/**
 * The music bed.
 *
 * Synthesised, for the same reasons as the effects: nothing to license,
 * nothing to download, and it can be written to the exact length of the video
 * instead of being faded out mid-phrase.
 *
 * Underscore for an explainer should be furniture -- if a viewer notices the
 * music, it is wrong. But there is a large gap between "not noticed" and
 * "obviously three oscillators", and closing it is what four things here are
 * for:
 *
 * - **A room.** Every voice goes through a synthesised reverb. Dry stacked
 *   sines sound like a test tone no matter how well they are voiced; the same
 *   notes in a small room sound like a recording. This is the single largest
 *   difference between a bed that reads as music and one that reads as a
 *   synthesiser, and it costs one convolver.
 * - **A bottom.** A root note an octave below the pad. Without one the bed
 *   sits in the same band as the narration and has to be mixed so low it may
 *   as well not be there.
 * - **Movement.** The pad's filter opens and closes across the film, so the
 *   texture at ninety seconds is not the texture at ten.
 * - **Width.** The pad voices are spread across the stereo field and the voice
 *   is not, which leaves a hole in the centre for the narration to sit in --
 *   the oldest mixing trick there is, and the reason a bed can be louder
 *   without competing.
 *
 * `MOOD` is still the whole tuning surface, so a different feel is a table
 * edit rather than new code. Everything is deterministic: an exported file
 * sounds exactly like the preview.
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
  /** The pad's resting cutoff, in Hz. Higher is brighter and more present. */
  colour: number;
  /** Level of the root note under the pad, 0 for none. */
  bass: number;
  /** Notes per chord in the plucked figure over the top. 0 for none. */
  arp: number;
  /** Reverb tail, in seconds. A bigger room for a slower piece. */
  space: number;
}

const MOODS: Record<Exclude<MusicMood, "none">, MoodSpec> = {
  calm: {
    root: 146.83, // D3
    progression: [[0, 7, 12], [-3, 4, 9], [2, 9, 14], [-5, 2, 7]],
    bars: 8,
    level: 0.05,
    pulse: false,
    colour: 780,
    bass: 0.5,
    arp: 0,
    space: 2.6,
  },
  curious: {
    root: 164.81, // E3
    progression: [[0, 7, 11], [2, 9, 14], [-1, 4, 11], [-3, 4, 9]],
    bars: 6,
    level: 0.055,
    pulse: true,
    colour: 1_100,
    bass: 0.4,
    // The one mood with a figure over the top: discovery wants something
    // moving, and a pad alone cannot imply forward motion.
    arp: 4,
    space: 1.9,
  },
  driving: {
    root: 130.81, // C3
    progression: [[0, 7, 12], [-4, 3, 10], [-2, 5, 12], [-5, 2, 7]],
    bars: 4,
    level: 0.06,
    pulse: true,
    colour: 1_300,
    bass: 0.75,
    arp: 3,
    space: 1.2,
  },
  warm: {
    root: 174.61, // F3
    progression: [[0, 4, 9], [-3, 4, 7], [-5, 2, 9], [0, 5, 12]],
    bars: 8,
    level: 0.05,
    pulse: false,
    colour: 700,
    bass: 0.55,
    arp: 0,
    space: 2.8,
  },
  serious: {
    root: 123.47, // B2
    progression: [[0, 3, 10], [-2, 5, 10], [-4, 3, 8], [0, 3, 7]],
    bars: 8,
    level: 0.048,
    pulse: false,
    colour: 560,
    bass: 0.8,
    arp: 0,
    space: 3.4,
  },
};

const semitone = (root: number, steps: number) => root * Math.pow(2, steps / 12);

/**
 * The root the bed is written on.
 *
 * Exported so the effects can be tuned to it. A mark a semitone off the pad
 * underneath it is the single clearest tell that a video's sound was assembled
 * rather than scored, and it costs one number to avoid.
 */
export function moodRoot(mood: MusicMood): number {
  if (mood === "none") return MOODS.calm.root;
  return MOODS[mood]?.root ?? MOODS.calm.root;
}

/** Deterministic 0..1, so a rendered file matches the preview exactly. */
function jitter(seed: number): number {
  const x = Math.sin(seed * 91.7 + 41.3) * 43_758.5453;
  return x - Math.floor(x);
}

/**
 * A small room, made of decaying noise.
 *
 * Two channels with different noise so the tail is genuinely stereo -- the
 * same noise on both sides collapses into the centre and sounds like a delay
 * rather than a space.
 */
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, frames, ctx.sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < frames; i += 1) {
      const t = i / frames;
      // An early gap before the tail builds: a room has walls at a distance.
      const build = Math.min(1, t * 14);
      const decay = Math.pow(1 - t, 2.4);
      data[i] = (jitter(i + channel * 7_919) * 2 - 1) * build * decay;
    }
  }
  return buffer;
}

/** Stereo placement, where the browser has it. Mono is a fine fallback. */
function panned(ctx: BaseAudioContext, out: AudioNode, pan: number): AudioNode {
  if (typeof ctx.createStereoPanner !== "function" || Math.abs(pan) < 0.01) return out;
  const node = ctx.createStereoPanner();
  node.pan.value = Math.max(-1, Math.min(1, pan));
  node.connect(out);
  return node;
}

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
    /** Playback rate of the picture, so the bed keeps step at 1.25x. */
    rate?: number;
  },
) {
  if (options.mood === "none" || options.duration <= 0) return;
  const spec = MOODS[options.mood];
  if (!spec) return;

  const base = options.base ?? 0;
  const from = options.from ?? 0;
  const rate = options.rate && options.rate > 0 ? options.rate : 1;
  /** Timeline seconds -> this context's clock. */
  const when = (t: number) => base + (t - from) / rate;
  const at = (t: number) => Math.max(base, when(t));

  const master = ctx.createGain();
  const level = (options.level ?? 1) * spec.level;

  /* ------------------------------- the room ------------------------------- */

  const dry = ctx.createGain();
  dry.gain.value = 0.78;
  dry.connect(master);

  let wet: AudioNode = dry;
  try {
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, spec.space);
    const send = ctx.createGain();
    // Enough to place the bed in a room, nowhere near enough to wash it out.
    send.gain.value = 0.34;
    reverb.connect(send).connect(master);
    wet = reverb;
  } catch {
    // No convolver is a drier bed, never a silent one.
  }

  /** Everything musical goes to both, so the room is heard behind all of it. */
  const voice = (pan: number): AudioNode => {
    const split = ctx.createGain();
    const placed = panned(ctx, split, pan);
    split.connect(dry);
    if (wet !== dry) split.connect(wet);
    return placed === split ? split : placed;
  };

  /* ------------------------------ the envelope ----------------------------- */

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

  /* ------------------------------- the parts ------------------------------- */

  const sections = Math.ceil(options.duration / spec.bars);

  for (let section = 0; section < sections; section += 1) {
    const start = section * spec.bars;
    const chord = spec.progression[section % spec.progression.length];
    const length = Math.min(spec.bars, options.duration - start);
    if (length <= 0.2) break;
    // Sections already behind the playhead are not scheduled at all.
    if (start + length <= from) continue;

    /* the pad */
    for (const [index, step] of chord.entries()) {
      const osc = ctx.createOscillator();
      osc.type = index === 0 ? "triangle" : "sine";
      osc.frequency.value = semitone(spec.root, step);
      // A hair of detune keeps stacked sines from sounding like a test tone.
      osc.detune.value = (index - 1) * 4;

      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      // The filter breathes across the film: brighter in the middle, closing
      // toward both ends, so ninety seconds of pad is not ninety seconds of
      // the same three notes.
      const through = start / Math.max(1, options.duration);
      const arc = Math.sin(through * Math.PI);
      low.frequency.setValueAtTime(spec.colour * (0.62 + arc * 0.55), at(start));
      low.frequency.setTargetAtTime(spec.colour * (0.7 + arc * 0.6), at(start), length * 0.4);
      low.Q.value = 0.7;

      const gain = ctx.createGain();
      const voiceLevel = index === 0 ? 0.5 : 0.3;
      gain.gain.setValueAtTime(0.0001, at(start));
      gain.gain.linearRampToValueAtTime(voiceLevel, when(start + Math.min(1.6, length * 0.35)));
      gain.gain.setValueAtTime(voiceLevel, when(start + length * 0.7));
      gain.gain.linearRampToValueAtTime(0.0001, when(start + length));

      // Spread across the field, leaving the centre for the narration.
      osc.connect(low).connect(gain).connect(voice((index - 1) * 0.42));
      osc.start(at(start));
      osc.stop(when(start + length + 0.05));
    }

    /* the bottom */
    if (spec.bass > 0.01) {
      const bass = ctx.createOscillator();
      bass.type = "sine";
      bass.frequency.value = semitone(spec.root, chord[0] - 12);

      const shape = ctx.createBiquadFilter();
      shape.type = "lowpass";
      shape.frequency.value = 240;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at(start));
      gain.gain.linearRampToValueAtTime(0.42 * spec.bass, when(start + Math.min(1.2, length * 0.25)));
      gain.gain.setValueAtTime(0.42 * spec.bass, when(start + length * 0.72));
      gain.gain.linearRampToValueAtTime(0.0001, when(start + length));

      // Dead centre and dry: a wide, reverberant bass is mud.
      bass.connect(shape).connect(gain).connect(dry);
      bass.start(at(start));
      bass.stop(when(start + length + 0.05));
    }

    /* the figure over the top */
    if (spec.arp > 0) {
      const step = length / spec.arp;
      for (let note = 0; note < spec.arp; note += 1) {
        const when_ = start + note * step;
        if (when_ < from) continue;
        const degree = chord[(note + section) % chord.length] + 12;

        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = semitone(spec.root, degree);

        const gain = ctx.createGain();
        // Plucked: instant on, long off. Quiet enough to be texture.
        gain.gain.setValueAtTime(0.0001, at(when_));
        gain.gain.exponentialRampToValueAtTime(0.14, when(when_ + 0.02));
        gain.gain.exponentialRampToValueAtTime(0.0001, when(when_ + step * 0.9));

        osc.connect(gain).connect(voice(note % 2 === 0 ? 0.55 : -0.55));
        osc.start(at(when_));
        osc.stop(when(when_ + step));
      }
    }

    if (!spec.pulse) continue;

    // A quiet heartbeat, one per two seconds, to keep time moving.
    for (let beat = 0; beat < length; beat += 2) {
      if (start + beat < from) continue;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = semitone(spec.root, chord[0] - 12);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at(start + beat));
      gain.gain.exponentialRampToValueAtTime(0.25, when(start + beat + 0.04));
      gain.gain.exponentialRampToValueAtTime(0.0001, when(start + beat + 0.7));
      osc.connect(gain).connect(dry);
      osc.start(at(start + beat));
      osc.stop(when(start + beat + 0.8));
    }
  }
}
