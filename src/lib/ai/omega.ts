import { AppError } from "@/lib/utils/errors";
import { fetchWithTimeout, raiseForStatus, readJson } from "@/lib/utils/http";
import type {
  ChatMessage,
  ModelInfo,
  TextGenerationInput,
  TextGenerationResult,
  TextProvider,
} from "./types";

/**
 * Omega C -- OpenAI-compatible chat completions.
 *
 * The published docs put the OpenAI-shaped routes under `/api/v1` while the
 * Anthropic-shaped routes and the model list live under `/v1`. Both spellings
 * have been observed in the wild, so the base is probed once at runtime and
 * cached rather than hardcoded.
 */

const ROOT = (process.env.OMEGA_BASE_URL ?? "https://api.omegaplusapi.com").replace(/\/+$/, "");
const CANDIDATE_BASES = dedupe([
  ...(process.env.OMEGA_BASE_URL ? [ROOT] : []),
  `${ROOT}/api/v1`,
  `${ROOT}/v1`,
]);

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Preference order when the caller does not name a model.
 *
 * Verified against a live account: every Omega id carries a `claude-` prefix
 * regardless of which vendor is behind it, so `gpt-5.5` is `claude-gpt-5-5`
 * here. The list is only a preference -- `listModels` is the source of truth
 * and an id that vanishes simply falls through to the next one.
 */
const MODEL_PREFERENCE = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-omega-plus",
  "claude-opus-4-7",
  "claude-gpt-5-5",
  "claude-gemini-3-1-pro",
];

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function apiKey(): string {
  const key = process.env.OMEGA_API_KEY?.trim();
  if (!key) {
    throw new AppError("missing_key", {
      userMessage: "Text generation isn't configured. Add OMEGA_API_KEY to .env.local.",
      detail: "OMEGA_API_KEY missing",
    });
  }
  return key;
}

function headers(): HeadersInit {
  const key = apiKey();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
    "x-api-key": key,
  };
}

/* ------------------------------ base discovery ----------------------------- */

let resolvedChatBase: string | null = null;
let chatBaseProbe: Promise<string> | null = null;

async function chatBase(): Promise<string> {
  if (resolvedChatBase) return resolvedChatBase;
  if (chatBaseProbe) return chatBaseProbe;

  chatBaseProbe = (async () => {
    let lastDetail = "";
    for (const base of CANDIDATE_BASES) {
      const res = await fetchWithTimeout(`${base}/chat/completions`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          model: MODEL_PREFERENCE[0],
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
        timeoutMs: 20_000,
        label: "omega probe",
      });
      // Anything other than "this path does not exist" means we found the route:
      // a 400 about the model or a 401 about the key both prove routing works.
      if (res.status !== 404 && res.status !== 405) {
        resolvedChatBase = base;
        return base;
      }
      lastDetail = `${base} -> ${res.status}`;
    }
    throw new AppError("provider_error", {
      userMessage: "Couldn't reach the Omega API. Check OMEGA_BASE_URL.",
      detail: `no chat/completions route found (${lastDetail})`,
    });
  })();

  try {
    return await chatBaseProbe;
  } finally {
    chatBaseProbe = null;
  }
}

/* -------------------------------- responses -------------------------------- */

interface OmegaChoice {
  message?: { content?: string | Array<{ type?: string; text?: string }> };
  delta?: { content?: string };
  finish_reason?: string;
}

interface OmegaChatResponse {
  model?: string;
  choices?: OmegaChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; type?: string } | string;
}

/** Content can arrive as a plain string or as Anthropic-style content blocks. */
function extractText(choice: OmegaChoice | undefined): string {
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block?.text === "string" ? block.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function body(input: TextGenerationInput, model: string, stream: boolean) {
  const payload: Record<string, unknown> = {
    model,
    messages: input.messages satisfies ChatMessage[],
    temperature: input.temperature ?? 0.7,
    max_tokens: input.maxTokens ?? 1600,
    stream,
  };
  if (input.json) payload.response_format = { type: "json_object" };
  return JSON.stringify(payload);
}

/* --------------------------------- provider -------------------------------- */

let modelCache: { at: number; models: ModelInfo[] } | null = null;
const MODEL_TTL_MS = 10 * 60_000;

const WORD_CASING: Record<string, string> = {
  gpt: "GPT",
  glm: "GLM",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  ai: "AI",
};

/**
 * `claude-gemini-3-1-pro` -> `Gemini 3.1 Pro`.
 *
 * The shared `claude-` prefix is Omega's routing convention, not the vendor, so
 * showing it would mislabel every non-Anthropic model in the picker.
 */
function labelFor(id: string): string {
  const parts = id.replace(/^claude-/, "").split("-");
  const merged: string[] = [];

  for (const part of parts) {
    const previous = merged[merged.length - 1];
    // Version numbers arrive split: "3", "1" -> "3.1".
    if (/^\d+$/.test(part) && previous && /\d$/.test(previous)) {
      merged[merged.length - 1] = `${previous}.${part}`;
    } else {
      merged.push(part);
    }
  }

  return merged
    .map((word) => {
      if (WORD_CASING[word]) return WORD_CASING[word];
      if (/^[vm]\d/.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export const omega: TextProvider = {
  id: "omega",

  isConfigured() {
    return Boolean(process.env.OMEGA_API_KEY?.trim());
  },

  async listModels() {
    if (modelCache && Date.now() - modelCache.at < MODEL_TTL_MS) return modelCache.models;

    const seen: ModelInfo[] = [];
    for (const base of dedupe([`${ROOT}/v1`, ...CANDIDATE_BASES])) {
      const res = await fetchWithTimeout(`${base}/models`, {
        headers: headers(),
        timeoutMs: 15_000,
        label: "omega models",
      });
      if (!res.ok) continue;
      const json = await readJson<{ data?: Array<{ id?: string; description?: string }> }>(
        res,
        "omega models",
      );
      for (const entry of json.data ?? []) {
        if (typeof entry?.id === "string" && entry.id) {
          seen.push({ id: entry.id, label: labelFor(entry.id), description: entry.description });
        }
      }
      if (seen.length) break;
    }

    if (!seen.length) {
      throw new AppError("provider_error", {
        userMessage: "Couldn't load the Omega model list.",
        detail: "no models returned from any candidate base",
      });
    }

    const ranked = seen.sort((a, b) => rank(a.id) - rank(b.id));
    modelCache = { at: Date.now(), models: ranked };
    return ranked;
  },

  async generateText(input) {
    const model = input.model ?? (await defaultModel());
    const base = await chatBase();

    const res = await fetchWithTimeout(`${base}/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: body(input, model, false),
      timeoutMs: DEFAULT_TIMEOUT_MS,
      label: "omega chat",
      signal: input.signal,
    });

    if (!res.ok) await raiseForStatus(res, "omega chat");

    const json = await readJson<OmegaChatResponse>(res, "omega chat");
    if (json.error) {
      const message = typeof json.error === "string" ? json.error : json.error.message;
      throw new AppError("provider_error", { detail: `omega chat error: ${message}` });
    }

    const text = extractText(json.choices?.[0]).trim();
    if (!text) {
      throw new AppError("malformed_response", {
        detail: `omega chat returned no content: ${JSON.stringify(json).slice(0, 300)}`,
      });
    }

    const usage = {
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
      totalTokens: json.usage?.total_tokens,
    };
    const finishReason = json.choices?.[0]?.finish_reason;
    input.onMeta?.({ finishReason, usage });

    return {
      text,
      model: json.model ?? model,
      provider: "omega",
      finishReason,
      usage,
    } satisfies TextGenerationResult;
  },

  async *streamText(input) {
    const model = input.model ?? (await defaultModel());
    const base = await chatBase();

    const res = await fetchWithTimeout(`${base}/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: body(input, model, true),
      timeoutMs: DEFAULT_TIMEOUT_MS,
      label: "omega stream",
      signal: input.signal,
    });

    if (!res.ok) await raiseForStatus(res, "omega stream");
    if (!res.body) throw new AppError("malformed_response", { detail: "omega stream had no body" });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let emitted = false;
    // Carried out of the loop and reported once at the end. `finish_reason` is
    // on the final chunk of an OpenAI-compatible stream; `usage` is only there
    // if the provider volunteers it, and is deliberately not asked for — an
    // unrecognised `stream_options` is a rejected request, and this path is
    // load-bearing for every plan the editor makes.
    let finishReason: string | undefined;
    let usage: OmegaChatResponse["usage"];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let parsed: OmegaChatResponse;
          try {
            parsed = JSON.parse(data) as OmegaChatResponse;
          } catch {
            continue;
          }
          const choice = parsed.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (parsed.usage) usage = parsed.usage;
          const delta = choice?.delta?.content;
          if (typeof delta === "string" && delta) {
            emitted = true;
            yield delta;
          }
        }
      }
    }

    if (!emitted) {
      throw new AppError("malformed_response", { detail: "omega stream produced no tokens" });
    }

    input.onMeta?.({
      finishReason,
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          }
        : undefined,
    });
  },
};

function rank(id: string): number {
  const index = MODEL_PREFERENCE.indexOf(id);
  return index === -1 ? MODEL_PREFERENCE.length + 1 : index;
}

/** First preferred model that the account actually exposes. */
export async function defaultModel(): Promise<string> {
  const models = await omega.listModels();
  for (const preferred of MODEL_PREFERENCE) {
    if (models.some((m) => m.id === preferred)) return preferred;
  }
  return models[0].id;
}

/** Convenience wrapper matching the shape named in the project brief. */
export function generateText(input: TextGenerationInput): Promise<TextGenerationResult> {
  return omega.generateText(input);
}
