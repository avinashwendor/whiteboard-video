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
 * 2. **Romanized display.** When the user picks the "roman" script, the same
 *    transliteration is put through the conventions people actually write in —
 *    Hinglish and Tinglish — rather than shown as folded IAST. See
 *    {@link toPopularRoman} for why those are not the same thing.
 *
 * English words mixed into the speech are already Latin and pass through
 * untouched: transliteration only fires on tokens that actually contain Indic
 * codepoints. That is the whole trick behind code-mixed output — a sentence
 * spoken half in Hindi and half in English comes back as one line of Latin
 * with the English still spelled the way English is spelled.
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
    // Composed first. A nukta written as its own combining character (ड + ़
    // rather than ड़) is not a letter sanscript knows, so it survives into the
    // output as a stray mark that later splits a syllable in two — बड़ा came
    // back as "baḍa़ā" and read as "badaa".
    return t(text.normalize("NFC"), scheme, "iast");
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

/* ----------------------------- Hinglish, Tinglish ---------------------------- */

/**
 * IAST, put through the conventions people actually write in.
 *
 * Folding the diacritics off IAST is the obvious way to get Latin text out of
 * Devanagari or Telugu, and it produces something nobody writes. IAST is a
 * transliteration scheme built to be reversible, not readable: its `c` is the
 * *ch* sound, so चाय comes out "caya" rather than "chai"; its `ś` and `ṣ` are
 * both *sh*, so शुक्रिया reads "sukriya"; and the anusvara `ṃ` — which is in a
 * huge share of Hindi words — folds to a bare "m", turning मैं into "maim" and
 * नहीं into "nahim".
 *
 * Hinglish and Tinglish are real orthographies with real conventions, and this
 * applies them:
 *
 *  - `c` is *ch* and `ch` is *chh* — the single biggest difference, and the one
 *    that makes the output look like a language rather than a decoding.
 *  - `ś` and `ṣ` are both *sh*.
 *  - The anusvara takes the place of what follows it: *m* before a labial or at
 *    the end of a Telugu word (कष्टं → "kashtam"), *n* everywhere else (मैं →
 *    "main", संस्कृत → "sanskrit", పంచాయత్ → "panchayat").
 *  - Vocalic `ṛ` is *ri*.
 *  - Hindi drops its final inherent vowel and Telugu does not, which is why
 *    घर is "ghar" and ప్రేమ is "prema". Without this every Hindi word gains a
 *    syllable it is not spoken with: "ghara", "kamala", "bahuta".
 *
 * Long vowels are deliberately left single. "aa"/"ee"/"oo" spellings exist and
 * are common in some words and wrong in others — "theek" but "jaldi", "baat"
 * but "kya" — and there is no rule that gets both. A single vowel is never the
 * jarring choice; a doubled one often is.
 */
export function toPopularRoman(iast: string, scheme: string | null): string {
  // Anusvara first, while there is still a following letter to look at.
  let out = iast.replace(/[ṃṁ]/gu, (_m, index: number, whole: string) => {
    const next = whole[index + 1] ?? "";
    if (/[pbm]/.test(next)) return "m";
    // End of a word: Telugu writes it as -m (కష్టం "kashtam"), Hindi as -n
    // (मैं "main", हैं "hain").
    if (!/\p{L}/u.test(next)) return scheme === "telugu" ? "m" : "n";
    return "n";
  });

  out = out
    .replace(/[ṛṝ]/gu, "ri")
    .replace(/[ḷḹ]/gu, "li")
    .replace(/[śṣ]/gu, "sh")
    .replace(/[ñṅṇ]/gu, "n")
    .replace(/ḥ/gu, "h")
    // One left-to-right pass over all three, so a replacement cannot feed the
    // next rule. `cch` is the aspirated geminate (अच्छा → "achcha"), `ch` is
    // the aspirate (छोटा → "chhota"), and a bare `c` is the plain ch sound
    // (चाय → "chay"). Run separately, "cch" would come out "achchha".
    .replace(/cch|ch|c/gu, (m) => (m === "cch" ? "chch" : m === "ch" ? "chh" : "ch"));

  // Before the fold, while a long ā is still distinguishable from a schwa.
  if (scheme === "devanagari") out = dropFinalSchwa(out);

  // Everything left is a length or retroflex mark: fold it to plain ASCII.
  return out.normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Hindi does not pronounce the inherent vowel at the end of a word, and does
 * not write it in Latin either: घर is "ghar", not "ghara".
 *
 * Only the final one. Medial schwa deletion (कमला → "kamla") needs to know
 * where the stress is, and getting it wrong mangles a word rather than
 * lengthening it — so a trailing syllable that should not be there is the
 * better failure.
 */
const IAST_VOWEL = /[aāiīuūeoṛṝ]/iu;

function dropFinalSchwa(text: string): string {
  return text.replace(/\p{L}+/gu, (word) => {
    // Only a bare `a` — a long ā is a vowel that is spoken and written.
    if (!word.endsWith("a")) return word;
    const before = word[word.length - 2] ?? "";
    // "kyā" ends in a vowel; "ghara" ends in one after a consonant.
    if (!before || IAST_VOWEL.test(before)) return word;
    // Leave short words alone: "ka" without its vowel is not a word.
    return word.length >= 3 ? word.slice(0, -1) : word;
  });
}

/**
 * Readable romanization for display.
 *
 * Not the same fold the aligner gets: that one only has to be a stable
 * character sequence for a CTC model to time against, and is checked against
 * the audio downstream. This one is read by a person.
 */
export function romanizeForDisplay(
  text: string,
  language?: TranscriptLanguage | string
): string {
  if (!hasIndicChars(text)) return text;
  const scheme = schemeForText(text, language);
  const roman = transliterateToLatin(text, language);
  return toPopularRoman(roman, scheme);
}
