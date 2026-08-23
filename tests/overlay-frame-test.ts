/**
 * The output frame, and the plan verifier.
 *
 * Two things that only fail on the way out: a frame whose arithmetic is a few
 * percent wrong produces a file nobody notices is wrong until it is uploaded,
 * and a verifier that is too eager sends the model back to fix a plan that was
 * already right. Both are pure functions, so both are cheap to pin down here.
 *
 * Run with `npx tsx tests/overlay-frame-test.ts`.
 */

import {
  DEFAULT_FRAME,
  DEFAULT_SUBTITLE_STYLE,
  emptyComposition,
  frameRatio,
  frameReframes,
  isEmptyComposition,
  outputSize,
  type FrameSpec,
} from "../src/rescript/lib/overlay/types";
import { subtitleBand, typeScale } from "../src/rescript/lib/overlay/layout";
import { fittedCharsPerLine } from "../src/rescript/lib/overlay/subtitles";
import { verifyPlan, type PlanWorld } from "../src/rescript/lib/overlay/verify";
import { siftOps } from "../src/rescript/lib/overlay/ops-schema";
import { jsonObjects, repairJson } from "../src/lib/ai/rescript-agent";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function close(a: number, b: number, tolerance = 1e-6): boolean {
  return Math.abs(a - b) <= tolerance;
}

function frame(patch: Partial<FrameSpec> = {}): FrameSpec {
  return { ...DEFAULT_FRAME, ...patch };
}

const WIDE = 16 / 9;
const TALL = 9 / 16;

/* ---------------------------------- ratio ---------------------------------- */

{
  assert(
    close(frameRatio(frame(), WIDE), WIDE),
    "the source frame is whatever the footage is"
  );
  assert(
    close(frameRatio(frame({ aspect: "9:16" }), WIDE), TALL),
    "a 9:16 frame ignores the footage's shape"
  );
  assert(
    close(frameRatio(frame({ aspect: "1:1" }), WIDE), 1),
    "a square frame is square"
  );
  assert(
    close(frameRatio(frame(), 0), WIDE),
    "an unknown source falls back to widescreen rather than dividing by zero"
  );
}

/* -------------------------------- reframing -------------------------------- */

{
  assert(!frameReframes(frame(), WIDE), "the source frame is not a reframe");
  assert(
    frameReframes(frame({ aspect: "9:16" }), WIDE),
    "widescreen footage in a vertical frame is a reframe"
  );
  assert(
    !frameReframes(frame({ aspect: "16:9" }), WIDE),
    "a frame that matches the footage is not a reframe, even when named"
  );
  assert(
    frameReframes(frame({ zoom: 1.4 }), WIDE),
    "a zoom is a reframe on its own"
  );
  assert(
    frameReframes(frame({ focusY: 0.3 }), WIDE),
    "a moved focus point is a reframe on its own"
  );

  // Export takes a fast path when there is nothing to burn in. A reframe has to
  // stop it doing that, or a vertical edit exports as the widescreen original.
  const empty = emptyComposition();
  assert(isEmptyComposition(empty, WIDE), "an untouched composition is empty");
  assert(
    !isEmptyComposition({ ...empty, frame: frame({ aspect: "9:16" }) }, WIDE),
    "a reframed composition is never empty, whatever else is on it"
  );
}

/* ------------------------------- output size ------------------------------- */

{
  const cases: [string, number, number, number, number, number][] = [
    // label, ratio, source w, source h, expected w, expected h
    ["widescreen stays as shot", WIDE, 1920, 1080, 1920, 1080],
    ["vertical from widescreen is a standard Short", TALL, 1920, 1080, 1080, 1920],
    ["vertical from vertical is native", TALL, 1080, 1920, 1080, 1920],
    ["Instagram portrait", 4 / 5, 1920, 1080, 1080, 1350],
    ["square from widescreen", 1, 1920, 1080, 1080, 1080],
    ["anamorphic crops rather than inventing width", 2.39, 1920, 1080, 1920, 804],
    ["widescreen from vertical", WIDE, 1080, 1920, 1920, 1080],
  ];

  for (const [label, ratio, sw, sh, ew, eh] of cases) {
    const size = outputSize(ratio, sw, sh);
    assert(
      size.width === ew && size.height === eh,
      `${label}: expected ${ew}×${eh}, got ${size.width}×${size.height}`
    );
    assert(
      size.width % 2 === 0 && size.height % 2 === 0,
      `${label}: H.264 needs even dimensions, got ${size.width}×${size.height}`
    );
  }

  const asked = outputSize(TALL, 1920, 1080, 720);
  assert(
    asked.height === 720 && asked.width === 406,
    `an explicit height wins and the width follows the frame, got ${asked.width}×${asked.height}`
  );
}

/* ---------------------------------- type ----------------------------------- */

{
  // The correction must be invisible on everything that was already fine.
  assert(close(typeScale(WIDE), 1), "widescreen type is unchanged");
  assert(close(typeScale(1), 1), "square type is unchanged");
  assert(close(typeScale(4 / 5), 1), "4:5 type is unchanged");
  assert(typeScale(TALL) < 1, "vertical type is pulled back");
  assert(
    close(typeScale(TALL), 0.75),
    `9:16 should scale type to 0.75 of the old unit, got ${typeScale(TALL)}`
  );

  const style = { ...DEFAULT_SUBTITLE_STYLE };
  const wide = subtitleBand(style, WIDE);
  const tall = subtitleBand(style, TALL);
  assert(
    tall.h < wide.h,
    "the subtitle band is a smaller fraction of a taller frame"
  );
  assert(
    wide.y + wide.h <= 1 && tall.y + tall.h <= 1,
    "the band never runs off the bottom of the frame"
  );

  // Cue length has to come down with the frame, or the renderer's own width
  // wrap produces more lines than maxLines and joins the overflow into one.
  const wideChars = fittedCharsPerLine(style, WIDE);
  const tallChars = fittedCharsPerLine(style, TALL);
  assert(
    wideChars === style.maxCharsPerLine,
    `a widescreen frame fits the whole taste setting, got ${wideChars}`
  );
  assert(
    tallChars < wideChars && tallChars >= 8,
    `a vertical frame needs shorter lines, got ${tallChars}`
  );
}

/* --------------------------------- verifier -------------------------------- */

const world: PlanWorld = {
  duration: 120,
  boundaryCount: 2,
  elementCount: 1,
  subtitlesOn: false,
  subtitlePosition: "bottom",
  transcript: "[0:04] We shipped it three times faster than last year.",
  can: { generateImage: true, photoSearch: true },
};

/** Parse through the real schema, so the verifier only ever sees valid ops. */
function ops(raw: unknown[]) {
  const sifted = siftOps(raw);
  assert(
    sifted.rejected.length === 0,
    `test fixture was rejected by the schema: ${sifted.rejected.join("; ")}`
  );
  return sifted.ops;
}

function saysNothing(raw: unknown[], w: PlanWorld = world) {
  const problems = verifyPlan(ops(raw), w);
  assert(
    problems.length === 0,
    `expected a clean plan, got: ${problems.join(" | ")}`
  );
}

function complainsAbout(raw: unknown[], needle: string, w: PlanWorld = world) {
  const problems = verifyPlan(ops(raw), w);
  assert(
    problems.some((p) => p.toLowerCase().includes(needle.toLowerCase())),
    `expected a complaint about "${needle}", got: ${problems.join(" | ") || "nothing"}`
  );
}

{
  saysNothing([
    { op: "setFrame", aspect: "9:16", fit: "cover", focusY: 0.4 },
    { op: "removeFillers" },
    { op: "subtitles", action: "on", preset: "shorts" },
    { op: "addText", text: "Shipped", start: 0, duration: 3, position: "top" },
  ]);

  // A phrase nobody says cannot be timed to, and used to fail one line at a
  // time in the log after the rest of the edit had already run.
  complainsAbout(
    [{ op: "captionPhrase", phrase: "ten times faster", text: "10×" }],
    "not in the transcript"
  );
  saysNothing([
    {
      op: "captionPhrase",
      phrase: "three times faster",
      text: "3× FASTER",
      position: "upper-third",
    },
  ]);

  // Punctuation and case in the transcript must not defeat the check.
  saysNothing([
    { op: "captionPhrase", phrase: "We shipped it", position: "upper-third" },
  ]);

  complainsAbout(
    [{ op: "setTransition", between: 7, kind: "dissolve" }],
    "has 2"
  );
  complainsAbout(
    [{ op: "setAllTransitions", kind: "dissolve" }],
    "nowhere to put one",
    { ...world, boundaryCount: 0 }
  );
  // Cutting first is what creates the boundaries, so this one is fine.
  saysNothing(
    [{ op: "removeFillers" }, { op: "setAllTransitions", kind: "dissolve" }],
    { ...world, boundaryCount: 0 }
  );

  complainsAbout(
    [{ op: "updateElement", element: 4, color: "#ffffff" }],
    "only ever has 1"
  );
  // Adding then addressing what was added is legitimate.
  saysNothing([
    { op: "addText", text: "Hello there", start: 0, duration: 4, position: "top" },
    { op: "updateElement", element: 2, color: "#ffd60a" },
  ]);

  complainsAbout(
    [{ op: "deleteRange", from: 200, to: 210 }],
    "120.0s long"
  );
  complainsAbout(
    [
      {
        op: "keepOnly",
        ranges: [
          { from: 40, to: 60 },
          { from: 50, to: 70 },
        ],
      },
    ],
    "overlap"
  );

  complainsAbout(
    [
      {
        op: "addText",
        text: "a rather long line of words to read",
        start: 2,
        duration: 1,
      },
    ],
    "too fast to read"
  );

  // Two captions in the same band at the same moment.
  complainsAbout(
    [
      { op: "addText", text: "One", start: 0, duration: 5, position: "top" },
      { op: "addText", text: "Two", start: 2, duration: 5, position: "top" },
    ],
    "same time"
  );
  // The same two, held apart, are fine.
  saysNothing([
    { op: "addText", text: "One", start: 0, duration: 4, position: "top" },
    { op: "addText", text: "Two", start: 5, duration: 4, position: "top" },
  ]);

  // Nothing goes in the subtitles' band while they are on.
  complainsAbout(
    [{ op: "addText", text: "Name here", start: 0, duration: 4, position: "lower-third" }],
    "burned-in subtitles",
    { ...world, subtitlesOn: true, subtitlePosition: "bottom" }
  );

  complainsAbout(
    [{ op: "addImage", query: "a bridge", start: 1, duration: 3 }],
    "photo search is not configured",
    { ...world, can: { generateImage: true, photoSearch: false } }
  );

  // The clock shrinks as the plan cuts, and later times are judged against what
  // is left — the real failure of a "make it a 30 second short" plan.
  complainsAbout(
    [
      { op: "keepOnly", ranges: [{ from: 10, to: 25 }, { from: 60, to: 75 }] },
      { op: "addText", text: "Closing", start: 90, duration: 3 },
    ],
    "at most 30.0s"
  );
  saysNothing([
    { op: "keepOnly", ranges: [{ from: 10, to: 25 }, { from: 60, to: 75 }] },
    { op: "addText", text: "Closing", start: 24, duration: 4, position: "top" },
  ]);
  complainsAbout(
    [
      { op: "keepOnly", ranges: [{ from: 0, to: 30 }] },
      { op: "splitAt", at: 45 },
    ],
    "outside the video"
  );
  // Each cut is written against the clock the one before it left behind, so
  // they compound rather than each measuring the original.
  complainsAbout(
    [
      { op: "deleteRange", from: 0, to: 100 },
      { op: "addText", text: "Nope", start: 30, duration: 3 },
    ],
    "at most 20.0s"
  );

  // Two kinetic captions on the same words in the same band. Both are timed
  // from the transcript, so they are comparable to each other even though
  // neither is comparable to an addText time.
  complainsAbout(
    [
      { op: "captionPhrase", phrase: "three times faster", position: "upper-third" },
      { op: "captionPhrase", phrase: "shipped it", position: "upper-third" },
    ],
    "same time"
  );

  // Cuts first and then times written for the clock they leave behind is the
  // documented shape of a good plan, not a defect. Only an unreachable time is.
  saysNothing([
    { op: "removeSilences", minDuration: 0.4 },
    { op: "addText", text: "Later", start: 60, duration: 3, position: "top" },
  ]);
  complainsAbout(
    [
      { op: "keepOnly", ranges: [{ from: 0, to: 30 }] },
      { op: "removeFillers" },
      { op: "addText", text: "Later", start: 60, duration: 3, position: "top" },
    ],
    "at most 30.0s"
  );
}

/* ------------------------------ reply parsing ------------------------------ */

{
  // The exact slips seen from a live model, both of which threw away a complete
  // plan before the harness learned to tolerate them.
  const strayAfterFloat =
    '{"summary":"x","ops":[{"op":"captionPhrase","phrase":"a b","hold":1.2"}]}';
  const strayBeforeComma =
    '{"summary":"x","ops":[{"op":"setFrame","aspect":"9:16","focusY":0.4","background":"blur"}]}';

  for (const [label, raw] of [
    ["stray quote before a closing brace", strayAfterFloat],
    ["stray quote before a comma", strayBeforeComma],
  ] as const) {
    assert(
      (() => {
        try {
          JSON.parse(raw);
          return false;
        } catch {
          return true;
        }
      })(),
      `${label}: the fixture should not be valid JSON to begin with`
    );
    const fixed = repairJson(raw);
    let parsed: { ops?: unknown[] } | null = null;
    try {
      parsed = JSON.parse(fixed);
    } catch {
      parsed = null;
    }
    assert(parsed !== null, `${label}: should parse after repair, got ${fixed}`);
    assert(
      siftOps(parsed!.ops as unknown[]).ops.length === 1,
      `${label}: the repaired operation should survive the schema`
    );
  }

  // The second slip: real newlines inside the reasoning string rather than \n.
  // Seen four turns running in one session, each one losing a whole plan.
  const nl = String.fromCharCode(10);
  const rawNewline = `{"thinking":"line one${nl}line two","summary":"x","ops":[{"op":"removeFillers"}]}`;
  assert(
    (() => {
      try {
        JSON.parse(rawNewline);
        return false;
      } catch {
        return true;
      }
    })(),
    "a raw newline inside a string should not be valid JSON to begin with"
  );
  const mended = JSON.parse(repairJson(rawNewline)) as {
    thinking: string;
    ops: unknown[];
  };
  assert(
    mended.thinking === `line one${nl}line two`,
    `the newline should survive as a newline, got ${JSON.stringify(mended.thinking)}`
  );
  assert(
    siftOps(mended.ops).ops.length === 1,
    "the operation should survive the repair"
  );

  // Both slips in one reply, which is how they actually turn up.
  const both = `{"thinking":"a${nl}b","ops":[{"op":"setFrame","aspect":"9:16","zoom":1"}]}`;
  assert(
    siftOps((JSON.parse(repairJson(both)) as { ops: unknown[] }).ops).ops
      .length === 1,
    "a reply carrying both slips should still yield its operation"
  );

  // The repair must not touch anything that already parses — in particular a
  // colon inside a string value, which is what a ratio like "9:16" is, and
  // escape sequences that are already correct.
  for (const good of [
    '{"summary":"1.5\\" of rain","ops":[],"n":2.5}',
    '{"aspect":"9:16","zoom":1,"note":"ends at 2:09"}',
    '{"ops":[{"op":"setFrame","aspect":"2.39:1"}]}',
    '{"thinking":"already escaped\\nand tabbed\\there","ops":[]}',
  ]) {
    assert(
      repairJson(good) === good,
      `a valid document must come back untouched, got ${repairJson(good)}`
    );
    JSON.parse(repairJson(good));
  }
}

/* ---------------------------- framing the reply ---------------------------- */

{
  // Two objects in one reply. "First brace to last brace" spliced them into
  // `}{` and lost a perfectly good first answer to a parse error.
  const twice =
    '{"thinking":"first go","ops":[{"op":"removeFillers"}]}' +
    String.fromCharCode(10) +
    '{"thinking":"second thoughts"}';
  const framed = jsonObjects(twice);
  assert(framed.length === 2, `expected two objects, got ${framed.length}`);
  assert(
    siftOps((JSON.parse(framed[0]) as { ops: unknown[] }).ops).ops.length === 1,
    "the first object should still carry its operation"
  );

  // Prose around a single object, which is the case the old heuristic existed
  // for and which must keep working.
  const wrapped = 'Here you go:' + String.fromCharCode(10) + '{"ops":[]}  — hope that helps';
  assert(
    jsonObjects(wrapped).length === 1 && jsonObjects(wrapped)[0] === '{"ops":[]}',
    `prose around one object should yield just the object, got ${JSON.stringify(jsonObjects(wrapped))}`
  );

  // Braces inside strings are not structure.
  const braces = '{"summary":"use {curly} braces","ops":[]}';
  assert(
    jsonObjects(braces).length === 1 && jsonObjects(braces)[0] === braces,
    "a brace inside a string must not frame a new object"
  );

  // Nested objects close at the right depth.
  const nested = '{"tool":"read_transcript","args":{"from":0,"to":30}}';
  assert(
    jsonObjects(nested).length === 1 && jsonObjects(nested)[0] === nested,
    "a nested object is one object, not two"
  );
}

console.log("ALL FRAME AND VERIFIER TESTS PASSED");
