import { detectLanguageFromText } from "../src/rescript/lib/scriptDetect";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
const eq = (got: unknown, want: unknown, label: string) =>
  assert(got === want, `${label}: expected ${String(want)}, got ${String(got)}`);

/* ------------------------------ single scripts ---------------------------- */
eq(detectLanguageFromText("నేను బాగున్నాను ఈ రోజు"), "te", "pure Telugu");
eq(detectLanguageFromText("hello there my friend"), "en", "pure Latin");
eq(detectLanguageFromText("这是一个测试句子"), "zh", "pure Han");

/* ------------------------------- code mixing ------------------------------ */
{
  // Telugu + English: Latin can out-count Telugu by characters, but it is the
  // Telugu that decides which aligner and romanization apply.
  eq(
    detectLanguageFromText("నేను super బాగున్నాను thank you very much indeed"),
    "te",
    "code-mixed Telugu wins over Latin"
  );
  // A single stray non-Latin token should NOT hijack an otherwise English line.
  eq(
    detectLanguageFromText(
      "this is a completely ordinary english sentence with lots of words ఓ"
    ),
    "en",
    "one stray glyph does not flip the language"
  );
}

/* --------------------------- unsupported scripts -------------------------- */
{
  // The exact failure this guards: Whisper forced into the wrong language
  // emits confident nonsense in a script we have no aligner for. Detection must
  // return null so CTC is skipped and the envelope heuristic does the timing,
  // rather than mis-aligning against a model that cannot read it.
  eq(
    detectLanguageFromText("اُکھ چکن دیس کو دن نمڑا نکتری چی نکھونٹھا رہے"),
    null,
    "Arabic/Urdu script has no aligner"
  );
  eq(
    detectLanguageFromText("это предложение на русском языке"),
    null,
    "Cyrillic has no aligner"
  );
  eq(
    detectLanguageFromText("यह हिंदी में एक वाक्य है"),
    null,
    "Devanagari has no aligner yet"
  );
}

/* ------------------------------- degenerate ------------------------------- */
{
  eq(detectLanguageFromText(""), null, "empty text");
  eq(detectLanguageFromText("   \n  "), null, "whitespace only");
  eq(detectLanguageFromText("ok"), null, "too short to judge");
  eq(detectLanguageFromText("123 456 !!! ..."), null, "no letters at all");
}

console.log("ALL SCRIPT DETECT TESTS PASSED");
