/**
 * Letting the agent see the footage.
 *
 * Every tool it has reads text — the transcript, the element list, the analysis
 * numbers — so it had never seen a frame of the video it was editing. That is
 * why its plans read as competent and generic: it could not know the speaker
 * sits left of frame, that the background is busy where a caption is about to
 * go, or that the shot is already tight enough that a punch-in would crop them.
 *
 * Grabbing the frames needs a browser. What can be pinned down here is where
 * they are sampled from — which matters more than it sounds, because a glance
 * that lands on material the person deleted shows the agent a moment that is
 * not in the video, and it will plan against it.
 *
 * Run with `npx tsx tests/glance-test.ts`.
 */

import { glanceTimes } from "../src/rescript/lib/overlay/glance";
import { buildTimeline, outputToOriginal } from "../src/rescript/lib/overlay/timeline";
import type { Word } from "../src/rescript/lib/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/* --------------------------------- sampling -------------------------------- */

{
  assert(glanceTimes(0).length === 0, "no video, nothing to look at");
  assert(glanceTimes(-5).length === 0, "a negative duration is not a video either");

  // A clip too short to sample three times gets one, in the middle, rather
  // than three nearly-identical frames.
  const brief = glanceTimes(1.2);
  assert(brief.length === 1, `a very short clip gets one frame, got ${brief.length}`);
  assert(brief[0] > 0 && brief[0] < 1.2, "and it is inside the clip");

  const times = glanceTimes(120);
  assert(times.length === 3, `three frames by default, got ${times.length}`);

  // Never at the edges. The first and last frames of a cut are
  // disproportionately a blink, a hand reaching for the keyboard, or black.
  for (const t of times) {
    assert(t > 0, `a sample at ${t} is at or before the start`);
    assert(t < 120, `a sample at ${t} is at or past the end`);
  }

  // Spread evenly, and in order.
  assert(
    times.every((t, i) => i === 0 || t > times[i - 1]),
    "samples run forwards"
  );
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  assert(
    Math.max(...gaps) - Math.min(...gaps) < 1e-9,
    `samples should be evenly spread, got gaps ${gaps.join(", ")}`
  );

  // The count is honoured, so the cost can be tuned without touching anything
  // else — each frame is roughly 800 tokens.
  assert(glanceTimes(120, 1).length === 1, "one when asked for one");
  assert(glanceTimes(120, 4).length === 4, "four when asked for four");
}

/* ------------------------------ through the cut ----------------------------- */

function word(id: number, text: string, start: number, end: number, deleted = false): Word {
  return { id, text, start, end, speaker: 0, deleted };
}

{
  // 0–4 and 6–10 kept: the output runs 0–8 with a seam at 4, and 4–6 of the
  // source is gone. A glance must never land in that hole.
  const words = [
    word(1, "one", 0, 2),
    word(2, "two", 2, 4),
    word(3, "cut", 4, 6, true),
    word(4, "four", 6, 8),
    word(5, "five", 8, 10),
  ];
  const timeline = buildTimeline(words, 10, [], []);
  assert(Math.abs(timeline.duration - 8) < 1e-9, `the cut runs 8s, got ${timeline.duration}`);

  const deleted = { start: 4, end: 6 };
  for (const at of glanceTimes(timeline.duration)) {
    const source = outputToOriginal(at, timeline.keepRanges);
    assert(
      source < deleted.start || source >= deleted.end,
      `a glance at output ${at}s maps to source ${source}s, which the person deleted`
    );
    assert(source >= 0 && source <= 10, `source ${source}s is outside the media`);
  }
}

{
  // A heavily cut video — most of it gone — must still sample only what is
  // left. This is the case where naive output-equals-source arithmetic quietly
  // shows the agent the wrong film entirely.
  const words = [
    word(1, "keep", 0, 2),
    word(2, "drop", 2, 30, true),
    word(3, "keep", 30, 33),
    word(4, "drop", 33, 60, true),
    word(5, "keep", 60, 62),
  ];
  const timeline = buildTimeline(words, 62, [], []);

  const kept = timeline.keepRanges;
  for (const at of glanceTimes(timeline.duration)) {
    const source = outputToOriginal(at, kept);
    const inside = kept.some((r) => source >= r.start && source <= r.end);
    assert(inside, `output ${at}s mapped to ${source}s, which is not in any kept range`);
  }
}

{
  // An uncut video is the common case and must be the identity.
  const words = [word(1, "all", 0, 20)];
  const timeline = buildTimeline(words, 20, [], []);
  for (const at of glanceTimes(timeline.duration)) {
    const source = outputToOriginal(at, timeline.keepRanges);
    assert(
      Math.abs(source - at) < 1e-6,
      `with nothing cut, output ${at}s should be source ${at}s, got ${source}s`
    );
  }
}

console.log("ALL GLANCE TESTS PASSED");
