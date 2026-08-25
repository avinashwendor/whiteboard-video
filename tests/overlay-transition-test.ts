/**
 * Transitions, checked at the level that actually broke: the composite.
 *
 * The maths in `transitionAt` was already covered, and it was right the whole
 * time — the bug was one layer down. A push transition (dissolve, the slides,
 * zoom-out) is *made of* the outgoing clip's held last frame, and the preview
 * was handing the renderer `null` for it. Every one of those six kinds drew the
 * incoming clip and returned, which on screen is indistinguishable from no
 * transition at all. Nothing threw, so nothing looked wrong in the code.
 *
 * So these assert what reaches the canvas: that the held frame is drawn, that
 * its opacity actually moves across the window, and that a dip tints the frame
 * hardest in the middle of the cut. A stub context records the draw calls,
 * which is enough to tell "composited" from "silently did nothing" without a
 * browser.
 */

import { paintFrame } from "../src/rescript/lib/overlay/frame";
import { buildTimeline, familyOf, transitionAt } from "../src/rescript/lib/overlay/timeline";
import { TRANSITIONS } from "../src/rescript/lib/overlay/ops-schema";
import {
  DEFAULT_FRAME,
  DEFAULT_SUBTITLE_STYLE,
  TRANSITION_LABELS,
  type Composition,
  type Transition,
  type TransitionKind,
} from "../src/rescript/lib/overlay/types";
import type { Word } from "../src/rescript/lib/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function word(id: number, text: string, start: number, end: number, deleted = false): Word {
  return { id, text, start, end, speaker: 0, deleted };
}

/* ------------------------------ a stub canvas ------------------------------ */

interface DrawCall {
  source: string;
  alpha: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FillCall {
  style: string;
  alpha: number;
  /**
   * Whether the picture had already been drawn when this fill happened.
   *
   * The renderer clears to black before anything else, so a fill on its own is
   * ambiguous — the clear and a full-strength dip look identical. Only a fill
   * laid *over* the picture is a transition tint.
   */
  overPicture: boolean;
}

/**
 * Just enough CanvasRenderingContext2D to record what a paint would have done.
 * `globalAlpha` has to be tracked through save/restore, because the alpha at
 * the moment of the call is the entire question here.
 */
function stubContext() {
  const draws: DrawCall[] = [];
  const fills: FillCall[] = [];
  const stack: number[] = [];

  const ctx = {
    globalAlpha: 1,
    fillStyle: "#000",
    filter: "none",
    save() {
      stack.push(this.globalAlpha);
    },
    restore() {
      const previous = stack.pop();
      if (previous !== undefined) this.globalAlpha = previous;
    },
    fillRect() {
      fills.push({
        style: String(this.fillStyle),
        alpha: this.globalAlpha,
        overPicture: draws.length > 0,
      });
    },
    drawImage(src: { __name?: string }, x: number, y: number, w: number, h: number) {
      draws.push({
        source: src?.__name ?? "unknown",
        alpha: this.globalAlpha,
        x,
        y,
        w,
        h,
      });
    },
    // Everything the overlay layer touches, stubbed to nothing. No elements or
    // subtitles are used below, so these only need to exist.
    beginPath() {},
    roundRect() {},
    rect() {},
    ellipse() {},
    arc() {},
    moveTo() {},
    lineTo() {},
    clip() {},
    fill() {},
    stroke() {},
    translate() {},
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

  return { ctx: ctx as unknown as CanvasRenderingContext2D, draws, fills };
}

/**
 * A stand-in for a video frame / held canvas, tagged so draws are identifiable.
 *
 * `sourceSize` in the renderer reads an intrinsic size by `instanceof` against
 * the DOM classes, none of which exist in Node — so a plain object is silently
 * treated as having no size and never drawn. Registering a canvas-shaped class
 * as the global is what lets the real drawing code run unmodified here.
 */
class FakeCanvas {
  __name: string;
  width = 640;
  height = 360;
  constructor(name: string) {
    this.__name = name;
  }
}
(globalThis as unknown as { HTMLCanvasElement: unknown }).HTMLCanvasElement = FakeCanvas;

function source(name: string) {
  return new FakeCanvas(name) as unknown as CanvasImageSource;
}

const SIZE = { width: 640, height: 360 };

function composition(transitions: Transition[]): Composition {
  return {
    elements: [],
    subtitles: { enabled: false, style: { ...DEFAULT_SUBTITLE_STYLE }, cues: [], generated: false },
    transitions,
    frame: { ...DEFAULT_FRAME },
    shots: [],
    grade: null,
  };
}

/** 0–4 and 6–10 kept: the output runs 0–8 with the seam at 4. */
function cutTimeline() {
  const words = [
    word(1, "one", 0, 2),
    word(2, "two", 2, 4),
    word(3, "cut", 4, 6, true),
    word(4, "four", 6, 8),
    word(5, "five", 8, 10),
  ];
  return buildTimeline(words, 10, [], []);
}

/** Paint one frame and hand back what the context recorded. */
function paintAt(t: number, transitions: Transition[]) {
  const timeline = cutTimeline();
  const active = transitionAt(t, timeline, transitions);
  const { ctx, draws, fills } = stubContext();
  paintFrame(
    ctx,
    SIZE,
    { live: source("live"), freeze: source("freeze") },
    active,
    composition(transitions),
    t
  );
  return { active, draws, fills };
}

/* ------------------------- the push family composites ---------------------- */

const PUSH: TransitionKind[] = [
  "dissolve",
  "slideLeft",
  "slideRight",
  "slideUp",
  "slideDown",
  "zoomOut",
  // The four added later. `morphCut` matters most: this editor cuts by deleting
  // words, so its cuts are jump cuts, and a morph that silently played as a
  // hard cut would leave the one transition the product actually needs broken.
  "morphCut",
  "whipPan",
  "iris",
];

for (const kind of PUSH) {
  const transitions: Transition[] = [{ index: 1, kind, duration: 0.6 }];

  // Mid-window: both the incoming clip and the held frame must reach the canvas.
  const { active, draws } = paintAt(4.3, transitions);
  assert(active, `${kind}: a transition should be active mid-window`);
  assert(active!.family === "push", `${kind} is a push transition`);

  const live = draws.filter((d) => d.source === "live");
  const freeze = draws.filter((d) => d.source === "freeze");
  // The live source can legitimately be drawn twice: once as the blurred
  // backdrop behind a letterboxed picture, once as the picture itself.
  assert(live.length >= 1, `${kind}: the incoming clip reaches the canvas`);
  assert(
    freeze.length === 1,
    `${kind}: THE HELD FRAME MUST BE DRAWN — this is the bug that made every push transition look like a hard cut`
  );

  // Outside the window nothing is held.
  const after = paintAt(6.0, transitions);
  assert(
    after.draws.every((d) => d.source !== "freeze"),
    `${kind}: no held frame once the transition is over`
  );
}

/* --------------------- a missing held frame degrades safely ---------------- */

for (const kind of PUSH) {
  const transitions: Transition[] = [{ index: 1, kind, duration: 0.6 }];
  const timeline = cutTimeline();
  const active = transitionAt(4.3, timeline, transitions);
  const { ctx, draws } = stubContext();
  // freeze: null is what the preview used to pass, always.
  paintFrame(ctx, SIZE, { live: source("live"), freeze: null }, active, composition(transitions), 4.3);

  assert(
    draws.length >= 1 && draws.every((d) => d.source === "live"),
    `${kind}: without a held frame it must fall back to a plain cut rather than throwing`
  );
}

/* ---------------------- the dissolve actually dissolves -------------------- */

{
  const transitions: Transition[] = [{ index: 1, kind: "dissolve", duration: 1 }];
  const alphaAt = (t: number) => {
    const { draws } = paintAt(t, transitions);
    const held = draws.find((d) => d.source === "freeze");
    return held ? held.alpha : null;
  };

  // Window is [4, 5). The held frame starts opaque and fades out.
  const early = alphaAt(4.02);
  const middle = alphaAt(4.5);
  const late = alphaAt(4.95);

  assert(early !== null && middle !== null && late !== null, "held frame drawn across the window");
  assert(early! > 0.9, `starts held: expected alpha near 1, got ${early}`);
  assert(late! < 0.2, `ends cleared: expected alpha near 0, got ${late}`);
  assert(
    early! > middle! && middle! > late!,
    `opacity must fall monotonically — got ${early}, ${middle}, ${late}`
  );
}

/* --------------------- slides move, rather than just fade ------------------ */

{
  const positions = (kind: TransitionKind, t: number) => {
    const { draws } = paintAt(t, [{ index: 1, kind, duration: 1 }]);
    return draws.find((d) => d.source === "freeze")!;
  };

  const leftEarly = positions("slideLeft", 4.05);
  const leftLate = positions("slideLeft", 4.9);
  assert(leftLate.x < leftEarly.x, "slideLeft carries the held frame off to the left");

  const rightEarly = positions("slideRight", 4.05);
  const rightLate = positions("slideRight", 4.9);
  assert(rightLate.x > rightEarly.x, "slideRight carries it the other way");

  const upEarly = positions("slideUp", 4.05);
  const upLate = positions("slideUp", 4.9);
  assert(upLate.y < upEarly.y, "slideUp carries it upwards");

  const downEarly = positions("slideDown", 4.05);
  const downLate = positions("slideDown", 4.9);
  assert(downLate.y > downEarly.y, "slideDown carries it downwards");

  // A slide is a move, not a fade: it stays opaque while it travels.
  assert(leftLate.alpha > 0.9, "a slide does not fade the frame it is moving");

  // Zoom-out grows the held frame as it goes.
  const zoomEarly = positions("zoomOut", 4.05);
  const zoomLate = positions("zoomOut", 4.9);
  assert(zoomLate.w > zoomEarly.w, "zoomOut scales the held frame up as it leaves");
}

/* ------------------------- the dip family tints the cut -------------------- */

{
  // fadeBlack is symmetric about the boundary and hardest in the middle.
  const transitions: Transition[] = [{ index: 1, kind: "fadeBlack", duration: 1 }];
  const tintAt = (t: number) => {
    const { fills } = paintAt(t, transitions);
    const tint = fills.filter(
      (f) => f.overPicture && f.style === "#000" && f.alpha > 0 && f.alpha <= 1
    );
    return tint.length ? Math.max(...tint.map((f) => f.alpha)) : 0;
  };

  // Window is [3.5, 4.5) — half either side of the seam at 4.
  const edge = tintAt(3.55);
  const centre = tintAt(4.0);
  assert(centre > edge, `the dip is deepest at the cut: edge ${edge}, centre ${centre}`);
  assert(centre > 0.9, `fully through black at the seam, got ${centre}`);

  // And it is gone outside the window.
  assert(tintAt(2.0) === 0, "no tint well before the cut");
  assert(tintAt(6.0) === 0, "nor well after it");

  // A dip never needs a held frame.
  const { draws } = paintAt(4.0, transitions);
  assert(
    draws.every((d) => d.source !== "freeze"),
    "a dip is single-source and must not draw a held frame"
  );
}

{
  // fadeWhite is the same shape in the other colour.
  const { fills } = paintAt(4.0, [{ index: 1, kind: "fadeWhite", duration: 1 }]);
  assert(
    fills.some((f) => f.overPicture && f.style === "#fff" && f.alpha > 0.9),
    "fadeWhite goes through white"
  );
}

/* ------------------------ every kind is actually offered -------------------- */

{
  const declared = Object.keys(TRANSITION_LABELS) as TransitionKind[];

  for (const kind of declared) {
    assert(
      (TRANSITIONS as readonly string[]).includes(kind),
      `"${kind}" exists but the agent's schema will not accept it`
    );
  }
  for (const kind of TRANSITIONS) {
    assert(
      declared.includes(kind as TransitionKind),
      `the schema accepts "${kind}", which is not a transition`
    );
  }

  // And each one composites *something* at the middle of its window. A kind
  // that falls through the switch draws nothing and looks like a hard cut,
  // which is the exact failure this whole file was written for.
  for (const kind of declared) {
    if (kind === "none") continue;
    // A dip is centred on the boundary and a push runs entirely after it, so
    // the middle of the window is a different second for each family.
    const at = familyOf(kind) === "dip" ? 4.0 : 4.3;
    const { active, draws, fills } = paintAt(at, [{ index: 1, kind, duration: 0.6 }]);
    assert(active, `${kind}: nothing active at ${at}s, mid-window for its family`);
    assert(
      draws.length + fills.length > 0,
      `${kind}: drew nothing at all mid-transition`
    );
  }
}

console.log("ALL TRANSITION TESTS PASSED");
