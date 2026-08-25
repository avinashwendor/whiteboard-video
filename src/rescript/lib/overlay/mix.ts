/**
 * Building the ffmpeg filter graph that mixes music under the voice.
 *
 * Split out from the exporter and kept free of ffmpeg itself, because a filter
 * graph is a string that either produces the right sound or fails silently at
 * the end of a two-minute render — and the only way to have any confidence in
 * one is to be able to build it in a test and read it.
 *
 * The shape of the graph, for each added clip:
 *
 *   [n:a] atrim=start:end , asetpts=PTS-STARTPTS      take the part we want
 *         [, aloop]                                    fill the window if short
 *         , adelay=…                                   put it where it belongs
 *         , volume=…                                   set the level
 *         [, afade=in][, afade=out]                    shape the edges
 *
 * …then every clip is mixed with the voice. Ducking is a `sidechaincompress`
 * driven by the voice track, which is what a broadcast mixer does and is
 * dramatically better than the alternative everyone reaches for first — keying
 * the level off the transcript's word timings, which pumps on every gap between
 * sentences and cannot hear anything the transcript missed.
 */

import { DUCK_ATTACK_S, DUCK_RELEASE_S, DUCK_DEPTH, type AudioClip } from "./audio";

export interface MixInput {
  /** Clips to add, already filtered to the audible ones. */
  clips: AudioClip[];
  /** True when the cut has a voice track to mix under. */
  hasVoice: boolean;
  /** Length of the finished video, in seconds. */
  duration: number;
}

export interface MixGraph {
  /** The `-filter_complex` argument. Empty when no mixing is needed. */
  filter: string;
  /** What to `-map` for audio. */
  outputLabel: string;
  /** True when at least one clip ducks and there is a voice to duck under. */
  ducks: boolean;
}

/** ffmpeg wants milliseconds for `adelay`, and an integer. */
function ms(seconds: number): number {
  return Math.max(0, Math.round(seconds * 1000));
}

/** Three decimals is well past audible and keeps the graph readable. */
function secs(seconds: number): string {
  return Math.max(0, seconds).toFixed(3);
}

/**
 * Build the graph.
 *
 * Input 0 is the cut (voice). Clips are inputs 1..n, in the order given — the
 * caller must write them to ffmpeg in that same order, which is why this
 * returns a graph rather than taking a callback: getting the indices right is
 * the whole difficulty and it belongs somewhere testable.
 */
export function buildMixGraph(input: MixInput): MixGraph {
  const { clips, hasVoice, duration } = input;
  if (clips.length === 0) {
    return { filter: "", outputLabel: hasVoice ? "0:a" : "", ducks: false };
  }

  const parts: string[] = [];
  const labels: string[] = [];

  clips.forEach((clip, i) => {
    // +1 because input 0 is the cut.
    const index = i + 1;
    const label = `a${i}`;
    const window = clip.end - clip.start;

    const chain: string[] = [];

    // Take the slice of the source we want. `atrim` is in source time; the clip
    // knows where in the file it starts from.
    chain.push(`atrim=start=${secs(clip.trimIn)}:end=${secs(clip.trimIn + window)}`);
    chain.push("asetpts=PTS-STARTPTS");

    if (clip.loop) {
      // Loop the trimmed part to fill the window. `aloop` counts samples, so
      // the size is the window at 44.1k — generous, then trimmed back below.
      chain.push(`aloop=loop=-1:size=${Math.ceil(window * 44_100)}`);
      chain.push(`atrim=duration=${secs(window)}`);
      chain.push("asetpts=PTS-STARTPTS");
    }

    // Silence in front, so it lands where it belongs on the output clock.
    if (clip.start > 0) {
      // `all=1` applies the delay to every channel; without it a stereo bed is
      // delayed on the left only, which is the kind of bug you hear once and
      // then cannot un-hear.
      chain.push(`adelay=${ms(clip.start)}:all=1`);
    }

    chain.push(`volume=${clip.gain.toFixed(3)}`);

    const fadeIn = Math.min(clip.fadeIn, window / 2);
    const fadeOut = Math.min(clip.fadeOut, window / 2);
    if (fadeIn > 0) {
      chain.push(`afade=t=in:st=${secs(clip.start)}:d=${secs(fadeIn)}`);
    }
    if (fadeOut > 0) {
      chain.push(
        `afade=t=out:st=${secs(clip.end - fadeOut)}:d=${secs(fadeOut)}`
      );
    }

    parts.push(`[${index}:a]${chain.join(",")}[${label}]`);
    labels.push(label);
  });

  const wantsDuck = hasVoice && clips.some((c) => c.duck);

  // Everything that is not the voice becomes one bed first, so ducking is
  // applied once to the whole bed rather than once per clip — n compressors
  // keyed off the same voice would each pump independently.
  let bedLabel = labels[0];
  if (labels.length > 1) {
    parts.push(
      `${labels.map((l) => `[${l}]`).join("")}amix=inputs=${labels.length}:normalize=0[bed]`
    );
    bedLabel = "bed";
  }

  if (wantsDuck) {
    // The voice is needed twice — once to key the compressor, once in the mix —
    // and a filter input cannot be consumed twice.
    parts.push("[0:a]asplit=2[voice][key]");
    parts.push(
      `[${bedLabel}][key]sidechaincompress=` +
        `threshold=0.05:ratio=${(1 / DUCK_DEPTH).toFixed(1)}:` +
        `attack=${Math.round(DUCK_ATTACK_S * 1000)}:` +
        `release=${Math.round(DUCK_RELEASE_S * 1000)}[ducked]`
    );
    parts.push(`[voice][ducked]amix=inputs=2:normalize=0:duration=first[mixout]`);
  } else if (hasVoice) {
    parts.push(`[0:a][${bedLabel}]amix=inputs=2:normalize=0:duration=first[mixout]`);
  } else {
    // No voice: the bed is the whole track, trimmed to the video's length so a
    // three-minute song under a forty-second cut does not extend the file.
    parts.push(`[${bedLabel}]atrim=duration=${secs(duration)}[mixout]`);
  }

  return { filter: parts.join(";"), outputLabel: "[mixout]", ducks: wantsDuck };
}

/**
 * `normalize=0` on every `amix`, deliberately.
 *
 * ffmpeg's default divides by the number of inputs, so adding a quiet sting
 * halves the voice — the mix gets quieter every time you add something to it,
 * which is the opposite of what anyone means. Levels are set per clip instead,
 * which is what the gain control is for.
 */
export const MIX_NOTES = "normalize=0: levels are per-clip, not averaged";
