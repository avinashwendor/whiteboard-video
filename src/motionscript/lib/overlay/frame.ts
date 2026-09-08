/**
 * Composites one finished frame: video, then the transition treatment, then
 * the overlay layer.
 *
 * The preview and the exporter both call `paintFrame` with the same arguments
 * and get the same pixels; they differ only in where the video frame comes from
 * (a playing `<video>` vs. a seeked one) and where the result goes (the screen
 * vs. an encoder).
 */

import { paintComposition, type FrameSize } from "./render";
import type { ActiveTransition } from "./timeline";
import { frameForPlate, plateRect, regionsFor, shotAt } from "./shots";
import { paintGrade, withGrade, type GradeSpec } from "./grade";
import {
  DEFAULT_FRAME,
  type Composition,
  type FrameSpec,
  type Plate,
  type Rect,
  type Shot,
} from "./types";

export interface FrameSources {
  /** The live source frame for this output time. */
  live: CanvasImageSource | null;
  /**
   * The outgoing clip's held last frame. Required by the push family; ignored
   * otherwise. When it is missing the transition degrades to a plain cut rather
   * than to a black flash.
   */
  freeze: CanvasImageSource | null;
}

/** Intrinsic size of a drawable source, or null if it has none yet. */
function sourceSize(src: CanvasImageSource): { w: number; h: number } | null {
  if (typeof HTMLVideoElement !== "undefined" && src instanceof HTMLVideoElement) {
    return src.videoWidth ? { w: src.videoWidth, h: src.videoHeight } : null;
  }
  if (typeof HTMLImageElement !== "undefined" && src instanceof HTMLImageElement) {
    return src.naturalWidth ? { w: src.naturalWidth, h: src.naturalHeight } : null;
  }
  if (typeof HTMLCanvasElement !== "undefined" && src instanceof HTMLCanvasElement) {
    return src.width ? { w: src.width, h: src.height } : null;
  }
  if (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) {
    return src.width ? { w: src.width, h: src.height } : null;
  }
  return null;
}

/**
 * Where a source lands inside the frame, before any transition offset.
 *
 * Split out from the drawing so the blurred backdrop and the picture itself are
 * laid out by the same arithmetic — a backdrop computed independently drifts
 * from the picture the moment a focus point or a zoom is involved.
 */
function placement(
  intrinsic: { w: number; h: number },
  size: FrameSize,
  frame: FrameSpec,
  fit: FrameSpec["fit"],
  scale: number
): { x: number; y: number; w: number; h: number } {
  const base =
    fit === "cover"
      ? Math.max(size.width / intrinsic.w, size.height / intrinsic.h)
      : Math.min(size.width / intrinsic.w, size.height / intrinsic.h);
  const zoom = frame.zoom > 0 ? frame.zoom : 1;
  const w = intrinsic.w * base * zoom * scale;
  const h = intrinsic.h * base * zoom * scale;

  // The focus point is the bit of the *source* held at the centre of the frame.
  // When the picture is smaller than the frame on an axis there is nothing to
  // choose between, so it is simply centred; when it is larger, the offset is
  // clamped so panning can never expose an edge.
  const place = (
    frameLength: number,
    drawn: number,
    focus: number
  ): number => {
    if (drawn <= frameLength) return (frameLength - drawn) / 2;
    const wanted = frameLength / 2 - focus * drawn;
    return Math.max(frameLength - drawn, Math.min(0, wanted));
  };

  return {
    x: place(size.width, w, frame.focusX),
    y: place(size.height, h, frame.focusY),
    w,
    h,
  };
}

/**
 * Fill the frame behind a picture that does not cover it.
 *
 * Only meaningful under `contain`. Black is honest; a blurred blow-up of the
 * same frame is what every social tool does, and it is the difference between a
 * Short that looks made and one that looks letterboxed.
 *
 * Drawn once per frame, by the caller, rather than by each `drawSource`. During
 * a push transition two sources are drawn over each other, and a backdrop
 * painted by the second of them would cover the first — the outgoing clip would
 * slide across on an opaque blur instead of across the incoming shot.
 */
function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  size: FrameSize,
  frame: FrameSpec
) {
  if (frame.fit !== "contain") return;
  const intrinsic = sourceSize(src);
  if (!intrinsic) return;

  const spot = placement(intrinsic, size, frame, "contain", 1);
  if (spot.w >= size.width - 1 && spot.h >= size.height - 1) return;

  if (frame.background === "blur") {
    const back = placement(intrinsic, size, frame, "cover", 1);
    ctx.save();
    // Blur radius follows the frame, not the source, so a 4K and a 720p
    // version of the same edit look the same.
    ctx.filter = `blur(${Math.max(8, size.height * 0.045)}px)`;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(src, back.x, back.y, back.w, back.h);
    ctx.restore();
    ctx.filter = "none";
  } else if (frame.background === "white") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size.width, size.height);
  }
  // "black" needs nothing: the frame was already cleared to black.
}

/**
 * Draw a source into `size` under the project's frame.
 *
 * `cover` crops to fill and is what makes a 16:9 recording usable as a Short;
 * `contain` fits the whole picture in, over whatever `drawBackdrop` left.
 * `scale` zooms about the centre for transitions; `dx`/`dy` shift in output
 * pixels for the push family.
 */
function drawSource(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  size: FrameSize,
  frame: FrameSpec,
  scale = 1,
  dx = 0,
  dy = 0,
  grade?: GradeSpec | null
) {
  const intrinsic = sourceSize(src);
  if (!intrinsic) return;
  const spot = placement(intrinsic, size, frame, frame.fit, scale);
  // Composed with whatever filter is already set rather than replacing it: a
  // dip transition has a blur on the context at this point, and a grade that
  // silently cancelled it would turn a blur-through into a hard cut.
  withGrade(ctx, grade, () =>
    ctx.drawImage(src, spot.x + dx, spot.y + dy, spot.w, spot.h)
  );
}

/** Peaks at 1 in the middle of the window and returns to 0 at both ends. */
function dipIntensity(progress: number): number {
  return 1 - Math.abs(progress * 2 - 1);
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** A normalised rect in output pixels. */
function pixels(rect: Rect, size: FrameSize) {
  return {
    x: rect.x * size.width,
    y: rect.y * size.height,
    w: rect.w * size.width,
    h: rect.h * size.height,
  };
}

/**
 * Clip to a region, optionally with rounded corners.
 *
 * The caller is responsible for the surrounding save/restore: a clip cannot be
 * undone any other way, and a plate that leaked its clip would crop everything
 * drawn after it — including the captions, which are drawn by someone else
 * entirely and would be very hard to trace back to here.
 */
function clipTo(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  size: FrameSize,
  radius: number
) {
  const box = pixels(rect, size);
  ctx.beginPath();
  if (radius > 0) {
    const r = Math.min(radius * Math.min(box.w, box.h), Math.min(box.w, box.h) / 2);
    ctx.roundRect(box.x, box.y, box.w, box.h, r);
  } else {
    ctx.rect(box.x, box.y, box.w, box.h);
  }
  ctx.clip();
}

/**
 * Draw one plate into its region.
 *
 * The region becomes the `FrameSize` handed to the existing drawing code, which
 * is the whole trick: `placement()` already takes width and height as
 * arguments, so a half-width region is just a smaller frame as far as it is
 * concerned. Nothing about fit, focus, zoom or the blurred backdrop needed to
 * learn what a plate is.
 */
function paintPlate(
  ctx: CanvasRenderingContext2D,
  plate: Plate,
  shot: Shot,
  rect: Rect,
  size: FrameSize,
  base: FrameSpec,
  sources: FrameSources,
  t: number,
  grade: GradeSpec | null | undefined
) {
  const box = pixels(rect, size);
  if (box.w < 1 || box.h < 1) return;

  ctx.save();
  clipTo(ctx, rect, size, plate.radius);
  ctx.translate(box.x, box.y);

  const region: FrameSize = { width: box.w, height: box.h };

  if (plate.source.kind === "solid") {
    ctx.fillStyle = plate.source.color;
    ctx.fillRect(0, 0, region.width, region.height);
    ctx.restore();
    return;
  }

  // Only the primary footage has a source to draw today. A `media` or `broll`
  // plate is a promise the ingest and b-roll work has not kept yet, and the
  // honest thing to show meanwhile is the footage — a black hole in the middle
  // of the frame reads as a broken renderer, not as an unfinished feature.
  const src = sources.live ?? sources.freeze;
  if (src) {
    const spec = frameForPlate(base, plate, shot, t);
    drawBackdrop(ctx, src, region, spec);
    drawSource(ctx, src, region, spec, 1, 0, 0, grade);
  }

  ctx.restore();
}

/**
 * Paint the video layer, applying `active` if one covers this frame.
 * Returns nothing; the overlay layer is drawn by the caller afterwards.
 */
function paintVideoLayer(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  sources: FrameSources,
  active: ActiveTransition | null,
  frame: FrameSpec,
  shot: Shot | null,
  t: number,
  grade: GradeSpec | null | undefined
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size.width, size.height);

  const { live, freeze } = sources;

  // A shot divides the frame. Transitions are deliberately not applied over the
  // top of one: a transition treats the whole picture, and what "the picture"
  // means during a split screen is a question the shot layer has to answer
  // first. Until it does, a boundary that falls inside a shot plays as a cut —
  // the same honest degradation a push transition takes when it has no freeze.
  if (shot) {
    const regions = regionsFor(shot.layout, size, shot.plates.length);
    // Painted in slot order rather than array order, so a plate list that
    // arrives out of order still puts the bubble in front of the screen.
    const ordered = [...shot.plates].sort((a, b) => a.slot - b.slot);
    for (const plate of ordered) {
      paintPlate(ctx, plate, shot, plateRect(plate, regions), size, frame, sources, t, grade);
    }
    return;
  }

  // One backdrop for the whole frame, from whichever source is real. The freeze
  // is the fallback because a seek can leave the <video> momentarily without a
  // picture, and a backdrop that blinks is worse than one drawn from the held
  // frame beside it.
  const backdropFrom = live ?? freeze;
  if (backdropFrom) drawBackdrop(ctx, backdropFrom, size, frame);

  if (!active) {
    if (live) drawSource(ctx, live, size, frame, 1, 0, 0, grade);
    return;
  }

  if (active.family === "dip") {
    const intensity = dipIntensity(active.progress);
    ctx.save();
    if (active.kind === "blur") {
      ctx.filter = `blur(${intensity * size.height * 0.035}px)`;
    } else if (active.kind === "zoomBlur") {
      // Softer than the plain blur and paired with a push, so it reads as
      // speed rather than as focus being lost.
      ctx.filter = `blur(${intensity * size.height * 0.018}px)`;
    }
    const scale =
      active.kind === "zoomIn"
        ? 1 + 0.28 * intensity
        : active.kind === "zoomBlur"
          ? 1 + 0.14 * intensity
          : 1;
    if (live) drawSource(ctx, live, size, frame, scale, 0, 0, grade);
    ctx.restore();
    ctx.filter = "none";

    if (active.kind === "fadeBlack" || active.kind === "fadeWhite") {
      ctx.save();
      ctx.globalAlpha = intensity;
      ctx.fillStyle = active.kind === "fadeWhite" ? "#fff" : "#000";
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.restore();
    }
    return;
  }

  // push: the incoming clip is live underneath, the held outgoing frame moves
  // off over it. Without a freeze there is nothing to move, so it plays as a
  // straight cut — which is the honest degradation.
  if (live) drawSource(ctx, live, size, frame, 1, 0, 0, grade);
  if (!freeze) return;

  const p = easeOut(active.progress);
  ctx.save();
  switch (active.kind) {
    case "dissolve":
      ctx.globalAlpha = 1 - p;
      drawSource(ctx, freeze, size, frame, 1, 0, 0, grade);
      break;
    case "zoomOut":
      ctx.globalAlpha = 1 - p;
      drawSource(ctx, freeze, size, frame, 1 + 0.35 * p, 0, 0, grade);
      break;
    case "slideLeft":
      drawSource(ctx, freeze, size, frame, 1, -size.width * p, 0, grade);
      break;
    case "slideRight":
      drawSource(ctx, freeze, size, frame, 1, size.width * p, 0, grade);
      break;
    case "slideUp":
      drawSource(ctx, freeze, size, frame, 1, 0, -size.height * p, grade);
      break;
    case "slideDown":
      drawSource(ctx, freeze, size, frame, 1, 0, size.height * p, grade);
      break;

    case "morphCut": {
      // The two frames are pulled toward each other rather than one simply
      // fading: on a jump cut the head has moved, and a straight dissolve shows
      // you both positions at once. A small counter-scale plus a blur that
      // peaks in the middle hides where the join is — which is the entire job.
      const meet = dipIntensity(active.progress);
      ctx.filter = `blur(${meet * size.height * 0.012}px)`;
      ctx.globalAlpha = 1 - p;
      drawSource(ctx, freeze, size, frame, 1 + 0.02 * p, 0, 0, grade);
      ctx.filter = "none";
      break;
    }

    case "whipPan": {
      // Fast and horizontal, with the smear strongest at the start where the
      // frame is moving quickest.
      const smear = (1 - p) * size.height * 0.05;
      ctx.filter = `blur(${smear}px)`;
      drawSource(ctx, freeze, size, frame, 1, -size.width * p * 1.15, 0, grade);
      ctx.filter = "none";
      break;
    }

    case "iris": {
      // A hole cut in the outgoing frame, opening onto the incoming one. The
      // clip is inverted with `evenodd` — a rect enclosing a circle — because
      // clipping to the *hole* would keep the wrong half of the picture.
      const corner = Math.hypot(size.width, size.height) / 2;
      const radius = corner * p;
      ctx.beginPath();
      ctx.rect(0, 0, size.width, size.height);
      ctx.arc(size.width / 2, size.height / 2, radius, 0, Math.PI * 2);
      ctx.clip("evenodd");
      drawSource(ctx, freeze, size, frame, 1, 0, 0, grade);
      break;
    }

    default:
      break;
  }
  ctx.restore();
}

/**
 * The whole frame: video treatment then overlays.
 * `t` is the output-clock second being drawn.
 */
export function paintFrame(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  sources: FrameSources,
  active: ActiveTransition | null,
  composition: Composition,
  t: number
) {
  // A composition restored from an older save has no frame and no shots;
  // falling back keeps it rendering exactly as it did rather than throwing on
  // the first paint.
  const shot = shotAt(composition, t);
  // A shot's own look wins over the project's, and `null` on a shot means
  // "neutral here" rather than "inherit" — a cutaway that has to be left alone
  // needs to be able to say so.
  const grade = shot && shot.grade !== undefined ? shot.grade : composition.grade;

  paintVideoLayer(
    ctx,
    size,
    sources,
    active,
    composition.frame ?? DEFAULT_FRAME,
    shot,
    t,
    grade
  );
  // Between the picture and the overlays: a grade treats the footage, and you
  // do not grade your own captions. Text gone muddy under a look someone
  // applied to the footage is an hour lost in the wrong panel.
  paintGrade(ctx, size, grade, t);
  paintComposition(ctx, composition, size, t);
}
