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
import { TYPEFACE_IDS } from "./typefaces";
// The preset list lives with the presets. A second copy here went stale the
// moment the library grew, and rejected names the prompt had already taught.
import { SUBTITLE_PRESET_IDS } from "./subtitles";
import { SFX_IDS } from "./sfx";

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
  "morphCut",
  "whipPan",
  "zoomBlur",
  "iris",
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

/**
 * The face, by name.
 *
 * Separate from `style` on purpose: a style says how the words should *read*
 * (a title, a badge, a quote) and a typeface says what they are *set in*. The
 * two are orthogonal — a badge in Bungee and a badge in Space Grotesk are the
 * same idea in two different pieces — and collapsing them, as this editor did
 * for a year, is why every video it made was set in the same face.
 */
const typefaceField = z.enum(TYPEFACE_IDS);

const textFields = {
  text: z.string().min(1).max(500).optional(),
  typeface: typefaceField.optional(),
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
  /**
   * A named template: a look *and* a motion, in one word.
   *
   * Preferred over `style` plus `enter`/`exit`, because a template is a
   * complete answer that someone has already made work over footage, and the
   * three fields separately are three chances to produce something that has
   * never been looked at. Anything set alongside it wins, so a template can be
   * nudged without being rebuilt.
   */
  template: z.string().trim().max(40).optional(),
  /** Overrides whatever face the template or style would have used. */
  typeface: typefaceField.optional(),
  color: colour.optional(),
  background: colour.nullable().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  uppercase: z.boolean().optional(),
  /** Tighter or looser tracking, in ems. Display faces want a little negative. */
  tracking: z.number().min(-0.15).max(0.5).optional(),
  /** An outline round the type, in fractions of the font size. 0.06-0.14 reads. */
  stroke: z.number().min(0).max(0.3).optional(),
  strokeColor: colour.nullable().optional(),
  /** Turn the element, in degrees. A sticker sits at 3-8; anything past 15 is a mistake. */
  rotation: z.number().min(-180).max(180).optional(),
  enter: animationField.optional(),
  exit: animationField.optional(),
});

export const addImageOp = z.object({
  op: z.literal("addImage"),
  /**
   * The slow move over the still.
   *
   * Defaulted rather than optional, and the default is on: a picture held
   * motionless over moving footage is the single clearest sign that a b-roll
   * insert was pasted in rather than cut in. "auto" alternates the direction
   * across a plan so three inserts in a row do not all drift the same way.
   */
  motion: z
    .enum(["auto", "none", "zoomIn", "zoomOut", "panLeft", "panRight"])
    .optional(),
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
  shape: z.enum(["rect", "ellipse", "line", "path"]).default("rect"),
  /**
   * Which mark, when `shape` is "path".
   *
   * An annotation name (arrow, circleThis, underline, check, …) or any of the
   * 1,776 Lucide icon names. Free text rather than an enum: an enum of 1,792
   * values in the schema handed to the model would be most of the prompt.
   */
  mark: z.string().trim().max(48).optional(),
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
  /**
   * Where the caption band sits. Three bands, not eleven positions.
   *
   * An element's `position` and a subtitle's `position` are different
   * vocabularies with the same field name, and the model reaches for the one it
   * has just used — "lower-third", "top-right" — perfectly reasonably. Refusing
   * that threw away the entire subtitles operation and, with it, the captions,
   * for a word whose meaning was never in doubt. So the element vocabulary is
   * accepted and folded onto the band it names.
   */
  position: z
    .union([z.enum(["top", "center", "bottom"]), z.enum(POSITIONS)])
    .transform((value) =>
      value === "top" || value === "center" || value === "bottom"
        ? value
        : value.startsWith("top") || value === "upper-third"
          ? ("top" as const)
          : value === "left" || value === "right"
            ? ("center" as const)
            : ("bottom" as const)
    )
    .optional(),
  uppercase: z.boolean().optional(),
  maxCharsPerLine: z.number().int().min(10).max(80).optional(),
  maxLines: z.number().int().min(1).max(4).optional(),
  /**
   * How much is on screen at once.
   *
   * The character budget cannot express this: a one-word cue is nowhere near
   * the line limit, so the grouper keeps going and "one word at a time"
   * silently produces ordinary captions. 1-3 is short-form; 0 lets the line
   * length decide, which is what a subtitle wants.
   */
  wordsPerCue: z.number().int().min(0).max(12).optional(),
  /** The face the captions are set in. */
  typeface: typefaceField.optional(),
  /** Stress figures, amounts and shouted words automatically. */
  emphasis: z.enum(["off", "auto"]).optional(),
  /** Words that always take the emphasis colour. */
  keywords: z.array(z.string().trim().min(1).max(40)).max(24).optional(),
  emphasisColor: colour.optional(),
  /** How much the spoken word grows, 1-1.3. Needs per-word timings. */
  activeScale: z.number().min(1).max(1.4).optional(),
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
  /** A named template. Same meaning as on addText, and preferred for the same reason. */
  template: z.string().trim().max(40).optional(),
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
  /**
   * How the camera behaves across the run.
   *
   * "steady" pushes in every time — right for a talking head, and the reason
   * every automatic edit this tool used to make moved the camera identically
   * ten times in a row. "varied" picks per moment: a new speaker gets a hard
   * cut to tighter, and after two pushes the frame opens back up so the video
   * does not simply get closer for its whole length. "energetic" is the
   * short-form treatment — snaps, no travel.
   */
  style: z.enum(["steady", "varied", "energetic"]).optional(),
});

/* ---------------------------------- grade ---------------------------------- */

/**
 * The look.
 *
 * A preset by name, optionally nudged. Named looks rather than seven sliders
 * for the same reason the camera takes preset names: asked for raw numbers a
 * model reaches for the ends of every range, and what comes back is a video
 * that has been *processed* rather than graded.
 */
export const setGradeOp = z.object({
  op: z.literal("setGrade"),
  preset: z.enum([
    "none",
    "clean",
    "warmFilm",
    "tealOrange",
    "bleach",
    "mono",
    "vivid",
    "moody",
  ]),
  /** Adjustments on top of the preset, each -1..1. */
  exposure: z.number().min(-1).max(1).optional(),
  contrast: z.number().min(-1).max(1).optional(),
  saturation: z.number().min(-1).max(1).optional(),
  temperature: z.number().min(-1).max(1).optional(),
  vignette: z.number().min(0).max(1).optional(),
  grain: z.number().min(0).max(1).optional(),
  /** A second inside one shot, to grade only that. Omit for the whole video. */
  at: seconds.optional(),
});

/* ---------------------------------- sound ---------------------------------- */

/**
 * Put music or an effect under the video.
 *
 * A *search*, not a URL. The model has no way to know what is in a catalogue
 * and no business choosing a file — the browser searches, takes the first
 * commercially-usable result, and proxies it onto our origin. What the model is
 * good for is knowing that this video wants something calm and that it should
 * start before the first word.
 */
export const addMusicOp = z.object({
  op: z.literal("addMusic"),
  /** What to look for: "calm piano", "driving drums", "whoosh". */
  query: z.string().trim().min(2).max(80),
  kind: z.enum(["music", "sfx"]).default("music"),
  /** Output-clock seconds. Music defaults to the whole video. */
  start: seconds.optional(),
  end: seconds.optional(),
  /** 0..1. Leave it alone unless asked — the defaults are chosen levels. */
  gain: z.number().min(0).max(1).optional(),
});

export const setMusicLevelOp = z.object({
  op: z.literal("setMusicLevel"),
  gain: z.number().min(0).max(1),
  /** Pull the bed down while someone is speaking. On by default. */
  duck: z.boolean().optional(),
});

/**
 * A named effect at a named moment.
 *
 * Named rather than searched, because "say what it should sound like" is a real
 * burden when the other end is a catalogue search: asked for a whoosh a model
 * writes "whoosh", but asked for the sound of a camera pushing in it writes
 * something evocative that matches nothing at all. The name resolves to a query
 * that has been checked.
 */
export const addSfxOp = z.object({
  op: z.literal("addSfx"),
  effect: z.enum(SFX_IDS),
  /** Output-clock second the effect should *land* on. Its lead-in is handled. */
  at: seconds,
  /** 0..1. Leave it out; the library's own level is tuned per effect. */
  gain: z.number().min(0).max(1).optional(),
});

/**
 * Sound the whole edit, off the edit itself.
 *
 * The placement an effect needs is frame-accurate and is not in the transcript
 * — it is in the cuts, the punch-ins and the captions, all of which the project
 * already holds. So this reads them rather than asking the model to time
 * anything.
 */
export const autoSfxOp = z.object({
  op: z.literal("autoSfx"),
  style: z.enum(["subtle", "energetic", "comedic"]).optional(),
  /** Ceiling per minute. The spacing rule still wins. 1-4. */
  perMinute: z.number().min(0.5).max(6).optional(),
});

export const removeSfxOp = z.object({
  op: z.literal("removeSfx"),
  /** Clear them all, or only the one nearest this second. */
  at: seconds.optional(),
});

export const removeMusicOp = z.object({
  op: z.literal("removeMusic"),
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
  setGradeOp,
  addMusicOp,
  setMusicLevelOp,
  removeMusicOp,
  addSfxOp,
  autoSfxOp,
  removeSfxOp,
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
