import type { Cue } from "./timing";
import type { SfxEvent } from "./sfx";

/**
 * Scoring the video.
 *
 * The renderer already knows, to the frame, when every drawing lands and when
 * every word is spoken. That schedule is exactly what a sound editor would ask
 * for, so the effects are derived from it rather than sprinkled on top: a
 * whoosh sits on the cut, a beat lands with the thing it draws, a riser leads
 * into the number the script is about to say.
 *
 * The vocabulary is kept deliberately small. Cueing every stroke would be
 * technically easy and would sound like a typewriter.
 */

export interface ScoredScene {
  /** Where the scene starts on the finished timeline. */
  start: number;
  duration: number;
  /** Silence before the narration, in scene time. */
  lead: number;
  /** Length of the narration clip. */
  speech: number;
  /** Beat schedule, in scene time. */
  cues: Cue[];
  /** When the scene's statistic is spoken, in scene time. */
  statAt?: number | null;
  hasNarration: boolean;
}

export interface ScoreInput {
  coverDuration: number;
  scenes: ScoredScene[];
  style: "whiteboard" | "hyperframes";
  /** 0 silences effects, 1 is the designed level. */
  intensity?: number;
}

export interface Score {
  sfx: SfxEvent[];
  /** Spans where speech plays, so the music can duck beneath it. */
  duck: Array<{ from: number; to: number }>;
}

export function buildScore(input: ScoreInput): Score {
  const sfx: SfxEvent[] = [];
  const duck: Array<{ from: number; to: number }> = [];
  const level = input.intensity ?? 1;
  if (level <= 0) return { sfx, duck };

  const modern = input.style === "hyperframes";

  // The title card resolving into the first scene.
  sfx.push({ name: "chime", at: Math.max(0, input.coverDuration - 1.9), gain: 0.5 * level });

  input.scenes.forEach((scene, index) => {
    const { start } = scene;

    // The cut itself. A modern cut has weight under it; a board is wiped.
    sfx.push({ name: "whoosh", at: Math.max(0, start - 0.18), gain: (modern ? 0.9 : 0.6) * level });
    if (modern && index > 0) {
      sfx.push({ name: "thud", at: start, gain: 0.55 * level });
    }

    if (scene.hasNarration) {
      duck.push({ from: start + scene.lead, to: start + scene.lead + scene.speech });
    }

    scene.cues.forEach((cue, beat) => {
      const at = start + cue.at;
      if (at >= start + scene.duration) return;
      // The heading is a tick; everything the heading introduces is a pop.
      sfx.push({
        name: beat === 0 ? "tick" : "pop",
        at,
        gain: (beat === 0 ? 0.5 : 0.75) * level,
      });
    });

    // A number gets led into and then landed on.
    if (scene.statAt != null) {
      const at = start + scene.statAt;
      sfx.push({ name: "riser", at: Math.max(start, at - 0.95), gain: 0.8 * level });
      sfx.push({ name: "chime", at, gain: 0.7 * level });
    }
  });

  // The last thing heard is the end of the last scene, not another effect.
  const last = input.scenes[input.scenes.length - 1];
  if (last) {
    sfx.push({ name: "chime", at: last.start + last.duration - 1.2, gain: 0.45 * level });
  }

  return { sfx, duck };
}
