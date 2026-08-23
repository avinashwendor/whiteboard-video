/**
 * Enter/exit animation maths.
 *
 * An animation is expressed as a *transform on the draw state* rather than as
 * bespoke drawing code, so every animation works on every element kind for
 * free: the renderer asks for a `DrawState` at time `t` and then draws the
 * element the same way it always does.
 */

import type { AnimationSpec, EasingName, OverlayElement } from "./types";

type EasingFn = (t: number) => number;

const EASINGS: Record<EasingName, EasingFn> = {
  linear: (t) => t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeIn: (t) => t * t * t,
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  // Overshoots past 1 and settles back — the classic "arrives with weight".
  backOut: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  // A damped oscillation, cheaper and more predictable than a real spring
  // solver and indistinguishable over the ~0.4s these run for.
  spring: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 - Math.pow(2, -10 * t) * Math.cos((t * Math.PI * 2) / 0.32);
  },
};

export function ease(name: EasingName, t: number): number {
  return EASINGS[name](clamp01(t));
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * How an animation modifies the draw. `dx`/`dy` are in normalised frame units,
 * `scale` is about the element's centre, `reveal` clips the element to a
 * left-to-right fraction, and `charFraction` drives the typewriter.
 */
export interface DrawState {
  opacity: number;
  dx: number;
  dy: number;
  scale: number;
  blur: number;
  reveal: number;
  charFraction: number;
}

const IDENTITY: DrawState = {
  opacity: 1,
  dx: 0,
  dy: 0,
  scale: 1,
  blur: 0,
  reveal: 1,
  charFraction: 1,
};

/**
 * `p` runs 0 → 1 across the animation. For an exit the caller passes the
 * progress already reversed, so both directions share one table.
 */
function apply(spec: AnimationSpec, p: number, entering: boolean): DrawState {
  const e = ease(spec.easing, p);
  const away = 1 - e;
  switch (spec.kind) {
    case "none":
      return IDENTITY;
    case "fade":
      return { ...IDENTITY, opacity: e };
    case "slideUp":
      return { ...IDENTITY, opacity: e, dy: away * 0.06 };
    case "slideDown":
      return { ...IDENTITY, opacity: e, dy: -away * 0.06 };
    case "slideLeft":
      return { ...IDENTITY, opacity: e, dx: away * 0.08 };
    case "slideRight":
      return { ...IDENTITY, opacity: e, dx: -away * 0.08 };
    case "scaleUp":
      return { ...IDENTITY, opacity: e, scale: 0.82 + 0.18 * e };
    case "pop":
      // Overshoot on the way in only; popping *out* past full size reads as a
      // glitch rather than as emphasis.
      return {
        ...IDENTITY,
        opacity: clamp01(p * 2),
        scale: entering ? 0.6 + 0.4 * ease("backOut", p) : 0.7 + 0.3 * e,
      };
    case "blur":
      return { ...IDENTITY, opacity: e, blur: away * 0.02 };
    case "wipeRight":
      return { ...IDENTITY, reveal: e };
    case "typewriter":
      // Text only; other kinds fall back to a plain fade so the option is
      // never a no-op the user has to discover.
      return { ...IDENTITY, charFraction: e };
    default:
      return IDENTITY;
  }
}

/** Longest an animation may run: never more than half the element's life. */
function budget(spec: AnimationSpec, life: number): number {
  return Math.max(0, Math.min(spec.duration, life / 2));
}

/**
 * Draw state for `element` at edited-timeline second `t`.
 * Returns `null` when the element is not on screen at all.
 */
export function drawStateAt(
  element: OverlayElement,
  t: number
): DrawState | null {
  if (element.hidden) return null;
  const life = element.end - element.start;
  if (life <= 0) return null;
  if (t < element.start || t >= element.end) return null;

  const into = t - element.start;
  const until = element.end - t;

  const enterFor = budget(element.enter, life);
  const exitFor = budget(element.exit, life);

  let state = IDENTITY;
  if (enterFor > 0 && into < enterFor) {
    state = apply(element.enter, into / enterFor, true);
  } else if (exitFor > 0 && until < exitFor) {
    state = apply(element.exit, until / exitFor, false);
  }

  return { ...state, opacity: state.opacity * element.opacity };
}

/** Every animation kind, in the order the picker shows them. */
export const ANIMATION_KINDS = [
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

export const ANIMATION_LABELS: Record<string, string> = {
  none: "None",
  fade: "Fade",
  slideUp: "Slide up",
  slideDown: "Slide down",
  slideLeft: "Slide left",
  slideRight: "Slide right",
  scaleUp: "Scale up",
  pop: "Pop",
  blur: "Blur in",
  wipeRight: "Wipe",
  typewriter: "Typewriter",
};

export const EASING_NAMES: EasingName[] = [
  "linear",
  "easeOut",
  "easeIn",
  "easeInOut",
  "backOut",
  "spring",
];
