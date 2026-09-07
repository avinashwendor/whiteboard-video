/**
 * Camera variety, and the slow move over a still.
 *
 * Two things that make an automatic edit stop looking automatic, and two that
 * fail quietly if they are wrong.
 *
 * `placePunchIns` used to return one move — a push in — for every beat it found,
 * so a two-minute edit pushed in six times identically and the frame only ever
 * got closer. Choosing the move from *what earned the beat* is the fix, and the
 * rule it must not break is the one the prompt states: never mix `push` with
 * `punchIn` in the same video, because one is atmosphere and the other is
 * emphasis and together they read as an accident.
 *
 * Ken Burns has a subtler failure. A move on a `contain` image pans the picture
 * around inside a box it already fits, exposing the empty box behind it — it
 * looks like a rendering bug rather than a missing feature, and only on some
 * images. The renderer therefore forces `cover` whenever a move is on.
 *
 * Run with `npx tsx tests/camera-variety-test.ts`.
 */

import { findBeats, placePunchIns, type Beat } from "../src/rescript/lib/overlay/emphasis";
import { autoPunchInsOp, addImageOp } from "../src/rescript/lib/overlay/ops-schema";
import { SYSTEM } from "../src/lib/ai/rescript-agent";
import type { Word } from "../src/rescript/lib/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/* ------------------------------- beat reasons ------------------------------- */

{
  // A script whose moments are individually identifiable: a pause, a figure, a
  // second speaker. Each should be recognised for what it is.
  const words: Word[] = [
    { id: "1", text: "So", start: 0, end: 0.3, speaker: 0, deleted: false },
    { id: "2", text: "we", start: 0.3, end: 0.5, speaker: 0, deleted: false },
    { id: "3", text: "shipped.", start: 0.5, end: 1.0, speaker: 0, deleted: false },
    // A long gap, then a word: the speaker is doing the emphasis.
    { id: "4", text: "Eventually", start: 2.4, end: 3.0, speaker: 0, deleted: false },
    { id: "5", text: "it", start: 3.0, end: 3.2, speaker: 0, deleted: false },
    { id: "6", text: "took", start: 3.2, end: 3.5, speaker: 0, deleted: false },
    { id: "7", text: "40", start: 3.5, end: 3.9, speaker: 0, deleted: false },
    { id: "8", text: "minutes.", start: 3.9, end: 4.4, speaker: 0, deleted: false },
    // A different speaker.
    { id: "9", text: "Right", start: 4.6, end: 5.0, speaker: 1, deleted: false },
  ] as unknown as Word[];

  const beats = findBeats(words, 6, []);
  assert(beats.length > 0, "beats are found at all");
  assert(
    beats.every((b) => typeof b.reason === "string"),
    "every beat says what earned it"
  );

  const reasons = new Map(beats.map((b) => [b.word.replace(/[^\w]/g, ""), b.reason]));
  assert(reasons.get("40") === "figure", `a number is a figure, got ${reasons.get("40")}`);
  assert(
    reasons.get("Right") === "speaker",
    `a change of speaker outranks everything else, got ${reasons.get("Right")}`
  );
  assert(
    reasons.get("Eventually") === "pause",
    `a word after a long gap is a pause, got ${reasons.get("Eventually")}`
  );
  console.log("✓ a beat knows what earned it");
}

/* ------------------------------ the same moves ------------------------------ */

{
  const beats: Beat[] = Array.from({ length: 12 }, (_, i) => ({
    at: i * 8,
    score: 50 - i,
    word: `w${i}`,
    reason: "pause" as const,
  }));

  const steady = placePunchIns(beats, { duration: 120, perMinute: 6 });
  assert(steady.length > 3, "enough moves to judge a pattern");
  assert(
    steady.every((p) => p.camera === "punchIn"),
    "the default is unchanged: every move is a push in"
  );
  console.log(`✓ steady stays steady (${steady.length} punch-ins)`);
}

/* -------------------------------- variety ----------------------------------- */

{
  const beats: Beat[] = [
    { at: 0, score: 40, word: "a", reason: "pause" },
    { at: 8, score: 39, word: "b", reason: "sentence" },
    { at: 16, score: 38, word: "c", reason: "sentence" },
    { at: 24, score: 37, word: "d", reason: "speaker" },
    { at: 32, score: 36, word: "e", reason: "figure" },
    { at: 40, score: 35, word: "f", reason: "sentence" },
    { at: 48, score: 34, word: "g", reason: "sentence" },
  ];

  const varied = placePunchIns(beats, { duration: 120, perMinute: 6, style: "varied" });
  const kinds = new Set(varied.map((p) => p.camera));
  assert(kinds.size > 1, `varied should not produce one move, got ${[...kinds]}`);
  assert(
    varied.find((p) => p.beat.reason === "speaker")?.camera === "snap",
    "a change of speaker is a new shot, so it does not travel"
  );
  assert(
    varied.some((p) => p.camera === "punchOut"),
    "the frame opens back up after a run of pushes, or the video only ever gets tighter"
  );

  // The rule the prompt states, which the variety must not break.
  assert(
    !(kinds.has("push") && kinds.has("punchIn")),
    "push and punchIn must never appear in the same video"
  );
  assert(!kinds.has("kenBurns") && !kinds.has("driftLeft"), "no drifting on a talking head");

  // Never two punch-outs running: releasing twice in a row is not a release.
  for (let i = 1; i < varied.length; i += 1) {
    assert(
      !(varied[i].camera === "punchOut" && varied[i - 1].camera === "punchOut"),
      "two punch-outs in a row"
    );
  }
  console.log(`✓ varied picks the move from the moment (${[...kinds].join(", ")})`);
}

/* ------------------------------- energetic ---------------------------------- */

{
  const beats: Beat[] = [
    { at: 0, score: 40, word: "a", reason: "pause" },
    { at: 8, score: 39, word: "b", reason: "figure" },
    { at: 16, score: 38, word: "c", reason: "speaker" },
  ];
  const hot = placePunchIns(beats, { duration: 60, perMinute: 6, style: "energetic" });
  assert(
    hot.every((p) => p.camera === "snap" || p.camera === "punchIn"),
    `short-form is snaps, got ${hot.map((p) => p.camera).join(", ")}`
  );
  assert(hot.some((p) => p.camera === "snap"), "and at least some of them really snap");
  console.log("✓ energetic is hard cuts to tighter");
}

/* ------------------------- placement is style-independent ------------------- */

{
  // Which beats survive is a question about spacing and strength. Asking for a
  // different look must not silently change what gets a move at all.
  const beats: Beat[] = Array.from({ length: 20 }, (_, i) => ({
    at: i * 3,
    score: 60 - i,
    word: `w${i}`,
    reason: (["pause", "sentence", "figure", "speaker"] as const)[i % 4],
  }));

  const times = (style: "steady" | "varied" | "energetic") =>
    placePunchIns(beats, { duration: 120, perMinute: 4, style })
      .map((p) => p.start)
      .join(",");

  assert(
    times("steady") === times("varied") && times("varied") === times("energetic"),
    "the same beats are chosen whatever the style"
  );
  console.log("✓ the style changes the move, never the placement");
}

/* --------------------------------- the schema -------------------------------- */

{
  for (const style of ["steady", "varied", "energetic"]) {
    assert(
      autoPunchInsOp.safeParse({ op: "autoPunchIns", style }).success,
      `the schema rejects the real style "${style}"`
    );
  }
  assert(
    !autoPunchInsOp.safeParse({ op: "autoPunchIns", style: "wild" }).success,
    "an invented style is refused"
  );

  for (const motion of ["auto", "none", "zoomIn", "zoomOut", "panLeft", "panRight"]) {
    assert(
      addImageOp.safeParse({ op: "addImage", query: "a bridge", motion }).success,
      `the schema rejects the real motion "${motion}"`
    );
  }
  assert(
    !addImageOp.safeParse({ op: "addImage", query: "a bridge", motion: "spin" }).success,
    "an invented motion is refused"
  );
  console.log("✓ the schema accepts exactly what exists");
}

/* -------------------------------- the prompt --------------------------------- */

{
  assert(SYSTEM.includes('"style":"varied"'), "the agent is never shown the camera style");
  assert(/energetic \(snaps, no travel/.test(SYSTEM), "nor what energetic means");
  assert(SYSTEM.includes('"motion":"panRight"'), "the agent is never shown image motion");
  assert(
    /motionless over moving footage/.test(SYSTEM),
    "nor why a still needs to move at all"
  );
  console.log("✓ both reach the model");
}

console.log("\ncamera variety: all checks passed");
