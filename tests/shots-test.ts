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
import { cameraFor, fitCamera } from "../src/rescript/lib/overlay/camera";
import { findBeats, placePunchIns, type Beat } from "../src/rescript/lib/overlay/emphasis";
import { verifyPlan, type PlanWorld } from "../src/rescript/lib/overlay/verify";
import {
  compositionFor,
  extraTargets,
  nameFor,
} from "../src/rescript/lib/overlay/deliver";
import { NEUTRAL_GRADE } from "../src/rescript/lib/overlay/grade";
import { siftOps } from "../src/rescript/lib/overlay/ops-schema";
import type { Word } from "../src/rescript/lib/types";

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
    grade: null,
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

/* --------------------------- camera presets -------------------------------- */

{
  // The presets exist so the model chooses between names instead of inventing
  // zoom levels. The numbers are the house numbers, and the thing worth pinning
  // down is that they stay restrained: past about 1.35 on a face you are
  // cropping foreheads.
  for (const kind of ["punchIn", "punchOut", "push", "driftLeft", "kenBurns", "snap"] as const) {
    const move = cameraFor({ kind });
    const tightest = Math.max(move.from.zoom, move.to.zoom);
    assert(tightest > 1, `${kind} must actually move`);
    assert(tightest <= 1.35, `${kind} is too tight at ${tightest} — that crops faces`);
    assert(move.from.zoom >= 1 && move.to.zoom >= 1, `${kind} must never zoom out past the fit`);
    for (const f of [move.from, move.to]) {
      assert(f.focusX >= 0 && f.focusX <= 1, `${kind} focusX in range`);
      assert(f.focusY >= 0 && f.focusY <= 1, `${kind} focusY in range`);
    }
  }

  // punchOut is punchIn backwards, not a different move.
  const inward = cameraFor({ kind: "punchIn" });
  const outward = cameraFor({ kind: "punchOut" });
  assert(inward.to.zoom > inward.from.zoom, "punchIn ends tighter");
  assert(outward.to.zoom < outward.from.zoom, "punchOut ends wider");

  // `snap` has no travel: a hard cut to the tighter framing.
  assert(cameraFor({ kind: "snap" }).duration === 0, "snap does not travel");

  // `amount` scales about 1, so zero means "no move" — not "zoom to nothing",
  // which would divide the picture out of existence.
  const none = cameraFor({ kind: "punchIn", amount: 0 });
  assert(none.to.zoom === 1, `amount 0 must be a zoom of 1, got ${none.to.zoom}`);
  const more = cameraFor({ kind: "punchIn", amount: 2 });
  assert(more.to.zoom > inward.to.zoom, "amount 2 travels further");

  // Out-of-range asks are clamped rather than refused.
  assert(cameraFor({ kind: "punchIn", focusX: 9 }).to.focusX <= 1, "focus is clamped");
  assert(cameraFor({ kind: "punchIn", amount: -4 }).to.zoom === 1, "a negative amount is no move");

  // A hold is a hold whatever else is asked for.
  const held = cameraFor({ kind: "hold", amount: 2 });
  assert(held.from.zoom === 1 && held.to.zoom === 1, "a hold does not move");
}

{
  // A six-second push on a two-second shot never arrives: it plays as a creep
  // that stops mid-travel at the cut, which reads as a dropped frame.
  const slow = cameraFor({ kind: "push" });
  assert(slow.duration > 2, "the push is long by design");
  const fitted = fitCamera(slow, 2);
  assert(fitted.duration === 2, `it must be shortened to the shot, got ${fitted.duration}`);
  assert(fitted.to.zoom === slow.to.zoom, "shortening must not change where it goes");

  // A move that already fits is returned untouched.
  assert(fitCamera(slow, 30) === slow, "a move that fits is not rewritten");
}

/* -------------------------------- emphasis --------------------------------- */

function words(spec: { text: string; start: number; end: number; speaker?: number }[]): Word[] {
  return spec.map((w, i) => ({
    id: i + 1,
    text: w.text,
    start: w.start,
    end: w.end,
    speaker: w.speaker ?? 0,
    deleted: false,
  }));
}

{
  // The beats come out of the delivery, not off a timer. A pause then a word is
  // the speaker doing the emphasis themselves; the camera only agrees.
  const spoken = words([
    { text: "So", start: 0, end: 0.3 },
    { text: "we", start: 0.3, end: 0.5 },
    { text: "tried", start: 0.5, end: 0.9 },
    { text: "it.", start: 0.9, end: 1.3 },
    // A clear pause, then a figure — the strongest beat available.
    { text: "Revenue", start: 2.1, end: 2.7 },
    { text: "tripled", start: 2.7, end: 3.2 },
    { text: "300%", start: 3.2, end: 3.9 },
  ]);

  const beats = findBeats(spoken, 4, []);
  assert(beats.length > 0, "there are beats in that");
  // Sorted best-first, and the best one is the pause-then-figure.
  assert(beats[0].score >= beats[beats.length - 1].score, "sorted best first");
  assert(
    beats[0].word === "Revenue" || beats[0].word === "300%",
    `the strongest beat should be the pause or the figure, got ${beats[0].word}`
  );

  // "So" opens the sentence and carries nothing; it must not outrank a figure.
  const weak = beats.find((b) => b.word === "So");
  if (weak) assert(weak.score < beats[0].score, "a weak opener is not a beat worth taking");

  assert(findBeats([], 10, []).length === 0, "no words, no beats");
}

{
  // Spacing is the part that decides whether an edit reads as directed. Below
  // about five seconds a zoom stops being emphasis and becomes a fault.
  const dense: Beat[] = [];
  for (let i = 0; i < 200; i += 1) {
    dense.push({ at: i * 0.5, score: 100 - i, word: `w${i}` });
  }
  const placed = placePunchIns(dense, { duration: 120, perMinute: 2.5 });

  assert(placed.length > 0, "something got placed");
  assert(placed.length <= 6, `two and a half a minute over two minutes, got ${placed.length}`);

  for (let i = 1; i < placed.length; i += 1) {
    const gap = placed[i].start - placed[i - 1].start;
    assert(gap >= 6 - 1e-9, `punches ${gap.toFixed(2)}s apart — too close to read as emphasis`);
  }

  // In order, and inside the video.
  for (const p of placed) {
    assert(p.end > p.start, "a punch must have length");
    assert(p.end <= 120 + 1e-9, "and must end inside the video");
  }

  // Best-first, not chronological: taking the strongest beat and clearing its
  // neighbourhood is what stops a merely-good moment displacing the best one.
  assert(placed[0].beat.score >= 90, "the strongest beat survives the spacing");

  // Degenerate asks produce nothing rather than throwing.
  assert(placePunchIns([], { duration: 60 }).length === 0, "no beats, no punches");
  assert(placePunchIns(dense, { duration: 0 }).length === 0, "no video, no punches");
}

/* ------------------------------ verification -------------------------------- */

const world: PlanWorld = {
  duration: 60,
  boundaryCount: 2,
  elementCount: 0,
  subtitlesOn: false,
  subtitlePosition: "bottom",
  transcript: "[00:00] this is what was said in the video",
  can: { generateImage: true, photoSearch: true },
};

{
  // A shot past the end of the cut never plays, and a plan that claims to have
  // reframed something while the video is unchanged is worse than a refusal.
  const late = verifyPlan([{ op: "addShot", start: 90, end: 95, layout: "full" }], world);
  assert(late.length > 0, "a shot past the end must be caught");

  // Too short to read as anything but a glitch.
  const blink = verifyPlan([{ op: "addShot", start: 5, end: 5.1, layout: "full" }], world);
  assert(blink.length > 0, "a tenth of a second must be caught");

  // A split screen with one plate would draw the footage into both halves,
  // which is not what anyone asking for a split screen means.
  const halfSplit = verifyPlan(
    [{ op: "addShot", start: 5, end: 12, layout: "splitLeft", plates: [{ slot: 0 }] }],
    world
  );
  assert(halfSplit.length > 0, "a two-region layout needs two plates");

  // The same thing, said properly, passes.
  const proper = verifyPlan(
    [
      {
        op: "addShot",
        start: 5,
        end: 12,
        layout: "splitLeft",
        plates: [{ slot: 0 }, { slot: 1, source: "selfCrop" }],
      },
    ],
    world
  );
  assert(proper.length === 0, `a well-formed split should pass, got ${JSON.stringify(proper)}`);

  // Two shots over the same seconds: the store clips the earlier one, so the
  // plan will do a step and a half of what it said it would.
  const clash = verifyPlan(
    [
      { op: "addShot", start: 5, end: 15, layout: "full" },
      { op: "addShot", start: 10, end: 20, layout: "full" },
    ],
    world
  );
  assert(clash.length > 0, "overlapping shots must be reported");

  // Adjacent, not overlapping, is the normal way to cut and must pass.
  const adjacent = verifyPlan(
    [
      { op: "addShot", start: 5, end: 10, layout: "full" },
      { op: "addShot", start: 10, end: 15, layout: "full" },
    ],
    world
  );
  assert(adjacent.length === 0, `adjacent shots are fine, got ${JSON.stringify(adjacent)}`);

  // Asking twice would land the second pass on top of the first.
  const twice = verifyPlan([{ op: "autoPunchIns" }, { op: "autoPunchIns" }], world);
  assert(twice.length > 0, "autoPunchIns twice must be caught");
  assert(verifyPlan([{ op: "autoPunchIns" }], world).length === 0, "once is fine");
}

{
  // The schema is the other half of the guard: a layout or camera kind that
  // does not exist must not reach the executor.
  const good = siftOps([
    { op: "addShot", start: 1, end: 4, layout: "stack", plates: [{ slot: 0 }, { slot: 1 }] },
    { op: "setCamera", start: 5, end: 8, camera: "punchIn" },
  ]);
  assert(good.ops.length === 2, `both should survive, got ${good.rejected.join("; ")}`);

  const bad = siftOps([
    { op: "addShot", start: 1, end: 4, layout: "hexagon" },
    { op: "setCamera", start: 1, end: 4, camera: "barrel-roll" },
    { op: "setCamera", start: 1, end: 4, camera: "punchIn", amount: 99 },
  ]);
  assert(bad.ops.length === 0, "none of those are real");
  assert(bad.rejected.length === 3, `all three should be reported, got ${bad.rejected.length}`);
}

/* ------------------------------- delivering -------------------------------- */

{
  // Offering a shape the project is already in produces two identical files and
  // a question about which is which. Compared by *shape*, not by name — ids
  // cannot see that "Source" on a 16:9 project is 16:9.
  const fromWide = extraTargets("16:9", 16 / 9).map((t) => t.aspect);
  assert(!fromWide.includes("16:9"), "never the current shape");
  assert(!fromWide.includes("source"), "and not Source when Source is the same shape");
  assert(fromWide.includes("9:16") && fromWide.includes("1:1"), "the useful ones are there");

  // A 4:3 recording framed as shot must not be offered 4:3 either.
  const fromFourThree = extraTargets("source", 4 / 3).map((t) => t.aspect);
  assert(!fromFourThree.includes("4:3"), "4:3 source must not offer 4:3");
  assert(fromFourThree.includes("16:9"), "but widescreen is a real deliverable from it");

  // Sizes are real, even, and the right way up.
  for (const target of extraTargets("16:9", 16 / 9)) {
    assert(target.width > 0 && target.height > 0, `${target.aspect}: has a size`);
    assert(target.width % 2 === 0 && target.height % 2 === 0, `${target.aspect}: H.264 needs even`);
  }
  const vertical = extraTargets("16:9", 16 / 9).find((t) => t.aspect === "9:16");
  assert(vertical && vertical.height > vertical.width, "9:16 is taller than it is wide");
  const square = extraTargets("16:9", 16 / 9).find((t) => t.aspect === "1:1");
  assert(square && square.width === square.height, "1:1 is square");
}

{
  // Only the shape changes. Everything else is the edit, and the edit is the
  // same edit in every shape — a delivery that also moved the captions or
  // dropped the look would be a different video, not another format of one.
  const source: Composition = {
    ...composition([shot()]),
    grade: { ...NEUTRAL_GRADE, contrast: 0.3 },
    frame: { ...DEFAULT_FRAME, aspect: "16:9", zoom: 1.2, focusX: 0.3 },
  };
  const vertical = compositionFor(source, "9:16");

  assert(vertical.frame.aspect === "9:16", "the shape changed");
  assert(vertical.frame.zoom === 1.2, "the framing did not");
  assert(vertical.frame.focusX === 0.3, "nor the focus point");
  assert(vertical.grade === source.grade, "nor the look");
  assert(vertical.shots === source.shots, "nor the shots");
  assert(vertical.elements === source.elements, "nor what is on screen");
  assert(source.frame.aspect === "16:9", "and the original is untouched");
}

{
  // Three downloads have to be tellable apart, and a colon is not a filename
  // character on any platform worth supporting.
  assert(nameFor("talk.mp4", "9:16", "mp4") === "talk-9x16.mp4", "named by its shape");
  assert(nameFor("talk.mp4", "2.39:1", "mp4") === "talk-2.39x1.mp4", "no colons");
  assert(nameFor("talk.mp4", "source", "mp4") === "talk.mp4", "the master keeps its own name");
  assert(nameFor("no-extension", "1:1", "mp4") === "no-extension-1x1.mp4", "and a stem without one works");
}

console.log("ALL SHOT TESTS PASSED");
