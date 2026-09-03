/**
 * Indic-script helpers for transcription.
 *
 * Whisper transcribes Telugu / Hindi / Tamil in their native scripts. Two later
 * stages need those words folded to the Latin alphabet:
 *
 * 1. **Forced alignment.** The MMS CTC aligner (see {@link ALIGN_MODELS}) has a
 *    Latin-only vocabulary; Meta's reference pipeline romanizes non-Latin text
 *    with `uroman` before alignment. uroman has no browser build, so we
 *    approximate it with sanscript (IAST) plus diacritic folding — close enough
 *    for the aligner, which only needs a monotonic character sequence to time,
 *    and the run is sanity-checked against the envelope heuristic downstream.
 *
 * 2. **Romanized display.** When the user picks the "roman" script the same
 *    transliteration produces a readable "Tenglish"-style line.
 *
 * English words mixed into the speech are already Latin and pass through
 * untouched: transliteration only fires on tokens that actually contain Indic
 * codepoints.
 */
import Sanscript from "@indic-transliteration/sanscript";
import type { TranscriptLanguage } from "./languages";

/** transliterate(text, from, to) — the one call we use off the default export. */
const t = (Sanscript as unknown as {
  t: (text: string, from: string, to: string) => string;
}).t;

/**
 * Transcript language → sanscript Brahmic scheme name. Keyed loosely by string
 * so Hindi/Tamil can be added to the language union later without touching this.
 */
const INDIC_SCHEME: Record<string, string> = {
  te: "telugu",
  hi: "devanagari",
  ta: "tamil",
};

/** Unicode block ranges for the Indic scripts we transliterate. */
const INDIC_RANGES: Array<[number, number]> = [
  [0x0900, 0x097f], // Devanagari (Hindi)
  [0x0b80, 0x0bff], // Tamil
  [0x0c00, 0x0c7f], // Telugu
];

/** True for a language whose transcript is a Brahmic Indic script. */
export function isIndicLanguage(
  language: TranscriptLanguage | string | undefined
): language is TranscriptLanguage {
  return language != null && language in INDIC_SCHEME;
}

/** Whether a string contains any character from a supported Indic block. */
export function hasIndicChars(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    for (const [lo, hi] of INDIC_RANGES) {
      if (cp >= lo && cp <= hi) return true;
    }
  }
  return false;
}

/** The sanscript scheme name for an Indic token, detected from its characters. */
function schemeForText(
  text: string,
  language: TranscriptLanguage | string | undefined
): string | null {
  // Prefer the caller's language, but a mixed transcript can carry a stray
  // token in another script, so fall back to detecting from the codepoints.
  if (isIndicLanguage(language)) return INDIC_SCHEME[language] ?? null;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0900 && cp <= 0x097f) return "devanagari";
    if (cp >= 0x0b80 && cp <= 0x0bff) return "tamil";
    if (cp >= 0x0c00 && cp <= 0x0c7f) return "telugu";
  }
  return null;
}

/**
 * Romanize an Indic word to IAST. Non-Indic input (English, punctuation,
 * already-Latin text) is returned unchanged so code-mixed lines survive intact.
 */
export function transliterateToLatin(
  text: string,
  language?: TranscriptLanguage | string
): string {
  if (!hasIndicChars(text)) return text;
  const scheme = schemeForText(text, language);
  if (!scheme) return text;
  try {
    return t(text, scheme, "iast");
  } catch {
    return text;
  }
}

/**
 * Fold text to the MMS aligner's `[a-z']` vocabulary: transliterate any Indic
 * content, drop the IAST diacritics via NFD, then keep letters and apostrophes.
 * Shared shape with {@link normalizeForCtc}'s Latin path so timings line up.
 */
export function romanizeForAlign(
  text: string,
  language?: TranscriptLanguage | string
): string {
  const roman = transliterateToLatin(text, language);
  return roman
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z']/g, "")
    .toLowerCase();
}

/**
 * Readable romanization for display: IAST with the diacritics folded to plain
 * ASCII (ā→a, ṭ→t, …) so it reads as ordinary Latin without losing spacing or
 * the English words around it.
 */
export function romanizeForDisplay(
  text: string,
  language?: TranscriptLanguage | string
): string {
  if (!hasIndicChars(text)) return text;
  const roman = transliterateToLatin(text, language);
  return roman.normalize("NFD").replace(/\p{M}/gu, "");
}
