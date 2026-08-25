/**
 * The audio layer: music, sound effects, and anything else over the voice.
 *
 * Until now this editor had exactly one audio track — the recording's own — and
 * it was never decoded. ffmpeg cut it and grafted it back onto the composited
 * picture with `-c copy`, and the comment at that graft says re-encoding it was
 * never on the table. That was the right call and it stays the right call for
 * every project that does not add sound.
 *
 * A music bed cannot be stream-copied, though: two tracks have to become one.
 * So the invariant is kept *conditionally* rather than abandoned — a project
 * with no added audio still takes the exact copy path it always did, and only a
 * project that actually has a music bed pays for a mix. That is the difference
 * between a feature and a tax.
 *
 * Everything is in **edited-timeline seconds**, like elements and shots, so a
 * music cue survives an upstream trim moving where its moment sits in the file.
 */

export type AudioKind = "music" | "sfx" | "voice";

/**
 * Where a piece of audio came from, and what it obliges you to say.
 *
 * Not decoration. The catalogues worth using are Creative Commons or
 * commercial-licence, and CC-BY music used without attribution is a licence
 * breach in a file somebody is about to publish. A tool that makes that easy to
 * do by accident is not usable for commercial work, which is most work.
 */
export interface AudioCredit {
  title: string;
  artist: string;
  /** e.g. "CC BY 4.0", "Jamendo Commercial", "Pixabay Content Licence". */
  licence: string;
  /** Where the track lives, for the attribution line. */
  url?: string;
  /** True when the licence requires the credit to be published. */
  attributionRequired: boolean;
}

export interface AudioClip {
  id: string;
  kind: AudioKind;
  /** Shown in the layer list and the timeline lane. */
  name: string;
  /**
   * Same-origin URL. Cross-origin audio is refused for the same reason
   * cross-origin images are: the editor is cross-origin isolated, and fetching
   * a track for the mix has to work from the page's own origin.
   */
  src: string;
  /** Visible window on the edited timeline. */
  start: number;
  end: number;
  /** Seconds into the source file that `start` corresponds to. */
  trimIn: number;
  /** 0..1, before ducking. */
  gain: number;
  fadeIn: number;
  fadeOut: number;
  /**
   * Pull down under speech.
   *
   * The single most important control on a music bed, and the one nobody
   * remembers to set — so it defaults on for music. A bed at a fixed level
   * either buries the voice or is inaudible, and the version that buries the
   * voice is the one people ship.
   */
  duck: boolean;
  /** Repeat to fill the window when the source is shorter than it. */
  loop: boolean;
  muted: boolean;
  credit?: AudioCredit;
}

/** A music bed under the whole video, at a level that leaves speech on top. */
export const DEFAULT_MUSIC_GAIN = 0.28;

/** A one-shot effect sits above the bed but below the voice. */
export const DEFAULT_SFX_GAIN = 0.6;

/** How far a ducked bed drops while someone is speaking, as a multiplier. */
export const DUCK_DEPTH = 0.32;

/** How quickly ducking reacts. Slow enough not to pump on every syllable. */
export const DUCK_ATTACK_S = 0.25;
export const DUCK_RELEASE_S = 0.6;

export function defaultGainFor(kind: AudioKind): number {
  return kind === "music" ? DEFAULT_MUSIC_GAIN : DEFAULT_SFX_GAIN;
}

/** True when there is nothing to mix and export can keep stream-copying. */
export function audioIsIdle(clips: AudioClip[] | undefined): boolean {
  if (!clips || clips.length === 0) return true;
  return clips.every((c) => c.muted || c.end <= c.start || c.gain <= 0);
}

/** The clips that actually contribute, in start order. */
export function audibleClips(clips: AudioClip[] | undefined): AudioClip[] {
  if (!clips) return [];
  return clips
    .filter((c) => !c.muted && c.end > c.start && c.gain > 0)
    .sort((a, b) => a.start - b.start);
}

/**
 * Gain for a clip at a given second, before ducking.
 *
 * Fades are clamped to half the clip so a two-second sting with a three-second
 * fade-in does not spend its whole life arriving.
 */
export function gainAt(clip: AudioClip, t: number): number {
  if (t < clip.start || t >= clip.end) return 0;
  const life = clip.end - clip.start;
  const into = t - clip.start;
  const until = clip.end - t;

  const fadeIn = Math.min(clip.fadeIn, life / 2);
  const fadeOut = Math.min(clip.fadeOut, life / 2);

  let g = clip.gain;
  if (fadeIn > 0 && into < fadeIn) g *= into / fadeIn;
  if (fadeOut > 0 && until < fadeOut) g *= until / fadeOut;
  return Math.max(0, Math.min(1, g));
}

/* ------------------------------- attribution ------------------------------- */

/**
 * The credits a project owes, deduplicated.
 *
 * Offered as a block to paste into a description. Two clips from the same track
 * — a bed split around a section — owe one credit, not two.
 */
export function creditsFor(clips: AudioClip[] | undefined): AudioCredit[] {
  const seen = new Map<string, AudioCredit>();
  for (const clip of clips ?? []) {
    const credit = clip.credit;
    if (!credit || !credit.attributionRequired) continue;
    seen.set(`${credit.artist}::${credit.title}`, credit);
  }
  return [...seen.values()];
}

/** The attribution block, as plain text. Empty when nothing is owed. */
export function creditText(clips: AudioClip[] | undefined): string {
  const credits = creditsFor(clips);
  if (credits.length === 0) return "";
  return [
    "Music and sound:",
    ...credits.map((c) => {
      const where = c.url ? ` — ${c.url}` : "";
      return `  “${c.title}” by ${c.artist} (${c.licence})${where}`;
    }),
  ].join("\n");
}
