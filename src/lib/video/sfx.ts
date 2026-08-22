/**
 * Sound design, synthesised.
 *
 * Every effect here is built from oscillators and noise at schedule time
 * rather than fetched as a file. Three reasons that is the right call for this
 * app: there is no licensing question, there is nothing to download before a
 * video can play, and -- the one that actually matters -- an effect can be
 * placed on the exact beat the picture lands on, because the renderer already
 * knows when every beat is. A stock whoosh cannot be sample-accurate to a cue
 * plan; a scheduled oscillator is.
 *
 * Everything takes a `BaseAudioContext`, so the same code plays live and
 * renders into the offline context the exporter mixes with.
 */

export type SfxName = "stroke" | "pop" | "tick" | "whoosh" | "riser" | "chime" | "thud";

export interface SfxEvent {
  name: SfxName;
  /** Seconds from the start of the context's timeline. */
  at: number;
  /** 0..1, before the per-effect level is applied. */
  gain?: number;
}

/** A short burst of shaped noise, reused by several effects. */
function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministic noise: an exported file should sound like the preview.
  let seed = 22_222;
  for (let i = 0; i < frames; i += 1) {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    data[i] = (seed / 0x3fffffff - 1) * 0.9;
  }
  return buffer;
}

function envelope(
  ctx: BaseAudioContext,
  at: number,
  attack: number,
  decay: number,
  peak: number,
): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return gain;
}

/**
 * The marker itself: a dry, short scrape.
 *
 * Deliberately quiet and slightly different each time it is asked for, because
 * an identical click on every stroke is the fastest way to sound synthetic.
 */
function stroke(ctx: BaseAudioContext, out: AudioNode, at: number, level: number) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.14);
  source.playbackRate.value = 0.85 + ((at * 7) % 1) * 0.4;

  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.setValueAtTime(1_400 + ((at * 13) % 1) * 900, at);
  band.Q.value = 1.6;

  const gain = envelope(ctx, at, 0.008, 0.1, 0.05 * level);
  source.connect(band).connect(gain).connect(out);
  source.start(at);
  source.stop(at + 0.2);
}

/** A soft blip for something arriving on the board. */
function pop(ctx: BaseAudioContext, out: AudioNode, at: number, level: number) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(520, at);
  osc.frequency.exponentialRampToValueAtTime(880, at + 0.06);

  const gain = envelope(ctx, at, 0.006, 0.16, 0.14 * level);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + 0.25);
}

/** A dry click for a step landing. */
function tick(ctx: BaseAudioContext, out: AudioNode, at: number, level: number) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.03);

  const high = ctx.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 2_600;

  const gain = envelope(ctx, at, 0.004, 0.04, 0.1 * level);
  source.connect(high).connect(gain).connect(out);
  source.start(at);
  source.stop(at + 0.08);
}

/** Air moving across a cut. */
function whoosh(ctx: BaseAudioContext, out: AudioNode, at: number, level: number) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.7);

  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.8;
  band.frequency.setValueAtTime(320, at);
  band.frequency.exponentialRampToValueAtTime(2_600, at + 0.28);
  band.frequency.exponentialRampToValueAtTime(420, at + 0.6);

  const gain = envelope(ctx, at, 0.12, 0.46, 0.12 * level);
  source.connect(band).connect(gain).connect(out);
  source.start(at);
  source.stop(at + 0.8);
}

/** Tension before a number lands. */
function riser(ctx: BaseAudioContext, out: AudioNode, at: number, level: number) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(110, at);
  osc.frequency.exponentialRampToValueAtTime(660, at + 0.9);

  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.setValueAtTime(600, at);
  low.frequency.exponentialRampToValueAtTime(4_000, at + 0.9);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.07 * level, at + 0.82);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.05);

  osc.connect(low).connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + 1.1);
}

/** A small bell for a conclusion. */
function chime(ctx: BaseAudioContext, out: AudioNode, at: number, level: number) {
  // Two partials a fifth apart read as a bell without a sample.
  for (const [ratio, weight] of [
    [1, 1],
    [1.5, 0.5],
    [2.02, 0.28],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 784 * ratio;
    const gain = envelope(ctx, at, 0.01, 1.5, 0.1 * level * weight);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + 1.8);
  }
}

/** Weight under a hard cut. */
function thud(ctx: BaseAudioContext, out: AudioNode, at: number, level: number) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(160, at);
  osc.frequency.exponentialRampToValueAtTime(48, at + 0.18);
  const gain = envelope(ctx, at, 0.006, 0.3, 0.18 * level);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + 0.4);
}

const VOICES: Record<SfxName, (c: BaseAudioContext, o: AudioNode, at: number, l: number) => void> = {
  stroke,
  pop,
  tick,
  whoosh,
  riser,
  chime,
  thud,
};

export interface ScheduleWindow {
  /** Context time that represents `from` on the video timeline. */
  base?: number;
  /** Video-timeline position playback is starting at. */
  from?: number;
}

/**
 * Schedules effects onto a context's clock.
 *
 * `base`/`from` are what let the same event list serve both a fresh play and a
 * scrub into the middle of a video: anything already past is skipped, and the
 * rest is placed relative to whenever the context happens to be now.
 */
export function scheduleSfx(
  ctx: BaseAudioContext,
  out: AudioNode,
  events: SfxEvent[],
  master = 1,
  window: ScheduleWindow = {},
) {
  const base = window.base ?? 0;
  const from = window.from ?? 0;

  for (const event of events) {
    const at = base + (event.at - from);
    if (event.at < from || at < base - 0.001) continue;
    VOICES[event.name]?.(ctx, out, at, (event.gain ?? 1) * master);
  }
}
