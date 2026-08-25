/**
 * Camera presets: one name, one move.
 *
 * The agent asks for `punchIn`, not for a pair of framings. That is deliberate
 * and it is the difference between a plan that reads as directed and one that
 * reads as a mistake: a model asked to supply `from` and `to` zoom levels
 * invents numbers — 1.8, 2.4 — that are far past what any editor would use on a
 * talking head, and it invents a different one every time, so no two shots in
 * the same video match.
 *
 * So the numbers are chosen once, here, and the model chooses between names.
 * `amount` scales the travel for the cases where "a bit more" is genuinely the
 * note, without handing back the whole range.
 */

import {
  NEUTRAL_FRAMING,
  type CameraFraming,
  type CameraKind,
  type CameraMove,
  type EasingName,
} from "./types";

interface Preset {
  /** How much closer the move ends up, as a multiplier on the fitted size. */
  zoom: number;
  /** How far it travels across the source, as a fraction. */
  pan: number;
  easing: EasingName;
  /** Seconds the move takes. The rest of the shot holds. */
  duration: number;
  /** True when the move ends wide and starts tight. */
  reverse?: boolean;
}

/**
 * The house numbers.
 *
 * A punch-in of 1.18 is small enough that nobody notices it as an effect and
 * large enough to feel like emphasis — which is the entire brief. Anything past
 * about 1.35 on a face starts cropping foreheads, and on 1080p footage
 * delivered at 1080p it also starts showing.
 */
const PRESETS: Record<CameraKind, Preset> = {
  hold: { zoom: 1, pan: 0, easing: "easeOut", duration: 0 },
  // Fast enough to land on the word, slow enough not to lurch.
  punchIn: { zoom: 1.18, pan: 0, easing: "easeOut", duration: 0.55 },
  punchOut: { zoom: 1.18, pan: 0, easing: "easeOut", duration: 0.55, reverse: true },
  // The slow one: it should never be noticed as movement, only as life.
  push: { zoom: 1.09, pan: 0, easing: "linear", duration: 6 },
  driftLeft: { zoom: 1.12, pan: -0.08, easing: "linear", duration: 6 },
  driftRight: { zoom: 1.12, pan: 0.08, easing: "linear", duration: 6 },
  kenBurns: { zoom: 1.14, pan: 0.06, easing: "easeInOut", duration: 8 },
  // No travel at all: a hard cut to the tighter framing, which is what the
  // energetic short-form style actually does.
  snap: { zoom: 1.22, pan: 0, easing: "linear", duration: 0 },
};

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export interface CameraRequest {
  kind: CameraKind;
  /** Scales the preset's travel. 1 is the house amount. */
  amount?: number;
  /** What the move centres on, 0..1 of the source. Defaults to the middle. */
  focusX?: number;
  focusY?: number;
  /** Overrides the preset's own length. */
  duration?: number;
}

/** Build the move a preset describes. */
export function cameraFor(request: CameraRequest): CameraMove {
  const preset = PRESETS[request.kind] ?? PRESETS.hold;
  const amount = clamp(request.amount ?? 1, 0, 2);

  const focusX = clamp(request.focusX ?? NEUTRAL_FRAMING.focusX, 0, 1);
  const focusY = clamp(request.focusY ?? NEUTRAL_FRAMING.focusY, 0, 1);

  // Scaled about 1, not about 0: `amount: 0` means "no move", which has to be
  // a zoom of exactly 1 rather than a zoom of zero.
  const zoom = 1 + (preset.zoom - 1) * amount;
  const pan = preset.pan * amount;

  const tight: CameraFraming = {
    zoom,
    focusX: clamp(focusX + pan / 2, 0, 1),
    focusY,
  };
  const wide: CameraFraming = {
    zoom: 1,
    focusX: clamp(focusX - pan / 2, 0, 1),
    focusY,
  };

  if (request.kind === "hold") {
    return { kind: "hold", from: { ...wide }, to: { ...wide }, easing: preset.easing, duration: 0 };
  }

  const from = preset.reverse ? tight : wide;
  const to = preset.reverse ? wide : tight;

  return {
    kind: request.kind,
    from,
    to,
    easing: preset.easing,
    duration: Math.max(0, request.duration ?? preset.duration),
  };
}

/**
 * Trim a move so it finishes inside the shot that carries it.
 *
 * A six-second push placed on a two-second shot never arrives — it plays as a
 * slow creep that stops mid-travel at the cut, which looks like a dropped frame
 * rather than a move. Shortening it is better than refusing it: the note was
 * "move here", and the shot length is the constraint, not the request.
 */
export function fitCamera(camera: CameraMove, shotSeconds: number): CameraMove {
  if (camera.duration <= shotSeconds || shotSeconds <= 0) return camera;
  return { ...camera, duration: shotSeconds };
}
