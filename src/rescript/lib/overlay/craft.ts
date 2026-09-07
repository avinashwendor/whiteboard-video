/**
 * The house style, as something a machine can check.
 *
 * The agent's prompt already carries a style guide — *Space, Restraint,
 * Colour, Contrast, Timing, Cuts, Hierarchy* — written as prose, which means it
 * is advice the model may or may not have taken and nobody can tell without
 * watching the output. That was survivable when the agent could place captions
 * and transitions. It stopped being survivable the moment it was given a
 * template library, 1,776 icons, seven grades and a box of new transitions:
 * a bigger toy box makes worse videos by default, and the only thing that
 * scales against that is a rule you can run.
 *
 * So these are the parts of the style guide that are objectively checkable,
 * expressed against a plan rather than against a finished frame. They are used
 * two ways: by the eval harness to score a prompt change, and — because they
 * are pure functions of a plan — they are what a review pass would run first,
 * before spending a vision call on anything a rule already caught.
 *
 * What is deliberately NOT here: whether a caption is any good, whether a cut
 * lands well, whether the accent suits the footage. Those are judgements. A
 * rule that pretends to make them would be worse than no rule, because it would
 * be trusted.
 */

import type { AgentOp } from "./ops-schema";
import { textTemplate } from "./templates";
import { typefaceOf } from "./typefaces";

export interface CraftFinding {
  /** Which rule. Stable, so a run can be diffed against the last one. */
  rule: string;
  /** What is wrong, in the voice the agent's own log uses. */
  message: string;
  /**
   * `error` is a rule the style guide states outright. `warning` is a smell:
   * usually wrong, sometimes deliberate, and never worth failing a run over.
   */
  severity: "error" | "warning";
}

export interface CraftContext {
  /** Length of the finished video, in output seconds. */
  duration: number;
  /**
   * Frame width ÷ height, when it is known.
   *
   * Density is not one number. A 9:16 cut carries genuinely more on screen than
   * a widescreen one and always has: the format is watched at arm's length with
   * the sound off, the captions *are* the content, and a Short with one title
   * and three captions in it reads as unfinished rather than as restrained. So
   * the ceiling moves with the shape. It is not a loophole — the rule that a
   * widescreen talking head is a slideshow at six things a minute is unchanged.
   */
  aspect?: number;
}

/* --------------------------------- helpers --------------------------------- */

const TEXT_OPS = new Set(["addText", "captionPhrase"]);

/**
 * Is this string actually a colour?
 *
 * `setFrame` has a `background` field too, and its value is usually the word
 * "blur" — the letterbox treatment, not an accent. Counting it made every
 * vertical reframe look like a plan with a second accent colour in it, and the
 * model's fix for that finding was to remove the colour it had chosen
 * correctly. A field name is not a type.
 */
function looksLikeColour(value: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\(/i.test(value);
}

/** Every colour a plan puts on screen, as written. */
function coloursIn(ops: AgentOp[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    // The frame's background is a fill treatment, not a colour choice, and it
    // is never an accent even when it is a colour.
    if (op.op === "setFrame") continue;
    const row = op as unknown as Record<string, unknown>;
    // `highlight` and `emphasisColor` are accents in every sense that matters —
    // they are the colours a caption pops in — and leaving them out let a plan
    // introduce a third accent through the subtitle track while passing the
    // one-accent rule.
    for (const key of [
      "color",
      "background",
      "strokeColor",
      "fill",
      "highlight",
      "emphasisColor",
    ]) {
      const value = row[key];
      if (typeof value === "string" && looksLikeColour(value)) {
        out.push(value.toLowerCase());
      }
    }
  }
  return out;
}

/**
 * Colours that carry no opinion.
 *
 * White, black, greys and translucent scrims are structure rather than accent —
 * counting them would make every plan with a caption and a scrim look like it
 * had two accents, and the rule would be ignored.
 */
function isNeutral(colour: string): boolean {
  if (/^rgba?\(\s*0\s*,\s*0\s*,\s*0/.test(colour)) return true;
  if (/^rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(colour)) return true;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(colour);
  if (!hex) return false;
  const full =
    hex[1].length === 3
      ? hex[1].split("").map((c) => c + c).join("")
      : hex[1];
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Near-grey: the channels agree, so there is no hue to be an accent.
  return Math.max(r, g, b) - Math.min(r, g, b) < 24;
}

/**
 * Which face a template is set in, by id.
 *
 * A template carries a family list rather than a typeface id — it is what the
 * renderer needs — so this walks it back through the catalogue. Anything that
 * does not resolve is treated as no opinion rather than as a violation: a
 * template with a bare CSS stack in it is old, not wrong.
 */
function templateFace(id: string): string | null {
  return typefaceOf(textTemplate(id)?.style.fontFamily) ?? null;
}

/* ---------------------------------- rules ---------------------------------- */

/**
 * How many things may be on screen per minute before it is a slideshow.
 *
 * Straight out of the prompt's own words: "Across a two-minute video: one
 * title, three or four kinetic captions, two or three pictures. More than that
 * is a slideshow, and it will be rejected." That is roughly four a minute, so
 * five is the point at which the rule speaks.
 */
const MAX_ELEMENTS_PER_MINUTE = 5;

/**
 * The same ceiling for a vertical cut.
 *
 * Nine, not five. Short-form is a caption-led format: the type carries the
 * piece, a viewer is scrubbing past at speed, and the density that reads as a
 * slideshow at 16:9 reads as ordinary at 9:16. Nine a minute is roughly a
 * title, five kinetic captions and a picture across a forty-five second Short,
 * which is what a good one actually contains.
 */
const MAX_ELEMENTS_PER_MINUTE_VERTICAL = 9;

/** A video shorter than this is all beginning; density rules do not apply. */
const TOO_SHORT_TO_JUDGE_S = 12;

export function checkCraft(ops: AgentOp[], ctx: CraftContext): CraftFinding[] {
  const findings: CraftFinding[] = [];
  const minutes = Math.max(ctx.duration, 1) / 60;

  /* density */
  const placed = ops.filter((op) => TEXT_OPS.has(op.op) || op.op === "addImage" || op.op === "addShape");
  // A plan that reframes to vertical is judged as a vertical cut, whatever the
  // footage arrived as — the ceiling is a property of the deliverable.
  const goesVertical = ops.some(
    (op) => op.op === "setFrame" && (op.aspect === "9:16" || op.aspect === "4:5")
  );
  const vertical = goesVertical || (ctx.aspect !== undefined && ctx.aspect < 1);
  const ceiling = vertical
    ? MAX_ELEMENTS_PER_MINUTE_VERTICAL
    : MAX_ELEMENTS_PER_MINUTE;

  if (ctx.duration >= TOO_SHORT_TO_JUDGE_S) {
    const perMinute = placed.length / minutes;
    if (perMinute > ceiling) {
      findings.push({
        rule: "density",
        severity: "error",
        message: `${placed.length} things on screen across ${ctx.duration.toFixed(0)}s is ${perMinute.toFixed(1)} a minute. More than ${ceiling} reads as a slideshow${vertical ? " even in a vertical cut" : ""}.`,
      });
    }
  }

  /* one accent */
  const accents = new Set(coloursIn(ops).filter((c) => !isNeutral(c)));
  if (accents.size > 1) {
    findings.push({
      rule: "accent",
      severity: "error",
      message: `${accents.size} accent colours (${[...accents].join(", ")}). Pick one and use it everywhere.`,
    });
  }

  /* one transition family */
  const kinds = new Set<string>();
  for (const op of ops) {
    if (op.op === "setTransition" || op.op === "setAllTransitions") {
      if (op.kind !== "none") kinds.add(op.kind);
    }
  }
  if (kinds.size > 2) {
    findings.push({
      rule: "transitions",
      severity: "error",
      message: `${kinds.size} different transitions (${[...kinds].join(", ")}). One video, one kind of cut.`,
    });
  }

  /* one look */
  const grades = ops.filter((op) => op.op === "setGrade" && op.at === undefined);
  if (grades.length > 1) {
    findings.push({
      rule: "grade",
      severity: "error",
      message: `The whole video is graded ${grades.length} times; only the last would survive.`,
    });
  }

  /* zoom restraint */
  const zooms = ops.filter((op) => op.op === "setCamera" || op.op === "addShot");
  const autos = ops.filter((op) => op.op === "autoPunchIns");
  if (ctx.duration >= TOO_SHORT_TO_JUDGE_S && zooms.length / minutes > 4) {
    findings.push({
      rule: "camera",
      severity: "warning",
      message: `${zooms.length} shots placed by hand over ${ctx.duration.toFixed(0)}s. autoPunchIns spaces them properly in one call.`,
    });
  }
  if (autos.length > 0 && zooms.length > 0) {
    findings.push({
      rule: "camera",
      severity: "warning",
      message:
        "autoPunchIns places its own shots and spaces them; hand-placed ones alongside it will land on top of them.",
    });
  }

  /* effects earn their place */
  const showy = ops.filter(
    (op) =>
      (op.op === "setTransition" || op.op === "setAllTransitions") &&
      (op.kind === "iris" || op.kind === "whipPan" || op.kind === "zoomBlur")
  );
  if (showy.length > 0 && kinds.size > 1) {
    findings.push({
      rule: "effects",
      severity: "warning",
      message: "An energetic transition mixed with others reads as an accident rather than a choice.",
    });
  }

  /* one voice */
  //
  // The library grew from four families to twelve, and the failure mode of
  // handing a model twelve typefaces is not that it picks a bad one — it is
  // that it picks six, one per caption, and the video stops having a look at
  // all. Faces arrive two ways, named outright or inherited from a template,
  // and both are counted: a plan that mixes `boldSlam` with `magazine` has
  // chosen Anton and Playfair whether or not it said so.
  //
  // The neutral sans and the monospace do not count against it. They mean
  // something specific — this is not meant to be noticed, this is typed — and
  // a rule that made "a title and a code card" a violation would be wrong.
  const voices = new Set<string>();
  for (const op of ops) {
    const row = op as unknown as Record<string, unknown>;
    const named = typeof row.typeface === "string" ? row.typeface : null;
    const fromTemplate =
      typeof row.template === "string" ? templateFace(row.template) : null;
    const face = named ?? fromTemplate;
    if (face && face !== "sans" && face !== "mono") voices.add(face);
  }
  if (voices.size > 2) {
    findings.push({
      rule: "typeface",
      severity: "error",
      message: `${voices.size} display typefaces (${[...voices].join(", ")}). One video, one voice — two at the very most.`,
    });
  }

  /* cuts before the times that depend on them */
  const CUTTING = new Set([
    "removeFillers",
    "removeSilences",
    "deletePhrase",
    "deleteRange",
    "keepOnly",
    "splitAt",
  ]);
  const lastCut = ops.map((op) => op.op).reduce((last, op, i) => (CUTTING.has(op) ? i : last), -1);
  const firstTimed = ops.findIndex(
    (op) => "start" in op && typeof (op as { start?: number }).start === "number"
  );
  if (lastCut >= 0 && firstTimed >= 0 && firstTimed < lastCut) {
    findings.push({
      rule: "order",
      severity: "error",
      message:
        "A timed operation comes before a cut. Cuts change the clock, so everything timed against it has to follow.",
    });
  }

  return findings;
}

/** A single number for a plan, 0..1. Errors cost more than warnings. */
export function craftScore(findings: CraftFinding[]): number {
  let penalty = 0;
  for (const finding of findings) {
    penalty += finding.severity === "error" ? 0.25 : 0.08;
  }
  return Math.max(0, 1 - penalty);
}
