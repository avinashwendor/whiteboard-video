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
import type { Composition } from "./types";

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
 * Draw a source to fill `size`, preserving aspect ratio and cropping the
 * overflow. `scale` zooms about the centre; `dx`/`dy` shift in output pixels.
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  size: FrameSize,
  scale = 1,
  dx = 0,
  dy = 0
) {
  const intrinsic = sourceSize(src);
  if (!intrinsic) return;
  // `contain`, not `cover`: the output canvas is created at the media's own
  // aspect ratio, so these agree — but if a source ever disagrees, letterboxing
  // it is right and cropping the person's footage is not.
  const fit = Math.min(size.width / intrinsic.w, size.height / intrinsic.h) * scale;
  const w = intrinsic.w * fit;
  const h = intrinsic.h * fit;
  ctx.drawImage(src, (size.width - w) / 2 + dx, (size.height - h) / 2 + dy, w, h);
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
  active: ActiveTransition | null
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size.width, size.height);

  const { live, freeze } = sources;

  if (!active) {
    if (live) drawCover(ctx, live, size);
    return;
  }

  if (active.family === "dip") {
    const intensity = dipIntensity(active.progress);
    ctx.save();
    if (active.kind === "blur") {
      ctx.filter = `blur(${intensity * size.height * 0.035}px)`;
    }
    const scale = active.kind === "zoomIn" ? 1 + 0.28 * intensity : 1;
    if (live) drawCover(ctx, live, size, scale);
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
  if (live) drawCover(ctx, live, size);
  if (!freeze) return;

  const p = easeOut(active.progress);
  ctx.save();
  switch (active.kind) {
    case "dissolve":
      ctx.globalAlpha = 1 - p;
      drawCover(ctx, freeze, size);
      break;
    case "zoomOut":
      ctx.globalAlpha = 1 - p;
      drawCover(ctx, freeze, size, 1 + 0.35 * p);
      break;
    case "slideLeft":
      drawCover(ctx, freeze, size, 1, -size.width * p, 0);
      break;
    case "slideRight":
      drawCover(ctx, freeze, size, 1, size.width * p, 0);
      break;
    case "slideUp":
      drawCover(ctx, freeze, size, 1, 0, -size.height * p);
      break;
    case "slideDown":
      drawCover(ctx, freeze, size, 1, 0, size.height * p);
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
  paintVideoLayer(ctx, size, sources, active);
  paintComposition(ctx, composition, size, t);
}
