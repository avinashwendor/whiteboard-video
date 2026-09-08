/**
 * Hinglish and Tinglish: the romanized transcript, spelled the way people write.
 *
 * Folding the diacritics off IAST is the obvious way to get Latin out of
 * Devanagari or Telugu, and it produces something nobody writes. IAST is built
 * to be reversible, not readable — its `c` is the *ch* sound, so चाय decodes to
 * "caya"; both `ś` and `ṣ` are *sh*; and the anusvara `ṃ`, which is in a large
 * share of Hindi words, folds to a bare "m" and turns मैं into "maim".
 *
 * So the rules are a real orthography rather than a character mapping, and the
 * only honest way to check an orthography is against words. The corpus below is
 * ordinary speech — the kind of thing that is actually in a video someone
 * uploads — with the spelling a person would use.
 *
 * Run with `npx tsx tests/hinglish-test.ts`.
 */

import { hasIndicChars, romanizeForDisplay } from "../src/motionscript/lib/indic";
import { romanizeWords } from "../src/motionscript/lib/romanize";
import {
  TRANSCRIPT_LANGUAGES,
  TRANSCRIPT_LANGUAGE_ORDER,
  isRomanizableLanguage,
  isTranscriptLanguage,
} from "../src/motionscript/lib/languages";
import { detectLanguageFromText } from "../src/motionscript/lib/scriptDetect";
import { alignModelFor } from "../src/motionscript/lib/alignModels";
import type { Word } from "../src/motionscript/lib/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/* ---------------------------------- Hindi ---------------------------------- */

const HINGLISH: Array<[string, string]> = [
  // The anusvara, which plain folding turns into "maim" and "nahim".
  ["मैं", "main"],
  ["नहीं", "nahin"],
  ["हैं", "hain"],
  ["हिंदी", "hindi"],
  ["पंचायत", "panchayat"],
  ["संस्कृत", "sanskrit"],
  // `c` is the ch sound and `ch` is the aspirate.
  ["चाय", "chay"],
  ["अच्छा", "achcha"],
  ["छोटा", "chhota"],
  ["सच", "sach"],
  // The final inherent vowel, which Hindi does not speak and does not write.
  ["घर", "ghar"],
  ["कमल", "kamal"],
  ["बहुत", "bahut"],
  ["दोस्त", "dost"],
  ["लेकिन", "lekin"],
  ["समझ", "samajh"],
  ["धन्यवाद", "dhanyavad"],
  ["बात", "bat"],
  ["प्यार", "pyar"],
  // ...but not where the last vowel is a long one.
  ["क्या", "kya"],
  ["पैसा", "paisa"],
  ["कैसे", "kaise"],
  ["जल्दी", "jaldi"],
  ["शुक्रिया", "shukriya"],
  ["ठीक", "thik"],
  // A nukta written as its own combining character used to split the syllable.
  ["बड़ा", "bada"],
];

{
  for (const [source, expected] of HINGLISH) {
    const got = romanizeForDisplay(source, "hi");
    assert(got === expected, `${source} → "${got}", expected "${expected}"`);
  }
  console.log(`✓ ${HINGLISH.length} Hindi words read as Hinglish`);
}

/* --------------------------------- Telugu ---------------------------------- */

const TINGLISH: Array<[string, string]> = [
  ["నేను", "nenu"],
  ["బాగున్నాను", "bagunnanu"],
  ["ఏమిటి", "emiti"],
  ["చాలా", "chala"],
  ["ఇల్లు", "illu"],
  ["తెలుగు", "telugu"],
  ["వచ్చాను", "vachchanu"],
  ["మంచి", "manchi"],
  ["ఎక్కడ", "ekkada"],
  ["ధన్యవాదాలు", "dhanyavadalu"],
  ["చెప్పు", "cheppu"],
  ["తిన్నాను", "tinnanu"],
  // Telugu keeps its final vowel where Hindi drops it — and writes a final
  // anusvara as -m, where Hindi writes -n.
  ["ప్రేమ", "prema"],
  ["కష్టం", "kashtam"],
  ["సంతోషం", "santosham"],
];

{
  for (const [source, expected] of TINGLISH) {
    const got = romanizeForDisplay(source, "te");
    assert(got === expected, `${source} → "${got}", expected "${expected}"`);
  }
  console.log(`✓ ${TINGLISH.length} Telugu words read as Tinglish`);
}

/* ------------------------------- the mixing -------------------------------- */

{
  // The point of the feature. A sentence spoken half in Hindi and half in
  // English has to come back as one line of Latin with the English still
  // spelled the way English is spelled — not transliterated, not dropped.
  const spoken: Word[] = [
    { id: 1, text: "मैं", start: 0, end: 0.3, speaker: 0, deleted: false },
    { id: 2, text: "सोच", start: 0.3, end: 0.6, speaker: 0, deleted: false },
    { id: 3, text: "रहा", start: 0.6, end: 0.9, speaker: 0, deleted: false },
    { id: 4, text: "था", start: 0.9, end: 1.1, speaker: 0, deleted: false },
    { id: 5, text: "ki", start: 1.1, end: 1.3, speaker: 0, deleted: false },
    { id: 6, text: "we", start: 1.3, end: 1.5, speaker: 0, deleted: false },
    { id: 7, text: "should", start: 1.5, end: 1.8, speaker: 0, deleted: false },
    { id: 8, text: "ship", start: 1.8, end: 2.1, speaker: 0, deleted: false },
    { id: 9, text: "it", start: 2.1, end: 2.3, speaker: 0, deleted: false },
  ];

  const roman = romanizeWords(spoken, "hi");
  assert(
    roman.map((w) => w.text).join(" ") === "main soch raha tha ki we should ship it",
    `code-mixed line came back as "${roman.map((w) => w.text).join(" ")}"`
  );

  // Timings are what the whole editor is built on; transliteration must not
  // touch them, and must not change the number of words.
  assert(roman.length === spoken.length, "romanizing changed the word count");
  for (let i = 0; i < roman.length; i++) {
    assert(
      roman[i].start === spoken[i].start &&
        roman[i].end === spoken[i].end &&
        roman[i].id === spoken[i].id,
      `word ${i} lost its timing`
    );
  }

  // An English word is returned by identity, not rebuilt — cheap, and it means
  // an all-English transcript costs nothing to "romanize".
  const english = spoken[6];
  assert(romanizeWords([english], "hi")[0] === english, "an English word was rewritten");
  console.log("✓ a code-mixed line survives with its English and its timings intact");
}

/* ------------------------------- registration ------------------------------ */

{
  assert(isTranscriptLanguage("hi"), "hi is not a language the editor knows");
  assert(TRANSCRIPT_LANGUAGE_ORDER.includes("hi"), "hi is missing from the menu");
  assert(isRomanizableLanguage("hi"), "hi has no roman toggle");
  assert(TRANSCRIPT_LANGUAGES.hi.nativeLabel === "हिन्दी", "hi is not named in its own script");

  // The toggle says what it produces. "Roman" is accurate and nobody looks for it.
  assert(TRANSCRIPT_LANGUAGES.hi.romanLabel === "Hinglish", "the Hindi toggle is unnamed");
  assert(TRANSCRIPT_LANGUAGES.te.romanLabel === "Tinglish", "the Telugu toggle is unnamed");

  // Devanagari has to reach an aligner, or Hindi words get envelope timings and
  // every caption in the video is a quarter of a second late.
  const model = alignModelFor("hi");
  assert(model !== null, "Hindi has no forced aligner");
  assert(model!.normalize === "indic-roman", "Hindi is not folded for the MMS vocabulary");
  console.log("✓ Hindi is a language, with a toggle and an aligner");
}

/* -------------------------------- detection -------------------------------- */

{
  // Auto-detect has to name Devanagari, or a Hindi transcript silently skips
  // forced alignment.
  assert(detectLanguageFromText("मैं सोच रहा था") === "hi", "Devanagari not detected");
  assert(detectLanguageFromText("నేను బాగున్నాను") === "te", "Telugu not detected");

  // The case that matters: a whole transcript that is mostly English by
  // character count, where the script that decides the aligner is still the
  // Hindi. This is what a Hinglish recording actually looks like.
  const mixed =
    "तो मैं सोच रहा था ki we should ship it today. " +
    "लेकिन the deploy अभी तक ready नहीं है, so मैं ने कहा कल करते हैं.";
  assert(
    detectLanguageFromText(mixed) === "hi",
    `a code-mixed transcript was read as ${detectLanguageFromText(mixed)}`
  );

  // A borrowed word or two across a transcript of English is not a Hindi
  // transcript, and the threshold that keeps it from being one is deliberate:
  // choosing the Indic aligner for English costs every word its timing.
  const borrowed =
    "So we shipped it on दिवाली and nobody noticed, which was the whole point. " +
    "The release went out on a Friday afternoon and the dashboards stayed flat, " +
    "and that is the best outcome a migration of this size can have.";
  assert(
    detectLanguageFromText(borrowed) === "en",
    `a borrowed word switched the whole aligner to ${detectLanguageFromText(borrowed)}`
  );
  assert(detectLanguageFromText("just an english sentence here") === "en", "English misread");
  assert(hasIndicChars("मैं"), "Devanagari not recognised as Indic");
  console.log("✓ a code-mixed line is detected by the script that needs the aligner");
}

console.log("\nHinglish / Tinglish: all checks passed");
