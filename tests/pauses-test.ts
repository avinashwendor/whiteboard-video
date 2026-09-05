import {
  findPauses,
  formatPause,
  clampPauseThreshold,
  DEFAULT_MIN_PAUSE_S,
  MIN_PAUSE_THRESHOLD_S,
  MAX_PAUSE_THRESHOLD_S,
  PAUSE_THRESHOLD_PRESETS,
} from "../src/rescript/lib/pauses";
import type { Word } from "../src/rescript/lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const w = (id: number, start: number, end: number): Word => ({
  id,
  text: `w${id}`,
  start,
  end,
  speaker: 0,
  deleted: false,
});

/* ------------------------------ gaps between ------------------------------ */
{
  // 0.5s lead-in, 0.6s gap after w1, tight join after w2.
  const words = [w(1, 0.5, 1.0), w(2, 1.6, 2.0), w(3, 2.02, 2.5)];
  const pauses = findPauses(words, { minDuration: 0.35 });
  assert(pauses.length === 2, `expected 2 pauses, got ${pauses.length}`);

  assert(pauses[0].start === 0 && pauses[0].end === 0.5, "lead-in pause span");
  assert(pauses[0].beforeWordId === 1, "lead-in sits before the first word");

  assert(Math.abs(pauses[1].duration - 0.6) < 1e-9, "gap duration");
  // The 0.6s gap runs from w1's end to w2's start, so it precedes w2.
  assert(pauses[1].beforeWordId === 2, "gap is anchored to the following word");

  // The 0.02s join is speech rhythm, not a pause.
  assert(!pauses.some((p) => p.duration < 0.35), "sub-threshold gap included");
}

/* ------------------------------ trailing tail ----------------------------- */
{
  const words = [w(1, 0.0, 1.0)];
  const withTail = findPauses(words, { minDuration: 0.35, duration: 3.0 });
  assert(withTail.length === 1, "expected the trailing pause");
  assert(withTail[0].beforeWordId === null, "trailing pause has no next word");
  assert(withTail[0].start === 1.0 && withTail[0].end === 3.0, "tail span");

  // Without a duration there is no known end, so no tail.
  assert(findPauses(words, { minDuration: 0.35 }).length === 0, "tail needs duration");
}

/* -------------------------------- threshold ------------------------------- */
{
  const words = [w(1, 0.0, 1.0), w(2, 1.4, 2.0)];
  assert(findPauses(words, { minDuration: 0.3 }).length === 1, "0.4s gap at 0.3 threshold");
  assert(findPauses(words, { minDuration: 0.5 }).length === 0, "0.4s gap at 0.5 threshold");
  // Boundary is inclusive.
  assert(findPauses(words, { minDuration: 0.4 }).length === 1, "gap equal to threshold counts");
}

/* ------------------------------- degenerate ------------------------------- */
{
  assert(findPauses([], { duration: 10 }).length === 0, "no words, no pauses");
  // Overlapping words must not produce a negative-length pause.
  const overlap = [w(1, 0.0, 2.0), w(2, 1.5, 3.0)];
  assert(
    findPauses(overlap, { minDuration: 0.35 }).every((p) => p.duration > 0),
    "overlap produced a non-positive pause"
  );
}

/* -------------------------------- formatting ------------------------------ */
{
  assert(formatPause(0.44) === "0.4s", `unexpected: ${formatPause(0.44)}`);
  assert(formatPause(1.25) === "1.3s", `unexpected: ${formatPause(1.25)}`);
  assert(DEFAULT_MIN_PAUSE_S > 0, "default threshold must be positive");
}

/* ------------------------------- threshold -------------------------------- */
{
  // The control is a slider over a range, so junk and out-of-range input has to
  // land somewhere sane rather than hiding every pause or showing every frame.
  assert(clampPauseThreshold(Number.NaN) === DEFAULT_MIN_PAUSE_S, "NaN falls back");
  assert(clampPauseThreshold(-5) === MIN_PAUSE_THRESHOLD_S, "clamps below the floor");
  assert(clampPauseThreshold(99) === MAX_PAUSE_THRESHOLD_S, "clamps above the ceiling");
  // Snapped to the slider's step, so the stored number and its label agree.
  assert(clampPauseThreshold(0.37) === 0.35, `snapped to step: ${clampPauseThreshold(0.37)}`);

  for (const preset of PAUSE_THRESHOLD_PRESETS) {
    assert(
      clampPauseThreshold(preset) === preset,
      `preset ${preset} must survive clamping unchanged`
    );
  }

  // Raising the threshold can only ever hide pauses, never reveal them. That
  // monotonicity is what makes the slider readable while you drag it.
  const take = [w(1, 0.0, 0.5), w(2, 0.7, 1.0), w(3, 1.9, 2.2), w(4, 4.0, 4.5)];
  let previous = Infinity;
  for (const step of [0.05, 0.2, 0.35, 0.8, 1.5, 3]) {
    const found = findPauses(take, { minDuration: step, duration: 5 }).length;
    assert(found <= previous, `threshold ${step} showed more pauses than the step below`);
    previous = found;
  }
  assert(findPauses(take, { minDuration: 0.05, duration: 5 }).length > 0, "loosest finds some");
  assert(findPauses(take, { minDuration: 3, duration: 5 }).length === 0, "tightest finds none");
}

console.log("ALL PAUSE TESTS PASSED");
