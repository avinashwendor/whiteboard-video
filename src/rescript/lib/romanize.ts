/**
 * Romanize a transcript for display.
 *
 * Transliteration is per-word and never changes the number of words or their
 * timings, so the romanized transcript drops straight into the same timeline
 * the aligner produced — every `start` / `end` / `speaker` is preserved. Words
 * with no Indic characters (English mixed into the speech) are left as-is.
 */
import type { Word } from "./types";
import type { TranscriptLanguage } from "./languages";
import { romanizeForDisplay } from "./indic";

/** Romanize one word's text, preserving its timing fields. */
export function romanizeWord(
  word: Word,
  language?: TranscriptLanguage | string
): Word {
  const text = romanizeForDisplay(word.text, language);
  return text === word.text ? word : { ...word, text };
}

/** Romanize a whole word list for the roman-script view. */
export function romanizeWords(
  words: Word[],
  language?: TranscriptLanguage | string
): Word[] {
  return words.map((word) => romanizeWord(word, language));
}
