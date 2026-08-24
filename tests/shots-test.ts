/**
 * The shot layer: regions, camera moves, and the promise that none of it
 * changes anything until someone asks for it.
 *
 * The frame used to be one region showing one source for the whole runtime.
 * Making it N regions touched the renderer, the schema and the store at once,
 * and the safety net for all of that is a single property: **a composition with
 * no shots, and a composition whose only shot is a plain full-frame hold, must
 * draw exactly what the old code drew.** That is asserted first here, because
 * everything else is allowed to be wrong in ways someone would notice.
 *
 * The other half is geometry. A region that is a fraction of a pixel too wide
 * leaves a seam down the middle of a split screen that nobody sees until it is
 * uploaded — the same class of bug the frame arithmetic has.
 *
 * Run with `npx tsx tests/shots-test.ts`.
 */

import {
  framingAt,
  frameForPlate,
  normaliseShots,
  plateRect,
  regionsFor,
  shotAt,
} from "../src/rescript/lib/overlay/shots";
import {
  DEFAULT_FRAME,
  DEFAULT_SUBTITLE_STYLE,
  emptyComposition,
  HOLD_CAMERA,
  isEmptyComposition,
  isPlainShot,
  NEUTRAL_FRAMING,
  primaryPlate,
  shotsAreIdle,
  SHOT_LAYOUT_LABELS,
  type CameraMove,
  type Composition,
  type Plate,
  type Shot,
  type ShotLayout,
} from "../src/rescript/lib/overlay/types";
import { paintFrame } from "../src/rescript/lib/overlay/frame";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function close(a: number, b: number, tolerance = 1e-9): boolean {
  return Math.abs(a - b) <= tolerance;
}

/* ------------------------------- the canvas -------------------------------- */

interface Draw {
  source: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Clip {
  x: number;
  y: number;
  w: number;
  h: number;
  rounded: boolean;
}

/**
 * A recording context that tracks the transform.
 *
 * Plates are drawn translated to their region's origin, so a `drawImage` at
 * (0, 0) means something different in each one — recording raw arguments would
 * make every plate look identically placed. The translate is tracked and
 * applied, so what comes out is where the pixels actually land.
 */
function stubContext() {
  const draws: Draw[] = [];
  const clips: Clip[] = [];
  let tx = 0;
  let ty = 0;
  const stack: { tx: number; ty: number }[] = [];
  let path: { x: number; y: number; w: number; h: number; rounded: boolean } | null = null;

  const ctx = {
    globalAlpha: 1,
    fillStyle: "#000",
    filter: "none",
    save() {
      stack.push({ tx, ty });
    },
    restore() {
      const previous = stack.pop();
      if (previous) {
        tx = previous.tx;
        ty = previous.ty;
      }
    },
    translate(x: number, y: number) {
      tx += x;
      ty += y;
    },
    beginPath() {
      path = null;
    },
    rect(x: number, y: number, w: number, h: number) {
      path = { x: tx + x, y: ty + y, w, h, rounded: false };
    },
    roundRect(x: number, y: number, w: number, h: number) {
      path = { x: tx + x, y: ty + y, w, h, rounded: true };
    },
    clip() {
      if (path) clips.push({ ...path });
    },
    fillRect() {},
    drawImage(src: { __name?: string }, x: number, y: number, w: number, h: number) {
      draws.push({ source: src?.__name ?? "unknown", x: tx + x, y: ty + y, w, h });
    },
    ellipse() {},
    moveTo() {},
    lineTo() {},
    fill() {},
    stroke() {},
    rotate() {},
    scale() {},
    measureText: () => ({ width: 10 }),
    fillText() {},
    strokeText() {},
    set font(_v: string) {},
    get font() {
      return "10px sans-serif";
    },
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, draws, clips };
}

/** `sourceSize` reads intrinsics by `instanceof`, so the global has to exist. */
class FakeCanvas {
  __name: string;
  width = 1920;
  height = 1080;
  constructor(name: string) {
    this.__name = name;
  }
}
(globalThis as unknown as { HTMLCanvasElement: unknown }).HTMLCanvasElement = FakeCanvas;

const FOOTAGE = new FakeCanvas("footage") as unknown as CanvasImageSource;
const SIZE = { width: 1280, height: 720 };

function composition(shots: Shot[]): Composition {
  return {
    elements: [],
    subtitles: { enabled: false, style: { ...DEFAULT_SUBTITLE_STYLE }, cues: [], generated: false },
    transitions: [],
    frame: { ...DEFAULT_FRAME },
    shots,
  };
}

function render(shots: Shot[], t = 1) {
  const { ctx, draws, clips } = stubContext();
  paintFrame(ctx, SIZE, { live: FOOTAGE, freeze: null }, null, composition(shots), t);
  return { draws, clips };
}

function shot(over: Partial<Shot> = {}): Shot {
  return { id: "s1", start: 0, end: 10, layout: "full", plates: [primaryPlate()], ...over };
}

/* ------------------- the promise: nothing changes by default ---------------- */

{
  const none = render([]);
  assert(none.draws.length === 1, `no shots draws once, got ${none.draws.length}`);

  // A plain full-frame hold is the identity shot. If this ever differs, every
  // existing project renders differently the moment the shot layer touches it.
  const plain = render([shot()]);
  assert(plain.draws.length === 1, `a plain shot draws once, got ${plain.draws.length}`);

  const a = none.draws[0];
  const b = plain.draws[0];
  assert(
    close(a.x, b.x) && close(a.y, b.y) && close(a.w, b.w) && close(a.h, b.h),
    `a plain shot must draw identically to no shot at all: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
  );

  assert(isPlainShot(shot()), "the default shot is plain");
  assert(shotsAreIdle([]), "no shots is idle");
  assert(shotsAreIdle([shot()]), "a plain shot is idle");

  // …and so export still takes the fast path.
  assert(
    isEmptyComposition(composition([shot()]), 16 / 9),
    "a plain shot must not force a re-encode"
  );
}

{
  // A shot that actually does something is work, and must not be skipped.
  const punched: Plate = {
    ...primaryPlate(),
    camera: {
      kind: "punchIn",
      from: { ...NEUTRAL_FRAMING },
      to: { zoom: 1.3, focusX: 0.5, focusY: 0.45 },
      easing: "easeOut",
      duration: 0.6,
    },
  };
  const busy = shot({ plates: [punched] });
  assert(!isPlainShot(busy), "a punch-in is not a plain shot");
  assert(!shotsAreIdle([busy]), "a punch-in is not idle");
  assert(
    !isEmptyComposition(composition([busy]), 16 / 9),
    "a punch-in must force compositing"
  );

  // And an empty composition is still empty.
  assert(isEmptyComposition(emptyComposition(), 16 / 9), "empty is still empty");
}

/* --------------------------------- lookup ---------------------------------- */

{
  const shots = [
    shot({ id: "a", start: 0, end: 5 }),
    shot({ id: "b", start: 5, end: 10 }),
  ];
  const c = composition(shots);

  assert(shotAt(c, 0)?.id === "a", "the start second is inside the shot");
  assert(shotAt(c, 4.999)?.id === "a", "just before the boundary");
  // Half-open, like every other range in this codebase: the boundary second
  // belongs to the incoming shot, so two adjacent shots never both claim it.
  assert(shotAt(c, 5)?.id === "b", "the boundary second belongs to the next shot");
  assert(shotAt(c, 10) === null, "past the end is a gap");
  assert(shotAt(composition([]), 1) === null, "no shots is always a gap");
}

/* --------------------------------- regions --------------------------------- */

const LAYOUTS = Object.keys(SHOT_LAYOUT_LABELS) as ShotLayout[];

for (const layout of LAYOUTS) {
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1080, height: 1920 },
    { width: 1080, height: 1080 },
  ]) {
    const regions = regionsFor(layout, size, 2);
    assert(regions.length > 0, `${layout} must have regions`);

    for (const r of regions) {
      assert(r.w > 0 && r.h > 0, `${layout}: a region must have area`);
      assert(
        r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9,
        `${layout}: a region must stay inside the frame, got ${JSON.stringify(r)}`
      );
    }

    // The dividing layouts must tile the frame exactly — a seam or an overlap
    // down the middle of a split screen is invisible until it is uploaded.
    if (layout.startsWith("split") || layout === "stack") {
      const area = regions.reduce((sum, r) => sum + r.w * r.h, 0);
      assert(close(area, 1, 1e-9), `${layout}: regions must tile the frame, got ${area}`);
    }
  }
}

{
  // The bubble is the one region that must not follow the frame's shape: a flat
  // fraction of width and height is an oval in 9:16 and a different oval in
  // 2.39:1.
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1080, height: 1920 },
  ]) {
    const [, bubble] = regionsFor("pip", size, 2);
    const w = bubble.w * size.width;
    const h = bubble.h * size.height;
    assert(close(w, h, 0.5), `pip must be square in pixels, got ${w}x${h}`);

    // And it stays inside the frame with room to spare.
    assert(
      bubble.x + bubble.w < 1 && bubble.y + bubble.h < 1,
      "the bubble must be inset from the corner"
    );
  }

  // The primary sits behind the bubble, full frame.
  const [back] = regionsFor("pip", SIZE, 2);
  assert(back.w === 1 && back.h === 1, "pip's primary fills the frame");
}

{
  // A dragged rect outranks the layout, and a plate whose slot does not exist
  // falls back to something visible rather than disappearing.
  const regions = regionsFor("splitLeft", SIZE, 2);
  const dragged: Plate = { ...primaryPlate(), rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } };
  assert(plateRect(dragged, regions).x === 0.1, "a deliberate placement wins");

  const orphan: Plate = { ...primaryPlate(), slot: 9 };
  const fallback = plateRect(orphan, regions);
  assert(fallback.w > 0 && fallback.h > 0, "an orphan plate still has somewhere to go");
}

/* -------------------------------- rendering -------------------------------- */

{
  // Two plates, two pictures, each inside its own region.
  const split = shot({
    layout: "splitLeft",
    plates: [primaryPlate(), { ...primaryPlate(), slot: 1 }],
  });
  const { draws, clips } = render([split]);

  assert(draws.length === 2, `a split screen draws twice, got ${draws.length}`);
  assert(clips.length === 2, `each plate clips to its region, got ${clips.length}`);
  assert(close(clips[0].x, 0) && close(clips[0].w, 640), "left region");
  assert(close(clips[1].x, 640) && close(clips[1].w, 640), "right region");

  // Under `cover`, a 16:9 source in a half-width region is taller than the
  // region and centred — so it must overhang vertically, not letterbox.
  for (const d of draws) {
    assert(d.h >= 720 - 1e-6, `cover must fill the region's height, got ${d.h}`);
  }
}

{
  // Plates paint in slot order, so a list that arrives out of order still puts
  // the bubble in front of the screen behind it.
  const pip = shot({
    layout: "pip",
    plates: [
      { ...primaryPlate(), slot: 1, radius: 0.5 },
      { ...primaryPlate(), slot: 0 },
    ],
  });
  const { clips } = render([pip]);
  assert(clips.length === 2, "two plates, two clips");
  assert(!clips[0].rounded, "the backdrop is drawn first, square");
  assert(clips[1].rounded, "the bubble is drawn second, rounded");
}

{
  // A solid plate paints no picture at all — it is what a card sits on.
  const card = shot({
    layout: "card",
    plates: [{ ...primaryPlate(), source: { kind: "solid", color: "#101010" } }],
  });
  const { draws } = render([card]);
  assert(draws.length === 0, `a solid plate draws no image, got ${draws.length}`);
}

/* --------------------------------- camera ---------------------------------- */

{
  const move: CameraMove = {
    kind: "punchIn",
    from: { zoom: 1, focusX: 0.5, focusY: 0.5 },
    to: { zoom: 1.4, focusX: 0.6, focusY: 0.4 },
    easing: "linear",
    duration: 2,
  };

  assert(framingAt(move, 0).zoom === 1, "starts at `from`");
  assert(close(framingAt(move, 1).zoom, 1.2), "halfway is halfway, on a linear ease");
  assert(framingAt(move, 2).zoom === 1.4, "arrives at `to`");
  // The rest of the shot holds. A push-in that keeps creeping for ninety
  // seconds is a different thing from one that arrives and settles.
  assert(framingAt(move, 90).zoom === 1.4, "holds after it arrives");
  assert(framingAt(move, -5).zoom === 1, "before the start clamps to `from`");

  // A zero-length move is a hard cut to the tighter framing — how `snap` is
  // expressed without a special case anywhere in the renderer.
  const snap: CameraMove = { ...move, kind: "snap", duration: 0 };
  assert(framingAt(snap, 0).zoom === 1.4, "a zero-length move is immediate");

  // A hold ignores `from` entirely, whatever someone put there.
  assert(framingAt({ ...HOLD_CAMERA, from: { zoom: 3, focusX: 0, focusY: 0 } }, 0).zoom === 1,
    "a hold is a hold");
}

{
  // Continuity: the framing must never jump within a shot. A discontinuity is
  // a visible snap in the middle of a move, which reads as a dropped frame.
  const move: CameraMove = {
    kind: "push",
    from: { zoom: 1, focusX: 0.2, focusY: 0.8 },
    to: { zoom: 1.6, focusX: 0.7, focusY: 0.3 },
    easing: "easeInOut",
    duration: 3,
  };
  let previous = framingAt(move, 0);
  for (let s = 0.05; s <= 3.5; s += 0.05) {
    const now = framingAt(move, s);
    assert(
      Math.abs(now.zoom - previous.zoom) < 0.05,
      `zoom jumped at ${s.toFixed(2)}s: ${previous.zoom} → ${now.zoom}`
    );
    previous = now;
  }
  assert(close(previous.zoom, 1.6), "and it ends where it was going");
}

{
  // The plate's framing becomes a FrameSpec, and only the three fields a plate
  // owns may differ. A shot decides what is *in* the frame, never what shape
  // the file is.
  const base = { ...DEFAULT_FRAME, aspect: "9:16" as const, background: "black" as const };
  const plate: Plate = {
    ...primaryPlate(),
    fit: "contain",
    camera: {
      kind: "punchIn",
      from: { ...NEUTRAL_FRAMING },
      to: { zoom: 2, focusX: 0.25, focusY: 0.75 },
      easing: "linear",
      duration: 1,
    },
  };
  const spec = frameForPlate(base, plate, shot({ start: 4 }), 5);

  assert(spec.aspect === "9:16", "the output shape is the project's, not the shot's");
  assert(spec.background === "black", "so is the letterbox fill");
  assert(spec.fit === "contain", "fit is the plate's");
  assert(spec.zoom === 2 && spec.focusX === 0.25, "and so is the framing, at that second");

  // A zoom of zero would divide the picture out of existence; it is coerced.
  const broken = frameForPlate(base, {
    ...plate,
    camera: { ...plate.camera, kind: "hold", to: { zoom: 0, focusX: 0.5, focusY: 0.5 } },
  }, shot(), 0);
  assert(broken.zoom === 1, "a zero zoom must not reach the renderer");
}

/* -------------------------------- ordering --------------------------------- */

{
  // Overlaps are resolved on the way in, because `shotAt` returns the first
  // match — so an overlap would be silently invisible rather than wrong, which
  // is the worse of the two to look at.
  const overlapping = [
    shot({ id: "a", start: 0, end: 6 }),
    shot({ id: "b", start: 4, end: 10 }),
  ];
  const fixed = normaliseShots(overlapping);
  assert(fixed.length === 2, "both survive");
  assert(fixed[0].end === 4, `the earlier one is clipped, got ${fixed[0].end}`);
  assert(fixed[1].start === 4, "the later one keeps its start");

  // A shot completely swallowed by the one before it takes the whole overlap,
  // rather than leaving a zero-length sliver behind.
  const swallowed = normaliseShots([
    shot({ id: "a", start: 0, end: 10 }),
    shot({ id: "b", start: 0, end: 4 }),
  ]);
  assert(
    swallowed.every((s) => s.end > s.start),
    "no zero-length shots may survive"
  );

  // Out of order in, in order out.
  const sorted = normaliseShots([
    shot({ id: "late", start: 8, end: 10 }),
    shot({ id: "early", start: 0, end: 2 }),
  ]);
  assert(sorted[0].id === "early", "sorted by start");

  // Degenerate shots are dropped rather than carried.
  assert(normaliseShots([shot({ start: 5, end: 5 })]).length === 0, "zero-length is dropped");
  assert(normaliseShots([shot({ start: 9, end: 3 })]).length === 0, "backwards is dropped");
  assert(normaliseShots([]).length === 0, "nothing in, nothing out");
}

console.log("ALL SHOT TESTS PASSED");
