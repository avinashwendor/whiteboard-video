/**
 * Marks and icons.
 *
 * The composition layer offered three shapes — rect, ellipse, line — while the
 * repo already held 1,776 Lucide icons as path geometry, used by the whiteboard
 * engine and unreachable from here. Making them one kind of element is most of
 * this; the parts worth testing are the edges.
 *
 * Namely: that a name nobody has is *refused* rather than silently placing an
 * invisible element, that the marks are actually drawable path data rather than
 * strings that happen to look like it, and that a mark scaled into a wide box
 * stays the shape it was — a circle-this stretched to its element's rect stops
 * reading as a circle, and every mark here is a gesture whose shape carries the
 * meaning.
 *
 * Run with `npx tsx tests/shapes-test.ts`.
 */

import {
  ANNOTATIONS,
  ANNOTATION_LABELS,
  ANNOTATION_NAMES,
  allShapeNames,
  drawShapePath,
  knownShape,
  pathsFor,
  searchShapes,
  VIEWBOX,
} from "../src/rescript/lib/overlay/shapes";
import { siftOps } from "../src/rescript/lib/overlay/ops-schema";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/* -------------------------------- the marks -------------------------------- */

{
  assert(ANNOTATION_NAMES.length >= 12, "the marks are the point; there should be a set of them");

  for (const name of ANNOTATION_NAMES) {
    const paths = ANNOTATIONS[name];
    assert(paths.length > 0, `${name}: no path data`);
    assert(ANNOTATION_LABELS[name], `${name}: no label for the picker`);

    for (const d of paths) {
      assert(/^[Mm]/.test(d.trim()), `${name}: a path must start with a move, got "${d.slice(0, 12)}"`);
      // Every coordinate has to sit in the box everything is scaled from.
      // One stray 240 in a hand-written path puts the mark off screen, and it
      // is invisible in review because the path data is a wall of numbers.
      const numbers = d.match(/-?\d+(\.\d+)?/g) ?? [];
      for (const raw of numbers) {
        const n = Number(raw);
        assert(
          n >= -1 && n <= VIEWBOX + 1,
          `${name}: coordinate ${n} is outside the ${VIEWBOX}×${VIEWBOX} box`
        );
      }
    }
  }
}

{
  // The marks shadow the icons: someone asking for "arrow" means the one they
  // can draw with, not whichever of the eighty Lucide arrows sorts first.
  assert(pathsFor("arrow") === ANNOTATIONS.arrow, "a mark wins over an icon of the same name");

  assert(pathsFor("rocket"), "the icon catalogue is reachable");
  assert(pathsFor("definitely-not-a-thing") === null, "an unknown name is null");
  assert(knownShape("check") && knownShape("server"), "both sets are known");
  assert(!knownShape(""), "an empty name is not a shape");

  assert(allShapeNames().length > 1_700, "the whole catalogue is available");
}

{
  // Search: marks unprompted, icons on request, and bounded — 1,776 results
  // rendered into a picker is a catalogue rather than a tool.
  assert(searchShapes("").length === ANNOTATION_NAMES.length, "no query means the marks");
  const servers = searchShapes("server", 5);
  assert(servers.length <= 5, "the limit is honoured");
  assert(servers[0] === "server", "an exact match sorts first");
  assert(searchShapes("zzzzzz").length === 0, "no matches is empty, not everything");

  // A prefix match beats a substring match.
  const clock = searchShapes("clock", 20);
  assert(clock[0].startsWith("clock"), `expected a prefix match first, got ${clock[0]}`);
}

/* -------------------------------- rendering -------------------------------- */

interface Stroked {
  scaleX: number;
  scaleY: number;
  lineWidth: number;
  dash: number[] | null;
  translateX: number;
  translateY: number;
}

function stubContext() {
  const strokes: Stroked[] = [];
  let scaleX = 1;
  let scaleY = 1;
  let tx = 0;
  let ty = 0;
  let dash: number[] | null = null;
  const stack: { scaleX: number; scaleY: number; tx: number; ty: number }[] = [];

  const ctx = {
    lineWidth: 0,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    strokeStyle: "#000" as unknown,
    fillStyle: "#000" as unknown,
    save() {
      stack.push({ scaleX, scaleY, tx, ty });
    },
    restore() {
      const previous = stack.pop();
      if (previous) {
        scaleX = previous.scaleX;
        scaleY = previous.scaleY;
        tx = previous.tx;
        ty = previous.ty;
      }
    },
    translate(x: number, y: number) {
      tx += x;
      ty += y;
    },
    scale(x: number, y: number) {
      scaleX *= x;
      scaleY *= y;
    },
    setLineDash(next: number[]) {
      dash = next.length ? next : null;
    },
    stroke() {
      strokes.push({
        scaleX,
        scaleY,
        lineWidth: this.lineWidth,
        dash,
        translateX: tx,
        translateY: ty,
      });
    },
    fill() {},
    beginPath() {},
    rect() {},
    roundRect() {},
    ellipse() {},
    moveTo() {},
    lineTo() {},
    clip() {},
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
}

// `Path2D` does not exist in Node. Registering a stand-in is what lets the real
// drawing code run here unmodified — without it every path silently fails to
// build and the whole module looks like it works while drawing nothing.
class FakePath2D {
  constructor(public d: string) {}
}
(globalThis as unknown as { Path2D: unknown }).Path2D = FakePath2D;

const SIZE = { width: 1280, height: 720 };
const OPTIONS = { stroke: "#fff", fill: null, strokeWidth: 0.008, progress: 1 };

{
  // Every mark and a sample of icons must actually stroke something.
  const sample = [...ANNOTATION_NAMES, "rocket", "server", "clock", "trending-up"];
  for (const name of sample) {
    const { ctx, strokes } = stubContext();
    const drawn = drawShapePath(ctx, name, { x: 0, y: 0, w: 200, h: 200 }, SIZE, OPTIONS);
    assert(drawn, `${name}: reported as not drawn`);
    assert(strokes.length > 0, `${name}: drew nothing`);
  }

  // An unknown name draws nothing and says so, which is what lets the caller
  // fall back to a rectangle rather than leaving an invisible element behind.
  const { ctx, strokes } = stubContext();
  assert(
    !drawShapePath(ctx, "nope", { x: 0, y: 0, w: 100, h: 100 }, SIZE, OPTIONS),
    "an unknown name must report that it drew nothing"
  );
  assert(strokes.length === 0, "…and must actually draw nothing");
}

{
  // Scaled to fit, never stretched: a circle-this squashed into a wide box
  // stops reading as a circle.
  const { ctx, strokes } = stubContext();
  drawShapePath(ctx, "circleThis", { x: 0, y: 0, w: 400, h: 100 }, SIZE, OPTIONS);
  assert(strokes.length > 0, "drew something");
  assert(
    Math.abs(strokes[0].scaleX - strokes[0].scaleY) < 1e-9,
    `aspect must be preserved: ${strokes[0].scaleX} vs ${strokes[0].scaleY}`
  );

  // …and centred in the box it did not fill.
  const drawnSize = VIEWBOX * strokes[0].scaleX;
  assert(
    Math.abs(strokes[0].translateX - (400 - drawnSize) / 2) < 1e-6,
    "a mark narrower than its box is centred"
  );
}

{
  // Stroke width is given in frame fractions and the context is in viewbox
  // units by the time the path is stroked. Without dividing by the scale, a
  // mark drawn small has a stroke thicker than the mark itself.
  const big = stubContext();
  drawShapePath(big.ctx, "check", { x: 0, y: 0, w: 480, h: 480 }, SIZE, OPTIONS);
  const small = stubContext();
  drawShapePath(small.ctx, "check", { x: 0, y: 0, w: 60, h: 60 }, SIZE, OPTIONS);

  const inPixels = (s: Stroked) => s.lineWidth * s.scaleX;
  assert(
    Math.abs(inPixels(big.strokes[0]) - inPixels(small.strokes[0])) < 1e-6,
    `a mark's stroke must be the same on screen at any size: ${inPixels(big.strokes[0])} vs ${inPixels(small.strokes[0])}`
  );
  assert(
    Math.abs(inPixels(big.strokes[0]) - 0.008 * SIZE.height) < 1e-6,
    "and must be the width that was asked for"
  );
}

{
  // The draw-on. Part-way through, the path is dashed; finished, it is not.
  const midway = stubContext();
  drawShapePath(midway.ctx, "arrow", { x: 0, y: 0, w: 200, h: 200 }, SIZE, {
    ...OPTIONS,
    progress: 0.4,
  });
  assert(midway.strokes[0].dash, "a partly-drawn mark is dashed");

  const done = stubContext();
  drawShapePath(done.ctx, "arrow", { x: 0, y: 0, w: 200, h: 200 }, SIZE, OPTIONS);
  assert(done.strokes[0].dash === null, "a finished mark is solid");

  // Not started: nothing is stroked at all. An invisible stroke still costs a
  // pass over the path.
  const none = stubContext();
  drawShapePath(none.ctx, "arrow", { x: 0, y: 0, w: 200, h: 200 }, SIZE, {
    ...OPTIONS,
    progress: 0,
  });
  assert(none.strokes.length === 0, "an undrawn mark strokes nothing");
}

{
  // Degenerate boxes are refused rather than producing NaN geometry, which
  // Canvas2D throws on — and a throw inside the render loop ends it.
  const { ctx } = stubContext();
  assert(!drawShapePath(ctx, "arrow", { x: 0, y: 0, w: 0, h: 100 }, SIZE, OPTIONS), "zero width");
  assert(!drawShapePath(ctx, "arrow", { x: 0, y: 0, w: 100, h: -5 }, SIZE, OPTIONS), "negative height");
}

/* ------------------------------ the operation ------------------------------- */

{
  const good = siftOps([
    { op: "addShape", shape: "path", mark: "circleThis" },
    { op: "addShape", shape: "rect", fill: "rgba(0,0,0,0.6)" },
  ]);
  assert(good.ops.length === 2, `both should pass: ${good.rejected.join("; ")}`);

  // The mark name is free text, because an enum of 1,792 values in the schema
  // handed to the model would be most of the prompt. The executor is what
  // refuses an unknown one — verified by hand rather than through the store,
  // since running the operation needs a browser.
  assert(
    siftOps([{ op: "addShape", shape: "path", mark: "sparkleBlast3000" }]).ops.length === 1,
    "the schema takes any name"
  );
  assert(!knownShape("sparkleBlast3000"), "…and the executor is what knows better");
}

console.log("ALL SHAPE TESTS PASSED");
