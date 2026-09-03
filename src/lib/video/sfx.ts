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
 * ## `at` is when you HEAR it
 *
 * The single most important contract in this file. A whoosh takes a third of a
 * second to arrive and a riser takes a second; if both are started at the beat
 * they are meant to hit, both are heard late -- which is exactly what "the
 * sound effects are out of sync" sounds like, even when every number in the
 * schedule is correct. So each voice declares its `lead`: the distance from
 * the node starting to the moment a listener perceives the hit. The scheduler
 * subtracts it. Callers name the frame the effect belongs on and never think
 * about attack times again.
 *
 * ## No bells
 *
 * There is deliberately nothing in this palette that rings. A bell is the
 * default reach for "something resolved" and it is the wrong one for a talking
 * video: a long tonal tail arrives after the picture has already moved on, it
 * stacks with the next one, and it sits in the same register as the voice. It
 * is the sound people mean when they say a video's audio is distracting, and
 * once you have heard it you cannot stop hearing it. Resolution here is done
 * with weight -- a sub, an impact -- and marks are short and mostly noise.
 *
 * Everything takes a `BaseAudioContext`, so the same code plays live and
 * renders into the offline context the exporter mixes with.
 */

export type SfxName =
  /* transient -- the hit is the first sample */
  | "tick"
  | "pop"
  | "stroke"
  | "thud"
  | "impact"
  | "sub"
  | "key"
  | "latch"
  /* approach -- the hit is somewhere after the node starts */
  | "swish"
  | "whoosh"
  | "reverse"
  | "riser";

export interface SfxEvent {
  name: SfxName;
  /**
   * Seconds from the start of the context's timeline at which the effect
   * should be *heard*. Approach effects are started earlier than this by
   * their own lead.
   */
  at: number;
  /** 0..1, before the per-effect level is applied. */
  gain?: number;
  /**
   * Musical root, in Hz, for the tonal voices. Passing the bed's root is what
   * keeps a mark from sitting a semitone off the pad underneath it -- the
   * detail that separates a scored video from one with sounds on it.
   */
  key?: number;
  /** -1..1. A little width stops repeated marks stacking in the centre. */
  pan?: number;
  /** Varies the noise and detune between two otherwise identical hits. */
  seed?: number;
  /**
   * Marks events that are one designed sound rather than several.
   *
   * A cut is air plus weight; a statistic is a riser plus the bell that
   * resolves it. Those layers are written to land together on purpose, so the
   * mixdown must not treat them as a collision and throw one away. Anything
   * sharing a group is a chord; anything crossing groups is a clash.
   */
  group?: string;
}

/**
 * How long before its transient each voice has to start.
 *
 * These are measured from the envelopes below, not guessed: change an attack
 * and the matching number here moves with it.
 */
export const SFX_LEAD: Record<SfxName, number> = {
  tick: 0,
  pop: 0,
  stroke: 0,
  thud: 0,
  impact: 0,
  sub: 0,
  key: 0,
  latch: 0,
  swish: 0.17,
  whoosh: 0.33,
  reverse: 0.54,
  riser: 0.92,
};

/**
 * Where each voice sits, relative to the narration.
 *
 * The distinction that matters for distraction is not "how long does it last"
 * but "how long does it last *in the register the voice occupies*". A sub can
 * decay for the better part of a second and read as weight, because nothing
 * about a 40Hz tail competes with speech. The same decay at 800Hz is a bell,
 * and a bell is the thing you cannot stop hearing.
 *
 * So: anything in `body` or `bright` must be short. `sub` is allowed to hang.
 */
export const SFX_REGISTER: Record<SfxName, "sub" | "body" | "bright"> = {
  tick: "bright",
  key: "bright",
  latch: "bright",
  swish: "bright",
  stroke: "bright",
  pop: "body",
  whoosh: "body",
  reverse: "body",
  riser: "body",
  impact: "body",
  thud: "sub",
  sub: "sub",
};

/** How long each voice rings on past its transient, for overlap checks. */
export const SFX_TAIL: Record<SfxName, number> = {
  tick: 0.05,
  pop: 0.1,
  stroke: 0.14,
  thud: 0.32,
  impact: 0.5,
  sub: 0.7,
  key: 0.12,
  latch: 0.09,
  swish: 0.2,
  whoosh: 0.42,
  reverse: 0.12,
  riser: 0.16,
};

/* ------------------------------- primitives ------------------------------- */

/** A short burst of shaped noise, reused by several effects. */
function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed = 22_222): AudioBuffer {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministic noise: an exported file should sound like the preview.
  let state = (Math.floor(seed) * 2_654_435_761) & 0x7fffffff;
  for (let i = 0; i < frames; i += 1) {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
    data[i] = (state / 0x3fffffff - 1) * 0.9;
  }
  return buffer;
}

/**
 * Noise that swells backwards into a point.
 *
 * The classic pre-cut sound, and the one thing a synthesised palette usually
 * lacks: everything else here decays, so an effect that *arrives* is what
 * makes a cut feel authored rather than sudden.
 */
function reverseBuffer(ctx: BaseAudioContext, seconds: number, seed = 909): AudioBuffer {
  const buffer = noiseBuffer(ctx, seconds, seed);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    const t = i / data.length;
    data[i] *= t * t * t;
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

/** Deterministic 0..1 from a seed, so two hits differ but a re-render does not. */
function jitter(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43_758.5453;
  return x - Math.floor(x);
}

const semitone = (root: number, steps: number) => root * Math.pow(2, steps / 12);

interface VoiceContext {
  ctx: BaseAudioContext;
  out: AudioNode;
  /** Context time of the *transient*, after the lead has been subtracted. */
  at: number;
  level: number;
  key: number;
  seed: number;
}

/* --------------------------------- voices --------------------------------- */

/**
 * The marker itself: a dry, short scrape.
 *
 * Deliberately quiet and slightly different each time it is asked for, because
 * an identical click on every stroke is the fastest way to sound synthetic.
 */
function stroke({ ctx, out, at, level, seed }: VoiceContext) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.14, seed * 31 + 7);
  source.playbackRate.value = 0.85 + jitter(seed) * 0.4;

  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.setValueAtTime(1_400 + jitter(seed + 3) * 900, at);
  band.Q.value = 1.6;

  const gain = envelope(ctx, at, 0.008, 0.1, 0.05 * level);
  source.connect(band).connect(gain).connect(out);
  source.start(at);
  source.stop(at + 0.2);
}

/**
 * A soft knock for something arriving on the board.
 *
 * Deliberately not a bleep. An exposed sine with a long decay rings, and a
 * ring is the one thing in a soundtrack a viewer cannot stop hearing -- it
 * arrives after the picture has moved on and it stacks with the next one. So
 * this is mostly a short noise transient with just enough pitch under it to
 * have a body, tuned to the bed and stepped up the triad so a row of four
 * items reads as a phrase rather than four identical taps.
 */
function pop({ ctx, out, at, level, key, seed }: VoiceContext) {
  const degree = [0, 4, 7, 11, 12][Math.floor(seed) % 5];
  // Two octaves down from where this used to sit: a body, not a bell.
  const base = semitone(key * 2, degree);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(base * 0.7, at);
  osc.frequency.exponentialRampToValueAtTime(base * 0.42, at + 0.07);

  // The noise carries the mark; the pitch is only underneath it.
  const air = ctx.createBufferSource();
  air.buffer = noiseBuffer(ctx, 0.05, seed * 17 + 1);
  const airFilter = ctx.createBiquadFilter();
  airFilter.type = "bandpass";
  airFilter.frequency.value = 1_800 + jitter(seed + 5) * 700;
  airFilter.Q.value = 0.8;

  // Short enough that it is over before the next word is spoken.
  osc.connect(envelope(ctx, at, 0.004, 0.075, 0.075 * level)).connect(out);
  air.connect(airFilter).connect(envelope(ctx, at, 0.002, 0.05, 0.05 * level)).connect(out);
  osc.start(at);
  osc.stop(at + 0.12);
  air.start(at);
  air.stop(at + 0.08);
}

/** A dry click for a step landing. */
function tick({ ctx, out, at, level, seed }: VoiceContext) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.03, seed * 13 + 5);

  const high = ctx.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 2_600;

  const gain = envelope(ctx, at, 0.004, 0.04, 0.1 * level);
  source.connect(high).connect(gain).connect(out);
  source.start(at);
  source.stop(at + 0.08);
}

/**
 * A single keystroke, for type that arrives a word at a time.
 *
 * Quieter and tighter than `tick`: this one is allowed to repeat quickly, so
 * anything with a ring on it would turn a headline into a rattle.
 */
function key({ ctx, out, at, level, seed }: VoiceContext) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.02, seed * 19 + 2);
  source.playbackRate.value = 0.9 + jitter(seed) * 0.3;

  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 3_600 + jitter(seed + 11) * 1_400;
  band.Q.value = 0.9;

  const gain = envelope(ctx, at, 0.002, 0.028, 0.055 * level);
  source.connect(band).connect(gain).connect(out);
  source.start(at);
  source.stop(at + 0.05);
}

/** Two-part mechanical click: something locking into position. */
function latch({ ctx, out, at, level, seed }: VoiceContext) {
  for (const [index, offset] of [0, 0.032].entries()) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx, 0.02, seed * 23 + index * 5);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = index === 0 ? 2_200 : 4_400;
    band.Q.value = 1.4;
    const gain = envelope(ctx, at + offset, 0.002, 0.03, (index === 0 ? 0.09 : 0.055) * level);
    source.connect(band).connect(gain).connect(out);
    source.start(at + offset);
    source.stop(at + offset + 0.06);
  }
}

/**
 * Air moving across a cut, peaking on the cut itself.
 *
 * The sweep is written backwards from `at`: it opens 0.33s early, crests
 * exactly on the frame the picture changes, and falls away into the new shot.
 */
function whoosh({ ctx, out, at, level, seed }: VoiceContext) {
  const lead = SFX_LEAD.whoosh;
  const start = at - lead;

  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.9, seed * 37 + 3);

  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.8;
  band.frequency.setValueAtTime(320, start);
  band.frequency.exponentialRampToValueAtTime(2_800, at);
  band.frequency.exponentialRampToValueAtTime(420, at + 0.4);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.13 * level, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);

  source.connect(band).connect(gain).connect(out);
  source.start(start);
  source.stop(at + 0.5);
}

/** The same gesture, a third the length. For a beat, not a cut. */
function swish({ ctx, out, at, level, seed }: VoiceContext) {
  const start = at - SFX_LEAD.swish;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.4, seed * 41 + 9);

  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.1;
  band.frequency.setValueAtTime(900, start);
  band.frequency.exponentialRampToValueAtTime(3_400, at);
  band.frequency.exponentialRampToValueAtTime(1_100, at + 0.18);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.075 * level, at - 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);

  source.connect(band).connect(gain).connect(out);
  source.start(start);
  source.stop(at + 0.24);
}

/** A reverse swell that vanishes on the hit. Announces without covering it. */
function reverse({ ctx, out, at, level, seed }: VoiceContext) {
  const start = at - SFX_LEAD.reverse;
  const source = ctx.createBufferSource();
  source.buffer = reverseBuffer(ctx, SFX_LEAD.reverse, seed * 53 + 13);

  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.7;
  band.frequency.setValueAtTime(600, start);
  band.frequency.exponentialRampToValueAtTime(4_200, at);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.1 * level, at - 0.02);
  // Cut, not faded: the point of a reverse is the silence it leaves.
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);

  source.connect(band).connect(gain).connect(out);
  source.start(start);
  source.stop(at + 0.1);
}

/** Tension before a number lands, resolving exactly as it does. */
function riser({ ctx, out, at, level, key: root, seed }: VoiceContext) {
  const start = at - SFX_LEAD.riser;

  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  // Rises to the fifth above the bed's root, so the impact that lands on it
  // arrives as a resolution rather than as an interruption.
  osc.frequency.setValueAtTime(semitone(root, -12), start);
  osc.frequency.exponentialRampToValueAtTime(semitone(root, 7), at);

  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.setValueAtTime(600, start);
  low.frequency.exponentialRampToValueAtTime(4_600, at);

  const air = ctx.createBufferSource();
  air.buffer = noiseBuffer(ctx, SFX_LEAD.riser + 0.1, seed * 59 + 17);
  const airBand = ctx.createBiquadFilter();
  airBand.type = "highpass";
  airBand.frequency.setValueAtTime(1_200, start);
  airBand.frequency.exponentialRampToValueAtTime(7_000, at);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.07 * level, at - 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);

  const airGain = ctx.createGain();
  airGain.gain.setValueAtTime(0.0001, start);
  airGain.gain.exponentialRampToValueAtTime(0.03 * level, at - 0.04);
  airGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);

  osc.connect(low).connect(gain).connect(out);
  air.connect(airBand).connect(airGain).connect(out);
  osc.start(start);
  osc.stop(at + 0.18);
  air.start(start);
  air.stop(at + 0.16);
}

/** Weight under a hard cut. */
function thud({ ctx, out, at, level, key: root }: VoiceContext) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(semitone(root, 0), at);
  osc.frequency.exponentialRampToValueAtTime(semitone(root, -20), at + 0.18);
  const gain = envelope(ctx, at, 0.006, 0.3, 0.18 * level);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + 0.4);
}

/**
 * A full-band impact: the sound of something big arriving.
 *
 * Noise crack over a pitched drop. Used sparingly -- on a title landing, on
 * the one statistic the film is built around -- because it is the loudest
 * thing in the palette and loses all of its meaning the second time.
 */
function impact({ ctx, out, at, level, key: root, seed }: VoiceContext) {
  const crack = ctx.createBufferSource();
  crack.buffer = noiseBuffer(ctx, 0.25, seed * 71 + 19);
  const crackBand = ctx.createBiquadFilter();
  crackBand.type = "lowpass";
  crackBand.frequency.setValueAtTime(6_000, at);
  crackBand.frequency.exponentialRampToValueAtTime(500, at + 0.22);
  crack.connect(crackBand).connect(envelope(ctx, at, 0.003, 0.22, 0.1 * level)).connect(out);
  crack.start(at);
  crack.stop(at + 0.3);

  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(semitone(root, 0), at);
  body.frequency.exponentialRampToValueAtTime(semitone(root, -24), at + 0.3);
  body.connect(envelope(ctx, at, 0.005, 0.45, 0.2 * level)).connect(out);
  body.start(at);
  body.stop(at + 0.55);
}

/** Sub only: felt, not heard. Under a cut that needs weight but not attention. */
function sub({ ctx, out, at, level, key: root }: VoiceContext) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(semitone(root, -12), at);
  osc.frequency.exponentialRampToValueAtTime(semitone(root, -26), at + 0.5);
  osc.connect(envelope(ctx, at, 0.02, 0.62, 0.16 * level)).connect(out);
  osc.start(at);
  osc.stop(at + 0.75);
}

const VOICES: Record<SfxName, (voice: VoiceContext) => void> = {
  stroke,
  pop,
  tick,
  key,
  latch,
  whoosh,
  swish,
  reverse,
  riser,
  thud,
  impact,
  sub,
};

/* -------------------------------- scheduling ------------------------------- */

/** Default musical root when a caller has no bed to tune against: D3. */
export const DEFAULT_KEY = 146.83;

export interface ScheduleWindow {
  /** Context time that represents `from` on the video timeline. */
  base?: number;
  /** Video-timeline position playback is starting at. */
  from?: number;
  /** Video-timeline position to stop scheduling at, exclusive. */
  until?: number;
  /**
   * Playback rate the picture is running at.
   *
   * Effects are placed on the context clock once and then run on their own,
   * so a 1.25x preview would drift a quarter-second further out of step every
   * second unless the timeline is compressed to match.
   */
  rate?: number;
  /** Musical root of the bed, so tonal effects sit in key with it. */
  key?: number;
}

/**
 * A bus that makes a pile of synthesised hits sound like a mix.
 *
 * Two things happen here that cannot be done per voice. A gentle high-pass
 * keeps the sub voices from muddying the narration, and a slow compressor
 * catches the moment three cues land together -- without it, a busy scene is
 * the only place in the video where the effects are suddenly twice as loud as
 * everywhere else.
 */
export function createSfxBus(ctx: BaseAudioContext, out: AudioNode): GainNode {
  const input = ctx.createGain();

  const high = ctx.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 60;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 26;
  comp.ratio.value = 3.2;
  comp.attack.value = 0.006;
  comp.release.value = 0.22;

  input.connect(high).connect(comp).connect(out);
  return input;
}

/**
 * Schedules effects onto a context's clock.
 *
 * `base`/`from` are what let the same event list serve both a fresh play and a
 * scrub into the middle of a video: anything already past is skipped, and the
 * rest is placed relative to whenever the context happens to be now. `until`
 * is what lets a live player schedule a rolling window a few hundred
 * milliseconds ahead of the picture instead of committing the whole film at
 * once -- the only arrangement in which effects cannot drift away from a clock
 * that is itself being corrected against the narration.
 *
 * Returns the number of events placed, so a rolling scheduler can tell whether
 * a window did anything.
 */
export function scheduleSfx(
  ctx: BaseAudioContext,
  out: AudioNode,
  events: SfxEvent[],
  master = 1,
  window: ScheduleWindow = {},
): number {
  const base = window.base ?? 0;
  const from = window.from ?? 0;
  const until = window.until ?? Number.POSITIVE_INFINITY;
  const rate = window.rate && window.rate > 0 ? window.rate : 1;
  const root = window.key ?? DEFAULT_KEY;
  let placed = 0;

  for (const [index, event] of events.entries()) {
    if (event.at < from || event.at >= until) continue;
    const voice = VOICES[event.name];
    if (!voice) continue;

    const at = base + (event.at - from) / rate;
    // An approach effect that is already partly in the past is played from
    // where it would be now rather than dropped: on a scrub, losing the whoosh
    // under the cut you just landed on is more noticeable than a short one.
    const start = at - SFX_LEAD[event.name] / rate;
    if (start < base - SFX_LEAD[event.name]) continue;

    voice({
      ctx,
      out,
      at: Math.max(at, base + SFX_LEAD[event.name] / rate),
      level: (event.gain ?? 1) * master,
      key: event.key ?? root,
      seed: event.seed ?? index + 1,
    });
    placed += 1;
  }

  return placed;
}
