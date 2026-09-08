/**
 * Where things are allowed to sit.
 *
 * The model is told to keep captions out of the subtitle band and off each
 * other, and it mostly does — but "mostly" is not good enough for something
 * that is visible in every frame of the finished video. So placement is
 * *enforced* here as well: whatever an operation asks for, the rect it gets
 * back has been moved clear of the burned-in subtitles and of anything else on
 * screen at the same moment.
 *
 * This is a layout pass, not a suggestion. It runs for elements added by hand
 * and by plan alike, which is why it lives next to the model rather than in the
 * agent's prompt.
 */

import type { Rect, SubtitleStyle } from "./types";

/** Broadcast-style margin: nothing important goes outside this. */
export const TITLE_SAFE = 0.05;

/** Gap kept between two things that would otherwise touch. */
const CLEARANCE = 0.02;

export function overlaps(a: Rect, b: Rect, pad = 0): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

/**
 * How much of a frame's height one unit of type is worth, as a fraction.
 *
 * Mirrors `typeUnit` in the renderer, which pulls type back on frames taller
 * than 4:3. This module works in normalised units and never sees a pixel, so it
 * needs the same correction expressed as a fraction of frame height — otherwise
 * the band it reserves for a vertical video is nearly twice the strip the
 * subtitles actually occupy, and everything gets shoved off the frame to dodge
 * empty space.
 */
export function typeScale(aspect: number): number {
  if (!(aspect > 0)) return 1;
  return Math.min(1, aspect * (4 / 3));
}

/**
 * The strip the burned-in subtitles occupy.
 *
 * Derived from the style rather than assumed, because the presets move: the
 * "Shorts" look sits mid-frame at 7% of frame height over two lines, and
 * anything placed by the "centre" rule would land straight on top of it.
 */
export function subtitleBand(style: SubtitleStyle, aspect = 16 / 9): Rect {
  // Line height in the renderer is 1.25em, plus the padding a background slab
  // adds either side.
  const unit = style.fontSize * typeScale(aspect);
  const height = unit * 1.25 * style.maxLines + unit * 0.6;
  const y =
    style.position === "top"
      ? style.margin
      : style.position === "center"
        ? (1 - height) / 2
        : 1 - style.margin - height;

  return { x: 0.05, y: Math.max(0, y), w: 0.9, h: Math.min(height, 1) };
}

/** Clamp a rect inside the frame, keeping its size where possible. */
export function clampToFrame(rect: Rect): Rect {
  const w = Math.min(rect.w, 1);
  const h = Math.min(rect.h, 1);
  return {
    w,
    h,
    x: Math.max(0, Math.min(rect.x, 1 - w)),
    y: Math.max(0, Math.min(rect.y, 1 - h)),
  };
}

/**
 * Move `rect` vertically until it clears every blocked band.
 *
 * Vertical only, and deliberately: captions read as belonging to a horizontal
 * position — lower third, upper third, centred — and sliding one sideways to
 * dodge a subtitle looks like a mistake, where lifting it does not. The
 * direction is whichever has more room, so a lower third lifts above the
 * subtitles and an upper third stays up.
 */
export function nudgeClear(rect: Rect, blocked: Rect[]): Rect {
  let placed = clampToFrame(rect);

  // A handful of passes: clearing one band can push into the next.
  for (let pass = 0; pass < 6; pass++) {
    const hit = blocked.find((b) => overlaps(placed, b, CLEARANCE));
    if (!hit) return placed;

    const above = hit.y - CLEARANCE - placed.h;
    const below = hit.y + hit.h + CLEARANCE;

    const canGoAbove = above >= TITLE_SAFE;
    const canGoBelow = below + placed.h <= 1 - TITLE_SAFE;

    if (!canGoAbove && !canGoBelow) {
      // Nowhere to go: sit above the obstruction and let the frame clip rather
      // than stacking two unreadable things on the same pixels.
      return clampToFrame({ ...placed, y: Math.max(0, above) });
    }

    if (canGoAbove && canGoBelow) {
      // Keep the element on the side it was already leaning towards.
      const centre = placed.y + placed.h / 2;
      placed = { ...placed, y: centre < hit.y + hit.h / 2 ? above : below };
    } else {
      placed = { ...placed, y: canGoAbove ? above : below };
    }
    placed = clampToFrame(placed);
  }

  return placed;
}

export interface Occupant {
  id: string;
  start: number;
  end: number;
  rect: Rect;
  hidden: boolean;
}

/** Rects of everything on screen at the same time as [start, end). */
export function occupiedDuring(
  elements: Occupant[],
  start: number,
  end: number,
  excludeId?: string
): Rect[] {
  return elements
    .filter(
      (e) =>
        !e.hidden &&
        e.id !== excludeId &&
        // Half-open overlap: something that ends exactly as this begins is not
        // on screen with it.
        e.start < end &&
        e.end > start
    )
    .map((e) => e.rect);
}

/**
 * Everything a new element at [start, end) has to avoid: the subtitle band, if
 * subtitles are burned in and a cue actually lands in that window, plus the
 * other elements sharing the moment.
 */
export function blockedFor(
  start: number,
  end: number,
  elements: Occupant[],
  subtitles: {
    enabled: boolean;
    style: SubtitleStyle;
    cues: Array<{ start: number; end: number }>;
  },
  excludeId?: string,
  aspect = 16 / 9
): Rect[] {
  const blocked = occupiedDuring(elements, start, end, excludeId);

  const subtitlesShowing =
    subtitles.enabled &&
    subtitles.cues.some((c) => c.start < end && c.end > start);
  if (subtitlesShowing) blocked.push(subtitleBand(subtitles.style, aspect));

  return blocked;
}
