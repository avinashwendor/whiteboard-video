/**
 * Silence between words, as something you can point at.
 *
 * Word timings come out of forced alignment, so the space between one word
 * ending and the next beginning is real measured silence rather than an
 * artefact of even spacing. That makes each gap an editable object: dead air at
 * the top of a take, a breath mid-sentence, the tail after the last word.
 *
 * Deliberately derived rather than stored. A pause is a function of the current
 * word timings, so it cannot drift out of sync with them — cut a word and the
 * neighbouring pauses simply recompute. Removing one is an ordinary cut over
 * its range, which is why nothing here mutates anything.
 */
import type { Word } from "./types";

export interface Pause {
  /**
   * Id of the word the pause sits before, or `null` for the trailing pause
   * after the final word. Stable across re-renders; index is not.
   */
  beforeWordId: number | null;
  start: number;
  end: number;
  duration: number;
}

/** Shorter than this is the natural rhythm of speech, not a pause. */
export const DEFAULT_MIN_PAUSE_S = 0.35;

export interface FindPausesOptions {
  /** Ignore gaps shorter than this. */
  minDuration?: number;
  /** Media duration, for the trailing pause. Omit to skip it. */
  duration?: number;
}

/**
 * Gaps between consecutive words, plus the lead-in and tail.
 *
 * `words` is expected in timeline order and to exclude anything already cut —
 * a gap either side of a removed word is not silence the viewer will hear.
 */
export function findPauses(
  words: Word[],
  { minDuration = DEFAULT_MIN_PAUSE_S, duration }: FindPausesOptions = {}
): Pause[] {
  const pauses: Pause[] = [];
  if (words.length === 0) return pauses;

  const add = (start: number, end: number, beforeWordId: number | null) => {
    const gap = end - start;
    // Epsilon because these are subtractions of floats: a gap the user set the
    // threshold to exactly (1.4 - 1.0 = 0.3999999999999999) must still count.
    // Also guards non-monotonic timings — overlapping words are not a pause.
    if (gap + 1e-9 >= minDuration) {
      pauses.push({ beforeWordId, start, end, duration: gap });
    }
  };

  // Dead air before anyone speaks.
  add(0, words[0].start, words[0].id);

  for (let i = 0; i < words.length - 1; i++) {
    add(words[i].end, words[i + 1].start, words[i + 1].id);
  }

  if (duration !== undefined) add(words[words.length - 1].end, duration, null);

  return pauses;
}

/** Human label for a pause chip: "0.4s", "1.2s". */
export function formatPause(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}
