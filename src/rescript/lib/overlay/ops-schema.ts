/**
 * The vocabulary the AI is allowed to speak, and the only thing it can produce.
 *
 * The model plans; the browser executes. It never writes an asset, never
 * touches the store directly, and never emits free-form JSON that something
 * downstream has to guess at. Every operation is parsed by the schema below on
 * the server *and* re-parsed in the browser before it runs, so a malformed plan
 * is a rejected line in the log rather than a corrupted project.
 *
 * Elements are addressed by their **1-based number** exactly as they are shown
 * to the model, never by an opaque id and never by a zero-based index. That is
 * the same lesson the studio's editor agent learned: asking a model to subtract
 * one is asking it to silently edit the wrong thing.
 *
 * No "use client" here on purpose — the route handler imports this too.
 */

import { z } from "zod";

export const POSITIONS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
  "lower-third",
  "upper-third",
] as const;
export type PositionName = (typeof POSITIONS)[number];

export const SIZES = ["xs", "s", "m", "l", "xl"] as const;
export type SizeName = (typeof SIZES)[number];

export const TEXT_STYLES = [
  "plain",
  "title",
  "subtitle",
  "caption",
  "badge",
  "quote",
  "handwritten",
] as const;
export type TextStyleName = (typeof TEXT_STYLES)[number];

export const ANIMATIONS = [
  "none",
  "fade",
  "slideUp",
  "slideDown",
  "slideLeft",
  "slideRight",
  "scaleUp",
  "pop",
  "blur",
  "wipeRight",
  "typewriter",
] as const;

export const TRANSITIONS = [
  "none",
  "fadeBlack",
  "fadeWhite",
  "dissolve",
  "slideLeft",
  "slideRight",
  "slideUp",
  "slideDown",
  "zoomIn",
  "zoomOut",
  "blur",
] as const;

export const SUBTITLE_PRESET_IDS = [
  "clean",
  "broadcast",
  "shorts",
  "karaoke",
  "minimal",
] as const;

/** A hex colour or a CSS rgb/rgba string. Anything else is rejected. */
const colour = z
  .string()
  .trim()
  .regex(
    /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)|transparent|none)$/,
    "must be a hex or rgb(a) colour"
  );

const position = z.union([
  z.enum(POSITIONS),
  z.object({
    x: z.number().min(-0.2).max(1.2),
    y: z.number().min(-0.2).max(1.2),
  }),
]);

const seconds = z.number().min(0).max(24 * 3600);

/** 1-based element number, as shown to the model. */
const elementNumber = z.number().int().min(1).max(200);

const animationField = z.enum(ANIMATIONS);

const textFields = {
  text: z.string().min(1).max(500).optional(),
  color: colour.optional(),
  background: colour.nullable().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  size: z.enum(SIZES).optional(),
  style: z.enum(TEXT_STYLES).optional(),
  uppercase: z.boolean().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
};

export const addTextOp = z.object({
  op: z.literal("addText"),
  text: z.string().min(1).max(500),
  start: seconds.optional(),
  end: seconds.optional(),
  /** Convenience alternative to `end`. */
  duration: z.number().min(0.1).max(600).optional(),
  position: position.optional(),
  size: z.enum(SIZES).optional(),
  style: z.enum(TEXT_STYLES).optional(),
  color: colour.optional(),
  background: colour.nullable().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  uppercase: z.boolean().optional(),
  enter: animationField.optional(),
  exit: animationField.optional(),
});

export const addImageOp = z.object({
  op: z.literal("addImage"),
  /** Artwork to generate. Mutually exclusive with `query`. */
  prompt: z.string().min(2).max(400).optional(),
  /** A real photograph to search for. */
  query: z.string().min(2).max(200).optional(),
  start: seconds.optional(),
  end: seconds.optional(),
  duration: z.number().min(0.1).max(600).optional(),
  position: position.optional(),
  size: z.enum(SIZES).optional(),
  enter: animationField.optional(),
  exit: animationField.optional(),
});

export const addShapeOp = z.object({
  op: z.literal("addShape"),
  shape: z.enum(["rect", "ellipse", "line"]).default("rect"),
  start: seconds.optional(),
  end: seconds.optional(),
  duration: z.number().min(0.1).max(600).optional(),
  position: position.optional(),
  size: z.enum(SIZES).optional(),
  fill: colour.nullable().optional(),
  strokeColor: colour.nullable().optional(),
});

export const updateElementOp = z.object({
  op: z.literal("updateElement"),
  element: elementNumber,
  ...textFields,
  opacity: z.number().min(0).max(1).optional(),
  rotation: z.number().min(-180).max(180).optional(),
});

export const moveElementOp = z.object({
  op: z.literal("moveElement"),
  element: elementNumber,
  position,
});

export const resizeElementOp = z.object({
  op: z.literal("resizeElement"),
  element: elementNumber,
  size: z.enum(SIZES),
});

export const timeElementOp = z.object({
  op: z.literal("timeElement"),
  element: elementNumber,
  start: seconds.optional(),
  end: seconds.optional(),
  duration: z.number().min(0.1).max(600).optional(),
});

export const animateElementOp = z.object({
  op: z.literal("animateElement"),
  element: elementNumber,
  enter: animationField.optional(),
  exit: animationField.optional(),
  duration: z.number().min(0.05).max(5).optional(),
});

export const removeElementOp = z.object({
  op: z.literal("removeElement"),
  /** `"all"` clears the whole overlay layer. */
  element: z.union([elementNumber, z.literal("all")]),
});

export const setTransitionOp = z.object({
  op: z.literal("setTransition"),
  /** 1-based boundary: 1 is between clip 1 and clip 2. */
  between: z.number().int().min(1).max(500),
  kind: z.enum(TRANSITIONS),
  duration: z.number().min(0.05).max(4).optional(),
});

export const setAllTransitionsOp = z.object({
  op: z.literal("setAllTransitions"),
  kind: z.enum(TRANSITIONS),
  duration: z.number().min(0.05).max(4).optional(),
});

export const subtitlesOp = z.object({
  op: z.literal("subtitles"),
  action: z.enum(["on", "off", "regenerate", "style"]),
  preset: z.enum(SUBTITLE_PRESET_IDS).optional(),
  color: colour.optional(),
  highlight: colour.optional(),
  background: colour.nullable().optional(),
  size: z.enum(SIZES).optional(),
  position: z.enum(["top", "center", "bottom"]).optional(),
  uppercase: z.boolean().optional(),
  maxCharsPerLine: z.number().int().min(10).max(80).optional(),
  maxLines: z.number().int().min(1).max(4).optional(),
});

export const removeFillersOp = z.object({ op: z.literal("removeFillers") });

export const removeSilencesOp = z.object({
  op: z.literal("removeSilences"),
  minDuration: z.number().min(0.1).max(10).optional(),
});

export const deletePhraseOp = z.object({
  op: z.literal("deletePhrase"),
  text: z.string().min(1).max(200),
  /** Which occurrence, 1-based. Omitted means every one. */
  occurrence: z.number().int().min(1).max(200).optional(),
});

/**
 * Cutting by time, in the finished video's clock.
 *
 * The transcript the model reads is stamped in that same clock, so "cut the bit
 * where they lose their thread, 42s to 55s" is expressible directly. The
 * browser maps these back onto the source — one output span can cover several
 * source spans once earlier material is already gone.
 */
export const deleteRangeOp = z.object({
  op: z.literal("deleteRange"),
  from: seconds,
  to: seconds,
});

/**
 * Keep only these spans and cut everything else. This is how a highlight reel
 * or a short gets made in one step rather than as twenty `deleteRange`s.
 */
export const keepOnlyOp = z.object({
  op: z.literal("keepOnly"),
  ranges: z
    .array(z.object({ from: seconds, to: seconds }))
    .min(1)
    .max(60),
});

/**
 * A scene boundary. Clips are what transitions sit between, so a video that was
 * never cut has nowhere to put one — splitting is how you make somewhere.
 */
export const splitAtOp = z.object({
  op: z.literal("splitAt"),
  at: seconds,
});

/**
 * Put words on screen exactly when they are spoken.
 *
 * The difference from `addText` is that this one is *found*, not timed: the
 * browser locates the phrase in the transcript and takes the start and end from
 * the word timings that are already there. That is the only way kinetic
 * captions land on the beat — a model asked to guess "roughly when do they say
 * this" is wrong by a quarter of a second, which reads as broken.
 */
export const captionPhraseOp = z.object({
  op: z.literal("captionPhrase"),
  /** Words to find in the transcript. Matched loosely on case and punctuation. */
  phrase: z.string().min(1).max(200),
  /** What to show. Defaults to the phrase itself. */
  text: z.string().min(1).max(200).optional(),
  /** Which occurrence, 1-based. Omitted means the first. */
  occurrence: z.number().int().min(1).max(200).optional(),
  position: position.optional(),
  size: z.enum(SIZES).optional(),
  style: z.enum(TEXT_STYLES).optional(),
  color: colour.optional(),
  background: colour.nullable().optional(),
  enter: animationField.optional(),
  exit: animationField.optional(),
  /** Seconds to hold after the phrase finishes. */
  hold: z.number().min(0).max(6).optional(),
});

export const FRAME_ASPECT_IDS = [
  "source",
  "16:9",
  "9:16",
  "1:1",
  "4:5",
  "4:3",
  "2.39:1",
] as const;

/**
 * The shape of the finished video.
 *
 * "Make this a Short" is a request about the frame before it is a request about
 * captions, and until this op existed the model could style a vertical edit
 * without being able to make one — it would answer with Shorts subtitles burned
 * into a widescreen file.
 */
export const setFrameOp = z.object({
  op: z.literal("setFrame"),
  aspect: z.enum(FRAME_ASPECT_IDS),
  /** "cover" crops to fill; "contain" fits the whole picture in. */
  fit: z.enum(["cover", "contain"]).optional(),
  zoom: z.number().min(1).max(3).optional(),
  /** The point of the source held at the centre of the frame, 0..1. */
  focusX: z.number().min(0).max(1).optional(),
  focusY: z.number().min(0).max(1).optional(),
  background: z.enum(["black", "blur", "white"]).optional(),
});

/* ---------------------------------- shots ---------------------------------- */

/**
 * How the frame is filled over a stretch of the finished video.
 *
 * A camera move is expressed as a preset rather than as two framings, because
 * "punch in on that line" is the instruction anyone actually gives, and a model
 * asked for `from`/`to` pairs invents zoom levels that read as a mistake. The
 * preset is turned into the framing pair by `cameraFor`, in one place, against
 * numbers that were chosen once.
 */
export const cameraKinds = [
  "hold",
  "punchIn",
  "punchOut",
  "push",
  "driftLeft",
  "driftRight",
  "kenBurns",
  "snap",
] as const;

export const shotLayouts = [
  "full",
  "splitLeft",
  "splitRight",
  "splitTop",
  "splitBottom",
  "stack",
  "pip",
  "card",
  "grid",
] as const;

/** What goes in one region. Kept flat: a nested union is where plans go wrong. */
const plateSpec = z.object({
  /** Region index. 0 is the primary — the largest, or the one behind a bubble. */
  slot: z.number().int().min(0).max(3),
  /**
   * `primary` is the footage. `selfCrop` is the footage again, framed
   * differently — the cutaway a real editor reaches for most, and the only one
   * that needs no provider and no upload.
   */
  source: z.enum(["primary", "selfCrop", "solid"]).optional(),
  color: colour.optional(),
  fit: z.enum(["cover", "contain"]).optional(),
  camera: z.enum(cameraKinds).optional(),
  /** How far the move travels. 1 is the preset's own amount. */
  amount: z.number().min(0).max(2).optional(),
  /** What the move centres on, 0..1 of the source. */
  focusX: z.number().min(0).max(1).optional(),
  focusY: z.number().min(0).max(1).optional(),
  radius: z.number().min(0).max(0.5).optional(),
});

export const addShotOp = z.object({
  op: z.literal("addShot"),
  /** Seconds on the finished video's own clock. */
  start: seconds,
  end: seconds,
  layout: z.enum(shotLayouts),
  plates: z.array(plateSpec).min(1).max(4).optional(),
});

export const setCameraOp = z.object({
  op: z.literal("setCamera"),
  start: seconds,
  end: seconds,
  camera: z.enum(cameraKinds),
  amount: z.number().min(0).max(2).optional(),
  focusX: z.number().min(0).max(1).optional(),
  focusY: z.number().min(0).max(1).optional(),
});

export const removeShotOp = z.object({
  op: z.literal("removeShot"),
  /** Any second inside the shot to remove. */
  at: seconds,
});

/**
 * Place punch-ins automatically, on the beats the footage actually has.
 *
 * One operation rather than twenty `addShot`s: a model asked to place its own
 * zooms spends its whole output budget on them and spaces them by eye, and the
 * spacing is the part that decides whether an edit reads as produced or as
 * restless. The rules live in `emphasis.ts` and are the same ones the manual
 * button uses.
 */
export const autoPunchInsOp = z.object({
  op: z.literal("autoPunchIns"),
  /** Roughly how many per minute. The placer still enforces its own spacing. */
  perMinute: z.number().min(0.5).max(8).optional(),
  amount: z.number().min(0).max(2).optional(),
});

export const agentOpSchema = z.discriminatedUnion("op", [
  addTextOp,
  addImageOp,
  addShapeOp,
  updateElementOp,
  moveElementOp,
  resizeElementOp,
  timeElementOp,
  animateElementOp,
  removeElementOp,
  setTransitionOp,
  setAllTransitionsOp,
  subtitlesOp,
  removeFillersOp,
  removeSilencesOp,
  deletePhraseOp,
  deleteRangeOp,
  keepOnlyOp,
  splitAtOp,
  captionPhraseOp,
  setFrameOp,
  addShotOp,
  setCameraOp,
  removeShotOp,
  autoPunchInsOp,
]);

export type AgentOp = z.infer<typeof agentOpSchema>;

/**
 * A named group of operations, so a proposal can be read — and accepted or
 * declined — a step at a time rather than as one opaque blob.
 */
export const agentStepSchema = z.object({
  title: z.string().min(1).max(80),
  detail: z.string().max(300).default(""),
  ops: z.array(z.unknown()).max(20).default([]),
});

export const agentPlanSchema = z.object({
  /** Deep reasoning step for the AI to analyze and plan out the highly-produced edit before choosing operations. */
  reasoning: z.string().optional(),
  summary: z.string().max(400).default(""),
  /** What the model noticed in the footage. Proposal mode only. */
  findings: z.array(z.string().max(240)).max(10).default([]),
  /** Grouped work, for proposal mode. */
  steps: z.array(agentStepSchema).max(10).default([]),
  /** Flat operations, for direct execution. */
  ops: z.array(z.unknown()).max(40).default([]),
});

/**
 * Validate operations one at a time.
 *
 * One bad operation must not lose the other nine: the good ones run and the
 * rejects are reported verbatim in the log, which is also how a prompt-shaped
 * problem becomes visible rather than mysterious.
 */
export function siftOps(raw: unknown[]): {
  ops: AgentOp[];
  rejected: string[];
} {
  const ops: AgentOp[] = [];
  const rejected: string[] = [];

  for (const entry of raw) {
    const parsed = agentOpSchema.safeParse(entry);
    if (parsed.success) {
      ops.push(parsed.data);
      continue;
    }
    const name =
      entry && typeof entry === "object" && "op" in entry
        ? String((entry as { op: unknown }).op)
        : "operation";
    const issue = parsed.error.issues[0];
    rejected.push(
      `${name}: ${[issue?.path.join("."), issue?.message].filter(Boolean).join(" ") || "not understood"}`
    );
  }

  return { ops, rejected };
}
