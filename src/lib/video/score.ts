import type { Cue } from "./timing";
import { SFX_LEAD, SFX_TAIL, type SfxEvent, type SfxName } from "./sfx";
import { moodRoot, type MusicMood } from "./music";

/**
 * Scoring the video.
 *
 * The renderer already knows, to the frame, when every drawing lands and when
 * every word is spoken. That schedule is exactly what a sound editor would ask
 * for, so the effects are derived from it rather than sprinkled on top: a
 * whoosh crests on the cut, a beat lands with the thing it draws, a riser
 * leads into the number the script is about to say.
 *
 * Three rules keep it from sounding like a sound-effects library:
 *
 * 1. **Every `at` is a landing time.** The scheduler subtracts each voice's
 *    own approach, so nothing here has to carry a hand-tuned offset -- and
 *    nothing arrives late because somebody forgot one.
 * 2. **The palette answers to the picture.** A hard modern cut gets weight
 *    under it; a marker stroke gets a marker. The same event list over a
 *    different engine sounds different.
 * 3. **The last pass is a mixdown, not a list.** Cues collide -- two beats
 *    inside a tenth of a second, a mark under an impact -- and a schedule that
 *    plays all of them is the thing people mean by "the sound effects are a
 *    mess". `declutter` keeps the important hit and drops the one nobody would
 *    have missed.
 * 4. **Nothing rings.** Every resolution is weight rather than a bell. See the
 *    note at the top of `sfx.ts` -- a tonal tail is the single most
 *    distracting thing a soundtrack can put over a talking video.
 */

/** How loud a voice is allowed to be relative to the others when they collide. */
const PRIORITY: Record<SfxName, number> = {
  impact: 100,
  riser: 85,
  thud: 70,
  sub: 68,
  whoosh: 60,
  reverse: 58,
  latch: 50,
  pop: 40,
  swish: 35,
  tick: 30,
  key: 20,
  stroke: 10,
};

/** Two transients closer than this are heard as one muddled hit. */
const CROWD = 0.085;

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
  /**
   * The shot this scene is cut as, when the modern engine is driving.
   *
   * Sound follows picture: a fanned deck of cards wants a different mark from
   * a counting statistic.
   */
  role?: string;
  /**
   * Where the picture cuts *inside* this scene, in scene time.
   *
   * A scene is several screens now, and a screen changing in silence is the
   * one thing that reads as a glitch rather than an edit -- the eye registers
   * the change and the ear says nothing happened. These get air, and nothing
   * else: an internal cut is a smaller event than a scene change and must
   * sound like one, or a film with eighteen screens in it becomes eighteen
   * whooshes.
   */
  panelCuts?: number[];
}

export interface ScoreInput {
  coverDuration: number;
  scenes: ScoredScene[];
  style: "whiteboard" | "hyperframes";
  /** 0 silences effects, 1 is the designed level. */
  intensity?: number;
  /** The bed, so every tonal effect is written in its key. */
  mood?: MusicMood;
}

export interface Score {
  sfx: SfxEvent[];
  /** Spans where speech plays, so the music can duck beneath it. */
  duck: Array<{ from: number; to: number }>;
  /** Musical root the effects were written against. */
  key: number;
}

/**
 * The mixdown pass.
 *
 * Sorted by time, then walked once: an event that lands on top of a louder
 * neighbour is dropped, and one that lands on top of a quieter neighbour takes
 * its place. The result is a schedule where every hit is audible as itself,
 * which is the whole difference between scored and noisy.
 */
function declutter(events: SfxEvent[]): SfxEvent[] {
  const sorted = [...events].filter((event) => (event.gain ?? 1) > 0.001).sort((a, b) => a.at - b.at);
  const kept: SfxEvent[] = [];

  for (const event of sorted) {
    const previous = kept[kept.length - 1];
    // Layers of one designed sound always pass together.
    if (previous && event.group && event.group === previous.group) {
      kept.push(event);
      continue;
    }
    if (previous && event.at - previous.at < CROWD) {
      if (PRIORITY[event.name] > PRIORITY[previous.name]) kept[kept.length - 1] = event;
      continue;
    }
    // A long-ringing voice masks a small one that lands inside its tail. Only
    // worth suppressing when the newcomer is genuinely quieter than the ring.
    if (
      previous &&
      event.at - previous.at < SFX_TAIL[previous.name] * 0.5 &&
      PRIORITY[event.name] < PRIORITY[previous.name] - 40
    ) {
      continue;
    }
    kept.push(event);
  }

  return kept;
}

export function buildScore(input: ScoreInput): Score {
  const key = moodRoot(input.mood ?? "calm");
  const events: SfxEvent[] = [];
  const duck: Array<{ from: number; to: number }> = [];
  const level = input.intensity ?? 1;
  if (level <= 0) return { sfx: events, duck, key };

  const modern = input.style === "hyperframes";
  let seed = 1;
  const push = (name: SfxName, at: number, gain: number, group: string, pan = 0) => {
    if (!(at >= 0) || gain <= 0) return;
    events.push({ name, at, gain: gain * level, key, pan, group, seed: (seed += 7) });
  };

  /* -------------------------------- the title ------------------------------- */

  // The title resolving is the first thing anyone hears, so it is given the
  // one full-band hit in the palette. Everything after it is smaller by
  // design: a film that opens at its loudest has somewhere to go.
  const titleLands = Math.max(SFX_LEAD.reverse, input.coverDuration * 0.42);
  push("reverse", titleLands, 0.7, "title");
  push(modern ? "impact" : "thud", titleLands, 0.85, "title");
  push("sub", titleLands, modern ? 0.5 : 0.3, "title");

  input.scenes.forEach((scene, index) => {
    const { start } = scene;

    /* --------------------------------- the cut -------------------------------- */

    // The whoosh crests on the cut rather than starting there. Weight goes
    // underneath a modern cut; a board is only wiped.
    push("whoosh", start, modern ? 0.95 : 0.6, `cut:${index}`);
    if (modern && index > 0) push(index % 3 === 0 ? "thud" : "sub", start, 0.6, `cut:${index}`);

    if (scene.hasNarration) {
      duck.push({ from: start + scene.lead, to: start + scene.lead + scene.speech });
    }

    /* ------------------------------ inner cuts ------------------------------- */

    for (const [cut, at] of (scene.panelCuts ?? []).entries()) {
      if (at <= 0.2 || at >= scene.duration - 0.2) continue;
      push("swish", start + at, 0.45, `panel:${index}:${cut}`);
    }

    /* --------------------------------- beats ---------------------------------- */

    scene.cues.forEach((cue, beat) => {
      const at = start + cue.at;
      if (at >= start + scene.duration - 0.15) return;

      if (beat === 0) {
        // A heading that lands on the cut is already announced by the cut. Two
        // marks a frame apart is not emphasis, it is a stumble.
        if (cue.at < 0.12) return;
        // Otherwise the shot locking into position, not an item arriving.
        push("latch", at, 0.5, `beat:${index}:0`);
        return;
      }

      // Items alternate side to side so a rail of four does not stack in the
      // middle of the image, and step up the triad as they accumulate.
      const pan = modern ? (beat % 2 === 0 ? 0.22 : -0.22) : 0;
      push(modern ? "pop" : "stroke", at, modern ? 0.7 : 0.85, `beat:${index}:${beat}`, pan);
      // A little air on the entrance of anything that slides in from an edge.
      if (modern && beat > 0) push("swish", at, 0.35, `beat:${index}:${beat}`, pan);
    });

    /* -------------------------------- the number ------------------------------ */

    if (scene.statAt != null) {
      const at = start + scene.statAt;
      // The riser does the work; the landing is weight, not a bell.
      push("riser", at, 0.7, `stat:${index}`);
      push("impact", at, 0.6, `stat:${index}`);
    }
  });

  /* --------------------------------- the end -------------------------------- */

  // The last thing heard is the end of the last scene, not another effect.
  // A closing bell is the most tempting mark in the whole palette and the one
  // that most reliably makes a video feel like a corporate slideshow, so the
  // film simply runs out: one low note under the final frame, then the bed.
  const last = input.scenes[input.scenes.length - 1];
  if (last) push("sub", last.start + last.duration - 1.2, 0.4, "close");

  return { sfx: declutter(events), duck, key };
}
