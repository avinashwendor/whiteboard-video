/**
 * Shots: how the frame is divided, and how it moves, over time.
 *
 * The whole of this module exists to turn a `Shot` into things `frame.ts`
 * already knows how to draw. It answers three questions and nothing else:
 *
 *   - which shot covers this second        (`shotAt`)
 *   - where does each plate sit            (`regionsFor`, `plateRect`)
 *   - how is its source framed right now   (`framingAt`, `frameForPlate`)
 *
 * The third is the one that matters. A camera move is evaluated into a plain
 * `FrameSpec` — the same fit/zoom/focus record the output frame has always
 * used — so a punch-in is an animated `FrameSpec` and a split screen is two of
 * them. `placement()` in `frame.ts` takes its region's width and height as
 * arguments, so it works per-region without a single change.
 *
 * Everything here is a pure function of (shot, time, size). Nothing reads a
 * store or a clock, which is what lets the exporter ask for frames out of order
 * and far faster than real time — the same property the renderer depends on.
 */

import { clamp01, ease } from "./animation";
import type { FrameSize } from "./render";
import {
  DEFAULT_FRAME,
  regionCount,
  type CameraFraming,
  type CameraMove,
  type Composition,
  type FrameSpec,
  type Plate,
  type Rect,
  type Shot,
  type ShotLayout,
} from "./types";

/* --------------------------------- lookup ---------------------------------- */

/**
 * The shot covering `t`, or null when none does.
 *
 * Null is the normal case, not an error: a composition with no shots is every
 * composition made before shots existed, and the gaps between shots are just
 * the footage, full frame, as shot. Callers must render that identically.
 */
export function shotAt(composition: Composition, t: number): Shot | null {
  const shots = composition.shots;
  if (!shots || shots.length === 0) return null;
  for (const shot of shots) {
    if (t >= shot.start && t < shot.end) return shot;
  }
  return null;
}

/* --------------------------------- regions --------------------------------- */

/** The stacked layout gives the talking head less room than the screen. */
const STACK_TOP = 0.42;

/** How far a picture-in-picture bubble sits from the corner, as a fraction. */
const PIP_INSET = 0.035;

/** The bubble's size, as a fraction of the frame's *shorter* side. */
const PIP_SIZE = 0.3;

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Where each region of a layout sits, normalised to the frame.
 *
 * Region 0 is always the primary — the largest, or for `pip` the one behind.
 * `plates` only matters for `grid`, which is the one layout whose region count
 * follows its contents.
 *
 * `size` is needed because a frame is not square and some regions should be:
 * a bubble specified as a flat fraction of width and height is an oval in 9:16
 * and a different oval in 2.39:1. Everything that should follow the frame's
 * shape is left as a plain fraction; only the bubble is corrected.
 */
export function regionsFor(
  layout: ShotLayout,
  size: FrameSize,
  plates = 2
): Rect[] {
  switch (layout) {
    case "full":
    case "card":
      return [{ ...FULL }];

    case "splitLeft":
      // The primary takes the left half.
      return [
        { x: 0, y: 0, w: 0.5, h: 1 },
        { x: 0.5, y: 0, w: 0.5, h: 1 },
      ];

    case "splitRight":
      return [
        { x: 0.5, y: 0, w: 0.5, h: 1 },
        { x: 0, y: 0, w: 0.5, h: 1 },
      ];

    case "splitTop":
      return [
        { x: 0, y: 0, w: 1, h: 0.5 },
        { x: 0, y: 0.5, w: 1, h: 0.5 },
      ];

    case "splitBottom":
      return [
        { x: 0, y: 0.5, w: 1, h: 0.5 },
        { x: 0, y: 0, w: 1, h: 0.5 },
      ];

    case "stack":
      // Deliberately not a half-and-half split. This is the vertical tutorial
      // shape — a face at the top, the thing being demonstrated given the room
      // it needs underneath. An even split makes both too small to read.
      return [
        { x: 0, y: 0, w: 1, h: STACK_TOP },
        { x: 0, y: STACK_TOP, w: 1, h: 1 - STACK_TOP },
      ];

    case "pip": {
      const shorter = Math.min(size.width, size.height);
      const w = (shorter * PIP_SIZE) / size.width;
      const h = (shorter * PIP_SIZE) / size.height;
      const insetX = (shorter * PIP_INSET) / size.width;
      const insetY = (shorter * PIP_INSET) / size.height;
      return [
        { ...FULL },
        { x: 1 - w - insetX, y: 1 - h - insetY, w, h },
      ];
    }

    case "grid": {
      const count = regionCount("grid", plates);
      if (count <= 2) {
        return [
          { x: 0, y: 0, w: 0.5, h: 1 },
          { x: 0.5, y: 0, w: 0.5, h: 1 },
        ];
      }
      // Three fills the fourth cell with nothing rather than inventing an
      // asymmetric layout nobody asked for.
      const cells: Rect[] = [
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      ];
      return cells.slice(0, count);
    }
  }
}

/**
 * The rect a plate actually occupies.
 *
 * A dragged rect outranks the layout — the same rule `layout.ts` keeps for
 * elements, and for the same reason: a placement someone made by hand was
 * meant. A plate whose slot is outside the layout falls back to the full frame
 * rather than vanishing, because a plate that draws nothing is the hardest
 * possible thing to debug from a black rectangle.
 */
export function plateRect(
  plate: Plate,
  regions: Rect[]
): Rect {
  if (plate.rect) return plate.rect;
  return regions[plate.slot] ?? regions[0] ?? { ...FULL };
}

/* --------------------------------- camera ---------------------------------- */

function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

/**
 * Where a move has got to, `seconds` into the shot.
 *
 * Before the move starts it is at `from`; after it finishes it holds at `to`.
 * A zero-length move is `to` immediately, which is how a `snap` — a hard cut
 * to a tighter framing, with no travel — is expressed without a special case.
 */
export function framingAt(camera: CameraMove, seconds: number): CameraFraming {
  if (camera.kind === "hold") return camera.to;
  if (camera.duration <= 0) return camera.to;

  const p = ease(camera.easing, clamp01(seconds / camera.duration));
  return {
    zoom: lerp(camera.from.zoom, camera.to.zoom, p),
    focusX: lerp(camera.from.focusX, camera.to.focusX, p),
    focusY: lerp(camera.from.focusY, camera.to.focusY, p),
  };
}

/**
 * The `FrameSpec` to draw one plate with, at `t`.
 *
 * Derived from the project's frame so the shape, the backdrop and the
 * letterbox fill all stay project-wide — a shot decides what is *in* the
 * frame, never what shape the file is. Only fit, zoom and focus are the
 * plate's to choose, and those are exactly the three `placement()` reads.
 */
export function frameForPlate(
  base: FrameSpec,
  plate: Plate,
  shot: Shot,
  t: number
): FrameSpec {
  const framing = framingAt(plate.camera, t - shot.start);
  return {
    ...base,
    fit: plate.fit,
    zoom: framing.zoom > 0 ? framing.zoom : 1,
    focusX: framing.focusX,
    focusY: framing.focusY,
  };
}

/**
 * The frame to draw the footage with when no shot covers `t`.
 *
 * Exactly the project frame, untouched. This is the path every existing
 * composition takes, and it must stay free.
 */
export function frameForGap(base: FrameSpec | undefined): FrameSpec {
  return base ?? DEFAULT_FRAME;
}

/* -------------------------------- ordering --------------------------------- */

/**
 * Sort shots and clip away any overlap, so exactly one covers any second.
 *
 * `shotAt` returns the first match, which makes an overlap silently invisible
 * rather than wrong — the worst kind of bug to look at. Normalising on the way
 * into the store means nothing downstream has to reason about it.
 */
export function normaliseShots(shots: Shot[]): Shot[] {
  const sorted = [...shots]
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  const out: Shot[] = [];
  for (const shot of sorted) {
    const previous = out[out.length - 1];
    if (previous && shot.start < previous.end) {
      // The later shot wins the overlap: it is the one just placed.
      const trimmed = { ...previous, end: shot.start };
      if (trimmed.end > trimmed.start) out[out.length - 1] = trimmed;
      else out.pop();
    }
    out.push(shot);
  }
  return out;
}
