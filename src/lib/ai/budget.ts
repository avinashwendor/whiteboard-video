/**
 * How much of the conversation actually fits.
 *
 * Nothing in this app counted tokens. Input was budgeted in *characters* on the
 * way in — a transcript cap here, an assistant-echo cap there — and once the
 * agent loop started, its message array was append-only for up to sixteen
 * turns with no trimming, no summarisation and no eviction. The failure that
 * produced was a provider 400, which arrives indistinguishable from a malformed
 * body and killed the whole plan on the first occurrence.
 *
 * So: an estimate good enough to trim by, a table of what each model will take,
 * and a packer that decides what to leave out. All pure functions of their
 * inputs — the packer never reads the clock or a store — so the eval harness
 * can pin the trimming behaviour down without a provider.
 */

import type { ChatMessage, ContentPart } from "./types";

/* -------------------------------- estimating ------------------------------- */

/**
 * Characters per token.
 *
 * The usual rule of thumb for English prose is 4. This deliberately runs under
 * it: what gets counted here is mostly JSON — operation names, quoted keys,
 * timestamps, hex colours — and punctuation tokenises far denser than prose.
 * Under-guessing the ratio means over-guessing the token count, which spends
 * some context we could have used. Over-guessing it means a 400. The asymmetry
 * is the whole reason for the number.
 */
const CHARS_PER_TOKEN = 3.5;

/** Rough per-message overhead for role framing, in tokens. */
const MESSAGE_OVERHEAD = 4;

/**
 * A picture is not free and is not measurable from its length.
 *
 * A `data:` URL's character count says nothing about what the vision model
 * charges for it, and counting the base64 would be wildly wrong in the other
 * direction. This is a flat, deliberately generous stand-in.
 */
const IMAGE_TOKENS = 800;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function partTokens(part: ContentPart): number {
  if (part.type === "text") return estimateTokens(part.text);
  return IMAGE_TOKENS;
}

export function messageTokens(message: ChatMessage): number {
  const content = message.content;
  const body =
    typeof content === "string"
      ? estimateTokens(content)
      : content.reduce((sum, part) => sum + partTokens(part), 0);
  return body + MESSAGE_OVERHEAD;
}

export function conversationTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0);
}

/* --------------------------------- limits ---------------------------------- */

/**
 * Context windows, in tokens.
 *
 * These are **floors we are confident in, not the vendors' advertised maxima**.
 * Every id here is an Omega routing name — the same `claude-` prefix fronts
 * several different vendors' models — so the window behind one can change
 * without the id changing. Sitting under the real number costs a little context
 * and nothing else; sitting over it costs the whole request.
 */
const MODEL_LIMITS: Record<string, number> = {
  "claude-opus-4-8": 200_000,
  "claude-opus-4-7": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-omega-plus": 128_000,
  "claude-gpt-5-5": 128_000,
  "claude-gemini-3-1-pro": 200_000,
};

/** What an unrecognised model is assumed to take. */
const DEFAULT_LIMIT = 128_000;

/**
 * Never hand the whole window to the input.
 *
 * The completion has to fit in the same window, and a request that budgets to
 * the last token leaves the model no room to answer — which surfaces as a
 * truncated reply rather than an error, and is harder to diagnose than a
 * rejection would have been.
 */
const SAFETY_MARGIN = 0.9;

export function contextLimitFor(model: string | undefined): number {
  if (!model) return DEFAULT_LIMIT;
  return MODEL_LIMITS[model] ?? DEFAULT_LIMIT;
}

/** Tokens available for the messages, once the answer has been reserved for. */
export function inputBudget(model: string | undefined, maxTokens: number): number {
  const limit = contextLimitFor(model);
  return Math.max(1_000, Math.floor(limit * SAFETY_MARGIN) - maxTokens);
}

/* --------------------------------- packing --------------------------------- */

export interface PackOptions {
  /**
   * Messages that are never trimmed and never dropped: the system prompt and
   * the brief describing the project. Losing either does not shorten the
   * conversation, it lobotomises it.
   */
  pinned: ChatMessage[];
  /** The conversation so far, oldest first. */
  body: ChatMessage[];
  budget: number;
  /**
   * How many of the newest body messages stay verbatim.
   *
   * The most recent exchange is what the next reply is actually about — a
   * digested tool result the model is mid-way through reasoning over is worse
   * than no tool result at all.
   */
  keepRecent?: number;
}

export interface PackResult {
  messages: ChatMessage[];
  tokens: number;
  /** Older messages shortened to a digest. */
  digested: number;
  /** Older messages left out entirely. */
  dropped: number;
  /** True when the pinned messages alone exceed the budget. */
  overflowed: boolean;
}

/** How much of a digested message survives, in characters. */
const DIGEST_CHARS = 400;

function digest(message: ChatMessage): ChatMessage {
  const content = message.content;
  if (typeof content !== "string") return message;
  if (content.length <= DIGEST_CHARS) return message;
  const cut = content.length - DIGEST_CHARS;
  return {
    ...message,
    content: `${content.slice(0, DIGEST_CHARS)}\n…(${cut} characters trimmed to fit)`,
  };
}

/**
 * Fit a conversation into a budget, giving up the least useful parts first.
 *
 * The order is deliberate and is what an editor would do with their own notes:
 * shorten the old ones, then throw the oldest away, and never touch the brief
 * or the thing you were just asked.
 */
export function packMessages(options: PackOptions): PackResult {
  const { pinned, body, budget } = options;
  const keepRecent = options.keepRecent ?? 4;

  const pinnedTokens = conversationTokens(pinned);
  const assemble = (rest: ChatMessage[]): ChatMessage[] => [...pinned, ...rest];

  // Already fits: the common case, and it must cost nothing.
  const whole = conversationTokens(body) + pinnedTokens;
  if (whole <= budget) {
    return {
      messages: assemble(body),
      tokens: whole,
      digested: 0,
      dropped: 0,
      overflowed: false,
    };
  }

  // The pinned half alone is too big. Nothing this function does can help —
  // say so rather than returning something that will be rejected anyway.
  if (pinnedTokens >= budget) {
    return {
      messages: assemble([]),
      tokens: pinnedTokens,
      digested: 0,
      dropped: body.length,
      overflowed: true,
    };
  }

  const boundary = Math.max(0, body.length - keepRecent);
  const recent = body.slice(boundary);
  const original = body.slice(0, boundary);

  // Pass one: shorten the old ones.
  let older = original.map(digest);

  // Pass two: drop from the oldest end until it fits. `recent` is never
  // dropped, which is why the pinned-overflow check above has to come first.
  let dropped = 0;
  let tokens = pinnedTokens + conversationTokens(older) + conversationTokens(recent);
  while (tokens > budget && older.length > 0) {
    tokens -= messageTokens(older[0]);
    older = older.slice(1);
    dropped += 1;
  }

  // Counted over the survivors, not over everything shortened: a message that
  // was digested and then dropped was dropped, and reporting it as both would
  // make the two numbers add up to more than the conversation.
  const digested = older.filter((m, i) => m !== original[dropped + i]).length;

  return {
    messages: assemble([...older, ...recent]),
    tokens,
    digested,
    dropped,
    overflowed: tokens > budget,
  };
}
