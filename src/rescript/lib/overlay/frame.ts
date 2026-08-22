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
import { DEFAULT_FRAME, type Composition, type FrameSpec } from "./types";

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
  dy = 0
) {
  const intrinsic = sourceSize(src);
  if (!intrinsic) return;
  const spot = placement(intrinsic, size, frame, frame.fit, scale);
  ctx.drawImage(src, spot.x + dx, spot.y + dy, spot.w, spot.h);
}

/** Peaks at 1 in the middle of the window and returns to 0 at both ends. */
function dipIntensity(progress: number): number {
  return 1 - Math.abs(progress * 2 - 1);
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
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
  frame: FrameSpec
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size.width, size.height);

  const { live, freeze } = sources;

  // One backdrop for the whole frame, from whichever source is real. The freeze
  // is the fallback because a seek can leave the <video> momentarily without a
  // picture, and a backdrop that blinks is worse than one drawn from the held
  // frame beside it.
  const backdropFrom = live ?? freeze;
  if (backdropFrom) drawBackdrop(ctx, backdropFrom, size, frame);

  if (!active) {
    if (live) drawSource(ctx, live, size, frame);
    return;
  }

  if (active.family === "dip") {
    const intensity = dipIntensity(active.progress);
    ctx.save();
    if (active.kind === "blur") {
      ctx.filter = `blur(${intensity * size.height * 0.035}px)`;
    }
    const scale = active.kind === "zoomIn" ? 1 + 0.28 * intensity : 1;
    if (live) drawSource(ctx, live, size, frame, scale);
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
  if (live) drawSource(ctx, live, size, frame);
  if (!freeze) return;

  const p = easeOut(active.progress);
  ctx.save();
  switch (active.kind) {
    case "dissolve":
      ctx.globalAlpha = 1 - p;
      drawSource(ctx, freeze, size, frame);
      break;
    case "zoomOut":
      ctx.globalAlpha = 1 - p;
      drawSource(ctx, freeze, size, frame, 1 + 0.35 * p);
      break;
    case "slideLeft":
      drawSource(ctx, freeze, size, frame, 1, -size.width * p, 0);
      break;
    case "slideRight":
      drawSource(ctx, freeze, size, frame, 1, size.width * p, 0);
      break;
    case "slideUp":
      drawSource(ctx, freeze, size, frame, 1, 0, -size.height * p);
      break;
    case "slideDown":
      drawSource(ctx, freeze, size, frame, 1, 0, size.height * p);
      break;
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
  // A composition restored from an older save has no frame; falling back keeps
  // it rendering exactly as it did rather than throwing on the first paint.
  paintVideoLayer(ctx, size, sources, active, composition.frame ?? DEFAULT_FRAME);
  paintComposition(ctx, composition, size, t);
}
