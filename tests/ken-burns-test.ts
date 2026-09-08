/**
 * The slow move over a still.
 *
 * Pure geometry, so it is checkable without a canvas — which matters, because
 * the way this goes wrong is not an exception but a picture that looks subtly
 * broken in some frames and fine in others.
 *
 * The invariant that carries the whole feature: **zoom is never below 1.** The
 * renderer forces `cover` while a move is on, so at zoom 1 the picture exactly
 * fills its box. Anything below that shrinks it inside the box and exposes the
 * empty frame behind it — a hole that appears mid-shot and closes again, which
 * reads as a rendering fault rather than as a missing feature. A pan has the
 * same problem sideways, so it is held slightly zoomed throughout rather than
 * sliding a picture that only just fits.
 *
 * The other property is restraint. The move exists so a still does not read as
 * dead; it is not supposed to be noticed. Every amount here is under what a
 * viewer consciously registers, and a test is the only thing that keeps it
 * there once somebody decides it should be "more obvious".
 *
 * Run with `npx tsx tests/ken-burns-test.ts`.
 */

import { kenBurns } from "../src/motionscript/lib/overlay/render";
import type { ImageMotionKind } from "../src/motionscript/lib/overlay/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const MOVES: ImageMotionKind[] = ["none", "zoomIn", "zoomOut", "panLeft", "panRight"];
const STEPS = Array.from({ length: 21 }, (_, i) => i / 20);

/* ------------------------------ the invariant ------------------------------- */

{
  for (const kind of MOVES) {
    for (const amount of [0, 0.5, 1, 2]) {
      for (const p of STEPS) {
        const m = kenBurns({ kind, amount }, p);
        assert(
          m.zoom >= 1,
          `${kind}@${amount} at p=${p}: zoom ${m.zoom} < 1 would expose the box behind the picture`
        );
        assert(Number.isFinite(m.zoom), `${kind}: non-finite zoom — Canvas2D throws on this`);
        assert(Number.isFinite(m.dx) && Number.isFinite(m.dy), `${kind}: non-finite offset`);
      }
    }
  }
  console.log("✓ the picture never shrinks inside its own box");
}

/* -------------------------------- restraint --------------------------------- */

{
  for (const kind of MOVES) {
    for (const p of STEPS) {
      const m = kenBurns({ kind, amount: 1 }, p);
      assert(m.zoom <= 1.1, `${kind}: ${m.zoom} is a zoom people will notice as an effect`);
      assert(Math.abs(m.dx) <= 0.05, `${kind}: ${m.dx} is a visible slide, not a drift`);
      assert(m.dy === 0, `${kind}: nothing moves vertically`);
    }
  }
  // A pan has to travel far enough to be worth having, even while being small.
  const left = kenBurns({ kind: "panLeft", amount: 1 }, 0);
  const right = kenBurns({ kind: "panLeft", amount: 1 }, 1);
  assert(
    Math.abs(right.dx - left.dx) > 0.01,
    "a pan that travels less than 1% of the box is not a pan"
  );
  console.log("✓ every move is under the threshold where it reads as an effect");
}

/* -------------------------------- direction --------------------------------- */

{
  const inAt = (p: number) => kenBurns({ kind: "zoomIn", amount: 1 }, p).zoom;
  assert(inAt(0) === 1, "a zoom in starts at the fitted size");
  assert(inAt(1) > inAt(0.5) && inAt(0.5) > inAt(0), "and grows monotonically");

  const outAt = (p: number) => kenBurns({ kind: "zoomOut", amount: 1 }, p).zoom;
  assert(outAt(1) === 1, "a zoom out ends at the fitted size");
  assert(outAt(0) > outAt(0.5) && outAt(0.5) > outAt(1), "and shrinks monotonically");

  const panL = (p: number) => kenBurns({ kind: "panLeft", amount: 1 }, p).dx;
  const panR = (p: number) => kenBurns({ kind: "panRight", amount: 1 }, p).dx;
  assert(panL(1) < panL(0), "panLeft travels left");
  assert(panR(1) > panR(0), "panRight travels right");
  assert(
    Math.abs(panL(0.5)) < 1e-9 && Math.abs(panR(0.5)) < 1e-9,
    "a pan is centred on the middle of the shot, so it reveals equally either side"
  );
  console.log("✓ each move goes the way its name says");
}

/* --------------------------------- degenerate -------------------------------- */

{
  const still = kenBurns({ kind: "none", amount: 1 }, 0.5);
  assert(still.zoom === 1 && still.dx === 0 && still.dy === 0, '"none" is the identity');
  const absent = kenBurns(undefined, 0.5);
  assert(absent.zoom === 1 && absent.dx === 0, "an image saved before motion existed does not move");

  // Progress is clamped: a frame drawn a hair past the end must not overshoot.
  const over = kenBurns({ kind: "zoomIn", amount: 1 }, 4);
  const end = kenBurns({ kind: "zoomIn", amount: 1 }, 1);
  assert(over.zoom === end.zoom, "progress past the end is clamped, not extrapolated");
  const under = kenBurns({ kind: "zoomIn", amount: 1 }, -3);
  assert(under.zoom === 1, "and before the start too");

  // Amount is clamped, so a bad value cannot produce a slam.
  const wild = kenBurns({ kind: "zoomIn", amount: 999 }, 1);
  assert(wild.zoom <= 1.2, `an absurd amount is clamped, got ${wild.zoom}`);
  const zero = kenBurns({ kind: "zoomIn", amount: 0 }, 1);
  assert(zero.zoom === 1, "amount 0 is the identity, which is how it is turned off");
  console.log("✓ degenerate inputs produce a still picture, never a broken one");
}

console.log("\nken burns: all checks passed");
