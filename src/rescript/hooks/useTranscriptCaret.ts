"use client";

import { useCallback, useState } from "react";
import {
  caretFromClick,
  caretFromIndex,
  caretTime,
  moveCaret,
  wordAfterCaret,
  type CaretPos,
} from "@/rescript/lib/caret";
import type { Word } from "@/rescript/lib/types";

/**
 * Owns the transcript's insertion point and the slash menu it opens.
 *
 * The caret is a real editing affordance — click to place it, arrows to move
 * it, `/` to act at it — over a list of timed words rather than a text buffer.
 * Word text itself is not typed into: corrections keep their own popover, which
 * is what preserves each word's timing against the audio.
 */
export function useTranscriptCaret(visible: Word[], duration: number) {
  const [caret, setCaret] = useState<CaretPos | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);

  const closeSlash = useCallback(() => setSlashOpen(false), []);

  const clearCaret = useCallback(() => {
    setCaret(null);
    setSlashOpen(false);
  }, []);

  /** Place the caret from a click on a word, at its left or right half. */
  const placeFromClick = useCallback(
    (word: Word, fraction: number) => {
      setCaret(caretFromClick(word, fraction, visible));
      setSlashOpen(false);
    },
    [visible]
  );

  /** Arrow-key movement; a first press with no caret starts at the beginning. */
  const move = useCallback(
    (direction: -1 | 1) => {
      setSlashOpen(false);
      setCaret((current) =>
        current
          ? moveCaret(current, visible, direction)
          : caretFromIndex(0, visible)
      );
    },
    [visible]
  );

  const openSlash = useCallback(() => {
    // `/` with no caret yet acts at the start rather than doing nothing.
    setCaret((current) => current ?? caretFromIndex(0, visible));
    setSlashOpen(true);
  }, [visible]);

  /** Media time the caret sits at — the split point. */
  const timeAtCaret = useCallback(
    () => (caret ? caretTime(caret, visible, duration) : null),
    [caret, visible, duration]
  );

  /** Word the caret sits before; the anchor the slash menu floats against. */
  const anchorWord = caret ? wordAfterCaret(caret, visible) : null;

  return {
    caret,
    setCaret,
    clearCaret,
    placeFromClick,
    move,
    slashOpen,
    openSlash,
    closeSlash,
    timeAtCaret,
    /** Falls back to the last word so an end-caret still has something to anchor to. */
    anchorWord: anchorWord ?? (caret ? (visible[visible.length - 1] ?? null) : null),
  };
}
