/**
 * Turning past verdicts into examples for the next plan.
 *
 * The system prompt contains **zero few-shot examples** — every operation is
 * taught by a single inline JSON line. That is the cheapest quality gap in the
 * whole agent, and the material to close it is now being collected: plans a
 * person read, judged and kept, on their own footage.
 *
 * Retrieval is lexical rather than semantic, deliberately and for now. A proper
 * embedding index is the right end state and is worth building; starting there
 * would mean the retrieval half of this could not ship until a model runs in a
 * worker, and an editing instruction is short, concrete and vocabulary-heavy
 * ("cut the fillers", "make it vertical", "add a lower third") — which is the
 * case lexical scoring handles well. The interface below is what an embedding
 * index would implement, so replacing the scorer does not touch the caller.
 */

import { listFeedback, type FeedbackEvent } from "./store";

/** An example handed to the planner. */
export interface Exemplar {
  instruction: string;
  title: string;
  detail: string;
  /** True when this is a step the person kept. */
  good: boolean;
}

/** Words too common in editing instructions to say anything about similarity. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "it", "this", "that", "is", "are", "be", "make", "made", "please",
  "can", "you", "i", "me", "my", "we", "video", "clip", "footage", "then",
  "some", "all", "every", "just", "so", "do", "does", "up", "out",
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * How alike two instructions are, 0..1.
 *
 * Jaccard over content words: shared terms against the size of the union, so a
 * long rambling instruction cannot score highly against everything simply by
 * containing more words. Symmetric, which matters because neither instruction
 * is privileged — one is not a query over the other, they are two things
 * someone said.
 */
export function similarity(a: string, b: string): number {
  const left = new Set(terms(a));
  const right = new Set(terms(b));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const term of left) if (right.has(term)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Below this two instructions have nothing useful to say about each other. */
const FLOOR = 0.2;

export interface RetrieveOptions {
  /** How many kept examples to return. */
  good?: number;
  /** How many rejected ones. Fewer: a warning needs less repetition. */
  bad?: number;
  /** Pass events in directly, for testing. Otherwise read from the store. */
  events?: FeedbackEvent[];
}

/**
 * The most similar past decisions to this instruction.
 *
 * Kept and rejected are ranked separately rather than taking the top *n*
 * overall. A single list would routinely come back all-good or all-bad — and
 * an example of what to avoid is worth more than a fourth example of what to
 * do, precisely because it is rarer.
 */
export async function retrieveExemplars(
  instruction: string,
  options: RetrieveOptions = {}
): Promise<Exemplar[]> {
  const wantGood = options.good ?? 3;
  const wantBad = options.bad ?? 2;
  if (wantGood + wantBad === 0) return [];

  const events = options.events ?? (await listFeedback());
  if (events.length === 0) return [];

  const scored: { event: FeedbackEvent; score: number }[] = [];
  for (const event of events) {
    // A failed step says nothing about taste — it says something broke — so it
    // is left out of both lists rather than taught as a bad example.
    if (event.verdict === "failed") continue;
    const score = similarity(instruction, event.instruction);
    if (score < FLOOR) continue;
    scored.push({ event, score });
  }

  scored.sort((a, b) => b.score - a.score || b.event.createdAt - a.event.createdAt);

  const good: Exemplar[] = [];
  const bad: Exemplar[] = [];
  const seen = new Set<string>();

  for (const { event } of scored) {
    // The same step title recurring across sessions is one lesson, not five.
    const key = `${event.verdict === "accepted"}:${event.stepTitle}`;
    if (seen.has(key)) continue;

    const exemplar: Exemplar = {
      instruction: event.instruction,
      title: event.stepTitle,
      detail: event.stepDetail,
      good: event.verdict === "accepted",
    };

    if (exemplar.good && good.length < wantGood) {
      seen.add(key);
      good.push(exemplar);
    } else if (!exemplar.good && bad.length < wantBad) {
      seen.add(key);
      bad.push(exemplar);
    }
    if (good.length >= wantGood && bad.length >= wantBad) break;
  }

  return [...good, ...bad];
}

/* --------------------------------- memory ---------------------------------- */

/**
 * Standing preferences, inferred from what keeps being kept and dropped.
 *
 * The third tier of memory: not this run, not this project, but the things
 * someone has demonstrated across all of them. Deliberately small and
 * conservative — an inferred rule that is wrong is worse than none, because it
 * quietly steers every future plan and nobody knows it is there.
 */
export interface StandingPreference {
  /** A sentence to put in the prompt. */
  note: string;
  /** How many decisions support it. */
  support: number;
}

/** Below this many consistent decisions, a pattern is a coincidence. */
const MIN_SUPPORT = 3;

/** …and it must be this one-sided to count as a preference at all. */
const MIN_RATIO = 0.75;

export function standingPreferences(
  events: FeedbackEvent[]
): StandingPreference[] {
  const byOp = new Map<string, { kept: number; dropped: number }>();

  for (const event of events) {
    if (event.verdict === "failed") continue;
    const kept = event.verdict === "accepted";
    // Counted per *operation kind* rather than per step title: "add a caption"
    // and "put a caption at 12s" are the same preference expressed twice, and
    // the op is the part both have in common.
    for (const op of new Set(event.ops.map((o) => o.op))) {
      const row = byOp.get(op) ?? { kept: 0, dropped: 0 };
      if (kept) row.kept += 1;
      else row.dropped += 1;
      byOp.set(op, row);
    }
  }

  const out: StandingPreference[] = [];
  for (const [op, { kept, dropped }] of byOp) {
    const total = kept + dropped;
    if (total < MIN_SUPPORT) continue;
    if (dropped / total >= MIN_RATIO) {
      out.push({
        note: `They have turned down "${op}" ${dropped} of the last ${total} times it was suggested. Do not reach for it unless they ask.`,
        support: dropped,
      });
    } else if (kept / total >= MIN_RATIO && total >= MIN_SUPPORT + 1) {
      out.push({
        note: `They keep "${op}" almost every time it is offered.`,
        support: kept,
      });
    }
  }

  return out.sort((a, b) => b.support - a.support).slice(0, 4);
}
