/**
 * The seams: does the finished video agree with the transcript it was made from?
 *
 * Every part of this editor is tested on its own — cuts, cues, motion, the
 * mixer. What none of those can catch is the two of them disagreeing, and that
 * is where every visible failure in a transcript editor lives: captions that
 * say something the transcript no longer says, an overlay placed against the
 * source clock and drawn against the output one, a clip in the mix that the
 * exporter never writes an input for.
 *
 * So this walks one small project all the way through — words, deletions,
 * cuts, an output clock, captions, motion, sound — and checks the pieces
 * against each other rather than against their own expectations.
 *
 * Run with `npx tsx tests/wired-test.ts`.
 */

import { getCutRanges, getKeepRanges, originalToEdited } from "../src/rescript/lib/edits";
import { buildTimeline, outputToOriginal } from "../src/rescript/lib/overlay/timeline";
import { cuesAreStale, cuesFromStyle } from "../src/rescript/lib/overlay/subtitles";
import { drawStateAt } from "../src/rescript/lib/overlay/animation";
import { buildMixGraph } from "../src/rescript/lib/overlay/mix";
import {
  audibleClips,
  defaultGainFor,
  type AudioClip,
} from "../src/rescript/lib/overlay/audio";
import { DEFAULT_SUBTITLE_STYLE } from "../src/rescript/lib/overlay/types";
import type { TextElement } from "../src/rescript/lib/overlay/types";
import type { Word } from "../src/rescript/lib/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function near(actual: number, expected: number, tol: number, what: string) {
  assert(
    Math.abs(actual - expected) <= tol,
    `${what}: expected ~${expected}, got ${actual.toFixed(4)}`
  );
}

/* ------------------------------- the project -------------------------------- */

const SPOKEN = [
  "So", "we", "shipped", "it", "on", "a", "Friday.",
  "um", "which", "is",
  "not", "something", "I", "would", "recommend.",
  "It", "took", "six", "weeks.",
];

/** Word `i` runs from 2i to 2i+1.4, so there is a 0.6s gap between each. */
const words: Word[] = SPOKEN.map((text, i) => ({
  id: i + 1,
  text,
  start: i * 2,
  end: i * 2 + 1.4,
  speaker: 0,
  // "um", and the aside after it.
  deleted: text === "um",
}));

const DURATION = SPOKEN.length * 2;

/* ------------------------------ the two clocks ------------------------------ */

{
  const cuts = getCutRanges(words, DURATION, []);
  const keeps = getKeepRanges(cuts, DURATION);
  const timeline = buildTimeline(words, DURATION, [], []);

  assert(cuts.length === 1, `expected one cut for the filler, got ${cuts.length}`);
  assert(timeline.duration < DURATION, "the cut did not shorten the video");
  near(
    timeline.duration,
    keeps.reduce((sum, k) => sum + (k.end - k.start), 0),
    1e-6,
    "the output length is the sum of what is kept"
  );

  // The two mappings are inverses on anything that survived the cut. Getting
  // this wrong is how an overlay ends up a second and a half from where it was
  // placed, which nobody notices until the export.
  for (const keep of keeps) {
    for (let t = keep.start + 0.01; t < keep.end; t += 0.37) {
      const out = originalToEdited(t, cuts);
      near(outputToOriginal(out, keeps), t, 1e-6, `round trip at source ${t.toFixed(2)}s`);
      assert(out >= 0 && out <= timeline.duration + 1e-6, `output ${out} outside the video`);
    }
  }

  // Nothing inside a cut maps forward into the middle of the video.
  const inside = (cuts[0].start + cuts[0].end) / 2;
  near(
    originalToEdited(inside, cuts),
    originalToEdited(cuts[0].start, cuts),
    1e-6,
    "a deleted moment maps to the join, not past it"
  );
  console.log("✓ the source clock and the output clock are inverses of each other");
}

/* ------------------------- captions match the words ------------------------- */

{
  const cuts = getCutRanges(words, DURATION, []);
  const timeline = buildTimeline(words, DURATION, [], []);
  const cues = cuesFromStyle(words, cuts, DEFAULT_SUBTITLE_STYLE);

  assert(cues.length > 0, "no captions were built from the transcript");

  // Every caption is inside the finished video, in order, and does not overlap
  // the next one. A cue past the end is drawn by nothing and exported anyway.
  for (let i = 0; i < cues.length; i++) {
    assert(cues[i].start >= -1e-6, `cue ${i} starts before the video`);
    assert(
      cues[i].end <= timeline.duration + 1e-6,
      `cue ${i} ends at ${cues[i].end} past a ${timeline.duration}s video`
    );
    assert(cues[i].end > cues[i].start, `cue ${i} ends before it starts`);
    if (i > 0) {
      assert(cues[i].start >= cues[i - 1].end - 1e-6, `cue ${i} overlaps the one before it`);
    }
  }

  // The captions are the transcript: every kept word, in order, and nothing
  // that was cut. This is the property the whole feature is for.
  const captioned = cues
    .map((c) => c.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const kept = words
    .filter((w) => !w.deleted)
    .map((w) => w.text)
    .join(" ");
  assert(captioned === kept, `captions read "${captioned}"\n  transcript is "${kept}"`);
  assert(!/\bum\b/.test(captioned), "a deleted word reached the captions");

  // Per-word timings, which is what karaoke and per-word emphasis animate
  // against — and they have to be on the output clock like everything else.
  const timed = cues.filter((c) => c.words?.length);
  assert(timed.length === cues.length, "some cues came back without word timings");
  for (const cue of cues) {
    for (const word of cue.words ?? []) {
      assert(
        word.start >= cue.start - 1e-6 && word.end <= cue.end + 1e-6,
        `a word in "${cue.text}" is timed outside its own cue`
      );
    }
  }
  console.log("✓ the captions are the transcript, on the output clock, in order");
}

/* --------------------------- ...and notice when not ------------------------- */

{
  const cuts = getCutRanges(words, DURATION, []);
  const cues = cuesFromStyle(words, cuts, DEFAULT_SUBTITLE_STYLE);

  assert(
    !cuesAreStale(cues, words, cuts, DEFAULT_SUBTITLE_STYLE),
    "freshly built captions were reported as out of date"
  );

  // The case the old check missed entirely: same count, same timings, different
  // words. A correction, or a switch between a native script and Hinglish.
  const corrected = words.map((w) =>
    w.text === "Friday." ? { ...w, text: "Thursday." } : w
  );
  assert(
    cuesAreStale(cues, corrected, getCutRanges(corrected, DURATION, []), DEFAULT_SUBTITLE_STYLE),
    "correcting a word left the captions reported as up to date"
  );

  // And the case it did catch, which must keep working.
  const recut = words.map((w) => (w.text === "weeks." ? { ...w, deleted: true } : w));
  assert(
    cuesAreStale(cues, recut, getCutRanges(recut, DURATION, []), DEFAULT_SUBTITLE_STYLE),
    "cutting a word left the captions reported as up to date"
  );
  console.log("✓ captions that no longer match the transcript are known to be stale");
}

/* --------------------- overlays land where the words are -------------------- */

{
  const cuts = getCutRanges(words, DURATION, []);
  const timeline = buildTimeline(words, DURATION, [], []);

  // "six weeks" is the phrase worth a counter over it. Placed from the word's
  // own timing, mapped onto the output clock — the same journey `captionPhrase`
  // and every `/` command make.
  const six = words.find((w) => w.text === "six")!;
  const at = originalToEdited(six.start, cuts);
  assert(at > 0 && at < timeline.duration, `"six" maps to ${at}, outside the video`);

  const element: TextElement = {
    id: "t1",
    kind: "text",
    name: "six weeks",
    text: "6 weeks",
    start: at,
    end: Math.min(timeline.duration, at + 3),
    rect: { x: 0.2, y: 0.35, w: 0.6, h: 0.2 },
    rotation: 0,
    opacity: 1,
    z: 1,
    locked: false,
    hidden: false,
    enter: { kind: "pop", duration: 0.4, easing: "backOut" },
    exit: { kind: "fade", duration: 0.3, easing: "easeIn" },
    ambient: { kind: "breathe" },
    counter: { from: 0, to: 6, suffix: " weeks" },
    fontFamily: "sans-serif",
    fontWeight: 800,
    italic: false,
    fontSize: 0.12,
    color: "#ffffff",
    align: "center",
    lineHeight: 1.1,
    letterSpacing: 0,
    padding: 0.2,
    background: null,
    strokeColor: null,
    strokeWidth: 0,
  } as TextElement;

  // On screen for its whole window and nowhere else — the exporter walks every
  // frame of the output and asks exactly this.
  assert(drawStateAt(element, element.start - 0.01) === null, "drawn before it exists");
  assert(drawStateAt(element, element.end) === null, "still drawn after it has gone");

  let moved = false;
  for (let t = element.start; t < element.end; t += 1 / 30) {
    const state = drawStateAt(element, t);
    assert(state !== null, `not drawn at ${t.toFixed(2)}s, inside its own window`);
    assert(state!.opacity >= 0 && state!.opacity <= 1, "opacity left 0..1");
    assert(state!.progress >= 0 && state!.progress <= 1, "progress left 0..1");
    if (Math.abs(state!.scale - 1) > 1e-6) moved = true;
  }
  assert(moved, "the ambient motion never reached a single exported frame");
  console.log("✓ an overlay placed from a word is on screen for exactly its own window");
}

/* ------------------------------ the sound mixes ----------------------------- */

{
  const timeline = buildTimeline(words, DURATION, [], []);
  const clips: AudioClip[] = [
    {
      id: "bed",
      kind: "music",
      name: "calm piano (generated)",
      src: "/api/asset/bed",
      start: 0,
      end: timeline.duration,
      trimIn: 0,
      gain: defaultGainFor("music"),
      fadeIn: 1.5,
      fadeOut: 2,
      duck: true,
      loop: false,
      muted: false,
    },
    {
      id: "sting",
      kind: "sfx",
      name: "whoosh",
      src: "/api/asset/sting",
      start: 4,
      end: 5,
      trimIn: 0,
      gain: defaultGainFor("sfx"),
      fadeIn: 0,
      fadeOut: 0,
      duck: false,
      loop: false,
      muted: false,
    },
    {
      id: "vo",
      kind: "voice",
      name: "Six weeks later.",
      src: "/api/asset/vo",
      start: 8,
      end: 11,
      trimIn: 0,
      gain: defaultGainFor("voice"),
      fadeIn: 0.05,
      fadeOut: 0.15,
      duck: false,
      loop: false,
      muted: false,
    },
    {
      id: "muted",
      kind: "sfx",
      name: "turned off",
      src: "/api/asset/off",
      start: 2,
      end: 3,
      trimIn: 0,
      gain: 0.5,
      fadeIn: 0,
      fadeOut: 0,
      duck: false,
      loop: false,
      muted: true,
    },
  ];

  const audible = audibleClips(clips);
  assert(audible.length === 3, `a muted clip reached the mix (${audible.length} audible)`);

  const graph = buildMixGraph({
    clips: audible,
    hasVoice: true,
    duration: timeline.duration,
  });

  // The contract the exporter depends on: clips are inputs 1..n in the order
  // given, and the graph must reference every one of them exactly once. A clip
  // written to ffmpeg with no filter reading it is silence nobody can explain.
  for (let i = 0; i < audible.length; i++) {
    assert(
      graph.filter.includes(`[${i + 1}:a]`),
      `clip ${i} ("${audible[i].name}") has no input in the graph`
    );
  }
  assert(!graph.filter.includes(`[${audible.length + 1}:a]`), "the graph reads an input that is never written");
  assert(graph.outputLabel === "[mixout]", "the exporter would map the wrong stream");
  assert(graph.ducks, "the bed does not duck under the speech");

  // Every clip is inside the finished video, or the mix is longer than the
  // picture it is under.
  for (const clip of audible) {
    assert(
      clip.start >= 0 && clip.end <= timeline.duration + 1e-6,
      `"${clip.name}" runs to ${clip.end} past a ${timeline.duration}s video`
    );
  }
  console.log("✓ every audible clip reaches the mix, once, inside the video");
}

console.log("\nwired end to end: all checks passed");
