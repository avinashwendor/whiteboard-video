/**
 * Joining several recordings into one editable video.
 *
 * The rest of the editor is built on a single continuous source: one media
 * clock, one transcript timed against it, one set of cuts, one export. That is
 * not a limitation to route around — it is what makes a transcript the timeline
 * — so several clips are joined on the way in and everything downstream is
 * unchanged.
 *
 * Which puts the whole feature in one filtergraph and two bits of arithmetic,
 * none of which can be checked by looking at the result: a graph that is wrong
 * fails inside wasm with a message about stream specifiers, and a layout that
 * is wrong puts the scene boundaries in the wrong place, which looks like the
 * clips being joined in the wrong order.
 *
 * Run with `npx tsx tests/join-test.ts`.
 */

import {
  joinFilter,
  joinFrame,
  joinLayout,
  readProbe,
  type ClipProbe,
} from "../src/rescript/lib/ffmpeg";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function probe(patch: Partial<ClipProbe> = {}): ClipProbe {
  return {
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
    ...patch,
  };
}

/* --------------------------------- reading --------------------------------- */

{
  // What ffmpeg actually prints when asked to open a file and nothing else.
  const log = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'join_0':
  Metadata:
    major_brand     : isom
  Duration: 00:01:23.45, start: 0.000000, bitrate: 4212 kb/s
  Stream #0:0[0x1](und): Video: h264 (avc1 / 0x31637661), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 4075 kb/s, 29.97 fps, 30 tbr, 15360 tbn
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s
At least one output file must be specified
`;
  const read = readProbe(log);
  assert(Math.abs(read.duration - 83.45) < 1e-6, `duration read as ${read.duration}`);
  assert(read.width === 1920 && read.height === 1080, `size read as ${read.width}x${read.height}`);
  assert(read.fps === 30, `fps read as ${read.fps}`);
  assert(read.hasVideo && read.hasAudio, "both streams should be seen");

  // A silent screen recording. Getting this wrong is not a cosmetic problem:
  // a filtergraph that references [1:a] on a clip with no audio track fails the
  // whole join with a message about an invalid stream specifier.
  const silent = readProbe(`
  Duration: 00:00:05.00, start: 0.000000, bitrate: 900 kb/s
  Stream #0:0: Video: h264, yuv420p, 1280x720, 25 fps, 25 tbr
`);
  assert(silent.hasVideo && !silent.hasAudio, "a silent clip was read as having audio");
  assert(silent.duration === 5, `silent duration read as ${silent.duration}`);

  // A voice memo.
  const audio = readProbe(`
  Duration: 00:02:00.00, start: 0.000000, bitrate: 128 kb/s
  Stream #0:0: Audio: aac (LC), 44100 Hz, mono, fltp, 128 kb/s
`);
  assert(!audio.hasVideo && audio.hasAudio, "an audio file was read as having a picture");
  assert(audio.duration === 120, `audio duration read as ${audio.duration}`);

  // Nothing readable at all reports a zero duration, which the caller refuses
  // rather than joining a clip of unknown length into the middle of a project.
  assert(readProbe("some unrelated output").duration === 0, "junk was read as a clip");
  console.log("✓ what is in a file is read from ffmpeg's own log");
}

/* ---------------------------------- frame ---------------------------------- */

{
  // The common frame is the largest of the sources, so nothing is thrown away,
  // and the highest frame rate, since dropping 60 to 30 is visible on anything
  // that moves.
  const frame = joinFrame([
    probe({ width: 1280, height: 720, fps: 30 }),
    probe({ width: 1920, height: 1080, fps: 60 }),
  ]);
  assert(frame.width === 1920 && frame.height === 1080, `frame is ${frame.width}x${frame.height}`);
  assert(frame.fps === 60, `fps is ${frame.fps}`);

  // Capped, because re-encoding 4K in a 1 GiB wasm heap is not a thing that
  // finishes.
  const big = joinFrame([probe({ width: 3840, height: 2160 })]);
  assert(big.width === 1920 && big.height === 1080, `4K was not capped: ${big.width}x${big.height}`);

  // Odd dimensions are refused by libx264, and a source that reports them is
  // not a hypothetical — plenty of phone crops do.
  const odd = joinFrame([probe({ width: 1081, height: 607 })]);
  assert(odd.width % 2 === 0 && odd.height % 2 === 0, `odd frame ${odd.width}x${odd.height}`);

  // Audio-only inputs have no frame at all, which is how the caller knows to
  // build an audio-only graph.
  assert(joinFrame([probe({ hasVideo: false })]).width === 0, "audio-only claimed a frame");
  console.log("✓ every clip is fitted into one frame, capped and even");
}

/* -------------------------------- the graph -------------------------------- */

{
  const probes = [probe({ duration: 4 }), probe({ duration: 6, width: 1280, height: 720 })];
  const frame = joinFrame(probes);
  const { filter, silences } = joinFilter(probes, frame);

  assert(silences.length === 0, "no silence needed when every clip has audio");
  assert(filter.includes("concat=n=2:v=1:a=1"), "the graph does not concatenate both streams");
  assert(filter.includes("[v0][a0][v1][a1]concat"), "streams are not paired in order");
  assert(filter.includes("[outv]") && filter.includes("[outa]"), "no outputs");

  // Fitted and padded, never cropped: a portrait clip between two landscape
  // ones keeps its whole picture. A crop would be a decision the tool made that
  // cannot be undone afterwards.
  assert(
    filter.includes("force_original_aspect_ratio=decrease"),
    "clips are cropped to fill rather than fitted"
  );
  assert(filter.includes("pad=1920:1080"), "clips are not padded to the common frame");
  assert(filter.includes("setsar=1"), "pixel aspect is not normalised — this shears mixed sources");
  console.log("✓ the graph fits every clip into the frame and concatenates in order");
}

/* -------------------------------- the silence ------------------------------- */

{
  // The case that breaks the whole run if it is not handled: concat needs the
  // same number of audio streams in every segment, so a silent clip has to be
  // given silence rather than skipped.
  const probes = [probe({ duration: 4 }), probe({ duration: 6, hasAudio: false }), probe({ duration: 2 })];
  const { filter, silences } = joinFilter(probes, joinFrame(probes));

  assert(silences.length === 1 && silences[0] === 1, `expected one silent clip, got ${silences}`);
  // Three real inputs, so the generated silence is input 3.
  assert(filter.includes("[3:a]atrim=0:6.000"), "silence is not wired to the clip that needs it");
  assert(filter.includes("[0:a]atrim"), "the first clip's own audio was replaced");
  assert(filter.includes("[2:a]atrim"), "the last clip's own audio was replaced");
  assert(filter.includes("concat=n=3:v=1:a=1"), "the silent clip was dropped from the concat");
  console.log("✓ a clip with no audio track gets silence rather than breaking the join");
}

/* ------------------------------- audio only -------------------------------- */

{
  const probes = [probe({ hasVideo: false, duration: 30 }), probe({ hasVideo: false, duration: 45 })];
  const { filter } = joinFilter(probes, joinFrame(probes));
  assert(filter.includes("concat=n=2:v=0:a=1"), "audio-only join asked for a video stream");
  assert(!filter.includes("[outv]"), "audio-only join produced a video output");
  assert(!filter.includes("scale="), "audio-only join built a video chain");
  console.log("✓ voice memos join as audio, without a video chain");
}

/* -------------------------------- the layout -------------------------------- */

{
  const probes = [probe({ duration: 12.5 }), probe({ duration: 7.25 }), probe({ duration: 30 })];
  const clips = joinLayout(["a.mp4", "b.mp4", "c.mov"], probes);

  assert(clips.length === 3, "a clip went missing");
  assert(clips[0].start === 0, "the first clip does not start at zero");
  assert(clips[0].end === 12.5 && clips[1].start === 12.5, "the second clip does not follow the first");
  assert(clips[1].end === 19.75 && clips[2].start === 19.75, "the third clip is in the wrong place");
  assert(clips[2].end === 49.75, `the joined length is ${clips[2].end}, expected 49.75`);
  assert(clips.map((c) => c.name).join() === "a.mp4,b.mp4,c.mov", "the names moved");

  // The seams are what become scene boundaries, so they have to be the starts
  // of every clip but the first — put one at zero and the timeline opens with
  // an empty segment.
  const seams = clips.slice(1).map((c) => c.start);
  assert(seams.length === 2 && seams[0] > 0, "a seam landed at the start of the video");
  for (let i = 1; i < clips.length; i++) {
    assert(clips[i].start === clips[i - 1].end, "the clips are not laid end to end");
  }
  console.log("✓ the clips land end to end, and the seams are where the joins are");
}

console.log("\njoining clips: all checks passed");
