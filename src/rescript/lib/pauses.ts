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
import type { TimeRange, Word } from "./types";

export interface Pause {
  /**
   * Id of the word the pause sits before, or `null` for the trailing pause
   * after the final word. Stable across re-renders; index is not.
   */
  beforeWordId: number | null;
  start: number;
  end: number;
  /**
   * Silence the viewer will actually hear here — the span minus anything
   * already cut, not `end - start`. The two differ wherever a cut lands inside
   * the gap, which is every gap beside a deleted word: the word's own span is
   * gone, and counting it would offer to remove time that is already removed.
   */
  duration: number;
}

/** Shorter than this is the natural rhythm of speech, not a pause. */
export const DEFAULT_MIN_PAUSE_S = 0.35;

export interface FindPausesOptions {
  /** Ignore gaps shorter than this. */
  minDuration?: number;
  /** Media duration, for the trailing pause. Omit to skip it. */
  duration?: number;
  /**
   * Ranges already cut. Silence inside one of these is not silence any more, so
   * it does not count towards the threshold and cannot make a pause on its own.
   */
  cuts?: TimeRange[];
}

/**
 * Gaps between consecutive words, plus the lead-in and tail.
 *
 * `words` is expected in timeline order and to exclude anything already cut —
 * a gap either side of a removed word is not silence the viewer will hear.
 */
export function findPauses(
  words: Word[],
  { minDuration = DEFAULT_MIN_PAUSE_S, duration, cuts }: FindPausesOptions = {}
): Pause[] {
  const pauses: Pause[] = [];
  if (words.length === 0) return pauses;

  /** How much of [start, end) is still in the video. */
  const audible = (start: number, end: number): number => {
    let left = end - start;
    for (const cut of cuts ?? []) {
      const from = Math.max(start, cut.start);
      const to = Math.min(end, cut.end);
      if (to > from) left -= to - from;
    }
    return left;
  };

  const add = (start: number, end: number, beforeWordId: number | null) => {
    if (end - start <= 0) return;
    const gap = audible(start, end);
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

/**
 * How long a gap must be before it is worth showing, in seconds.
 *
 * There is no correct value. A scripted read to camera leaves 0.2s between
 * clauses and a conversational take leaves a second; the same threshold turns
 * one transcript into a wall of chips and hides every real breath in the other.
 * So it is the user's to set, and these are the useful places to start from
 * rather than the only ones allowed.
 */
export const PAUSE_THRESHOLD_PRESETS = [0.2, 0.35, 0.8, 1.5] as const;

export const MIN_PAUSE_THRESHOLD_S = 0.05;
export const MAX_PAUSE_THRESHOLD_S = 3;

/** Clamp to the supported range, falling back to the default for junk. */
export function clampPauseThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MIN_PAUSE_S;
  // Round to the slider's step so the stored value and the rendered label agree.
  const stepped = Math.round(value * 20) / 20;
  return Math.min(MAX_PAUSE_THRESHOLD_S, Math.max(MIN_PAUSE_THRESHOLD_S, stepped));
}

const THRESHOLD_STORAGE_KEY = "rescript.pause-threshold";

/** Read the last-set pause threshold from localStorage. */
export function loadPauseThresholdPreference(): number {
  if (typeof window === "undefined") return DEFAULT_MIN_PAUSE_S;
  try {
    const raw = window.localStorage.getItem(THRESHOLD_STORAGE_KEY);
    if (raw !== null) return clampPauseThreshold(Number.parseFloat(raw));
  } catch {
    // private mode / disabled storage
  }
  return DEFAULT_MIN_PAUSE_S;
}

export function savePauseThresholdPreference(value: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THRESHOLD_STORAGE_KEY, String(value));
  } catch {
    // private mode / disabled storage
  }
}
