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

import { isNeutralGrade, type GradeSpec } from "./grade";

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

/* ---------------------------------- shots ---------------------------------- */

/**
 * How the frame is divided for a stretch of the video.
 *
 * Until this existed the frame was one region showing one source, for the whole
 * runtime — so "camera on the left, text on the right", "screen recording with
 * the webcam in the corner" and "cam on top, screen underneath" were not
 * expressible, and neither was a plain cutaway. Those are not five features:
 * they are one mechanism with different region counts, which is the only reason
 * this is a small change to the renderer rather than a second one.
 *
 * A composition with no shots renders exactly as it did before.
 */
export type ShotLayout =
  | "full"
  | "splitLeft"
  | "splitRight"
  | "splitTop"
  | "splitBottom"
  | "stack"
  | "pip"
  | "card"
  | "grid";

export const SHOT_LAYOUT_LABELS: Record<ShotLayout, string> = {
  full: "Full frame",
  splitLeft: "Split — left",
  splitRight: "Split — right",
  splitTop: "Split — top",
  splitBottom: "Split — bottom",
  stack: "Stacked",
  pip: "Picture in picture",
  card: "Card",
  grid: "Grid",
};

/** How many regions a layout divides the frame into. `grid` varies. */
export function regionCount(layout: ShotLayout, plates = 2): number {
  switch (layout) {
    case "full":
    case "card":
      return 1;
    case "grid":
      return Math.min(4, Math.max(2, plates));
    default:
      return 2;
  }
}

export type CameraKind =
  | "hold"
  | "punchIn"
  | "punchOut"
  | "push"
  | "driftLeft"
  | "driftRight"
  | "kenBurns"
  | "snap";

/** One framing of a source: what `FrameSpec` already means, minus the shape. */
export interface CameraFraming {
  /** Extra zoom on top of the fit, 1 = none. */
  zoom: number;
  /** The point of the source held at the centre of its region, 0..1. */
  focusX: number;
  focusY: number;
}

export const NEUTRAL_FRAMING: CameraFraming = { zoom: 1, focusX: 0.5, focusY: 0.5 };

/**
 * A move from one framing to another, over part of the shot.
 *
 * `duration` is how long the move takes, not how long the shot is: the rest of
 * the shot holds at `to`. A push-in that keeps creeping for ninety seconds is
 * a different thing from one that arrives and settles, and only the second is
 * what anyone means by a punch-in.
 */
export interface CameraMove {
  kind: CameraKind;
  from: CameraFraming;
  to: CameraFraming;
  easing: EasingName;
  duration: number;
}

export const HOLD_CAMERA: CameraMove = {
  kind: "hold",
  from: { ...NEUTRAL_FRAMING },
  to: { ...NEUTRAL_FRAMING },
  easing: "easeOut",
  duration: 0,
};

/** Where a plate's picture comes from. */
export type PlateSource =
  /** The transcribed footage — the one recording that owns the clock. */
  | { kind: "primary" }
  /** Another recording attached to the project: a screen capture, a second camera. */
  | { kind: "media"; mediaId: string }
  /** A cutaway from the project's b-roll library. */
  | { kind: "broll"; brollId: string }
  /** A flat colour. What a card sits on when no footage should show through. */
  | { kind: "solid"; color: string };

/** What fills one region of a layout. */
export interface Plate {
  /** Region index within the layout. 0 is the primary/largest. */
  slot: number;
  source: PlateSource;
  fit: FrameFit;
  camera: CameraMove;
  /** Corner radius as a fraction of the region's shorter side. */
  radius: number;
  /**
   * Overrides the layout's region when the person drags it.
   *
   * Normalised to the frame, like everything else here. A deliberate placement
   * outranks the layout, which is the same rule `layout.ts` keeps for elements.
   */
  rect?: Rect;
}

/**
 * A stretch of the edited timeline, and how the frame is filled during it.
 *
 * Times are edited-timeline seconds — the same clock as elements and
 * subtitles — so a shot survives an upstream cut moving where its moment sits
 * in the source, exactly as a caption does.
 */
export interface Shot {
  id: string;
  start: number;
  end: number;
  layout: ShotLayout;
  plates: Plate[];
  /**
   * A look for this stretch only. Absent means the project's.
   *
   * Per-shot rather than only per-project because a cutaway to different
   * footage is the one place a single look genuinely does not fit — the two
   * cameras were never going to match out of the box.
   */
  grade?: GradeSpec | null;
}

/** A full-frame plate of the footage, framed as shot. The default everything. */
export function primaryPlate(): Plate {
  return {
    slot: 0,
    source: { kind: "primary" },
    fit: "cover",
    camera: { ...HOLD_CAMERA, from: { ...NEUTRAL_FRAMING }, to: { ...NEUTRAL_FRAMING } },
    radius: 0,
  };
}

/* ------------------------------- composition ------------------------------- */

/** Everything the renderer needs, and the whole of what gets persisted. */
export interface Composition {
  elements: OverlayElement[];
  subtitles: SubtitleTrack;
  transitions: Transition[];
  /** The shape of the output. See the frame section below. */
  frame: FrameSpec;
  /**
   * How the frame is divided over time. Empty means the whole runtime is one
   * full-frame plate of the footage — which is what it always was.
   *
   * Optional on the way in, because a composition saved before shots existed
   * does not have one and must keep rendering identically.
   */
  shots: Shot[];
  /**
   * The look, applied to the footage and never to the overlays.
   *
   * Optional for the same reason as `shots`: absent means neutral, which is
   * what every project made before this rendered as.
   */
  grade?: GradeSpec | null;
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
    shots: [],
    grade: null,
  };
}

/** True when a shot changes nothing about how the frame is filled. */
export function isPlainShot(shot: Shot): boolean {
  if (shot.layout !== "full") return false;
  if (shot.plates.length !== 1) return false;
  const plate = shot.plates[0];
  if (plate.source.kind !== "primary") return false;
  if (plate.rect) return false;
  if (plate.radius !== 0) return false;
  const { from, to } = plate.camera;
  return (
    plate.camera.kind === "hold" &&
    from.zoom === NEUTRAL_FRAMING.zoom &&
    from.focusX === NEUTRAL_FRAMING.focusX &&
    from.focusY === NEUTRAL_FRAMING.focusY &&
    to.zoom === NEUTRAL_FRAMING.zoom &&
    to.focusX === NEUTRAL_FRAMING.focusX &&
    to.focusY === NEUTRAL_FRAMING.focusY
  );
}

/**
 * True when the shot list changes nothing, so export can take the fast path.
 *
 * A list of shots that are all plain full-frame holds is work someone did in
 * the editor and no work at all for the encoder.
 */
export function shotsAreIdle(shots: Shot[] | undefined): boolean {
  if (!shots || shots.length === 0) return true;
  return shots.every(isPlainShot);
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
    shotsAreIdle(c.shots) &&
    isNeutralGrade(c.grade) &&
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
