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
}

/* --------------------------------- helpers --------------------------------- */

const TEXT_OPS = new Set(["addText", "captionPhrase"]);

/** Every colour a plan puts on screen, as written. */
function coloursIn(ops: AgentOp[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    const row = op as unknown as Record<string, unknown>;
    for (const key of ["color", "background", "strokeColor", "fill"]) {
      const value = row[key];
      if (typeof value === "string") out.push(value.toLowerCase());
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

/** A video shorter than this is all beginning; density rules do not apply. */
const TOO_SHORT_TO_JUDGE_S = 12;

export function checkCraft(ops: AgentOp[], ctx: CraftContext): CraftFinding[] {
  const findings: CraftFinding[] = [];
  const minutes = Math.max(ctx.duration, 1) / 60;

  /* density */
  const placed = ops.filter((op) => TEXT_OPS.has(op.op) || op.op === "addImage" || op.op === "addShape");
  if (ctx.duration >= TOO_SHORT_TO_JUDGE_S) {
    const perMinute = placed.length / minutes;
    if (perMinute > MAX_ELEMENTS_PER_MINUTE) {
      findings.push({
        rule: "density",
        severity: "error",
        message: `${placed.length} things on screen across ${ctx.duration.toFixed(0)}s is ${perMinute.toFixed(1)} a minute. More than ${MAX_ELEMENTS_PER_MINUTE} reads as a slideshow.`,
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
