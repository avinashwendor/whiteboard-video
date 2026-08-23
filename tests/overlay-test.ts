/**
 * Composition layer: the parts that are arithmetic rather than pixels.
 *
 * Written in the same shape as the ported suite — a plain assertion script run
 * with `npx tsx tests/overlay-test.ts`, no runner. The things covered here are
 * the ones that fail silently in a UI: a cue that lands a frame late, a
 * boundary that moves after an edit, an operation the model got slightly wrong
 * that would otherwise be applied anyway.
 */

import { siftOps } from "../src/motionscript/lib/overlay/ops-schema";
import { buildCues } from "../src/motionscript/lib/overlay/subtitles";
import {
  buildTimeline,
  clampTransitionDuration,
  complementToSource,
  familyOf,
  outputRangeToSource,
  outputToOriginal,
  pruneTransitions,
  transitionAt,
} from "../src/motionscript/lib/overlay/timeline";
import { drawStateAt } from "../src/motionscript/lib/overlay/animation";
import { rectAt, startAtPlayhead } from "../src/motionscript/lib/overlay/presets";
import {
  blockedFor,
  clampToFrame,
  nudgeClear,
  overlaps,
  subtitleBand,
  TITLE_SAFE,
} from "../src/motionscript/lib/overlay/layout";
import {
  DEFAULT_SUBTITLE_STYLE,
  isEmptyComposition,
  emptyComposition,
  type OverlayElement,
} from "../src/motionscript/lib/overlay/types";
import type { Word } from "../src/motionscript/lib/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function close(a: number, b: number, tolerance = 1e-6): boolean {
  return Math.abs(a - b) <= tolerance;
}

function word(
  id: number,
  text: string,
  start: number,
  end: number,
  deleted = false
): Word {
  return { id, text, start, end, speaker: 0, deleted };
}

/* --------------------------------- schema ---------------------------------- */

{
  const { ops, rejected } = siftOps([
    { op: "addText", text: "Hello", start: 1, duration: 2, position: "center" },
    { op: "setTransition", between: 1, kind: "dissolve", duration: 0.5 },
    { op: "subtitles", action: "on", preset: "shorts" },
  ]);
  assert(ops.length === 3, "three valid operations should survive");
  assert(rejected.length === 0, "nothing valid should be rejected");
}

{
  // One bad operation must not take the good ones with it.
  const { ops, rejected } = siftOps([
    { op: "addText", text: "Fine" },
    { op: "addText" },
    { op: "setTransition", between: 1, kind: "teleport" },
    { op: "updateElement", element: 0, text: "zero is not a number people use" },
    { op: "removeElement", element: "all" },
    { op: "nonsense" },
  ]);
  assert(ops.length === 2, `two operations should survive, got ${ops.length}`);
  assert(rejected.length === 4, `four should be rejected, got ${rejected.length}`);
  assert(
    rejected.some((r) => r.startsWith("setTransition")),
    "a rejection names the operation it came from"
  );
}

{
  // Colours are checked, because an invalid one silently paints nothing.
  const { ops } = siftOps([
    { op: "addText", text: "a", color: "#ff0000" },
    { op: "addText", text: "b", color: "rgba(0,0,0,0.5)" },
    { op: "addText", text: "c", color: "chartreuse-ish" },
    { op: "addText", text: "d", color: "javascript:alert(1)" },
  ]);
  assert(ops.length === 2, `only real colours pass, got ${ops.length}`);
}

/* -------------------------------- timeline ---------------------------------- */

{
  // Ten seconds of media, words 4–6 deleted: the output is 0–4 then 6–10.
  const words = [
    word(1, "one", 0, 2),
    word(2, "two", 2, 4),
    word(3, "cut", 4, 6, true),
    word(4, "four", 6, 8),
    word(5, "five", 8, 10),
  ];
  const timeline = buildTimeline(words, 10, [], []);

  assert(close(timeline.duration, 8), `output is 8s, got ${timeline.duration}`);
  assert(timeline.boundaries.length === 1, "one cut makes one boundary");

  const boundary = timeline.boundaries[0];
  assert(close(boundary.outTime, 4), `boundary at 4s, got ${boundary.outTime}`);
  assert(close(boundary.outgoingEnd, 4), "outgoing clip ends at source 4s");
  assert(close(boundary.incomingStart, 6), "incoming clip starts at source 6s");

  // Output → source, on both sides of the cut.
  assert(close(outputToOriginal(1, timeline.keepRanges), 1), "before the cut");
  assert(close(outputToOriginal(5, timeline.keepRanges), 7), "after the cut");
  assert(
    close(outputToOriginal(0, timeline.keepRanges), 0),
    "the first frame maps to the first frame"
  );
}

{
  // A scene split with no cut still divides the clips, and a transition there
  // is the case a dissolve is actually for.
  const words = [word(1, "a", 0, 5), word(2, "b", 5, 10)];
  const timeline = buildTimeline(words, 10, [], [{ id: 1, time: 5 }]);
  assert(timeline.clips.length === 2, "a scene boundary subdivides the clip");
  assert(timeline.boundaries.length === 1, "and produces a boundary");
  assert(close(timeline.duration, 10), "without shortening the output");
}

/* --------------------- cutting by the finished video's clock ---------------- */

{
  // 0-4 and 6-10 kept: the output runs 0-8 with the seam at 4.
  const words = [
    word(1, "one", 0, 2),
    word(2, "two", 2, 4),
    word(3, "cut", 4, 6, true),
    word(4, "four", 6, 8),
    word(5, "five", 8, 10),
  ];
  const timeline = buildTimeline(words, 10, [], []);

  // Entirely before the seam.
  const early = outputRangeToSource(1, 3, timeline.keepRanges);
  assert(early.length === 1, "a span inside one clip maps to one source span");
  assert(close(early[0].start, 1) && close(early[0].end, 3), "and maps 1:1");

  // Entirely after it: output 5 is source 7.
  const late = outputRangeToSource(5, 6, timeline.keepRanges);
  assert(late.length === 1 && close(late[0].start, 7), "after the seam it shifts");

  // Straddling the seam: one output span, two source spans, because the
  // material between them is already gone.
  const across = outputRangeToSource(3, 5, timeline.keepRanges);
  assert(across.length === 2, `a span across a cut maps to two, got ${across.length}`);
  assert(close(across[0].start, 3) && close(across[0].end, 4), "first piece");
  assert(close(across[1].start, 6) && close(across[1].end, 7), "second piece");

  const total = across.reduce((n, r) => n + (r.end - r.start), 0);
  assert(close(total, 2), "and together they are as long as what was asked for");

  // Out of range asks for nothing rather than throwing.
  assert(
    outputRangeToSource(50, 60, timeline.keepRanges).length === 0,
    "a span past the end maps to nothing"
  );
  assert(outputRangeToSource(3, 3, timeline.keepRanges).length === 0, "empty is empty");
}

{
  // keepOnly is the complement: everything not named gets cut.
  const words = [word(1, "a", 0, 10)];
  const timeline = buildTimeline(words, 10, [], []);
  const drop = complementToSource([{ from: 2, to: 4 }, { from: 6, to: 8 }], timeline);
  const dropped = drop.reduce((n, r) => n + (r.end - r.start), 0);
  assert(close(dropped, 6), `keeping 4s of 10s cuts 6s, got ${dropped}`);

  // Overlapping and unsorted input from a model must still behave.
  const messy = complementToSource(
    [{ from: 6, to: 8 }, { from: 2, to: 5 }, { from: 3, to: 4 }],
    timeline
  );
  const messyDropped = messy.reduce((n, r) => n + (r.end - r.start), 0);
  assert(close(messyDropped, 5), `overlaps merge, expected 5s cut, got ${messyDropped}`);

  // Reversed bounds are read as a span, not discarded.
  const reversed = complementToSource([{ from: 8, to: 6 }], timeline);
  const reversedKept = 10 - reversed.reduce((n, r) => n + (r.end - r.start), 0);
  assert(close(reversedKept, 2), "from/to the wrong way round still keeps 2s");
}

/* ------------------------------- transitions -------------------------------- */

{
  const words = [
    word(1, "one", 0, 2),
    word(2, "cut", 2, 3, true),
    word(3, "three", 3, 10),
  ];
  const timeline = buildTimeline(words, 10, [], []);
  const boundary = timeline.boundaries[0];

  assert(familyOf("fadeBlack") === "dip", "a fade treats the live clip");
  assert(familyOf("dissolve") === "push", "a dissolve needs the held frame");
  assert(familyOf("zoomOut") === "push", "so does a zoom out");

  // A dip sits half on each side, so it is bounded by the shorter neighbour.
  const dip = clampTransitionDuration(boundary, "fadeBlack", 10);
  assert(dip > 0 && dip <= boundary.roomBefore * 2, "a dip is clamped to its room");
  assert(dip < 10, "an over-long request is trimmed, not honoured");

  const transitions = [{ index: 1, kind: "fadeBlack" as const, duration: 0.4 }];
  const mid = transitionAt(boundary.outTime, timeline, transitions);
  assert(mid !== null, "the boundary itself is inside a dip");
  assert(close(mid!.progress, 0.5, 1e-3), "and sits at the midpoint");

  assert(
    transitionAt(boundary.outTime - 5, timeline, transitions) === null,
    "well before the cut there is no transition"
  );

  // A push starts at the boundary rather than straddling it.
  const push = transitionAt(boundary.outTime, timeline, [
    { index: 1, kind: "dissolve", duration: 0.4 },
  ]);
  assert(push !== null && close(push.progress, 0, 1e-6), "a push begins at the cut");
}

{
  // Editing away a cut must take its transition with it.
  const words = [word(1, "a", 0, 2), word(2, "b", 2, 4)];
  const timeline = buildTimeline(words, 4, [], []);
  const pruned = pruneTransitions(
    [{ index: 1, kind: "dissolve", duration: 0.5 }],
    timeline
  );
  assert(pruned.length === 0, "a transition without a boundary is dropped");
}

/* -------------------------------- subtitles --------------------------------- */

{
  const words = [
    word(1, "Hello", 0, 0.4),
    word(2, "there,", 0.4, 0.8),
    word(3, "this", 0.8, 1.1),
    word(4, "is", 1.1, 1.3),
    word(5, "a", 1.3, 1.4),
    word(6, "test.", 1.4, 1.9),
    // A long pause: the next words belong to their own cue.
    word(7, "And", 4.0, 4.3),
    word(8, "another", 4.3, 4.9),
    word(9, "one.", 4.9, 5.3),
  ];
  const cues = buildCues(words, [], { maxCharsPerLine: 38, maxLines: 2 });

  assert(cues.length >= 2, `a long pause splits the cue, got ${cues.length}`);
  assert(close(cues[0].start, 0), "the first cue starts with the first word");
  assert(
    cues.every((c) => c.end > c.start),
    "no cue may end before it starts"
  );
  for (let i = 0; i < cues.length - 1; i++) {
    assert(
      cues[i].end <= cues[i + 1].start + 1e-9,
      "cues must not overlap on screen"
    );
  }
  assert(
    cues.every((c) => (c.words?.length ?? 0) > 0),
    "per-word timings ride along, which is what karaoke needs"
  );
}

{
  // Deleted words are not captioned, and the survivors are on the output clock.
  const words = [
    word(1, "keep", 0, 1),
    word(2, "drop", 1, 2, true),
    word(3, "keep2", 2, 3),
  ];
  const cuts = [{ start: 1, end: 2 }];
  const cues = buildCues(words, cuts, { maxCharsPerLine: 40, maxLines: 2 });
  const text = cues.map((c) => c.text).join(" ");
  assert(!text.includes("drop"), "a deleted word never reaches the captions");
  assert(text.includes("keep") && text.includes("keep2"), "the rest survives");
  assert(
    cues[cues.length - 1].start < 2,
    "times are on the output clock, so the last cue starts before source 2s"
  );
}

/* ------------------------------- animation ---------------------------------- */

{
  const element: OverlayElement = {
    id: "t1",
    kind: "text",
    name: "t",
    start: 2,
    end: 6,
    rect: { x: 0, y: 0, w: 1, h: 0.2 },
    rotation: 0,
    opacity: 1,
    z: 1,
    locked: false,
    hidden: false,
    enter: { kind: "fade", duration: 0.5, easing: "linear" },
    exit: { kind: "fade", duration: 0.5, easing: "linear" },
    text: "t",
    fontFamily: "sans-serif",
    fontWeight: 700,
    italic: false,
    fontSize: 0.05,
    color: "#fff",
    align: "center",
    lineHeight: 1.2,
    letterSpacing: 0,
    uppercase: false,
    background: null,
    padding: 0.3,
    radius: 0.1,
    shadow: false,
    strokeColor: null,
    strokeWidth: 0,
  };

  assert(drawStateAt(element, 1.9) === null, "not drawn before it starts");
  assert(drawStateAt(element, 6) === null, "nor at its end, which is exclusive");
  assert(drawStateAt(element, 4)!.opacity === 1, "fully opaque in the middle");
  assert(drawStateAt(element, 2)!.opacity === 0, "transparent on its first frame");
  assert(
    drawStateAt(element, 2.25)!.opacity > 0.4 &&
      drawStateAt(element, 2.25)!.opacity < 0.6,
    "half way through a linear fade is half opacity"
  );
  assert(
    drawStateAt({ ...element, hidden: true }, 4) === null,
    "a hidden element is never drawn"
  );

  // An animation longer than the element gets clamped rather than never finishing.
  const brief = {
    ...element,
    start: 0,
    end: 0.4,
    enter: { kind: "fade" as const, duration: 5, easing: "linear" as const },
  };
  assert(
    drawStateAt(brief, 0.2)!.opacity === 1,
    "the entrance is capped at half the element's life"
  );
}

/* --------------------------------- presets ---------------------------------- */

{
  const box = rectAt("center", 0.5, 0.2);
  assert(close(box.x, 0.25) && close(box.y, 0.4), "centre means centred");

  const lower = rectAt("lower-third", 0.8, 0.2);
  assert(close(lower.x, 0.1), "a wide element is horizontally centred");
  assert(lower.y > 0.5, "the lower third is in the lower half");

  const corner = rectAt("top-right", 0.2, 0.2);
  assert(close(corner.x, 0.75) && close(corner.y, 0.05), "corners respect the margin");

  assert(startAtPlayhead(0.1) === 0, "an element never starts before the video");
  assert(startAtPlayhead(10) < 10, "and otherwise leads the playhead slightly");
}

/* --------------------------------- layout ----------------------------------- */

{
  // The band follows the style, which is the whole point — the "Shorts" preset
  // puts subtitles in the middle of the frame, not at the bottom.
  const bottom = subtitleBand({ ...DEFAULT_SUBTITLE_STYLE, position: "bottom" });
  assert(bottom.y > 0.6, `a bottom band sits low, got y=${bottom.y}`);

  const centre = subtitleBand({
    ...DEFAULT_SUBTITLE_STYLE,
    position: "center",
    fontSize: 0.072,
    maxLines: 1,
  });
  assert(
    centre.y < 0.55 && centre.y + centre.h > 0.45,
    "a centred band straddles the middle of the frame"
  );

  const top = subtitleBand({ ...DEFAULT_SUBTITLE_STYLE, position: "top" });
  assert(top.y < 0.2, "a top band sits high");

  // More lines is a taller band.
  const two = subtitleBand({ ...DEFAULT_SUBTITLE_STYLE, maxLines: 2 });
  const four = subtitleBand({ ...DEFAULT_SUBTITLE_STYLE, maxLines: 4 });
  assert(four.h > two.h, "four lines need more room than two");
}

{
  // A lower third with subtitles under it must be lifted clear.
  const band = subtitleBand(DEFAULT_SUBTITLE_STYLE);
  const lowerThird = { x: 0.1, y: 0.66, w: 0.8, h: 0.16 };
  assert(overlaps(lowerThird, band, 0.02), "the test case really does collide");

  const moved = nudgeClear(lowerThird, [band]);
  assert(!overlaps(moved, band, 0.02), "after nudging it no longer collides");
  assert(moved.y < lowerThird.y, "and it went up, not sideways");
  assert(close(moved.x, lowerThird.x), "its horizontal position is untouched");
  assert(close(moved.w, lowerThird.w) && close(moved.h, lowerThird.h), "same size");
  assert(moved.y >= 0, "and it stays on screen");
}

{
  // Two captions in the same window: the second gets moved off the first.
  const first = { x: 0.1, y: 0.66, w: 0.8, h: 0.14 };
  const second = { x: 0.1, y: 0.68, w: 0.8, h: 0.14 };
  const moved = nudgeClear(second, [first]);
  assert(!overlaps(moved, first, 0.02), "two captions do not share pixels");
}

{
  // Nowhere to go: it still returns something on screen rather than looping.
  const wall = { x: 0, y: 0, w: 1, h: 1 };
  const moved = nudgeClear({ x: 0.1, y: 0.4, w: 0.8, h: 0.3 }, [wall]);
  const framed = clampToFrame(moved);
  assert(
    close(moved.x, framed.x) && close(moved.y, framed.y),
    "an impossible placement is still inside the frame"
  );
}

{
  // Subtitles only block while a cue is actually up.
  const style = DEFAULT_SUBTITLE_STYLE;
  const withCue = blockedFor(
    1,
    3,
    [],
    { enabled: true, style, cues: [{ start: 0.5, end: 4 }] }
  );
  assert(withCue.length === 1, "a cue in the window blocks the band");

  const noCue = blockedFor(
    10,
    12,
    [],
    { enabled: true, style, cues: [{ start: 0.5, end: 4 }] }
  );
  assert(noCue.length === 0, "no cue in the window means no band to avoid");

  const off = blockedFor(
    1,
    3,
    [],
    { enabled: false, style, cues: [{ start: 0.5, end: 4 }] }
  );
  assert(off.length === 0, "subtitles switched off block nothing");

  // Elements only block while they share the moment.
  const elements = [
    { id: "a", start: 0, end: 2, rect: { x: 0, y: 0.6, w: 1, h: 0.2 }, hidden: false },
    { id: "b", start: 8, end: 9, rect: { x: 0, y: 0.6, w: 1, h: 0.2 }, hidden: false },
    { id: "c", start: 0, end: 2, rect: { x: 0, y: 0.1, w: 1, h: 0.2 }, hidden: true },
  ];
  const during = blockedFor(1, 1.5, elements, {
    enabled: false,
    style,
    cues: [],
  });
  assert(during.length === 1, `only the overlapping visible one blocks, got ${during.length}`);

  const excluded = blockedFor(
    1,
    1.5,
    elements,
    { enabled: false, style, cues: [] },
    "a"
  );
  assert(excluded.length === 0, "an element never blocks itself");
}

{
  // Half-open: something ending exactly as another begins is not a collision.
  const elements = [
    { id: "a", start: 0, end: 2, rect: { x: 0, y: 0.6, w: 1, h: 0.2 }, hidden: false },
  ];
  const after = blockedFor(2, 4, elements, {
    enabled: false,
    style: DEFAULT_SUBTITLE_STYLE,
    cues: [],
  });
  assert(after.length === 0, "back-to-back captions are not a collision");
}

{
  assert(TITLE_SAFE > 0 && TITLE_SAFE < 0.2, "the safe margin is a sane fraction");
}

/* ------------------------------- composition -------------------------------- */

{
  const empty = emptyComposition();
  assert(isEmptyComposition(empty), "a fresh composition needs no compositing");

  empty.subtitles = {
    enabled: true,
    style: DEFAULT_SUBTITLE_STYLE,
    cues: [{ id: "c", start: 0, end: 1, text: "hi" }],
    generated: true,
  };
  assert(
    !isEmptyComposition(empty),
    "subtitles switched on mean the export has work to do"
  );
}

console.log("ALL OVERLAY TESTS PASSED");
