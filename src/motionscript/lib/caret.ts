/**
 * Transcript caret: an insertion point between words.
 *
 * The transcript is a list of timed words, not a text buffer, so the caret is
 * modelled as "before word X" (or past the last word) rather than a character
 * offset. Word ids are stable across cuts and re-renders; positions in the
 * visible list are not, so the id is what gets stored.
 *
 * Everything here is pure — placement, movement and the seconds a caret maps to
 * — so the behaviour is testable without a DOM.
 */
import type { Word } from "./types";

export type CaretPos =
  | { kind: "before"; wordId: number }
  /** Past the final visible word. */
  | { kind: "end" };

/** Index of the caret in a 0..n insertion-slot space (n = after the last word). */
export function caretToIndex(caret: CaretPos, visible: Word[]): number {
  if (caret.kind === "end") return visible.length;
  const i = visible.findIndex((w) => w.id === caret.wordId);
  // A caret on a word that just got hidden falls back to the end, which is
  // where the text now stops.
  return i === -1 ? visible.length : i;
}

/** The caret at a given insertion slot, clamped into range. */
export function caretFromIndex(index: number, visible: Word[]): CaretPos {
  const clamped = Math.max(0, Math.min(index, visible.length));
  if (clamped >= visible.length) return { kind: "end" };
  return { kind: "before", wordId: visible[clamped].id };
}

/** Move the caret one slot left or right. */
export function moveCaret(
  caret: CaretPos,
  visible: Word[],
  direction: -1 | 1
): CaretPos {
  return caretFromIndex(caretToIndex(caret, visible) + direction, visible);
}

/**
 * Where a click lands: before the word when it hits the left half, after it
 * (i.e. before the next word) when it hits the right half — the same rule a
 * text caret follows.
 */
export function caretFromClick(
  word: Word,
  /** Horizontal position within the word's box, 0..1. */
  fraction: number,
  visible: Word[]
): CaretPos {
  const i = visible.findIndex((w) => w.id === word.id);
  if (i === -1) return { kind: "end" };
  return caretFromIndex(fraction < 0.5 ? i : i + 1, visible);
}

/**
 * Media time the caret sits at, used as the split point.
 *
 * A caret before a word splits at that word's start, so the word begins the new
 * clip. Past the last word there is nothing left to split off, so the caller
 * gets the end of the media and `canSplitAt` rejects it.
 */
export function caretTime(
  caret: CaretPos,
  visible: Word[],
  duration: number
): number {
  if (caret.kind === "end") return duration;
  const word = visible.find((w) => w.id === caret.wordId);
  return word ? word.start : duration;
}

/** The word immediately after the caret, if any. */
export function wordAfterCaret(
  caret: CaretPos,
  visible: Word[]
): Word | null {
  const i = caretToIndex(caret, visible);
  return i < visible.length ? visible[i] : null;
}
