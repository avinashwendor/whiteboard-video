/**
 * The look: exposure, contrast, colour, and the two things a lens does.
 *
 * There was no grading here at all — grep the composition layer for `lut`,
 * `saturate` or `vignette` and the only hits were CSS class names. Meanwhile
 * `src/lib/video/grade.ts` holds a working grain-and-vignette pass with **zero
 * call sites**: it was written for the generated-video engine and then
 * deliberately switched off there, on the grounds that a flat printed frame
 * that needs grain to look finished was not composed properly. That reasoning
 * is right about drawn frames and wrong about footage, which was shot through
 * an actual lens.
 *
 * The noise-tile trick below is adapted from it rather than imported: the
 * studio and the editor share no code today, in either direction, and two
 * drawing helpers are not worth being the first exception to that.
 *
 * Everything is a pure function of (grade, size, time). No `Math.random()`, no
 * accumulating state — so an exported frame is identical to the previewed one,
 * which is the property the whole renderer is built on.
 */

import type { FrameSize } from "./render";

/**
 * A look, as adjustments rather than as a curve.
 *
 * Every field is centred on zero and runs -1..1 (or 0..1 where only one
 * direction is meaningful), so `NEUTRAL_GRADE` is all zeroes and "is anything
 * set?" is a question that can be answered without a lookup table. The ranges
 * are deliberately narrow: these are finishing adjustments, and a saturation
 * slider that can reach greyscale in one direction and neon in the other is a
 * slider nobody can land in the middle of.
 */
export interface GradeSpec {
  /** Brightness. -1 is about two stops down, 1 about a stop and a half up. */
  exposure: number;
  contrast: number;
  saturation: number;
  /** Warm at 1, cool at -1. Painted as a tint, not a hue rotation. */
  temperature: number;
  /** Green/magenta, the other half of a white balance. */
  tint: number;
  /** Lens falloff. 0 is off. */
  vignette: number;
  /** Film grain. 0 is off. */
  grain: number;
}

export const NEUTRAL_GRADE: GradeSpec = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  vignette: 0,
  grain: 0,
};

export function isNeutralGrade(grade: GradeSpec | null | undefined): boolean {
  if (!grade) return true;
  return (
    grade.exposure === 0 &&
    grade.contrast === 0 &&
    grade.saturation === 0 &&
    grade.temperature === 0 &&
    grade.tint === 0 &&
    grade.vignette === 0 &&
    grade.grain === 0
  );
}

/** Fill in anything a saved or partial grade is missing. */
export function withGradeDefaults(grade?: Partial<GradeSpec> | null): GradeSpec {
  return { ...NEUTRAL_GRADE, ...(grade ?? {}) };
}

/* --------------------------------- filters --------------------------------- */

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * The CSS filter chain for a grade's tonal half.
 *
 * Canvas 2D takes the same filter functions CSS does, and the codebase already
 * relies on that — the whiteboard renderer treats its photographs with
 * `saturate(0.78) contrast(1.04)`. So the tonal work costs one string and no
 * new rendering path, which means the preview and the export cannot disagree
 * about it: they are the same call.
 *
 * Returns an empty string when there is nothing to do, so the caller can skip
 * touching `ctx.filter` at all rather than setting it to `"none"`.
 */
export function gradeFilter(grade: GradeSpec | null | undefined): string {
  if (!grade) return "";
  const parts: string[] = [];

  // Multiplicative, and asymmetric on purpose: an equal step down reads as a
  // bigger change than an equal step up, because the eye is not linear either.
  if (grade.exposure !== 0) {
    const e = clamp(grade.exposure, -1, 1);
    parts.push(`brightness(${(1 + e * (e > 0 ? 0.45 : 0.55)).toFixed(3)})`);
  }
  if (grade.contrast !== 0) {
    const c = clamp(grade.contrast, -1, 1);
    parts.push(`contrast(${(1 + c * 0.4).toFixed(3)})`);
  }
  if (grade.saturation !== 0) {
    const s = clamp(grade.saturation, -1, 1);
    // Full desaturation is reachable; the other end stops well short of neon.
    parts.push(`saturate(${(1 + s * (s > 0 ? 0.6 : 1)).toFixed(3)})`);
  }

  return parts.join(" ");
}

/**
 * Draw something with the grade applied, preserving whatever filter is already set.
 *
 * Composed rather than replaced because a transition may already have put a
 * blur on the context, and a grade that silently cancelled it would turn a
 * blur-through into a hard cut — the kind of bug that only shows up on one
 * frame in the middle of a transition and is never reproduced on demand.
 */
export function withGrade(
  ctx: CanvasRenderingContext2D,
  grade: GradeSpec | null | undefined,
  draw: () => void
) {
  const filter = gradeFilter(grade);
  if (!filter) {
    draw();
    return;
  }
  const previous = ctx.filter;
  ctx.filter =
    previous && previous !== "none" ? `${previous} ${filter}` : filter;
  draw();
  ctx.filter = previous;
}

/* -------------------------------- overlays --------------------------------- */

/** Deterministic value noise in 0..1. */
function hash(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const TILE = 160;
let grainTile: HTMLCanvasElement | null = null;
let grainPattern: CanvasPattern | null = null;

/** One noise tile, reused. Regenerating it per frame would crawl. */
function tile(): HTMLCanvasElement | null {
  if (grainTile) return grainTile;
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const image = ctx.createImageData(TILE, TILE);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.floor(hash(i * 0.017) * 255);
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  grainTile = canvas;
  return canvas;
}

/**
 * Film grain.
 *
 * The tile is offset at about twelve steps a second rather than every frame,
 * which is what film actually does — grain that moves on every frame reads as
 * video noise, which is the opposite of the intent.
 */
function drawGrain(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  strength: number,
  t: number
) {
  const source = tile();
  if (!source) return;
  if (!grainPattern) grainPattern = ctx.createPattern(source, "repeat");
  if (!grainPattern) return;

  const step = Math.floor(t * 12);
  ctx.save();
  ctx.globalAlpha = clamp(strength, 0, 1) * 0.12;
  ctx.globalCompositeOperation = "overlay";
  ctx.translate(hash(step) * TILE - TILE, hash(step + 91) * TILE - TILE);
  ctx.fillStyle = grainPattern;
  ctx.fillRect(0, 0, size.width + TILE * 2, size.height + TILE * 2);
  ctx.restore();
}

/** Lens falloff: nothing in the centre, straight black at the corners. */
function drawVignette(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  strength: number
) {
  const s = clamp(strength, 0, 1) * 0.55;
  const gradient = ctx.createRadialGradient(
    size.width / 2,
    size.height * 0.46,
    size.height * 0.28,
    size.width / 2,
    size.height / 2,
    size.width * 0.78
  );
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.65, `rgba(0,0,0,${(s * 0.35).toFixed(3)})`);
  gradient.addColorStop(1, `rgba(0,0,0,${s.toFixed(3)})`);
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.restore();
}

/**
 * White balance, as a tint over the picture.
 *
 * Not `hue-rotate`, which turns the whole wheel and sends skin green on the way
 * to making a frame cooler. A soft-light fill leaves the neutrals alone and
 * pushes the highlights and shadows the way a temperature control actually
 * does.
 */
function drawTint(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  temperature: number,
  tint: number
) {
  const warm = clamp(temperature, -1, 1);
  const green = clamp(tint, -1, 1);
  if (warm === 0 && green === 0) return;

  const r = 128 + warm * 90 + green * 20;
  const g = 128 + green * -60;
  const b = 128 - warm * 90 + green * 20;

  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = Math.min(1, Math.max(Math.abs(warm), Math.abs(green)) * 0.85);
  ctx.fillStyle = `rgb(${Math.round(clamp(r, 0, 255))},${Math.round(
    clamp(g, 0, 255)
  )},${Math.round(clamp(b, 0, 255))})`;
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.restore();
}

/**
 * The half of a grade that is painted rather than filtered.
 *
 * Called after the footage and **before** the overlay layer, so the grade
 * treats the picture and not the captions. You do not grade your own titles:
 * text that goes muddy under a look someone applied to the footage is a bug
 * they will spend an hour failing to find in the text panel.
 */
export function paintGrade(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  grade: GradeSpec | null | undefined,
  t: number
) {
  if (!grade) return;
  drawTint(ctx, size, grade.temperature, grade.tint);
  if (grade.vignette > 0) drawVignette(ctx, size, grade.vignette);
  if (grade.grain > 0) drawGrain(ctx, size, grade.grain, t);
}

/* --------------------------------- presets --------------------------------- */

export interface GradePreset {
  id: string;
  label: string;
  grade: GradeSpec;
}

/**
 * Seven looks.
 *
 * Restrained on purpose. The point of a preset list is that every entry is
 * usable on a talking head without further tuning — a "cinematic" preset that
 * needs three sliders walked back afterwards is not a preset, it is a starting
 * argument.
 */
export const GRADE_PRESETS: GradePreset[] = [
  { id: "none", label: "None", grade: { ...NEUTRAL_GRADE } },
  {
    id: "clean",
    label: "Clean",
    grade: { ...NEUTRAL_GRADE, contrast: 0.15, saturation: 0.1 },
  },
  {
    id: "warmFilm",
    label: "Warm film",
    grade: {
      ...NEUTRAL_GRADE,
      exposure: 0.05,
      contrast: 0.2,
      saturation: -0.1,
      temperature: 0.35,
      vignette: 0.3,
      grain: 0.35,
    },
  },
  {
    id: "tealOrange",
    label: "Teal & orange",
    grade: {
      ...NEUTRAL_GRADE,
      contrast: 0.3,
      saturation: 0.25,
      temperature: 0.25,
      tint: -0.15,
      vignette: 0.25,
    },
  },
  {
    id: "bleach",
    label: "Bleach",
    grade: { ...NEUTRAL_GRADE, exposure: 0.1, contrast: 0.45, saturation: -0.55 },
  },
  {
    id: "mono",
    label: "Mono",
    grade: { ...NEUTRAL_GRADE, contrast: 0.3, saturation: -1, grain: 0.4 },
  },
  {
    id: "vivid",
    label: "Vivid",
    grade: { ...NEUTRAL_GRADE, exposure: 0.08, contrast: 0.25, saturation: 0.5 },
  },
  {
    id: "moody",
    label: "Moody",
    grade: {
      ...NEUTRAL_GRADE,
      exposure: -0.15,
      contrast: 0.3,
      saturation: -0.2,
      temperature: -0.3,
      vignette: 0.45,
    },
  },
];

export const GRADE_PRESET_IDS = GRADE_PRESETS.map((p) => p.id);

export function gradePreset(id: string): GradeSpec | null {
  return GRADE_PRESETS.find((p) => p.id === id)?.grade ?? null;
}

/* ------------------------------ reading the look ---------------------------- */

/**
 * What this footage needs, from what it measurably is.
 *
 * The agent has been choosing a look off the transcript, which means it has
 * been choosing one off the *subject* — "a cooking video, so warmFilm" — with
 * no idea whether the footage is already warm, already contrasty, or two stops
 * under. That is how you get a warm grade on footage shot under tungsten and a
 * bleach pass on something already flat.
 *
 * Now that `vision.ts` measures brightness, contrast and the palette, the
 * corrective half of a grade is arithmetic. This does that half and stops
 * there: it says *this footage is dark and flat, so lift it and add contrast*,
 * and it deliberately does not have an opinion about whether the piece wants to
 * feel warm or cold. That is the half that belongs to whoever is making it.
 *
 * Reads only the derived figures, so it works server-side on the wire form.
 */
export interface GradeReading {
  /** The preset to start from. */
  preset: string;
  /** Nudges to apply over it, already clamped to sane amounts. */
  adjust: Partial<GradeSpec>;
  /** One clause per reason, in the order they were noticed. */
  reasons: string[];
}

export function suggestGrade(
  frames: { brightness: number; contrast: number; colors: string[] }[]
): GradeReading | null {
  if (!frames.length) return null;

  const n = frames.length;
  const brightness = frames.reduce((a, f) => a + f.brightness, 0) / n;
  const contrast = frames.reduce((a, f) => a + f.contrast, 0) / n;

  // Warmth, from the dominant colours: how far red runs ahead of blue, as a
  // fraction of the channel range. Crude and adequate — the question is only
  // "is this footage already warm", not "what is its colour temperature".
  let warmth = 0;
  let counted = 0;
  for (const frame of frames) {
    for (const colour of frame.colors.slice(0, 3)) {
      const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
      if (!match) continue;
      const r = parseInt(match[1], 16);
      const b = parseInt(match[3], 16);
      warmth += (r - b) / 255;
      counted += 1;
    }
  }
  if (counted) warmth /= counted;

  const reasons: string[] = [];
  const adjust: Partial<GradeSpec> = {};

  // Exposure. The thresholds are wide on purpose: a grade that corrects every
  // frame that is not exactly mid-grey is a grade that flattens everything.
  if (brightness < 0.28) {
    adjust.exposure = Math.min(0.25, (0.34 - brightness) * 1.2);
    reasons.push(`under-exposed at ${brightness.toFixed(2)} — lift it`);
  } else if (brightness > 0.68) {
    adjust.exposure = Math.max(-0.2, (0.62 - brightness) * 1.1);
    reasons.push(`hot at ${brightness.toFixed(2)} — pull it down`);
  }

  // Contrast. Flat footage is the single most common thing wrong with a
  // phone-shot talking head, and the cheapest thing to fix.
  if (contrast < 0.2) {
    adjust.contrast = Math.min(0.3, (0.28 - contrast) * 1.6);
    reasons.push(`flat at ${contrast.toFixed(2)} — it needs contrast`);
  } else if (contrast > 0.55) {
    reasons.push(`already contrasty at ${contrast.toFixed(2)} — do not add more`);
  }

  // White balance, and only when it is obvious. A small cast is a look; a
  // large one is a mistake, and the difference is roughly this threshold.
  if (warmth > 0.22) {
    adjust.temperature = -Math.min(0.25, (warmth - 0.16) * 0.8);
    reasons.push(`warm cast (${warmth.toFixed(2)}) — cool it slightly`);
  } else if (warmth < -0.14) {
    adjust.temperature = Math.min(0.25, (-0.08 - warmth) * 0.8);
    reasons.push(`cool cast (${warmth.toFixed(2)}) — warm it slightly`);
  }

  // The preset is the conservative one unless the footage is genuinely flat
  // and cool, which is the one case where a stronger look is a correction
  // rather than a decision.
  const preset = contrast < 0.16 && warmth < -0.05 ? "warmFilm" : "clean";
  if (!reasons.length) {
    reasons.push(
      `well exposed (${brightness.toFixed(2)}) with normal contrast (${contrast.toFixed(2)}) — nothing needs correcting`
    );
  }

  return { preset, adjust, reasons };
}

/** The reading as a line for the brief. */
export function describeGradeReading(reading: GradeReading | null): string {
  if (!reading) return "";
  const nudges = Object.entries(reading.adjust)
    .map(([key, value]) => `${key} ${value > 0 ? "+" : ""}${value.toFixed(2)}`)
    .join(", ");
  return [
    `  The footage measures: ${reading.reasons.join("; ")}.`,
    nudges
      ? `  So the corrective grade is "${reading.preset}" with ${nudges}. Anything beyond that is a look, not a correction — only apply one if they asked for it.`
      : `  So "${reading.preset}" is all it needs. Anything stronger is a look they did not ask for.`,
  ].join("\n");
}
