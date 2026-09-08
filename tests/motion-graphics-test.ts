/**
 * Ambient motion, and numbers that count.
 *
 * Enter and exit animations are the two ends of an element's life. A
 * composition made only of those is a slideshow: everything lands, freezes for
 * three seconds, and leaves. What separates motion graphics from captions is
 * that nothing on screen is ever completely still — and the amount of movement
 * that achieves it is much smaller than it looks written down.
 *
 * Three properties hold the whole thing together and each fails invisibly.
 * A motion that is not identity at t=0 jumps at the moment the entrance hands
 * over to it. One that is too large turns a produced video into a bouncy one.
 * One that drifts without bound walks its element off the frame over a long
 * hold. None of that is a crash, a type error, or anything a screenshot of a
 * single frame would show.
 *
 * Run with `npx tsx tests/motion-graphics-test.ts`.
 */

import {
  AMBIENTS,
  AMBIENT_KINDS,
  ambientAt,
  counterText,
  describeAmbients,
} from "../src/motionscript/lib/overlay/ambient";
import { drawStateAt } from "../src/motionscript/lib/overlay/animation";
import { addTextOp, animateElementOp } from "../src/motionscript/lib/overlay/ops-schema";
import { readFigure } from "../src/motionscript/lib/slash";
import { SYSTEM } from "../src/lib/ai/motionscript-agent";
import type { AmbientKind, TextElement } from "../src/motionscript/lib/overlay/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function near(actual: number, expected: number, tol: number, what: string) {
  assert(
    Math.abs(actual - expected) <= tol,
    `${what}: expected ~${expected}, got ${actual.toFixed(5)}`
  );
}

const moving = AMBIENT_KINDS.filter((k) => k !== "none");

/* ------------------------------ starts at rest ------------------------------ */

{
  // `tilt` and `drift` are one long move rather than a loop, so they are
  // centred on where the element was placed — they start turned one way and
  // end turned the other. Checked separately below.
  const LONG: AmbientKind[] = ["tilt", "drift"];

  for (const kind of moving) {
    const at0 = ambientAt({ kind }, 0, 4);
    // Whatever else a motion does, it cannot start at a different size or a
    // different brightness: those are what the entrance was animating.
    near(at0.scale, 1, 1e-9, `${kind} scale at t=0`);
    near(at0.opacity, 1, 1e-9, `${kind} opacity at t=0`);
    if (LONG.includes(kind)) continue;
    near(at0.dx, 0, 1e-9, `${kind} dx at t=0`);
    near(at0.dy, 0, 1e-9, `${kind} dy at t=0`);
    near(at0.rotate, 0, 1e-9, `${kind} rotation at t=0`);
  }

  for (const kind of LONG) {
    const mid = ambientAt({ kind }, 2, 4);
    near(mid.dx, 0, 1e-9, `${kind} passes through where it was placed (dx)`);
    near(mid.dy, 0, 1e-9, `${kind} passes through where it was placed (dy)`);
    near(mid.rotate, 0, 1e-9, `${kind} passes through square`);
  }
  console.log(`✓ all ${moving.length} motions are continuous from the first frame`);
}

/* --------------------------------- restraint -------------------------------- */

{
  // The amplitudes are in fractions of the frame. 0.02 is about twenty pixels
  // at 1080 — a drift you feel rather than see. Anything past 0.05 is a bounce.
  for (const kind of moving) {
    for (let t = 0; t <= 12; t += 0.05) {
      const s = ambientAt({ kind }, t, 12);
      assert(Math.abs(s.dx) <= 0.03, `${kind} moved ${s.dx.toFixed(3)} sideways`);
      assert(Math.abs(s.dy) <= 0.03, `${kind} moved ${s.dy.toFixed(3)} vertically`);
      assert(s.scale > 0.9 && s.scale < 1.12, `${kind} scaled to ${s.scale.toFixed(3)}`);
      assert(Math.abs(s.rotate) <= 4, `${kind} turned ${s.rotate.toFixed(2)}°`);
      assert(s.opacity > 0.7 && s.opacity <= 1, `${kind} faded to ${s.opacity.toFixed(3)}`);
    }
  }
  console.log("✓ nothing moves further than it should, over a twelve-second hold");
}

/* ------------------------------- amount, speed ------------------------------ */

{
  // Amount scales the movement and zero stops it, which is what makes the
  // slider usable rather than a choice between "on" and "too much".
  const half = ambientAt({ kind: "float", amount: 0.5 }, 1, 4);
  const full = ambientAt({ kind: "float", amount: 1 }, 1, 4);
  near(half.dy, full.dy / 2, 1e-9, "half the amount is half the movement");
  near(ambientAt({ kind: "float", amount: 0 }, 1, 4).dy, 0, 1e-9, "zero is still");

  // Speed moves the phase, so the same shape arrives sooner.
  const slow = ambientAt({ kind: "float", speed: 1 }, 1, 8);
  const fast = ambientAt({ kind: "float", speed: 2 }, 0.5, 8);
  near(fast.dy, slow.dy, 1e-9, "double speed reaches the same point in half the time");

  // No spec at all, and "none", are both simply still.
  near(ambientAt(undefined, 3, 8).scale, 1, 1e-9, "no motion is still");
  near(ambientAt({ kind: "none" }, 3, 8).dy, 0, 1e-9, "none is still");
  // A zero-length element cannot be part-way through anything.
  near(ambientAt({ kind: "float" }, 0, 0).dy, 0, 1e-9, "a zero-length element is still");
  console.log("✓ amount and speed do what the sliders say they do");
}

/* ------------------------------ the long moves ------------------------------ */

{
  // `tilt` and `drift` complete exactly once however long the element is up,
  // so a ten-second title and a two-second one both finish their move.
  for (const life of [2, 10, 60]) {
    const start = ambientAt({ kind: "tilt" }, 0, life);
    const end = ambientAt({ kind: "tilt" }, life, life);
    near(start.rotate, -3, 1e-9, `tilt starts the same at ${life}s`);
    near(end.rotate, 3, 1e-9, `tilt ends the same at ${life}s`);
    near(ambientAt({ kind: "tilt" }, life / 2, life).rotate, 0, 1e-9, "tilt passes through square");
  }
  console.log("✓ a slow tilt is one move, whatever the element's length");
}

/* ------------------------------- composition -------------------------------- */

{
  const element: TextElement = {
    id: "t1",
    kind: "text",
    name: "Title",
    text: "Shipped",
    start: 10,
    end: 16,
    rect: { x: 0.2, y: 0.4, w: 0.6, h: 0.2 },
    rotation: 6,
    opacity: 0.8,
    z: 1,
    locked: false,
    hidden: false,
    enter: { kind: "fade", duration: 0.4, easing: "easeOut" },
    exit: { kind: "fade", duration: 0.3, easing: "easeIn" },
    ambient: { kind: "wobble" },
    fontFamily: "sans-serif",
    fontWeight: 700,
    italic: false,
    fontSize: 0.08,
    color: "#ffffff",
    align: "center",
    lineHeight: 1.1,
    letterSpacing: 0,
    padding: 0.2,
    background: null,
    uppercase: false,
    strokeColor: null,
    strokeWidth: 0,
  } as TextElement;

  const mid = drawStateAt(element, 13)!;
  assert(mid !== null, "the element should be on screen");
  assert(mid.rotate !== 0, "the wobble did not reach the draw state");
  // Element opacity is a multiplier, not a replacement — a half-transparent
  // element that shimmers must not come back to full.
  assert(mid.opacity <= 0.8 + 1e-9, `opacity climbed to ${mid.opacity}`);

  // The element's own rotation is separate from the motion's: the renderer adds
  // them, so the motion is a wobble *around* however it was placed.
  assert(element.rotation === 6, "the element's own rotation was overwritten");

  // Progress is what a counter and a filling bar are drawn from, and it has to
  // be the element's own life rather than the video's.
  near(drawStateAt(element, 10)!.progress, 0, 1e-9, "progress at the start");
  near(drawStateAt(element, 13)!.progress, 0.5, 1e-9, "progress half way");
  assert(drawStateAt(element, 9.9) === null, "drawn before it exists");
  assert(drawStateAt(element, 16) === null, "still drawn after it has gone");

  // No jump at the handover: the state either side of the entrance ending has
  // to be continuous, which is the whole reason motions start at identity.
  const before = drawStateAt(element, 10.39)!;
  const after = drawStateAt(element, 10.41)!;
  assert(
    Math.abs(after.rotate - before.rotate) < 0.2,
    "the picture jumps when the entrance hands over to the motion"
  );
  console.log("✓ motion composes onto the entrance without a jump at the handover");
}

/* --------------------------------- counters --------------------------------- */

{
  const spec = { from: 0, to: 10000, suffix: " users" };
  assert(counterText(spec, 0) === "0 users", `start: ${counterText(spec, 0)}`);
  assert(counterText(spec, 1) === "10,000 users", `end: ${counterText(spec, 1)}`);

  // It lands before it leaves. A figure still climbing as it fades out has not
  // been read, so the count finishes at `hold` and the rest is a hold.
  assert(
    counterText(spec, 0.6) === "10,000 users",
    `should have landed by 60%: ${counterText(spec, 0.6)}`
  );
  assert(
    counterText({ ...spec, hold: 0.3 }, 0.3) === "10,000 users",
    "a shorter hold lands sooner"
  );

  // Grouping, decimals, and both ends of the string.
  assert(counterText({ from: 0, to: 1250 }, 1) === "1,250", "thousands are grouped");
  assert(
    counterText({ from: 0, to: 1250, grouped: false }, 1) === "1250",
    "grouping can be turned off"
  );
  assert(
    counterText({ from: 0, to: 1.2, decimals: 1, prefix: "$", suffix: "M" }, 1) === "$1.2M",
    `prefix and suffix: ${counterText({ from: 0, to: 1.2, decimals: 1, prefix: "$", suffix: "M" }, 1)}`
  );
  // Counting down is a legitimate figure too.
  assert(counterText({ from: 100, to: 0, suffix: "%" }, 1) === "0%", "counts down as well as up");
  // Never past the target, whatever the caller passes.
  assert(counterText(spec, 5) === "10,000 users", "overran the target");
  assert(counterText(spec, -1) === "0 users", "started before the beginning");
  console.log("✓ a counter lands on its figure and holds there");
}

/* ------------------------------- reading a figure ---------------------------- */

{
  const cases: Array<[string, number, string, string, number]> = [
    ["94%", 94, "", "%", 0],
    ["$1.2M", 1.2, "$", "M", 1],
    ["10,000 users", 10000, "", " users", 0],
    ["3.75x faster", 3.75, "", "x faster", 2],
    ["-40 seconds", -40, "", " seconds", 0],
  ];
  for (const [text, value, prefix, suffix, decimals] of cases) {
    const read = readFigure(text);
    assert(read !== null, `"${text}" had no number in it`);
    assert(read!.value === value, `"${text}" → ${read!.value}, expected ${value}`);
    assert(read!.prefix === prefix, `"${text}" prefix "${read!.prefix}"`);
    assert(read!.suffix === suffix, `"${text}" suffix "${read!.suffix}"`);
    assert(read!.decimals === decimals, `"${text}" decimals ${read!.decimals}`);
  }
  // Words with no figure in them animate nothing rather than counting to an
  // invented number.
  assert(readFigure("shipped on a Friday") === null, "invented a figure");
  console.log("✓ a figure is read out of what somebody typed");
}

/* ---------------------------------- the ops --------------------------------- */

{
  assert(
    addTextOp.safeParse({ op: "addText", text: "Hi", ambient: "float" }).success,
    "a bare motion name is refused"
  );
  assert(
    addTextOp.safeParse({
      op: "addText",
      text: "Hi",
      ambient: { kind: "pulse", amount: 0.8, speed: 1.2 },
    }).success,
    "the object form is refused"
  );
  assert(
    !addTextOp.safeParse({ op: "addText", text: "Hi", ambient: "jiggle" }).success,
    "an invented motion is accepted"
  );
  assert(
    !addTextOp.safeParse({ op: "addText", text: "Hi", ambient: { kind: "float", amount: 9 } }).success,
    "an amount that would be a mistake is accepted"
  );
  assert(
    addTextOp.safeParse({
      op: "addText",
      text: "10,000 users",
      count: { from: 0, to: 10000, suffix: " users" },
    }).success,
    "a counter is refused"
  );
  assert(
    animateElementOp.safeParse({ op: "animateElement", element: 2, ambient: "none" }).success,
    "there is no way to take a motion away again"
  );
  console.log("✓ the schema accepts exactly what exists");
}

/* --------------------------------- the prompt -------------------------------- */

{
  assert(SYSTEM.includes('"ambient"'), "the agent is never told motion exists");
  assert(SYSTEM.includes('"count"'), "nor that a number can count up");
  assert(
    /freezes for three seconds and leaves/.test(SYSTEM),
    "nor why any of it matters, which is the part that decides whether it is used"
  );
  for (const a of AMBIENTS) {
    if (a.id === "none") continue;
    assert(SYSTEM.includes(a.id), `"${a.id}" is not in the list the model is given`);
  }
  assert(describeAmbients().split("\n").length === AMBIENTS.length - 1, "the listing lost a motion");
  console.log("✓ the whole decision reaches the model");
}

console.log("\nmotion graphics: all checks passed");
