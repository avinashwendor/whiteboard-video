/**
 * Which language a finished transcript is actually in, read off its script.
 *
 * When the user picks "auto" Whisper decides the language itself, but this
 * version of transformers.js gives no way to ask which one it chose: the ASR
 * pipeline never forwards `return_language` to `_decode_asr`, and with word
 * timestamps it slices the prefix tokens off the sequence — which is exactly
 * where the language token sits.
 *
 * The script is enough for what the answer is used for. The CTC aligner is
 * chosen by character vocabulary, not by grammar: Telugu text needs the
 * romanizing MMS path, Han text needs the CJK model, Latin text needs a Latin
 * model, and the Latin languages we support all share one aligner anyway. So
 * counting characters answers the only question being asked.
 *
 * Latin resolves to English on purpose. It is not a claim that the speech was
 * English — es/fr/de/en all map to a Latin aligner, and `en`'s model is the one
 * that is always correct for ASCII.
 */
import type { TranscriptLanguage } from "./languages";

/** Unicode ranges that decide the answer, in priority order. */
const SCRIPT_RANGES: Array<{
  language: TranscriptLanguage;
  ranges: Array<[number, number]>;
}> = [
  { language: "te", ranges: [[0x0c00, 0x0c7f]] }, // Telugu
  { language: "zh", ranges: [[0x4e00, 0x9fff], [0x3400, 0x4dbf]] }, // Han
  { language: "en", ranges: [[0x0041, 0x005a], [0x0061, 0x007a]] }, // Latin
];

function inRanges(cp: number, ranges: Array<[number, number]>): boolean {
  for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return true;
  return false;
}

/**
 * The dominant script's language, or null when the text is too short or is in a
 * script we have no aligner for (Devanagari, Arabic, Cyrillic …). Null means
 * "skip CTC", which leaves the envelope heuristic doing the timing — the same
 * safe fallback every unsupported language already takes.
 */
export function detectLanguageFromText(
  text: string
): TranscriptLanguage | null {
  const counts = new Map<TranscriptLanguage, number>();
  let scored = 0;

  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    for (const { language, ranges } of SCRIPT_RANGES) {
      if (inRanges(cp, ranges)) {
        counts.set(language, (counts.get(language) ?? 0) + 1);
        scored++;
        break;
      }
    }
  }

  if (scored < 4) return null;

  let best: TranscriptLanguage | null = null;
  let bestCount = 0;
  for (const [language, count] of counts) {
    if (count > bestCount) {
      best = language;
      bestCount = count;
    }
  }

  // A non-Latin script wins on any real presence: code-mixed Telugu is mostly
  // Latin by character count once English words are in it, and it is the Telugu
  // that decides the aligner.
  for (const { language } of SCRIPT_RANGES) {
    if (language === "en") continue;
    const count = counts.get(language) ?? 0;
    if (count >= 4 && count >= scored * 0.15) return language;
  }

  return best;
}
