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
