/**
 * The composition layer that sits on top of the cut.
 *
 * Everything here is expressed in **edited-timeline seconds** — the time the
 * viewer sees, after cuts are removed — and in **normalised frame coordinates**
 * (0..1 of the output width/height). Both choices are deliberate:
 *
 *  - Edited time is what the person means when they say "at 4 seconds", and it
 *    survives an upstream cut changing where that moment sits in the source.
 *  - Normalised coordinates mean the same composition renders identically into
 *    a 720p preview and a 4K export. Nothing in this file knows a pixel size.
 *
 * `lib/overlay/render.ts` is the only thing that turns these into pixels, and
 * it is used by both the live preview and the exporter, so there is exactly one
 * definition of what a composition looks like.
 */

/** Normalised rectangle: 0..1 of the frame, origin top-left. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type EasingName =
  | "linear"
  | "easeOut"
  | "easeIn"
  | "easeInOut"
  | "backOut"
  | "spring";

export type AnimationKind =
  | "none"
  | "fade"
  | "slideUp"
  | "slideDown"
  | "slideLeft"
  | "slideRight"
  | "scaleUp"
  | "pop"
  | "blur"
  | "wipeRight"
  | "typewriter";

export interface AnimationSpec {
  kind: AnimationKind;
  /** Seconds the animation runs for. Clamped to half the element's life. */
  duration: number;
  easing: EasingName;
}

export const DEFAULT_ENTER: AnimationSpec = {
  kind: "fade",
  duration: 0.4,
  easing: "easeOut",
};
export const DEFAULT_EXIT: AnimationSpec = {
  kind: "fade",
  duration: 0.3,
  easing: "easeIn",
};

export type ElementKind = "text" | "image" | "shape";

interface Common {
  id: string;
  kind: ElementKind;
  /** Shown in the layer list and used by the AI to address the element. */
  name: string;
  /** Visible window, in edited-timeline seconds. */
  start: number;
  end: number;
  rect: Rect;
  /** Degrees, clockwise, about the rect's centre. */
  rotation: number;
  opacity: number;
  /** Paint order. Higher draws later (on top). */
  z: number;
  locked: boolean;
  hidden: boolean;
  enter: AnimationSpec;
  exit: AnimationSpec;
}

export type TextAlign = "left" | "center" | "right";

export interface TextElement extends Common {
  kind: "text";
  text: string;
  fontFamily: string;
  fontWeight: number;
  italic: boolean;
  /** Fraction of frame height, so type scales with the output. */
  fontSize: number;
  color: string;
  align: TextAlign;
  /** Multiplier on font size. */
  lineHeight: number;
  /** Fraction of font size. */
  letterSpacing: number;
  uppercase: boolean;
  /** Box behind the text. `null` for none. */
  background: string | null;
  /** Fraction of font size. */
  padding: number;
  /** Fraction of the box's shorter side. */
  radius: number;
  shadow: boolean;
  strokeColor: string | null;
  /** Fraction of font size. */
  strokeWidth: number;
}

export type ImageFit = "contain" | "cover";

export interface ImageElement extends Common {
  kind: "image";
  /**
   * Same-origin URL. Cross-origin sources are refused on load: the editor page
   * is cross-origin isolated, and a tainted canvas cannot be exported.
   */
  src: string;
  /** Set when the image came out of the generator, so it can be re-rolled. */
  prompt?: string;
  /** Where it came from, for the layer list. */
  origin?: "generated" | "search" | "upload";
  fit: ImageFit;
  /** Fraction of the shorter side. */
  radius: number;
  shadow: boolean;
}

export type ShapeKind = "rect" | "ellipse" | "line";

export interface ShapeElement extends Common {
  kind: "shape";
  shape: ShapeKind;
  fill: string | null;
  strokeColor: string | null;
  /** Fraction of frame height. */
  strokeWidth: number;
  radius: number;
}

export type OverlayElement = TextElement | ImageElement | ShapeElement;

/* -------------------------------- subtitles -------------------------------- */

export type SubtitlePosition = "bottom" | "center" | "top";
export type SubtitleAnimation = "none" | "fade" | "pop" | "karaoke";

export interface SubtitleStyle {
  fontFamily: string;
  fontWeight: number;
  /** Fraction of frame height. */
  fontSize: number;
  color: string;
  /** Colour the active word takes under "karaoke". */
  highlight: string;
  background: string | null;
  uppercase: boolean;
  outline: boolean;
  shadow: boolean;
  position: SubtitlePosition;
  /** Fraction of frame height held clear of the chosen edge. */
  margin: number;
  maxCharsPerLine: number;
  maxLines: number;
  animation: SubtitleAnimation;
}

export interface SubtitleWord {
  text: string;
  start: number;
  end: number;
}

export interface SubtitleCue {
  id: string;
  /** Edited-timeline seconds. */
  start: number;
  end: number;
  text: string;
  /** Per-word timings, when the transcript had them. Drives karaoke. */
  words?: SubtitleWord[];
}

export interface SubtitleTrack {
  enabled: boolean;
  style: SubtitleStyle;
  cues: SubtitleCue[];
  /** True once cues have been generated from the transcript at least once. */
  generated: boolean;
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  fontWeight: 700,
  fontSize: 0.055,
  color: "#ffffff",
  highlight: "#ffd60a",
  background: "rgba(0,0,0,0.55)",
  uppercase: false,
  outline: true,
  shadow: true,
  position: "bottom",
  margin: 0.08,
  maxCharsPerLine: 38,
  maxLines: 2,
  animation: "fade",
};

/* ------------------------------- transitions ------------------------------- */

export type TransitionKind =
  | "none"
  | "fadeBlack"
  | "fadeWhite"
  | "dissolve"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "zoomIn"
  | "zoomOut"
  | "blur";

/**
 * A transition sits on the boundary *before* clip `index` (so `index` is always
 * ≥ 1). Boundaries are addressed by clip index rather than by time because a
 * trim moves the time but not which two clips meet.
 */
export interface Transition {
  index: number;
  kind: TransitionKind;
  /** Seconds. Clamped at render to what the neighbouring clips can give. */
  duration: number;
}

/** Kinds that need a frame from the incoming clip as well as the outgoing one. */
export const DUAL_SOURCE_TRANSITIONS: ReadonlySet<TransitionKind> = new Set([
  "dissolve",
  "slideLeft",
  "slideRight",
  "slideUp",
  "slideDown",
]);

export const TRANSITION_LABELS: Record<TransitionKind, string> = {
  none: "Cut",
  fadeBlack: "Fade through black",
  fadeWhite: "Fade through white",
  dissolve: "Dissolve",
  slideLeft: "Slide left",
  slideRight: "Slide right",
  slideUp: "Slide up",
  slideDown: "Slide down",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  blur: "Blur through",
};

/* ------------------------------- composition ------------------------------- */

/** Everything the renderer needs, and the whole of what gets persisted. */
export interface Composition {
  elements: OverlayElement[];
  subtitles: SubtitleTrack;
  transitions: Transition[];
}

export function emptyComposition(): Composition {
  return {
    elements: [],
    subtitles: {
      enabled: false,
      style: { ...DEFAULT_SUBTITLE_STYLE },
      cues: [],
      generated: false,
    },
    transitions: [],
  };
}

/** True when there is nothing to composite and export can take the fast path. */
export function isEmptyComposition(c: Composition): boolean {
  return (
    c.elements.every((e) => e.hidden) &&
    (!c.subtitles.enabled || c.subtitles.cues.length === 0) &&
    c.transitions.every((t) => t.kind === "none" || t.duration <= 0)
  );
}
