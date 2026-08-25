/**
 * Music, effects, and the mix that puts them under the voice.
 *
 * This editor had exactly one audio track and never decoded it: ffmpeg cut it
 * and grafted it back with `-c copy`, and the comment at that graft says
 * re-encoding was never on the table. A music bed cannot be stream-copied — two
 * tracks have to become one — so the invariant is kept *conditionally*, and the
 * first thing asserted here is that a project with no music still takes the
 * exact copy path it always did. A feature that made everyone pay for a
 * re-encode would be a tax.
 *
 * The rest is the filter graph. A graph is a string that either produces the
 * right sound or fails silently at the end of a long render, so the point of
 * building it in a separate module is being able to read one here.
 *
 * Run with `npx tsx tests/audio-test.ts`.
 */

import {
  audibleClips,
  audioIsIdle,
  creditText,
  creditsFor,
  defaultGainFor,
  gainAt,
  type AudioClip,
} from "../src/rescript/lib/overlay/audio";
import { buildMixGraph } from "../src/rescript/lib/overlay/mix";
import {
  emptyComposition,
  isEmptyComposition,
} from "../src/rescript/lib/overlay/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

let n = 0;
function clip(over: Partial<AudioClip> = {}): AudioClip {
  n += 1;
  return {
    id: `a${n}`,
    kind: "music",
    name: "bed",
    src: "blob:bed",
    start: 0,
    end: 60,
    trimIn: 0,
    gain: 0.28,
    fadeIn: 0,
    fadeOut: 0,
    duck: true,
    loop: false,
    muted: false,
    ...over,
  };
}

/* ------------------------- the copy path is preserved ----------------------- */

{
  // The promise. No clips, nothing muted into existence, no mix — and export
  // still stream-copies, which is what every project without music does.
  assert(audioIsIdle([]), "no clips is idle");
  assert(audioIsIdle(undefined), "and so is a save made before this existed");
  assert(audioIsIdle([clip({ muted: true })]), "a muted clip is idle");
  assert(audioIsIdle([clip({ gain: 0 })]), "and so is a silent one");
  assert(audioIsIdle([clip({ start: 5, end: 5 })]), "and a zero-length one");

  assert(!audioIsIdle([clip()]), "a real bed is not idle");

  // …and the composition-level check agrees, so the exporter's fast path is
  // decided by the same question.
  assert(isEmptyComposition(emptyComposition(), 16 / 9), "an empty project is empty");
  assert(
    !isEmptyComposition({ ...emptyComposition(), audio: [clip()] }, 16 / 9),
    "a project with music needs compositing"
  );
  assert(
    isEmptyComposition({ ...emptyComposition(), audio: [clip({ muted: true })] }, 16 / 9),
    "a muted bed does not"
  );

  // The graph itself says so too: no clips, no filter, and the audio maps
  // straight off input 0.
  const none = buildMixGraph({ clips: [], hasVoice: true, duration: 60 });
  assert(none.filter === "", "no clips, no filter graph");
  assert(none.outputLabel === "0:a", "the voice is mapped directly");
  assert(!none.ducks, "and nothing ducks");
}

/* ---------------------------------- levels ---------------------------------- */

{
  // A bed sits well under speech; an effect sits above the bed. Getting these
  // the wrong way round is the difference between a video with music and a
  // video you cannot hear.
  assert(defaultGainFor("music") < defaultGainFor("sfx"), "a bed is quieter than a sting");
  assert(defaultGainFor("music") < 0.4, "and quiet enough to leave speech on top");

  const faded = clip({ start: 10, end: 20, gain: 1, fadeIn: 2, fadeOut: 2 });
  assert(gainAt(faded, 9) === 0, "silent before it starts");
  assert(gainAt(faded, 20) === 0, "and after it ends");
  assert(gainAt(faded, 10) === 0, "starts from nothing");
  assert(Math.abs(gainAt(faded, 11) - 0.5) < 1e-9, "halfway up the fade");
  assert(gainAt(faded, 15) === 1, "full in the middle");
  assert(Math.abs(gainAt(faded, 19) - 0.5) < 1e-9, "halfway down");

  // A fade longer than the clip cannot make it spend its whole life arriving.
  const stingy = clip({ start: 0, end: 2, gain: 1, fadeIn: 5, fadeOut: 5 });
  assert(gainAt(stingy, 1) > 0.9, `a 2s sting must reach full level, got ${gainAt(stingy, 1)}`);
}

/* --------------------------------- the graph -------------------------------- */

{
  const graph = buildMixGraph({
    clips: [clip({ start: 5, end: 65, trimIn: 12, gain: 0.3, fadeIn: 1, fadeOut: 2 })],
    hasVoice: true,
    duration: 65,
  });

  assert(graph.filter.includes("[1:a]"), "the clip is input 1 — input 0 is the cut");
  assert(graph.filter.includes("atrim=start=12.000"), "trimmed from where the clip starts");
  assert(graph.filter.includes("adelay=5000:all=1"), "delayed to where it belongs");
  // `all=1` matters: without it a stereo bed is delayed on the left channel
  // only, which is a bug you hear once and cannot un-hear.
  assert(graph.filter.includes(":all=1"), "delayed on every channel");
  assert(graph.filter.includes("volume=0.300"), "at its own level");
  assert(graph.filter.includes("afade=t=in"), "faded in");
  assert(graph.filter.includes("afade=t=out"), "and out");
  assert(graph.outputLabel === "[mixout]", "and mixed to a named output");
}

{
  // `normalize=0` on every amix, without exception. ffmpeg's default divides by
  // the number of inputs, so adding a quiet sting would halve the voice — the
  // mix gets quieter every time you add to it, which is the opposite of what
  // anyone means.
  for (const graph of [
    buildMixGraph({ clips: [clip()], hasVoice: true, duration: 60 }),
    buildMixGraph({ clips: [clip(), clip({ kind: "sfx" })], hasVoice: true, duration: 60 }),
    buildMixGraph({ clips: [clip({ duck: false })], hasVoice: true, duration: 60 }),
  ]) {
    const mixes = graph.filter.match(/amix=[^[\];]*/g) ?? [];
    assert(mixes.length > 0, "there is a mix");
    for (const mix of mixes) {
      assert(mix.includes("normalize=0"), `every amix must set normalize=0: "${mix}"`);
    }
  }
}

{
  // Ducking is a sidechain keyed off the voice — what a broadcast mixer does.
  // The alternative everyone reaches for first is keying the level off the
  // transcript's word timings, which pumps on every gap between sentences and
  // is deaf to anything the transcript missed.
  const ducked = buildMixGraph({ clips: [clip({ duck: true })], hasVoice: true, duration: 60 });
  assert(ducked.ducks, "it ducks");
  assert(ducked.filter.includes("sidechaincompress"), "using a sidechain");
  // The voice is needed twice — to key the compressor and in the mix — and a
  // filter input cannot be consumed twice.
  assert(ducked.filter.includes("asplit=2"), "so the voice is split");

  const flat = buildMixGraph({ clips: [clip({ duck: false })], hasVoice: true, duration: 60 });
  assert(!flat.ducks, "a bed that does not duck");
  assert(!flat.filter.includes("sidechaincompress"), "gets no compressor");
  assert(!flat.filter.includes("asplit"), "and the voice is not split for nothing");

  // Nothing to duck under.
  const silentFilm = buildMixGraph({ clips: [clip({ duck: true })], hasVoice: false, duration: 40 });
  assert(!silentFilm.ducks, "no voice, no ducking");
  assert(
    silentFilm.filter.includes("atrim=duration=40.000"),
    "and the bed is trimmed to the video, so a 3-minute song does not extend a 40s cut"
  );
}

{
  // Several clips become one bed *before* ducking. One compressor per clip,
  // all keyed off the same voice, would each pump independently.
  const many = buildMixGraph({
    clips: [clip(), clip({ kind: "sfx", start: 10, end: 12 }), clip({ start: 30, end: 40 })],
    hasVoice: true,
    duration: 60,
  });
  assert(many.filter.includes("amix=inputs=3"), "the three clips become one bed");
  assert(
    (many.filter.match(/sidechaincompress/g) ?? []).length === 1,
    "and one compressor treats the bed, not one per clip"
  );
  assert(many.filter.includes("[3:a]"), "the third clip is input 3");
}

{
  // A looped clip fills its window and is then trimmed back to it, so a
  // thirty-second loop under a two-minute video does not run four seconds long.
  const looped = buildMixGraph({
    clips: [clip({ loop: true, start: 0, end: 120 })],
    hasVoice: true,
    duration: 120,
  });
  assert(looped.filter.includes("aloop=loop=-1"), "it loops");
  assert(looped.filter.includes("atrim=duration=120.000"), "and is cut back to the window");
}

/* -------------------------------- attribution ------------------------------- */

{
  // CC-BY music used without attribution is a licence breach in a file somebody
  // is about to publish. A tool that makes that easy to do by accident is not
  // usable for commercial work, which is most work.
  const cc = clip({
    credit: {
      title: "Nightwalk",
      artist: "Someone",
      licence: "CC BY 4.0",
      url: "https://example.org/t",
      attributionRequired: true,
    },
  });
  const free = clip({
    credit: {
      title: "Anything",
      artist: "Nobody",
      licence: "Pixabay Content Licence",
      attributionRequired: false,
    },
  });

  assert(creditsFor([cc, free]).length === 1, "only what the licence actually requires");
  assert(creditsFor([clip()]).length === 0, "a track with no credit owes nothing");

  // The same track twice — a bed split around a section — owes one credit.
  assert(creditsFor([cc, { ...cc, id: "other" }]).length === 1, "deduplicated");

  const text = creditText([cc]);
  assert(text.includes("Nightwalk") && text.includes("Someone"), "names the track and artist");
  assert(text.includes("CC BY 4.0"), "and the licence");
  assert(text.includes("https://example.org/t"), "and where it came from");
  assert(creditText([free]) === "", "nothing owed, nothing printed");
  assert(creditText([]) === "", "and an empty project prints nothing");
}

/* --------------------------------- ordering --------------------------------- */

{
  // The graph numbers inputs in the order it is given them, and the exporter
  // writes the files in that same order. Out of step is the one mistake that
  // produces a file which plays and is wrong, so the ordering is pinned.
  const out = audibleClips([
    clip({ start: 30, name: "late" }),
    clip({ start: 0, name: "early" }),
    clip({ start: 10, name: "middle", muted: true }),
  ]);
  assert(out.length === 2, "muted clips are not in the mix at all");
  assert(out[0].name === "early" && out[1].name === "late", "and the rest are in start order");
}

console.log("ALL AUDIO TESTS PASSED");
