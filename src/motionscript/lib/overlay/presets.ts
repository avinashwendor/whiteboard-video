/**
 * Named positions, sizes and text styles.
 *
 * These exist so a person and the AI can both say "put a title in the lower
 * third" and mean the same pixels. The UI's buttons and the agent's `position`
 * field resolve through this one table, so a prompt and a click cannot drift
 * apart.
 */

import type { PositionName, SizeName, TextStyleName } from "./ops-schema";
import type { Rect, TextElement } from "./types";

/** Frame fraction kept clear of every edge. */
export const SAFE_MARGIN = 0.05;

/** Positions whose element should span most of the frame's width. */
const WIDE: ReadonlySet<PositionName> = new Set([
  "top",
  "bottom",
  "center",
  "lower-third",
  "upper-third",
]);

export function isWidePosition(name: PositionName): boolean {
  return WIDE.has(name);
}

/** Place a box of size `w`×`h` at a named position. */
export function rectAt(
  name: PositionName,
  w: number,
  h: number
): Rect {
  const m = SAFE_MARGIN;
  const midX = (1 - w) / 2;
  const midY = (1 - h) / 2;
  const right = 1 - m - w;
  const bottom = 1 - m - h;

  switch (name) {
    case "top-left":
      return { x: m, y: m, w, h };
    case "top":
      return { x: midX, y: m, w, h };
    case "top-right":
      return { x: right, y: m, w, h };
    case "left":
      return { x: m, y: midY, w, h };
    case "center":
      return { x: midX, y: midY, w, h };
    case "right":
      return { x: right, y: midY, w, h };
    case "bottom-left":
      return { x: m, y: bottom, w, h };
    case "bottom":
      return { x: midX, y: bottom, w, h };
    case "bottom-right":
      return { x: right, y: bottom, w, h };
    case "lower-third":
      return { x: midX, y: 0.66, w, h };
    case "upper-third":
      return { x: midX, y: 0.14, w, h };
    default:
      return { x: midX, y: midY, w, h };
  }
}

/** Type size as a fraction of frame height. */
export const TEXT_SIZE: Record<SizeName, number> = {
  xs: 0.032,
  s: 0.046,
  m: 0.062,
  l: 0.082,
  xl: 0.115,
};

/** Image width as a fraction of frame width. */
export const IMAGE_SIZE: Record<SizeName, number> = {
  xs: 0.14,
  s: 0.22,
  m: 0.32,
  l: 0.46,
  xl: 0.64,
};

/** Shape footprint as a fraction of the frame. */
export const SHAPE_SIZE: Record<SizeName, { w: number; h: number }> = {
  xs: { w: 0.2, h: 0.06 },
  s: { w: 0.35, h: 0.1 },
  m: { w: 0.55, h: 0.16 },
  l: { w: 0.8, h: 0.24 },
  xl: { w: 0.94, h: 0.4 },
};

/**
 * Box height that fits `lines` lines of type at `fontSize`, plus the padding
 * a background scrim would need. Two lines is the assumption for a caption.
 */
export function textBoxHeight(fontSize: number, lines = 2): number {
  return fontSize * 1.18 * lines + fontSize * 0.7;
}

export type TextStylePatch = Partial<
  Pick<
    TextElement,
    | "fontFamily"
    | "fontWeight"
    | "italic"
    | "color"
    | "background"
    | "uppercase"
    | "letterSpacing"
    | "align"
    | "shadow"
    | "strokeColor"
    | "strokeWidth"
    | "padding"
    | "radius"
  >
> & { sizeScale?: number };

const SANS = "var(--font-geist-sans), system-ui, sans-serif";
const HAND = "var(--font-hand), var(--font-geist-sans), system-ui, sans-serif";

/**
 * The looks on offer. Each one is a complete answer to "how should this read",
 * not a single property — which is why the AI is given style names rather than
 * being asked to pick a weight and a tracking value.
 */
export const TEXT_STYLES: Record<TextStyleName, TextStylePatch> = {
  plain: {
    fontFamily: SANS,
    fontWeight: 600,
    italic: false,
    color: "#ffffff",
    background: null,
    uppercase: false,
    letterSpacing: -0.005,
    shadow: true,
    strokeColor: null,
  },
  title: {
    fontFamily: SANS,
    fontWeight: 800,
    italic: false,
    color: "#ffffff",
    background: null,
    uppercase: false,
    letterSpacing: -0.025,
    shadow: true,
    strokeColor: null,
    sizeScale: 1.15,
  },
  subtitle: {
    fontFamily: SANS,
    fontWeight: 500,
    italic: false,
    color: "rgba(255,255,255,0.86)",
    background: null,
    uppercase: false,
    letterSpacing: -0.005,
    shadow: true,
    sizeScale: 0.72,
  },
  caption: {
    fontFamily: SANS,
    fontWeight: 600,
    italic: false,
    color: "#ffffff",
    background: "rgba(0,0,0,0.6)",
    uppercase: false,
    letterSpacing: 0,
    padding: 0.42,
    radius: 0.22,
    shadow: false,
    sizeScale: 0.8,
  },
  badge: {
    fontFamily: SANS,
    fontWeight: 800,
    italic: false,
    color: "#0a0b0d",
    background: "#ffd60a",
    uppercase: true,
    letterSpacing: 0.06,
    padding: 0.5,
    radius: 0.5,
    shadow: true,
    sizeScale: 0.6,
  },
  quote: {
    fontFamily: SANS,
    fontWeight: 500,
    italic: true,
    color: "#ffffff",
    background: null,
    uppercase: false,
    letterSpacing: -0.01,
    shadow: true,
    sizeScale: 1.05,
  },
  handwritten: {
    fontFamily: HAND,
    fontWeight: 400,
    italic: false,
    color: "#ffffff",
    background: null,
    uppercase: false,
    letterSpacing: 0.01,
    shadow: true,
    sizeScale: 1.1,
  },
};

export const TEXT_STYLE_LABELS: Record<TextStyleName, string> = {
  plain: "Plain",
  title: "Title",
  subtitle: "Subtitle",
  caption: "Caption",
  badge: "Badge",
  quote: "Quote",
  handwritten: "Marker",
};

/** The style's element fields, with the size multiplier stripped off. */
export function textStyleFields(
  name: TextStyleName
): Omit<TextStylePatch, "sizeScale"> {
  const { sizeScale: _ignored, ...fields } = TEXT_STYLES[name];
  void _ignored;
  return fields;
}

/** How much this style scales the chosen size. */
export function textStyleScale(name: TextStyleName): number {
  return TEXT_STYLES[name].sizeScale ?? 1;
}

/**
 * Where an element added "here" should actually start.
 *
 * Nudged just behind the playhead so its entrance has already played by the
 * time you look at it. Starting exactly on the playhead is technically right
 * and reads as a bug: a fade-in is fully transparent at its first frame, so a
 * caption added at the current position appears to do nothing until you scrub.
 */
export const ENTRANCE_LEAD_S = 0.45;

export function startAtPlayhead(playhead: number): number {
  return Math.max(0, playhead - ENTRANCE_LEAD_S);
}
