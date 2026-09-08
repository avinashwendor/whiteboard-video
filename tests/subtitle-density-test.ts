/**
 * Dense captions, emphasis, and the presets that ask for them.
 *
 * Three things go wrong here and none of them throws.
 *
 * A word ceiling that the grouper ignores produces ordinary two-line captions
 * from a preset whose entire point is one word at a time — the operation looks
 * like it ran and the video is unchanged. A minimum hold applied to a one-word
 * track makes every cue overlap the next, and the de-overlap pass then trims
 * them all to nothing, so the captions vanish. And a preset list restated in
 * the schema rejects names the prompt has already taught, which reaches the
 * person as "that edit couldn't be worked out".
 *
 * Run with `npx tsx tests/subtitle-density-test.ts`.
 */

import {
  buildCues,
  cuesFromStyle,
  describeSubtitlePresets,
  rewrapCues,
  SUBTITLE_PRESETS,
  SUBTITLE_PRESET_IDS,
} from "../src/motionscript/lib/overlay/subtitles";
import { subtitlesOp } from "../src/motionscript/lib/overlay/ops-schema";
import {
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleStyle,
  type SubtitleTrack,
} from "../src/motionscript/lib/overlay/types";
import type { Word } from "../src/motionscript/lib/types";
import { SYSTEM } from "../src/lib/ai/motionscript-agent";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** A sentence, at a believable 150 words a minute. */
function speak(text: string, from = 0): Word[] {
  return text.split(" ").map((word, i) => ({
    id: `w${i}`,
    text: word,
    start: from + i * 0.4,
    end: from + i * 0.4 + 0.34,
    speaker: 0,
    deleted: false,
  })) as unknown as Word[];
}

const LINE =
  "we shipped the whole thing in 3 days and it cost us $400 which is roughly 90% less than the quote";
const words = speak(LINE);

/* ------------------------------ the ceiling -------------------------------- */

{
  const loose = buildCues(words, [], { maxCharsPerLine: 40, maxLines: 2 });
  const one = buildCues(words, [], { maxCharsPerLine: 40, maxLines: 2, maxWords: 1 });
  const three = buildCues(words, [], { maxCharsPerLine: 40, maxLines: 2, maxWords: 3 });

  assert(loose.length > 0, "the baseline produces cues at all");
  assert(
    one.length === words.length,
    `one word a cue means one cue a word — got ${one.length} for ${words.length} words`
  );
  assert(
    one.every((cue) => (cue.words ?? []).length === 1),
    "and every cue really does hold one word"
  );
  assert(
    three.every((cue) => (cue.words ?? []).length <= 3),
    "a ceiling of three is never exceeded"
  );
  assert(
    one.length > three.length && three.length > loose.length,
    `denser settings produce more cues (${one.length} > ${three.length} > ${loose.length})`
  );

  // The failure that eats the captions: padding every cue to the 0.6s minimum
  // makes each overlap the next, and the de-overlap pass trims them to zero.
  assert(
    one.every((cue) => cue.end > cue.start),
    "no one-word cue is trimmed out of existence"
  );
  const held = one.reduce((n, cue) => n + (cue.end - cue.start), 0);
  assert(held > 2, `a dense track still holds text on screen — only ${held.toFixed(2)}s total`);

  // Nothing spoken is lost at any density.
  for (const [name, cues] of [["one", one], ["three", three], ["loose", loose]] as const) {
    const said = cues
      .flatMap((cue) => cue.words ?? [])
      .map((w) => w.text)
      .join(" ");
    assert(said === LINE, `${name}: the words are all still there`);
  }
  console.log("✓ the word ceiling is honoured and loses nothing");
}

/* ------------------------------- the presets -------------------------------- */

{
  for (const preset of SUBTITLE_PRESETS) {
    const style: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, ...preset.style };

    // Every preset has to be complete. One that leaves a field out inherits
    // whatever the last preset set, so switching presets gives a different
    // result depending on which one you were on before.
    assert(typeof style.maxWords === "number", `${preset.id}: no maxWords`);
    assert(style.activeScale >= 1 && style.activeScale <= 1.4, `${preset.id}: activeScale out of range`);
    assert(
      style.emphasis === "off" || style.emphasis === "auto",
      `${preset.id}: emphasis is not a real setting`
    );
    assert(
      style.fontFamily.includes("var(--font-"),
      `${preset.id}: the face is not one of ours (${style.fontFamily})`
    );
    // Legibility over footage is not optional.
    assert(
      style.outline || style.shadow || style.background !== null,
      `${preset.id}: nothing separates the type from the picture`
    );

    const cues = cuesFromStyle(words, [], style, 9 / 16);
    assert(cues.length > 0, `${preset.id}: produces no cues at all`);
    assert(
      cues.every((cue) => cue.end > cue.start),
      `${preset.id}: produces cues with no duration`
    );
    if (style.maxWords > 0) {
      assert(
        cues.every((cue) => (cue.words ?? []).length <= style.maxWords),
        `${preset.id}: asks for ${style.maxWords} words a cue and does not get it`
      );
    }
  }

  const dense = SUBTITLE_PRESETS.find((p) => p.id === "oneWord")!;
  const quiet = SUBTITLE_PRESETS.find((p) => p.id === "documentary")!;
  assert(dense.style.maxWords === 1, "the one-word preset asks for one word");
  assert(
    (quiet.style.maxWords ?? 0) === 0,
    "the documentary preset leaves it to the line length"
  );
  console.log(`✓ all ${SUBTITLE_PRESETS.length} presets are complete and produce cues`);
}

/* ------------------------------- the schema --------------------------------- */

{
  // The list the schema accepts is the list the library ships. It was a second
  // hardcoded copy, and a copy rejects every name added after it was written.
  for (const preset of SUBTITLE_PRESETS) {
    const parsed = subtitlesOp.safeParse({ op: "subtitles", action: "on", preset: preset.id });
    assert(parsed.success, `the schema rejects the real preset "${preset.id}"`);
  }
  assert(
    SUBTITLE_PRESET_IDS.length === SUBTITLE_PRESETS.length,
    "the id list and the library are the same length"
  );
  assert(
    !subtitlesOp.safeParse({ op: "subtitles", action: "on", preset: "nope" }).success,
    "and an invented preset is still refused"
  );

  const full = subtitlesOp.safeParse({
    op: "subtitles",
    action: "style",
    preset: "punch",
    typeface: "anton",
    wordsPerCue: 2,
    emphasis: "auto",
    emphasisColor: "#4ade80",
    keywords: ["motionscript", "free"],
    activeScale: 1.12,
  });
  assert(full.success, `the whole vocabulary parses: ${JSON.stringify(full.error?.issues)}`);
  assert(
    !subtitlesOp.safeParse({ op: "subtitles", action: "style", activeScale: 2 }).success,
    "a scale that would wobble is refused"
  );
  console.log("✓ the schema accepts exactly what exists");
}

/* -------------------------------- rewrapping -------------------------------- */

{
  // Re-breaking for another frame shape must not quietly undo the density.
  const style: SubtitleStyle = {
    ...DEFAULT_SUBTITLE_STYLE,
    ...SUBTITLE_PRESETS.find((p) => p.id === "punch")!.style,
  };
  const track: SubtitleTrack = {
    enabled: true,
    generated: true,
    style,
    cues: cuesFromStyle(words, [], style, 16 / 9),
  };
  const vertical = rewrapCues(track, 9 / 16);
  assert(
    vertical.cues.every((cue) => (cue.words ?? []).length <= style.maxWords),
    "a re-wrap for a vertical frame keeps the word ceiling"
  );
  assert(vertical.cues.length > 0, "and still produces cues");
  console.log("✓ re-wrapping preserves the density");
}

/* -------------------------------- the prompt -------------------------------- */

{
  const listing = describeSubtitlePresets();
  for (const preset of SUBTITLE_PRESETS) {
    assert(
      listing.includes(preset.id),
      `preset "${preset.id}" is missing from the generated listing`
    );
    assert(
      SYSTEM.includes(preset.id),
      `preset "${preset.id}" never reaches the prompt the model is given`
    );
  }
  assert(
    SYSTEM.includes("wordsPerCue"),
    "the agent is never told how to ask for dense captions"
  );
  assert(SYSTEM.includes("emphasis"), "nor how to stress the figures");
  console.log("✓ every preset reaches the model");
}

console.log("\nsubtitle density: all checks passed");
