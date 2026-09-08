/**
 * Does the drawing fit on the board?
 *
 * A whiteboard scene is composed as geometry in board coordinates and only
 * later painted, so nothing checks that what was composed is actually on the
 * paper. It never had to: every layout was written against one board, by
 * eye, at 1280×720.
 *
 * Now there are three shapes, and the failure this guards against is the exact
 * reason portrait could not be a scale factor: a row of four icons is 1052
 * pixels wide, which is a comfortable row on a 1280-wide board, most of a
 * 1080-wide one, and 46% wider than a 720-wide one. Overflow does not throw. It
 * paints an icon half off the edge of the paper, in a video, silently.
 *
 * So every layout is composed in every shape, at every item count the schema
 * allows, and every primitive is measured against the paper.
 *
 * Run with `npx tsx tests/board-shapes-test.ts`.
 */

import {
  BOARDS,
  composeScene,
  photoBoxFor,
  type Board,
  type BoardFormat,
  type Prim,
  type SceneItem,
  type SceneSpec,
} from "../src/lib/whiteboard/scene";
import { frameH, frameW, setFrame } from "../src/lib/hyperframes/frame";
import { contentWidth, margin, safeBottom } from "../src/lib/hyperframes/stage";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EMPTY: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

function grow(box: Box, x: number, y: number): Box {
  return {
    minX: Math.min(box.minX, x),
    minY: Math.min(box.minY, y),
    maxX: Math.max(box.maxX, x),
    maxY: Math.max(box.maxY, y),
  };
}

/**
 * Bounds of an SVG path, over-estimating rather than under.
 *
 * An arc is bounded by expanding its chord midpoint by the radii, which is
 * exact for the semicircle pairs `circle()` emits and generous for anything
 * shorter. Generous is the right direction: this decides whether a drawing is
 * reported as fitting, and a false pass is a video with an icon off the edge.
 */
function pathBounds(d: string): Box {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  let box = EMPTY;
  let command = "";
  let x = 0;
  let y = 0;
  let i = 0;

  const num = () => Number(tokens[i++]);

  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[A-Za-z]$/.test(token)) {
      command = token;
      i += 1;
      if (command === "Z" || command === "z") continue;
    }
    const rel = command === command.toLowerCase();
    const up = command.toUpperCase();

    switch (up) {
      case "M":
      case "L":
      case "T": {
        const nx = num();
        const ny = num();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        box = grow(box, x, y);
        break;
      }
      case "H": {
        const nx = num();
        x = rel ? x + nx : nx;
        box = grow(box, x, y);
        break;
      }
      case "V": {
        const ny = num();
        y = rel ? y + ny : ny;
        box = grow(box, x, y);
        break;
      }
      case "Q":
      case "S": {
        const cx = num();
        const cy = num();
        const nx = num();
        const ny = num();
        box = grow(box, rel ? x + cx : cx, rel ? y + cy : cy);
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        box = grow(box, x, y);
        break;
      }
      case "C": {
        const c1x = num();
        const c1y = num();
        const c2x = num();
        const c2y = num();
        const nx = num();
        const ny = num();
        box = grow(box, rel ? x + c1x : c1x, rel ? y + c1y : c1y);
        box = grow(box, rel ? x + c2x : c2x, rel ? y + c2y : c2y);
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        box = grow(box, x, y);
        break;
      }
      case "A": {
        const rx = Math.abs(num());
        const ry = Math.abs(num());
        num(); // x-axis rotation
        const large = num();
        const sweep = num();
        const nx = num();
        const ny = num();
        const ex = rel ? x + nx : nx;
        const ey = rel ? y + ny : ny;

        // The endpoints are on the arc whatever else is true.
        box = grow(box, x, y);
        box = grow(box, ex, ey);

        const half = Math.hypot(ex - x, ey - y) / 2;
        const r = Math.max(rx, ry);

        if (rx === ry && half > 1e-6 && half <= r + 1e-6) {
          /**
           * Exactly, by finding the centre and asking which extremes the arc
           * actually sweeps through.
           *
           * Bounding an arc by its chord expanded by the sagitta is sound but
           * far too loose: a 144° slice of a pie bulges 102 pixels past its own
           * chord, and expanding the box in every direction by that reports the
           * slice reaching a hundred pixels above the top of the circle it is
           * part of. Every layout would then look like it overflowed.
           *
           * The centre sits on the perpendicular bisector of the chord — on the
           * positive side when the large-arc and sweep flags differ, the
           * negative side when they agree, which is the SVG rule.
           */
          const midX = (x + ex) / 2;
          const midY = (y + ey) / 2;
          const d = Math.sqrt(Math.max(0, r * r - half * half));
          const side = large === sweep ? -1 : 1;
          const ux = -(ey - y) / (half * 2);
          const uy = (ex - x) / (half * 2);
          const cx = midX + side * d * ux;
          const cy = midY + side * d * uy;

          const from = Math.atan2(y - cy, x - cx);
          const to = Math.atan2(ey - cy, ex - cx);
          const TAU = Math.PI * 2;
          // Sweep 1 travels in the direction of increasing angle, which with a
          // y-down axis is clockwise on the screen.
          let delta = sweep === 1 ? to - from : from - to;
          delta = ((delta % TAU) + TAU) % TAU;

          for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            let travelled = sweep === 1 ? a - from : from - a;
            travelled = ((travelled % TAU) + TAU) % TAU;
            if (travelled <= delta + 1e-9) {
              box = grow(box, cx + r * Math.cos(a), cy + r * Math.sin(a));
            }
          }
        } else {
          // An ellipse, or a chord longer than the diameter the path claims.
          // Fall back to a bound that is generous rather than unsound.
          box = grow(box, (x + ex) / 2 - rx, (y + ey) / 2 - ry);
          box = grow(box, (x + ex) / 2 + rx, (y + ey) / 2 + ry);
        }

        x = ex;
        y = ey;
        break;
      }
      default:
        i += 1;
    }
  }

  return box;
}

/** Where a primitive actually lands, stroke width included. */
function primBounds(prim: Prim): Box {
  if (prim.kind === "text") {
    /**
     * How wide the words actually are, not how wide the box is.
     *
     * `maxWidth` is permission, not occupancy: a caption centred at x=200 that
     * is allowed 790 pixels still only draws the 300 its words take, and
     * measuring the box would report it hanging 200 pixels off the paper when
     * nothing is drawn there. Anything longer than the box wraps, so the drawn
     * width is capped by it and the height grows instead.
     *
     * 0.62 of the size per character is a generous average for the condensed
     * marker face the board is set in; the specimens below use the longest
     * strings the schema allows, so this is measured against the worst text a
     * model can produce rather than against a sample.
     */
    const perChar = prim.size * 0.62 + (prim.tracking ?? 0);
    const wanted = prim.text.length * perChar;
    const drawn = Math.min(prim.maxWidth, wanted);
    const lines = Math.max(1, Math.ceil(wanted / Math.max(1, prim.maxWidth)));
    const left =
      prim.align === "left"
        ? prim.x
        : prim.align === "right"
          ? prim.x - drawn
          : prim.x - drawn / 2;
    return {
      minX: left,
      maxX: left + drawn,
      // Wrapped lines run downwards from the baseline, which is how the
      // renderer lays them out.
      minY: prim.y - prim.size,
      maxY: prim.y + prim.size * 0.34 + (lines - 1) * prim.size * 1.16,
    };
  }
  const box = pathBounds(prim.d);
  const pad = prim.width / 2;
  return {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  };
}

function overlaps(a: Box, b: Box): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/* ------------------------------- the specimens ------------------------------ */

/** The longest label the schema allows (24 characters), so this is a worst case. */
const LABEL = "Continuous integration!!";
const TITLE = "Everything the build pipeline does, end";
const STAT = "40 min ago";
const CAPTION = "down from forty minutes a run";

const ICON = (n: number): SceneItem => ({
  icon: "rocket",
  label: LABEL.slice(0, 23) + n,
});

function specs(count: number): SceneSpec[] {
  const items = Array.from({ length: Math.max(2, count) }, (_, i) => ICON(i + 1));
  const data = Array.from({ length: Math.max(2, count) }, (_, i) => ({
    // 24 characters, the schema's ceiling for a datum label.
    label: `Integration testing ${i + 1}`.slice(0, 24),
    value: (i + 1) * 40,
  }));
  const side = {
    title: "Before the migration!!!!",
    items: items.slice(0, Math.min(3, count)),
    stat: STAT,
    statCaption: "every single build, all",
  };

  // Clamped to what each layout's schema actually accepts, so the sweep covers
  // every count a model can send and none it cannot.
  return [
    { layout: "icons", title: TITLE, items: items.slice(0, Math.max(1, Math.min(4, count))) },
    { layout: "steps", title: TITLE, items: items.slice(0, 4) },
    { layout: "compare", title: TITLE, left: side, right: side },
    { layout: "pie", title: TITLE, data: data.slice(0, 4), items: items.slice(0, 3) },
    { layout: "bars", title: TITLE, data: data.slice(0, 5), items: items.slice(0, 3) },
    { layout: "timeline", title: TITLE, items: items.slice(0, 4) },
    { layout: "stat", title: TITLE, stat: STAT, caption: CAPTION, icon: "clock" },
  ];
}

/* --------------------------------- on the paper ----------------------------- */

const FORMATS: BoardFormat[] = ["landscape", "portrait", "square"];
/** A stroke may kiss the edge; nothing may hang off it. */
const EDGE = 2;

{
  let checked = 0;

  for (const format of FORMATS) {
    const board: Board = BOARDS[format];
    for (let count = 1; count <= 5; count++) {
      // "icons" is the only layout that takes a single item; the rest start at
      // two, and `specs` floors the list accordingly.
      for (const spec of specs(count)) {

        const { beats } = composeScene(spec, { board: format });
        assert(beats.length > 0, `${format}/${spec.layout} composed nothing`);

        for (const beat of beats) {
          for (const prim of beat.prims) {
            const box = primBounds(prim);
            const what = `${format}/${spec.layout} ×${count} ${prim.kind === "text" ? `"${prim.text.slice(0, 20)}"` : "shape"}`;
            assert(
              box.minX >= -EDGE,
              `${what} runs off the left edge (x ${box.minX.toFixed(0)})`,
            );
            assert(
              box.maxX <= board.width + EDGE,
              `${what} runs off the right edge (x ${box.maxX.toFixed(0)} of ${board.width})`,
            );
            assert(
              box.minY >= -EDGE,
              `${what} runs off the top (y ${box.minY.toFixed(0)})`,
            );
            assert(
              box.maxY <= board.height + EDGE,
              `${what} runs off the bottom (y ${box.maxY.toFixed(0)} of ${board.height})`,
            );
            checked += 1;
          }
        }
      }
    }
  }
  console.log(`✓ ${checked} primitives, every layout in every shape, all on the paper`);
}

/* ------------------------------ clear of the title -------------------------- */

{
  for (const format of FORMATS) {
    const board = BOARDS[format];
    for (const spec of specs(4)) {
      const { beats } = composeScene(spec, { board: format });
      const [titleBeat, ...rest] = beats;
      const title = primBounds(titleBeat.prims[0]);

      for (const beat of rest) {
        for (const prim of beat.prims) {
          const box = primBounds(prim);
          // The heading may wrap to two or three lines in a narrow frame, so
          // this measures against where the drawing is allowed to start rather
          // than against the one line the title happens to be today.
          assert(
            box.minY >= board.contentTop - 60,
            `${format}/${spec.layout}: ${prim.kind === "text" ? `"${prim.text.slice(0, 24)}"` : prim.d.slice(0, 50)} is drawn at y ${box.minY.toFixed(0)}, above the content band (${board.contentTop})`,
          );
        }
      }
      assert(title.minY < board.contentTop, `${format}: the heading is not above the drawing`);
    }
  }
  console.log("✓ nothing is drawn into the heading's band");
}

/* --------------------------------- the photo -------------------------------- */

{
  for (const format of FORMATS) {
    const board = BOARDS[format];
    const box = photoBoxFor(board);
    assert(box.x >= 0 && box.y >= 0, `${format}: the photo card starts off the paper`);
    assert(
      box.x + box.width <= board.width && box.y + box.height <= board.height,
      `${format}: the photo card runs off the paper`,
    );

    for (const spec of specs(3)) {
      const { beats, photoBox } = composeScene(spec, { board: format, photo: true });
      assert(photoBox !== null, `${format}/${spec.layout}: asked for a photo and got no box`);
      const card: Box = {
        minX: photoBox!.x,
        minY: photoBox!.y,
        maxX: photoBox!.x + photoBox!.width,
        maxY: photoBox!.y + photoBox!.height,
      };

      for (const beat of beats) {
        for (const prim of beat.prims) {
          // Text is measured on its declared maxWidth, which is a box it is
          // *allowed* to use rather than one it fills — a centred caption that
          // reserves 200px and draws 90 would report a false collision. Shapes
          // are exact, and shapes are what actually collide with a card.
          if (prim.kind === "text") continue;
          assert(
            !overlaps(primBounds(prim), card),
            `${format}/${spec.layout}: the drawing runs under the taped photograph`,
          );
        }
      }
    }
  }
  console.log("✓ the drawing makes room for a taped photograph, in every shape");
}

/* ---------------------------- the arrangement changed ----------------------- */

{
  // The point of the whole exercise: a portrait board is not a scaled landscape
  // one. If these ever come out the same, something has quietly gone back to
  // rescaling and every check above would still pass.
  const wide = composeScene({ layout: "icons", title: "Four things", items: [ICON(1), ICON(2), ICON(3), ICON(4)] }, { board: "landscape" });
  const tall = composeScene({ layout: "icons", title: "Four things", items: [ICON(1), ICON(2), ICON(3), ICON(4)] }, { board: "portrait" });

  const spread = (scene: typeof wide) => {
    const xs = scene.beats.slice(1).map((b) => b.origin.x);
    const ys = scene.beats.slice(1).map((b) => b.origin.y);
    return {
      x: Math.max(...xs) - Math.min(...xs),
      y: Math.max(...ys) - Math.min(...ys),
    };
  };

  const w = spread(wide);
  const t = spread(tall);
  assert(w.x > w.y * 4, "the widescreen board no longer lays four icons out in a row");
  assert(t.y > t.x, "the portrait board still lays four icons out in a row");
  console.log("✓ four icons are a row on a wide board and a grid on a tall one");

  // And the ones that genuinely change shape rather than just direction.
  const barsTall = composeScene(
    { layout: "bars", title: "Minutes per stage", data: [{ label: "Install", value: 20 }, { label: "Compile", value: 60 }] },
    { board: "portrait" },
  );
  const barBeat = barsTall.beats.find((b) => b.prims.some((p) => p.kind === "shape" && p.fill));
  assert(barBeat, "the portrait bars chart drew no bars");
  const bar = primBounds(barBeat!.prims.find((p) => p.kind === "shape" && p.fill)!);
  assert(
    bar.maxX - bar.minX > bar.maxY - bar.minY,
    "portrait bars are still standing up, where the frame has no room for them",
  );

  const timelineTall = composeScene(
    { layout: "timeline", title: "Six weeks", items: [ICON(1), ICON(2), ICON(3)] },
    { board: "portrait" },
  );
  const stops = timelineTall.beats.slice(2).map((b) => b.origin);
  assert(
    Math.max(...stops.map((s) => s.y)) - Math.min(...stops.map((s) => s.y)) >
      Math.max(...stops.map((s) => s.x)) - Math.min(...stops.map((s) => s.x)),
    "the portrait timeline still runs across the frame",
  );
  console.log("✓ bars lie down and the timeline stands up when the frame is tall");
}

/* ------------------------------- the other engine --------------------------- */

{
  // Hyperframes has no composed geometry to measure — it paints straight to a
  // canvas — so what is checked is the thing every one of its hundred and sixty
  // drawing helpers reads: the frame, and the three numbers derived from it.
  const landscape = BOARDS.landscape;

  setFrame(BOARDS.landscape);
  assert(frameW() === 1280 && frameH() === 720, "the frame did not take");
  const wideMargin = margin();
  const wideSafe = safeBottom();
  assert(wideMargin === 96, `the widescreen gutter moved: ${wideMargin}`);
  assert(wideSafe === 552, `the widescreen subtitle floor moved: ${wideSafe}`);
  assert(
    contentWidth() === landscape.width - wideMargin * 2,
    "the line length is not the frame minus its gutters",
  );

  setFrame(BOARDS.portrait);
  assert(frameW() === 720 && frameH() === 1280, "the frame did not change");
  assert(margin() < wideMargin, "a narrow frame kept a widescreen gutter");
  assert(
    contentWidth() > 0 && contentWidth() < frameW(),
    "the line length left the frame",
  );
  assert(
    safeBottom() < frameH() && safeBottom() > frameH() * 0.7,
    `the subtitle floor is in the wrong place: ${safeBottom()} of ${frameH()}`,
  );

  // A string, as the settings store it, and nothing at all — both have to land
  // somewhere real rather than on NaN.
  setFrame("square");
  assert(frameW() === 1080 && frameH() === 1080, "a named format did not resolve");
  setFrame(undefined);
  assert(frameW() === 1280, "no format did not fall back to widescreen");
  console.log("✓ the kinetic engine's frame, its gutter and its subtitle floor all move together");
}

console.log("\nboard shapes: all checks passed");
