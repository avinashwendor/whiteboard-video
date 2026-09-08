/**
 * What an element does while it is on screen.
 *
 * Enter and exit animations are the two ends of an element's life, and a
 * composition made only of those is a slideshow: everything lands, freezes for
 * three seconds, and leaves. The difference between that and motion graphics is
 * not more elaborate entrances — it is that nothing on screen is ever
 * completely still. A title that breathes, a badge that floats, a stat that
 * pulses on the beat: each one is a few pixels of movement nobody consciously
 * notices, and together they are the whole difference between a video that
 * looks made and one that looks assembled.
 *
 * Expressed as a transform composed on top of the enter/exit state, exactly
 * like everything in `animation.ts`, so every motion works on every element
 * kind for free and none of them needs to coordinate with the entrance.
 *
 * Three rules the table below keeps, all of which are invisible until broken:
 *
 *  - **Continuous from t = 0.** The loops are all identity at zero, so nothing
 *    jumps at the moment the entrance hands over. The two that are one long
 *    move rather than a loop — `tilt` and `drift` — are instead centred on
 *    where the element was placed: they start turned one way and end turned
 *    the other, passing through square in the middle. That is a pose, not a
 *    jump, and it is continuous for the whole life either way.
 *  - **Small.** The amplitudes are tuned in fractions of the frame, and they
 *    are much smaller than they look written down: 0.012 of frame height is
 *    about thirteen pixels at 1080, which is a drift you feel rather than see.
 *    Doubling any of these turns a produced video into a bouncy one.
 *  - **Slow.** Everything periodic here runs between a two- and a five-second
 *    cycle. Faster reads as a loading spinner.
 */

import { ease } from "./animation";
import type { AmbientKind, AmbientSpec, CounterSpec } from "./types";

/** What a motion adds to the draw. Offsets are in normalised frame units. */
export interface AmbientState {
  dx: number;
  dy: number;
  scale: number;
  /** Degrees, added to the element's own rotation. */
  rotate: number;
  /** Multiplied into the opacity, never added. */
  opacity: number;
}

const STILL: AmbientState = { dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 };

export interface AmbientInfo {
  id: AmbientKind;
  label: string;
  /** When to reach for it. Shown in the picker and given to the agent. */
  use: string;
}

/**
 * The catalogue, in the order the picker shows them: the ones that suit type
 * first, then the ones that suit a sticker or a badge.
 */
export const AMBIENTS: AmbientInfo[] = [
  { id: "none", label: "Still", use: "Holds. The right answer for a lower third under someone talking." },
  { id: "float", label: "Float", use: "Rises and settles. Good under almost any title." },
  { id: "sway", label: "Sway", use: "Drifts side to side. Suits something pinned to an edge." },
  { id: "bob", label: "Bob", use: "A lighter, quicker lift. For a sticker or an emoji." },
  { id: "breathe", label: "Breathe", use: "Grows and relaxes. Keeps a held title alive." },
  { id: "pulse", label: "Pulse", use: "A beat, on the beat. For a figure or a call to action." },
  { id: "wobble", label: "Wobble", use: "Rocks a few degrees. Reads as hand-placed." },
  { id: "tilt", label: "Slow tilt", use: "Turns across its whole life. One long move, not a loop." },
  { id: "drift", label: "Slow drift", use: "Travels a little. Gives a still frame somewhere to go." },
  { id: "shimmer", label: "Shimmer", use: "Breathes in brightness rather than size." },
  { id: "throb", label: "Throb", use: "Scale and brightness together. Loud; use once." },
];

export const AMBIENT_KINDS = AMBIENTS.map((a) => a.id) as [AmbientKind, ...AmbientKind[]];

export const AMBIENT_LABELS: Record<string, string> = Object.fromEntries(
  AMBIENTS.map((a) => [a.id, a.label])
);

/** One line per motion, for the agent's prompt. */
export function describeAmbients(): string {
  return AMBIENTS.filter((a) => a.id !== "none")
    .map((a) => `  ${a.id} — ${a.use}`)
    .join("\n");
}

/**
 * Where a motion has got to.
 *
 * `into` is seconds since the element appeared and `life` its whole length.
 * Periodic motions use `into` so they run at a real-world rate whatever the
 * element's length; the two that are one long move — `tilt` and `drift` — use
 * the fraction, so they complete exactly once however long the element is up.
 */
export function ambientAt(
  spec: AmbientSpec | undefined,
  into: number,
  life: number
): AmbientState {
  if (!spec || spec.kind === "none" || life <= 0) return STILL;

  const amount = spec.amount ?? 1;
  const speed = spec.speed ?? 1;
  const p = Math.max(0, Math.min(1, into / life));
  /** Sine at `hz` cycles per second, zero at t=0. */
  const wave = (hz: number) => Math.sin(2 * Math.PI * hz * speed * into);

  switch (spec.kind) {
    case "float":
      return { ...STILL, dy: -0.012 * amount * wave(0.25) };
    case "sway":
      return { ...STILL, dx: 0.014 * amount * wave(0.2) };
    case "bob":
      // Absolute sine: it lifts and returns rather than dipping below where it
      // was placed, which is what makes it read as bouncing rather than
      // wandering.
      return { ...STILL, dy: -0.018 * amount * Math.abs(Math.sin(Math.PI * 0.6 * speed * into)) };
    case "breathe":
      return { ...STILL, scale: 1 + 0.03 * amount * wave(0.25) };
    case "pulse": {
      // A sharp beat rather than a sine: raised to a power, the curve sits near
      // zero for most of the cycle and spikes, which is a pulse. A plain sine
      // is a throb, and it is on the list separately.
      const beat = Math.pow(Math.max(0, wave(0.8)), 6);
      return { ...STILL, scale: 1 + 0.09 * amount * beat };
    }
    case "wobble":
      return { ...STILL, rotate: 2.5 * amount * wave(0.5) };
    case "tilt":
      // One move across the whole life, centred so it passes through square.
      return { ...STILL, rotate: 3 * amount * (p - 0.5) * 2 };
    case "drift":
      return {
        ...STILL,
        dx: 0.02 * amount * (p - 0.5) * 2,
        dy: -0.008 * amount * (p - 0.5) * 2,
      };
    case "shimmer":
      // (1 - cos)/2 rather than sine: it starts at full brightness and dips,
      // where a sine would start mid-dip and brighten past where it was placed.
      return { ...STILL, opacity: 1 - 0.22 * amount * (1 - Math.cos(2 * Math.PI * 0.6 * speed * into)) / 2 };
    case "throb": {
      const swell = (1 - Math.cos(2 * Math.PI * 0.5 * speed * into)) / 2;
      return { ...STILL, scale: 1 + 0.05 * amount * swell, opacity: 1 - 0.15 * amount * swell };
    }
    default:
      return STILL;
  }
}

/* --------------------------------- counters -------------------------------- */

/** How much of the element's life a count takes when the spec does not say. */
const DEFAULT_HOLD = 0.6;

/**
 * The number to draw at a given point in the element's life.
 *
 * Counts for the first `hold` of the element and then stays put. A figure that
 * is still climbing as it fades out has not been read — the whole reason to
 * animate a number is to make somebody look at it, and it has to be *there*
 * when they do.
 */
export function counterText(spec: CounterSpec, progress: number): string {
  const hold = Math.max(0.05, Math.min(1, spec.hold ?? DEFAULT_HOLD));
  const p = ease(spec.easing ?? "easeOut", Math.max(0, Math.min(1, progress / hold)));
  const value = spec.from + (spec.to - spec.from) * p;

  const decimals = Math.max(0, Math.min(3, Math.round(spec.decimals ?? 0)));
  const body =
    spec.grouped === false
      ? value.toFixed(decimals)
      : value.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });

  return `${spec.prefix ?? ""}${body}${spec.suffix ?? ""}`;
}
