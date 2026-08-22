/**
 * Easing and interpolation.
 *
 * Every curve here is a pure function of a normalised 0..1 input, which is what
 * lets the live preview, a scrub and every recorded frame agree: given the same
 * timestamp, the same pixels.
 */

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Normalises `value` into 0..1 across [from, to]. */
export function range(value: number, from: number, to: number): number {
  if (to <= from) return value >= to ? 1 : 0;
  return clamp01((value - from) / (to - from));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mix(a: number, b: number, t: number): number {
  return lerp(a, b, clamp01(t));
}

export function smoothstep(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

export function smootherstep(x: number): number {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - clamp01(x), 3);
}

export function easeInOutCubic(x: number): number {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutQuint(x: number): number {
  return 1 - Math.pow(1 - clamp01(x), 5);
}

export function easeOutExpo(x: number): number {
  const t = clamp01(x);
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function easeInExpo(x: number): number {
  const t = clamp01(x);
  return t === 0 ? 0 : Math.pow(2, 10 * t - 10);
}

/** Overshoots once and settles. `amount` 0 is a plain ease-out. */
export function easeOutBack(x: number, amount = 1.24): number {
  const c3 = amount + 1;
  const t = clamp01(x);
  return 1 + c3 * Math.pow(t - 1, 3) + amount * Math.pow(t - 1, 2);
}

/**
 * A damped spring settling on 1. Reads as weight rather than as a bounce,
 * which is the difference between motion design and a bouncing ball.
 */
export function spring(x: number, stiffness = 9.2, damping = 0.62): number {
  const t = clamp01(x);
  if (t === 0) return 0;
  if (t === 1) return 1;
  return 1 - Math.exp(-stiffness * damping * t) * Math.cos(stiffness * Math.sqrt(1 - damping * damping) * t);
}

/** Rises, holds at 1, then falls -- one gesture in a single call. */
export function pulse(x: number, rise = 0.18, fall = 0.18): number {
  const t = clamp01(x);
  if (t < rise) return smoothstep(t / rise);
  if (t > 1 - fall) return smoothstep((1 - t) / fall);
  return 1;
}

/** Deterministic pseudo-random in 0..1 -- same seed, same value, every frame. */
export function hash(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Smooth deterministic noise in -1..1, for drift and handheld motion. */
export function noise1(t: number, seed = 0): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash(i + seed * 57.3) * 2 - 1;
  const b = hash(i + 1 + seed * 57.3) * 2 - 1;
  return lerp(a, b, smootherstep(f));
}
