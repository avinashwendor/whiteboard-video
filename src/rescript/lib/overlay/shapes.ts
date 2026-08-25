/**
 * Shapes beyond a rectangle: icons, arrows, and things you draw on the frame
 * to point at something.
 *
 * The composition layer had three shapes — rect, ellipse, line — which is the
 * entire graphics vocabulary it could offer. Meanwhile the repo already holds
 * **1,776 Lucide icons as path geometry** (`lib/icons/lucide-paths.generated`),
 * normalised to a 24×24 box, used by the whiteboard engine and unreachable from
 * here. So the library is mostly a matter of pointing at what exists.
 *
 * Everything is expressed as SVG path data in that same 24×24 space, which
 * makes an icon and a hand-drawn arrow the same kind of thing: a path, scaled
 * into the element's rect and stroked. That is what lets one animation — the
 * draw-on — work for all of them.
 */

import {
  LUCIDE_NAMES,
  LUCIDE_PATHS,
} from "@/lib/icons/lucide-paths.generated";
import type { FrameSize } from "./render";

/** The box every path in this module is drawn in, before it is scaled. */
export const VIEWBOX = 24;

/* ------------------------------- annotations ------------------------------- */

/**
 * The marks an editor actually makes on a frame.
 *
 * Hand-shaped rather than geometric — a perfect ellipse around someone's face
 * reads as a UI element, and a slightly wobbly one reads as a person pointing.
 * The wobble is baked into the path data rather than generated, so a shape is
 * identical every frame and in the export: the renderer's whole contract is
 * being a pure function of its inputs.
 */
export const ANNOTATIONS: Record<string, string[]> = {
  arrow: ["M2 18 C 8 16, 14 12, 21 5", "M14 4 L21 5 L20 12"],
  arrowCurved: ["M3 19 C 6 8, 14 4, 21 7", "M15 3 L21 7 L15 11"],
  circleThis: [
    "M12 3 C 18.5 3, 22 7.2, 21.8 12.1 C 21.6 17.4, 17.6 21, 11.8 21 C 6.2 21, 2.3 17.2, 2.4 11.8 C 2.5 6.8, 6 3.2, 12 3",
  ],
  underline: ["M3 17 C 8 15.6, 16 15.4, 21 16.6"],
  doubleUnderline: [
    "M3 16 C 8 14.7, 16 14.5, 21 15.6",
    "M4 19 C 9 18, 15 17.9, 20 18.7",
  ],
  strike: ["M3 12.4 C 9 11.6, 15 11.4, 21 12.2"],
  box: [
    "M3.4 4.2 C 9 3.4, 16 3.5, 20.8 4.4 C 21.3 9, 21.2 15.4, 20.6 19.7 C 15 20.5, 8 20.4, 3.2 19.6 C 2.7 15 2.8 8.8 3.4 4.2",
  ],
  bracketLeft: ["M9 3 C 5.5 3.6, 5 5, 5 12 C 5 19, 5.5 20.4, 9 21"],
  bracketRight: ["M15 3 C 18.5 3.6, 19 5, 19 12 C 19 19, 18.5 20.4, 15 21"],
  scribble: [
    "M3 15 C 6 9, 8 18, 11 11 C 13.4 5.4, 15 17, 18 10 C 19.4 6.8, 20.4 12, 21 13.6",
  ],
  check: ["M4 13 L 10 19 L 20 5"],
  cross: ["M5 5 L 19 19", "M19 5 L 5 19"],
  divider: ["M2 12 L 22 12"],
  chevron: ["M9 5 L 16 12 L 9 19"],
  plus: ["M12 4 L 12 20", "M4 12 L 20 12"],
  star: ["M12 3 L 14.9 9.3 L 21.7 10.1 L 16.7 14.8 L 18 21.5 L 12 18.2 L 6 21.5 L 7.3 14.8 L 2.3 10.1 L 9.1 9.3 Z"],
};

export const ANNOTATION_NAMES = Object.keys(ANNOTATIONS);

export const ANNOTATION_LABELS: Record<string, string> = {
  arrow: "Arrow",
  arrowCurved: "Curved arrow",
  circleThis: "Circle this",
  underline: "Underline",
  doubleUnderline: "Double underline",
  strike: "Strike through",
  box: "Box",
  bracketLeft: "Bracket (left)",
  bracketRight: "Bracket (right)",
  scribble: "Scribble",
  check: "Tick",
  cross: "Cross",
  divider: "Divider",
  chevron: "Chevron",
  plus: "Plus",
  star: "Star",
};

/* --------------------------------- lookup ---------------------------------- */

/**
 * The path data for a named mark.
 *
 * Annotations are checked first: they are the short, memorable names, and
 * someone asking for "arrow" means the one they can draw with, not whichever of
 * the eighty Lucide arrows sorts first.
 *
 * The catalogue is imported statically rather than fetched when the picker
 * opens. Lazy-loading it would save ~327KB on a project that never places an
 * icon, at the cost of a real hole: reopening a saved project that *does* have
 * one would draw a rectangle until something happened to pull the catalogue in.
 * A rendering path that is correct only after an unrelated component has
 * mounted is not a rendering path.
 */
export function pathsFor(name: string): string[] | null {
  return ANNOTATIONS[name] ?? LUCIDE_PATHS[name] ?? null;
}

export function knownShape(name: string): boolean {
  return pathsFor(name) !== null;
}

/** Every mark that can be placed: the marks first, then the icons. */
export function allShapeNames(): string[] {
  return [...ANNOTATION_NAMES, ...LUCIDE_NAMES];
}

/** Names matching a search, marks first. Bounded — the catalogue is 1,776 long. */
export function searchShapes(query: string, limit = 60): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return ANNOTATION_NAMES.slice(0, limit);

  const starts: string[] = [];
  const contains: string[] = [];
  for (const name of allShapeNames()) {
    const at = name.toLowerCase().indexOf(q);
    if (at === 0) starts.push(name);
    else if (at > 0) contains.push(name);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/* -------------------------------- rendering -------------------------------- */

const cache = new Map<string, Path2D | null>();

/**
 * `Path2D` for one subpath, cached.
 *
 * `new Path2D(d)` throws on malformed data in some engines and silently yields
 * an empty path in others, so a failure is cached as `null` rather than retried
 * every frame — a bad icon name must not cost anything at 60fps.
 */
function path2d(d: string): Path2D | null {
  const hit = cache.get(d);
  if (hit !== undefined) return hit;
  let built: Path2D | null = null;
  try {
    built = typeof Path2D === "undefined" ? null : new Path2D(d);
  } catch {
    built = null;
  }
  cache.set(d, built);
  return built;
}

export interface DrawShapeOptions {
  /** Stroke colour. Null strokes nothing. */
  stroke: string | null;
  /** Fill colour. Null fills nothing. Most marks are strokes only. */
  fill: string | null;
  /** Stroke width as a fraction of the frame height, like ShapeElement. */
  strokeWidth: number;
  /**
   * How much of the mark is drawn, 0..1 — the draw-on.
   *
   * Implemented with a dash pattern rather than by splitting the path, which
   * is why it costs nothing: the whole path is stroked every frame and the
   * dash offset decides how much of it is ink. The trade is that the reveal is
   * per *subpath* rather than continuous across the whole mark — for a
   * two-stroke arrow that reads as the shaft and then the head, which is the
   * order a person would draw it in anyway.
   */
  progress: number;
}

/**
 * Draw a named mark into a pixel box.
 *
 * Scaled to fit rather than stretched: a circle-this squashed to its element's
 * rect stops reading as a circle, and every mark here is a gesture whose shape
 * carries the meaning.
 */
export function drawShapePath(
  ctx: CanvasRenderingContext2D,
  name: string,
  box: { x: number; y: number; w: number; h: number },
  size: FrameSize,
  options: DrawShapeOptions
): boolean {
  const subpaths = pathsFor(name);
  if (!subpaths || subpaths.length === 0) return false;
  if (box.w <= 0 || box.h <= 0) return false;

  const scale = Math.min(box.w, box.h) / VIEWBOX;
  const width = VIEWBOX * scale;
  const height = VIEWBOX * scale;

  ctx.save();
  ctx.translate(box.x + (box.w - width) / 2, box.y + (box.h - height) / 2);
  ctx.scale(scale, scale);

  // Widths are given in frame fractions and the context is now in viewbox
  // units, so the line width has to come back out of the scale or a mark drawn
  // small would have a stroke thicker than the mark.
  const strokePx = Math.max(0.001, options.strokeWidth * size.height);
  ctx.lineWidth = strokePx / scale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const progress = options.progress <= 0 ? 0 : Math.min(1, options.progress);

  for (const d of subpaths) {
    const p = path2d(d);
    if (!p) continue;

    if (options.fill && progress >= 1) {
      ctx.fillStyle = options.fill;
      ctx.fill(p);
    }
    if (options.stroke && progress > 0) {
      ctx.strokeStyle = options.stroke;
      if (progress < 1) {
        // A length longer than any subpath here, in viewbox units. Exact path
        // measurement needs an SVG element and a layout, which the exporter
        // does not have — and over a 24-unit box an over-estimate simply means
        // the mark finishes drawing slightly early, which nobody can see.
        const total = 120;
        ctx.setLineDash([total * progress, total]);
      }
      ctx.stroke(p);
      ctx.setLineDash([]);
    }
  }

  ctx.restore();
  return true;
}
