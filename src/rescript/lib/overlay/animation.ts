/**
 * Enter/exit animation maths.
 *
 * An animation is expressed as a *transform on the draw state* rather than as
 * bespoke drawing code, so every animation works on every element kind for
 * free: the renderer asks for a `DrawState` at time `t` and then draws the
 * element the same way it always does.
 */

import type {
  AnimationKind,
  AnimationSpec,
  AnimationUnit,
  EasingName,
  OverlayElement,
} from "./types";

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
  /**
   * Clips the draw to a fraction of its own height, rising from the baseline.
   * 1 is unclipped. Drives the `mask` kind.
   */
  rise: number;
  /**
   * How to spread this animation across a text element's tokens.
   *
   * Carried on the state rather than resolved here because only the renderer
   * knows where the words ended up — the wrap depends on the font, the box and
   * the frame size, none of which this module has. So this says *what* to do
   * and `render.ts` works out how many tokens there are to do it to.
   *
   * Absent means the whole element at once, which is what every animation did
   * before per-token reveals existed.
   */
  tokens: { unit: Exclude<AnimationUnit, "element">; p: number; stagger: number } | null;
}

const IDENTITY: DrawState = {
  opacity: 1,
  dx: 0,
  dy: 0,
  scale: 1,
  blur: 0,
  reveal: 1,
  charFraction: 1,
  rise: 1,
  tokens: null,
};

/**
 * Where one token of a staggered reveal has got to.
 *
 * With `n` tokens each delayed by `stagger` of the whole animation, the last
 * one starts at `(n-1) * stagger` and every token gets the remainder as its
 * own window. The window is floored so a very long caption still animates
 * rather than snapping: past about twenty words the stagger is compressed
 * instead of the reveal running past the end of the animation.
 */
export function tokenProgress(
  p: number,
  index: number,
  count: number,
  stagger: number
): number {
  // Pinned at the ends rather than left to the arithmetic. Dividing by a window
  // computed from a compressed spread lands the last token at 0.9999999999999998
  // for some counts, which is invisible but means "everything has settled when
  // the animation ends" is not actually true — and that is the one property the
  // rest of the renderer is entitled to assume.
  if (p >= 1) return 1;
  if (p <= 0) return 0;
  if (count <= 1 || stagger <= 0) return clamp01(p);
  const spread = Math.min(stagger * (count - 1), 0.8);
  const each = Math.max(0.2, 1 - spread);
  const begins = count > 1 ? (spread * index) / (count - 1) : 0;
  return clamp01((p - begins) / each);
}

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
    case "mask":
      // Rises out from behind its own baseline. The opacity is deliberately
      // not animated: the clip is doing the work, and fading as well turns a
      // hard typographic edge back into the soft appearance it exists to avoid.
      return { ...IDENTITY, rise: e, dy: (1 - e) * 0.9 };
    default:
      return IDENTITY;
  }
}

/**
 * Kinds that mean nothing applied to a whole element at once.
 *
 * `mask` on one box is a wipe; `mask` per word is the reveal it was ported for.
 * Rather than let it read as a dull wipe when someone picks it, it defaults to
 * per-word and can still be overridden explicitly.
 */
const PER_WORD_BY_DEFAULT: ReadonlySet<AnimationKind> = new Set(["mask"]);

function unitFor(spec: AnimationSpec): AnimationUnit {
  if (spec.unit) return spec.unit;
  return PER_WORD_BY_DEFAULT.has(spec.kind) ? "word" : "element";
}

/** How far apart tokens are, when the spec does not say. */
const DEFAULT_STAGGER = 0.16;

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
  let spec: AnimationSpec | null = null;
  let p = 1;

  if (enterFor > 0 && into < enterFor) {
    spec = element.enter;
    p = into / enterFor;
    state = apply(spec, p, true);
  } else if (exitFor > 0 && until < exitFor) {
    spec = element.exit;
    p = until / exitFor;
    state = apply(spec, p, false);
  }

  // Only text has tokens to stagger, and only while something is animating —
  // a settled element is one element, whatever revealed it.
  const unit = spec ? unitFor(spec) : "element";
  const tokens =
    spec && unit !== "element" && element.kind === "text"
      ? { unit, p, stagger: spec.stagger ?? DEFAULT_STAGGER }
      : null;

  return { ...state, tokens, opacity: state.opacity * element.opacity };
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
  "mask",
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
  mask: "Mask reveal",
};

export const EASING_NAMES: EasingName[] = [
  "linear",
  "easeOut",
  "easeIn",
  "easeInOut",
  "backOut",
  "spring",
];
