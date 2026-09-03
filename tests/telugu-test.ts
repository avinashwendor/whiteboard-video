import {
  DEFAULT_TRANSCRIPT_SCRIPT,
  isRomanizableLanguage,
  isTranscriptLanguage,
  isTranscriptScript,
  TRANSCRIPT_LANGUAGE_ORDER,
  TRANSCRIPT_LANGUAGES,
} from "../src/rescript/lib/languages";
import {
  hasIndicChars,
  isIndicLanguage,
  romanizeForAlign,
  romanizeForDisplay,
  transliterateToLatin,
} from "../src/rescript/lib/indic";
import { normalizeForCtc } from "../src/rescript/lib/forcedAlign";
import { romanizeWords } from "../src/rescript/lib/romanize";
import type { Word } from "../src/rescript/lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

/* -------------------------- language registration ------------------------- */
{
  assert(isTranscriptLanguage("te"), "te should be a valid language");
  assert(TRANSCRIPT_LANGUAGE_ORDER.includes("te"), "te missing from order");
  assert(
    TRANSCRIPT_LANGUAGES.te.nativeLabel === "తెలుగు",
    "te native label wrong"
  );
  assert(TRANSCRIPT_LANGUAGES.te.code === "TE", "te code wrong");
  assert(isRomanizableLanguage("te"), "te should be romanizable");
  assert(!isRomanizableLanguage("en"), "en should not be romanizable");
  assert(!isRomanizableLanguage("zh"), "zh should not be romanizable");
}

/* ------------------------------ script prefs ------------------------------ */
{
  assert(DEFAULT_TRANSCRIPT_SCRIPT === "native", "default script should be native");
  assert(isTranscriptScript("roman"), "roman should be a valid script");
  assert(isTranscriptScript("native"), "native should be a valid script");
  assert(!isTranscriptScript("latin"), "latin is not a valid script");
}

/* --------------------------- indic detection ------------------------------ */
{
  assert(isIndicLanguage("te"), "te is indic");
  assert(!isIndicLanguage("en"), "en is not indic");
  assert(hasIndicChars("తెలుగు"), "telugu string should have indic chars");
  assert(!hasIndicChars("hello world"), "english should have no indic chars");
  assert(hasIndicChars("నేను bro"), "mixed string should detect indic");
}

/* -------------------------- transliteration ------------------------------- */
{
  // Telugu → readable Latin (diacritics folded).
  const roman = romanizeForDisplay("నేను బాగున్నాను", "te");
  assert(/^[a-zA-Z ]+$/.test(roman), `display roman not plain latin: "${roman}"`);
  assert(roman.split(/\s+/).length === 2, `expected 2 words, got "${roman}"`);

  // English passes through untouched in both modes.
  assert(transliterateToLatin("hello", "te") === "hello", "english mangled");
  assert(romanizeForDisplay("bro", "te") === "bro", "english display mangled");
}

/* ------------------- CTC align folding (indic-roman) ---------------------- */
{
  // Native Telugu word folds to [a-z'] for the MMS aligner vocab.
  const folded = normalizeForCtc("తెలుగు", "indic-roman");
  assert(/^[a-z']+$/.test(folded), `align fold not [a-z']: "${folded}"`);
  assert(folded.length > 0, "align fold produced empty string");

  // Direct romanizeForAlign matches what the aligner sees.
  assert(
    romanizeForAlign("తెలుగు", "te") === folded,
    "romanizeForAlign disagrees with normalizeForCtc"
  );

  // English word inside a code-mixed transcript still folds to itself.
  assert(
    normalizeForCtc("okay", "indic-roman") === "okay",
    "english word broke under indic-roman fold"
  );
}

/* ---------------- romanizeWords preserves timing & count ------------------ */
{
  const words: Word[] = [
    { id: 1, text: "నేను", start: 0.0, end: 0.4, speaker: 0, deleted: false },
    { id: 2, text: "super", start: 0.4, end: 0.7, speaker: 0, deleted: false },
    { id: 3, text: "బాగున్నాను", start: 0.7, end: 1.3, speaker: 0, deleted: false },
  ];
  const romanized = romanizeWords(words, "te");
  assert(romanized.length === words.length, "word count changed");
  romanized.forEach((w, i) => {
    assert(w.start === words[i].start, `start changed at ${i}`);
    assert(w.end === words[i].end, `end changed at ${i}`);
    assert(w.speaker === words[i].speaker, `speaker changed at ${i}`);
    assert(w.id === words[i].id, `id changed at ${i}`);
    assert(w.deleted === words[i].deleted, `deleted changed at ${i}`);
  });
  assert(romanized[1].text === "super", "english word should be unchanged");
  assert(/^[a-zA-Z]+$/.test(romanized[0].text), "telugu word 0 not romanized");
  assert(/^[a-zA-Z]+$/.test(romanized[2].text), "telugu word 2 not romanized");
}

console.log("ALL TELUGU TESTS PASSED");
