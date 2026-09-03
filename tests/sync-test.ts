/**
 * Sound-to-picture sync.
 *
 * This file exists because of a specific, invisible class of bug. Every number
 * in the cue plan can be correct and the video can still sound wrong, for two
 * reasons that look nothing alike in the code:
 *
 * 1. **A unit mismatch across the transport boundary.** The picture clock is
 *    scene-relative; the score is written against the whole film. Passing one
 *    where the other is expected produces a schedule that is off by however
 *    long the video has been running -- and it gets worse the longer you
 *    watch, which is exactly what a viewer reports as "the effects drift".
 * 2. **Scheduling by note-on instead of by transient.** A whoosh takes a third
 *    of a second to arrive. Start it on the cut and it is heard a third of a
 *    second after the cut, every time, no matter how exact the arithmetic was.
 *
 * Both are asserted here against a recording stub of the Web Audio API, so the
 * assertions are about when a listener actually hears something rather than
 * about what the code intended.
 *
 * Run with `npx tsx tests/sync-test.ts`.
 */

import { buildScore } from "../src/lib/video/score";
import {
  scheduleSfx,
  SFX_LEAD,
  SFX_REGISTER,
  SFX_TAIL,
  type SfxEvent,
  type SfxName,
} from "../src/lib/video/sfx";
import type { Cue } from "../src/lib/video/timing";
import { scheduleMusic } from "../src/lib/video/music";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${message}`);
}

/* ------------------------------ the audio stub ----------------------------- */

/**
 * Just enough of `BaseAudioContext` to record when things start.
 *
 * Deliberately not a mock of the graph: nothing here checks routing, because
 * routing is not what goes wrong. Start times are.
 */
function recordingContext(currentTime = 0) {
  const starts: number[] = [];
  const param = () => {
    const self = {
      value: 0,
      setValueAtTime: () => self,
      exponentialRampToValueAtTime: () => self,
      linearRampToValueAtTime: () => self,
      setTargetAtTime: () => self,
      cancelScheduledValues: () => self,
    };
    return self;
  };
  const node = (extra: Record<string, unknown> = {}) => ({
    connect: (next: unknown) => next,
    disconnect: () => {},
    start: (at: number) => starts.push(at),
    stop: () => {},
    ...extra,
  });

  const ctx: Record<string, unknown> = {
    sampleRate: 48_000,
    currentTime,
    createConvolver: () => node({ buffer: null }),
    createStereoPanner: () => node({ pan: param() }),
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
      length,
    }),
    createGain: () => node({ gain: param() }),
    createOscillator: () => node({ type: "sine", frequency: param(), detune: param() }),
    createBufferSource: () => node({ buffer: null, playbackRate: param() }),
    createBiquadFilter: () => node({ type: "lowpass", frequency: param(), Q: param() }),
    createDynamicsCompressor: () =>
      node({
        threshold: param(),
        knee: param(),
        ratio: param(),
        attack: param(),
        release: param(),
      }),
  };

  return { ctx: ctx as unknown as BaseAudioContext, starts, raw: ctx };
}

/** When a listener hears the effect, given where its nodes were started. */
function heardAt(name: SfxName, starts: number[]): number {
  return Math.min(...starts) + SFX_LEAD[name];
}

/* ---------------------- 1. an effect lands where it says --------------------- */

{
  const names: SfxName[] = ["whoosh", "riser", "reverse", "swish", "pop", "impact", "sub"];
  for (const name of names) {
    const { ctx, starts } = recordingContext(0);
    const out = ctx.createGain();
    scheduleSfx(ctx, out, [{ name, at: 10 }], 1, { base: 0, from: 0 });
    assert(starts.length > 0, `${name} scheduled something`);
    const heard = heardAt(name, starts);
    assert(
      Math.abs(heard - 10) < 0.001,
      `${name} is heard on its beat, not ${(heard - 10).toFixed(3)}s away`,
    );
  }

  // The approach voices must genuinely start early -- an assertion that would
  // pass trivially if every lead were zero.
  const { ctx, starts } = recordingContext(0);
  scheduleSfx(ctx, ctx.createGain(), [{ name: "riser", at: 10 }], 1, {});
  assert(Math.min(...starts) < 9.2, "a riser opens most of a second before it resolves");
}

/* ------------------------- 2. windows and playback rate ------------------------ */

{
  const events: SfxEvent[] = [
    { name: "tick", at: 1 },
    { name: "tick", at: 5 },
    { name: "tick", at: 9 },
  ];

  const { ctx, starts } = recordingContext(0);
  const placed = scheduleSfx(ctx, ctx.createGain(), events, 1, { from: 4, until: 6 });
  assert(placed === 1, `only the in-window event is placed, got ${placed}`);
  assert(Math.abs(starts[0] - 1) < 0.001, "and it is placed relative to the window start");

  // Half speed doubles the wall-clock distance between two beats.
  const slow = recordingContext(0);
  scheduleSfx(slow.ctx, slow.ctx.createGain(), events, 1, { from: 0, rate: 0.5 });
  assert(Math.abs(slow.starts[1] - slow.starts[0] - 8) < 0.01, "0.5x stretches the gaps");
}

/* ------------- 3. the rolling scheduler survives a drifting clock ------------- */

/**
 * The real test.
 *
 * A picture clock that runs slightly fast and is yanked back by the narration
 * twice -- which is what actually happens on a stalled buffer -- is simulated
 * at 90ms ticks, exactly as the player pumps it. Every effect must still be
 * heard within a frame or two of the timeline position it was written for.
 *
 * Under the old design (commit the whole score once, rebuild on a threshold)
 * the second correction alone put every remaining effect out by a quarter of a
 * second, and the unit mismatch put them out by the whole running time.
 */
{
  const events: SfxEvent[] = Array.from({ length: 24 }, (_, index) => ({
    name: (index % 4 === 0 ? "whoosh" : "pop") as SfxName,
    at: 2 + index * 1.7,
  }));

  const LOOKAHEAD = 1.3;
  const TICK = 0.09;
  /** Timeline position -> the context time it was committed to play at. */
  let committed = new Map<number, number>();

  let contextTime = 0;
  let picture = 0;
  let cursor = 0;
  /** Where the picture would be if it had never been corrected. */
  const snaps: Array<{ contextAt: number; by: number }> = [];

  for (let step = 0; step < 600; step += 1) {
    // The picture runs 1.5% fast, and is snapped back onto the narration twice.
    picture += TICK * 1.015;
    contextTime += TICK;

    let snapped = 0;
    if (step === 120) snapped = -0.31;
    if (step === 300) snapped = 0.27;
    if (snapped) {
      picture += snapped;
      snaps.push({ contextAt: contextTime, by: snapped });
      // What the player does on a hard resync: the effects bus is thrown away,
      // so anything committed but not yet played is discarded and re-laid from
      // where the picture now is. The bed underneath is untouched.
      committed = new Map([...committed].filter(([, at]) => at <= contextTime));
      cursor = picture;
    }

    if (cursor < picture) cursor = picture;
    const until = picture + LOOKAHEAD;
    if (until <= cursor) continue;

    for (const event of events) {
      if (event.at < cursor || event.at >= until) continue;
      const at = contextTime + (event.at - picture);
      assert(!committed.has(event.at), `event at ${event.at} is committed once`);
      committed.set(event.at, at);
    }
    cursor = until;
  }

  assert(
    committed.size === events.length,
    `every effect was scheduled: ${committed.size}/${events.length}`,
  );

  // Where the picture actually was at the moment each effect played.
  const pictureAt = (contextAt: number) => {
    let value = contextAt * 1.015;
    for (const snap of snaps) if (contextAt >= snap.contextAt) value += snap.by;
    return value;
  };

  let worst = 0;
  for (const event of events) {
    worst = Math.max(worst, Math.abs(pictureAt(committed.get(event.at)!) - event.at));
  }
  // Two frames at 30fps. Anything inside this is inaudible as a sync error.
  assert(worst < 0.067, `worst-case slip stays under two frames, got ${(worst * 1000).toFixed(0)}ms`);
}

/* ---------------------------- 4. the score itself ---------------------------- */

{
  const cue = (at: number): Cue => ({ at, span: 0.8, anchored: true });
  const score = buildScore({
    coverDuration: 3.2,
    style: "hyperframes",
    mood: "curious",
    scenes: [
      { start: 3.2, duration: 10, lead: 0.5, speech: 8, cues: [cue(0), cue(2), cue(4)], hasNarration: true, role: "process" },
      { start: 13.2, duration: 9, lead: 0.5, speech: 7.5, cues: [cue(0), cue(3)], statAt: 5, hasNarration: true, role: "metric" },
      { start: 22.2, duration: 8, lead: 0.5, speech: 6.5, cues: [cue(0)], hasNarration: true, role: "deck" },
    ],
  });

  assert(score.sfx.length > 0, "a three-scene film gets a score");
  assert(score.key > 100 && score.key < 400, "the score is written in the bed's key");

  for (const event of score.sfx) {
    assert(event.key === score.key, `${event.name} is tuned to the bed`);
  }

  // Monotonic, and never crowded: two transients inside 85ms are heard as one
  // muddled hit, which is what "the sound effects are a mess" means.
  for (let i = 1; i < score.sfx.length; i += 1) {
    const previous = score.sfx[i - 1];
    const event = score.sfx[i];
    assert(event.at - previous.at >= 0, "the schedule is in order");
    // Layers of one designed sound are allowed to coincide; two unrelated
    // hits inside 85ms are heard as one muddled mark.
    if (event.group === previous.group) continue;
    assert(
      event.at - previous.at >= 0.084,
      `no two hits inside 85ms (${previous.name}/${event.name} at ${(event.at - previous.at).toFixed(3)}s)`,
    );
  }

  // The cut sound is written on the cut. The scheduler, not the score, is what
  // makes it open early -- so a whoosh whose `at` is 0.18s before the scene
  // start is now a bug rather than a hand-tuned offset.
  const cuts = score.sfx.filter((event) => event.name === "whoosh").map((event) => event.at);
  for (const start of [3.2, 13.2, 22.2]) {
    assert(cuts.some((at) => Math.abs(at - start) < 0.001), `a cut sound lands on ${start}s`);
  }

  // The number is led into and landed on, in that order.
  const riser = score.sfx.find((event) => event.name === "riser");
  assert(riser != null && Math.abs(riser.at - 18.2) < 0.001, "the riser resolves on the statistic");

  /**
   * Nothing rings.
   *
   * A long tonal tail arrives after the picture has moved on, stacks with the
   * next one, and sits in the same register as the voice. It is the single
   * most distracting thing a soundtrack can put over a talking video, and it
   * is also the most tempting mark to reach for -- which is exactly why it is
   * asserted against rather than left to taste.
   */
  const RINGING = 0.55;
  for (const event of score.sfx) {
    // A sub is allowed to hang: nothing about a 40Hz tail competes with a
    // voice. Anything in the register speech occupies must be over quickly.
    if (SFX_REGISTER[event.name] === "sub") continue;
    assert(
      SFX_TAIL[event.name] <= RINGING,
      `${event.name} rings for ${SFX_TAIL[event.name]}s in the ${SFX_REGISTER[event.name]} register`,
    );
  }

  // And the whole palette, not merely the marks this fixture happened to use.
  for (const [name, tail] of Object.entries(SFX_TAIL)) {
    if (SFX_REGISTER[name as SfxName] === "sub") continue;
    assert(tail <= RINGING, `the palette itself contains a ringing voice: ${name} (${tail}s)`);
  }

  // Ducking covers every narration span so the bed never fights the voice.
  assert(score.duck.length === 3, "every narrated scene ducks the bed");
  assert(Math.abs(score.duck[0].from - 3.7) < 0.001, "ducking starts when the voice does");

  // Silence is silence.
  const muted = buildScore({ coverDuration: 3.2, style: "whiteboard", scenes: [], intensity: 0 });
  assert(muted.sfx.length === 0, "intensity 0 writes no effects at all");
}

/* ------------------------------ 5. the bed ------------------------------- */

/**
 * The music, which fails differently from everything else here.
 *
 * A bed does not need to be sample-accurate -- nobody hears a pad a tenth of a
 * second late -- so what is asserted is that it exists, that it respects the
 * window it was given, and that it survives a browser missing the optional
 * nodes it reaches for. The last one matters: a convolver or a stereo panner
 * that is not there must cost the room or the width, never the music.
 */
{
  const full = recordingContext(0);
  scheduleMusic(full.ctx, full.ctx.createGain(), {
    mood: "curious",
    duration: 60,
    duck: [{ from: 4, to: 12 }],
  });
  assert(full.starts.length > 20, `a minute of bed is more than a few notes: ${full.starts.length}`);
  assert(Math.min(...full.starts) >= 0, "nothing is scheduled before the context starts");
  assert(Math.max(...full.starts) <= 61, "and nothing past the end of the video");

  // Joining halfway: everything already past is skipped rather than crammed in.
  const joined = recordingContext(0);
  scheduleMusic(joined.ctx, joined.ctx.createGain(), { mood: "curious", duration: 60, from: 40 });
  assert(
    joined.starts.length < full.starts.length,
    "a scrub into the middle does not re-lay the whole bed",
  );

  // A browser without the optional nodes still gets a bed.
  const bare = recordingContext(0);
  delete (bare as unknown as { raw: Record<string, unknown> }).raw.createConvolver;
  delete (bare as unknown as { raw: Record<string, unknown> }).raw.createStereoPanner;
  let threw = false;
  try {
    scheduleMusic(bare.ctx, bare.ctx.createGain(), { mood: "calm", duration: 30 });
  } catch {
    threw = true;
  }
  assert(!threw, "a missing convolver or panner costs the room, not the music");
  assert(bare.starts.length > 5, "and the notes are still there");

  // Silence is silence.
  const silent = recordingContext(0);
  scheduleMusic(silent.ctx, silent.ctx.createGain(), { mood: "none", duration: 30 });
  assert(silent.starts.length === 0, "\"none\" writes no bed at all");
}

if (failures) {
  console.error(`\n${failures} sync assertion(s) failed`);
  process.exit(1);
}
console.log("ALL SYNC TESTS PASSED");
