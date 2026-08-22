/**
 * The music bed.
 *
 * Synthesised, for the same reasons as the effects: nothing to license,
 * nothing to download, and it can be written to the exact length of the video
 * instead of being faded out mid-phrase. It is deliberately plain -- a slow
 * pad, a little movement, and a chord change every few bars. Underscore for an
 * explainer should be furniture: if a viewer notices the music, it is wrong.
 *
 * `MOOD` is the whole tuning surface, so a different feel is a table edit
 * rather than new code.
 */

export type MusicMood = "calm" | "curious" | "driving" | "warm" | "serious" | "none";

interface MoodSpec {
  /** Root of the progression, in Hz. */
  root: number;
  /** Scale degrees, as semitone offsets, cycled one per section. */
  progression: number[][];
  /** Seconds per chord. */
  bars: number;
  /** Overall level. Underscore sits well below speech. */
  level: number;
  /** Adds a soft pulse on the beat when true. */
  pulse: boolean;
}

const MOODS: Record<Exclude<MusicMood, "none">, MoodSpec> = {
  calm: {
    root: 146.83, // D3
    progression: [[0, 7, 12], [-3, 4, 9], [2, 9, 14], [-5, 2, 7]],
    bars: 8,
    level: 0.05,
    pulse: false,
  },
  curious: {
    root: 164.81, // E3
    progression: [[0, 7, 11], [2, 9, 14], [-1, 4, 11], [-3, 4, 9]],
    bars: 6,
    level: 0.055,
    pulse: true,
  },
  driving: {
    root: 130.81, // C3
    progression: [[0, 7, 12], [-4, 3, 10], [-2, 5, 12], [-5, 2, 7]],
    bars: 4,
    level: 0.06,
    pulse: true,
  },
  warm: {
    root: 174.61, // F3
    progression: [[0, 4, 9], [-3, 4, 7], [-5, 2, 9], [0, 5, 12]],
    bars: 8,
    level: 0.05,
    pulse: false,
  },
  serious: {
    root: 123.47, // B2
    progression: [[0, 3, 10], [-2, 5, 10], [-4, 3, 8], [0, 3, 7]],
    bars: 8,
    level: 0.048,
    pulse: false,
  },
};

const semitone = (root: number, steps: number) => root * Math.pow(2, steps / 12);

/**
 * Writes a full-length bed into the context.
 *
 * `duck` is where the narration sits: the pad drops under speech so the bed
 * never competes with the voice, which is the difference between underscore
 * and noise.
 */
export function scheduleMusic(
  ctx: BaseAudioContext,
  out: AudioNode,
  options: {
    mood: MusicMood;
    duration: number;
    /** Spans where narration plays, so the bed can duck beneath it. */
    duck?: Array<{ from: number; to: number }>;
    level?: number;
    /** Context time representing `from` on the video timeline. */
    base?: number;
    /** Timeline position playback starts at, so a scrub joins mid-bed. */
    from?: number;
  },
) {
  if (options.mood === "none" || options.duration <= 0) return;
  const spec = MOODS[options.mood];
  if (!spec) return;

  const base = options.base ?? 0;
  const from = options.from ?? 0;
  /** Timeline seconds -> this context's clock. */
  const when = (t: number) => base + (t - from);

  const master = ctx.createGain();
  const level = (options.level ?? 1) * spec.level;

  // Fade the whole bed in and out with the video. A scrub that lands past the
  // opening fade simply starts at full level.
  const fadeIn = Math.min(2.5, options.duration * 0.15);
  master.gain.setValueAtTime(from >= fadeIn ? level : 0.0001, base);
  if (from < fadeIn) master.gain.linearRampToValueAtTime(level, when(fadeIn));
  master.gain.setValueAtTime(level, Math.max(base, when(options.duration - 2.2)));
  master.gain.linearRampToValueAtTime(0.0001, when(options.duration));

  // Duck under every narration span, with a little lead and recovery.
  for (const span of options.duck ?? []) {
    const start = Math.max(from, span.from - 0.35);
    const stop = Math.min(options.duration, span.to + 0.5);
    if (stop <= start) continue;
    master.gain.setTargetAtTime(level * 0.42, when(start), 0.25);
    master.gain.setTargetAtTime(level, when(stop), 0.6);
  }

  master.connect(out);

  const sections = Math.ceil(options.duration / spec.bars);
  for (let section = 0; section < sections; section += 1) {
    const at = section * spec.bars;
    const chord = spec.progression[section % spec.progression.length];
    const length = Math.min(spec.bars, options.duration - at);
    if (length <= 0.2) break;
    // Sections already behind the playhead are not scheduled at all.
    if (at + length <= from) continue;

    for (const [index, step] of chord.entries()) {
      const osc = ctx.createOscillator();
      osc.type = index === 0 ? "triangle" : "sine";
      osc.frequency.value = semitone(spec.root, step);
      // A hair of detune keeps stacked sines from sounding like a test tone.
      osc.detune.value = (index - 1) * 4;

      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 900;

      const gain = ctx.createGain();
      const voiceLevel = index === 0 ? 0.5 : 0.3;
      gain.gain.setValueAtTime(0.0001, Math.max(base, when(at)));
      gain.gain.linearRampToValueAtTime(voiceLevel, when(at + Math.min(1.6, length * 0.35)));
      gain.gain.setValueAtTime(voiceLevel, when(at + length * 0.7));
      gain.gain.linearRampToValueAtTime(0.0001, when(at + length));

      osc.connect(low).connect(gain).connect(master);
      osc.start(Math.max(base, when(at)));
      osc.stop(when(at + length + 0.05));
    }

    if (!spec.pulse) continue;

    // A quiet heartbeat, one per two seconds, to keep time moving.
    for (let beat = 0; beat < length; beat += 2) {
      if (at + beat < from) continue;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = semitone(spec.root, chord[0] - 12);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, when(at + beat));
      gain.gain.exponentialRampToValueAtTime(0.25, when(at + beat + 0.04));
      gain.gain.exponentialRampToValueAtTime(0.0001, when(at + beat + 0.7));
      osc.connect(gain).connect(master);
      osc.start(when(at + beat));
      osc.stop(when(at + beat + 0.8));
    }
  }
}
