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
  /** The shape of the output. See the frame section below. */
  frame: FrameSpec;
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
    frame: { ...DEFAULT_FRAME },
  };
}

/**
 * True when there is nothing to composite and export can take the fast path.
 *
 * `sourceAspect` decides whether the frame counts as work: reframing a 16:9
 * recording to 9:16 is a re-render even with no captions on it, while a frame
 * that matches the footage is not.
 */
export function isEmptyComposition(
  c: Composition,
  sourceAspect = 0
): boolean {
  return (
    c.elements.every((e) => e.hidden) &&
    (!c.subtitles.enabled || c.subtitles.cues.length === 0) &&
    c.transitions.every((t) => t.kind === "none" || t.duration <= 0) &&
    !frameReframes(c.frame ?? DEFAULT_FRAME, sourceAspect)
  );
}

/* --------------------------------- frame ---------------------------------- */

/**
 * The shape of the finished video.
 *
 * Until this existed the output was always the source's own aspect, which made
 * a vertical deliverable impossible: you could edit a 16:9 recording and export
 * it, and that was the only answer available. A frame is a *target* — the
 * composition's 0..1 coordinates are relative to it, not to the footage — so
 * the same overlays reframe with the picture rather than sliding off it.
 */
export type FrameAspectId =
  | "source"
  | "16:9"
  | "9:16"
  | "1:1"
  | "4:5"
  | "4:3"
  | "2.39:1";

export const FRAME_ASPECTS: {
  id: FrameAspectId;
  label: string;
  hint: string;
  /** Width ÷ height. Null means "whatever the footage is". */
  ratio: number | null;
}[] = [
  { id: "source", label: "Source", hint: "As shot", ratio: null },
  { id: "16:9", label: "16:9", hint: "Landscape", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", hint: "Shorts, Reels, TikTok", ratio: 9 / 16 },
  { id: "1:1", label: "1:1", hint: "Square feed", ratio: 1 },
  { id: "4:5", label: "4:5", hint: "Instagram portrait", ratio: 4 / 5 },
  { id: "4:3", label: "4:3", hint: "Classic", ratio: 4 / 3 },
  { id: "2.39:1", label: "2.39:1", hint: "Anamorphic", ratio: 2.39 },
];

/** How the footage sits inside a frame it does not match. */
export type FrameFit = "cover" | "contain";

/** What fills the frame where `contain` leaves the footage short. */
export type FrameBackground = "black" | "blur" | "white";

export interface FrameSpec {
  aspect: FrameAspectId;
  fit: FrameFit;
  /** Extra zoom on top of the fit, 1 = none. */
  zoom: number;
  /**
   * The point of the *source* picture held at the centre of the frame, in its
   * own 0..1 coordinates. 0.5/0.5 is the middle; a talking head shot off to one
   * side is why this is adjustable at all.
   */
  focusX: number;
  focusY: number;
  background: FrameBackground;
}

export const DEFAULT_FRAME: FrameSpec = {
  aspect: "source",
  fit: "cover",
  zoom: 1,
  focusX: 0.5,
  focusY: 0.5,
  background: "blur",
};

/** Width ÷ height of the output, given what the footage is. */
export function frameRatio(frame: FrameSpec, sourceAspect: number): number {
  const preset = FRAME_ASPECTS.find((a) => a.id === frame.aspect);
  const ratio = preset?.ratio ?? null;
  if (ratio && Number.isFinite(ratio) && ratio > 0) return ratio;
  return sourceAspect > 0 ? sourceAspect : 16 / 9;
}

/** True when the frame changes the picture and must therefore be rendered. */
export function frameReframes(frame: FrameSpec, sourceAspect: number): boolean {
  if (frame.zoom !== 1) return true;
  if (frame.focusX !== 0.5 || frame.focusY !== 0.5) return true;
  if (frame.aspect === "source") return false;
  const target = frameRatio(frame, sourceAspect);
  // Within a pixel or two of the same shape is not a reframe.
  return Math.abs(target - sourceAspect) > 0.01;
}

/** Round to an even number of pixels; H.264 requires it on both axes. */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * The pixel size of the finished file.
 *
 * The frame decides the shape; this decides how many pixels that shape gets,
 * and the rule is "keep the detail the footage actually has". The output's
 * shorter side matches the source's shorter side — so a 1920×1080 recording
 * delivered vertically is 1080×1920, the size everything expects — except where
 * that would blow the longer side up past what was shot, which is what stops a
 * 2.39:1 crop of a 16:9 master from being invented out of nothing.
 *
 * `targetHeight` overrides the lot; the width still follows the frame.
 */
export function outputSize(
  ratio: number,
  nativeWidth: number,
  nativeHeight: number,
  targetHeight?: number
): { width: number; height: number } {
  if (targetHeight && targetHeight > 0) {
    return { width: even(ratio * targetHeight), height: even(targetHeight) };
  }

  const shorter = Math.min(nativeWidth, nativeHeight);
  const longer = Math.max(nativeWidth, nativeHeight);

  let height = ratio >= 1 ? shorter : shorter / ratio;
  let width = ratio * height;

  if (ratio >= 1 && width > longer) {
    width = longer;
    height = width / ratio;
  } else if (ratio < 1 && height > longer) {
    height = longer;
    width = ratio * height;
  }

  return { width: even(width), height: even(height) };
}
