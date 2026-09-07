/**
 * A generated music bed, as an alternative to the synthesised one.
 *
 * `music.ts` builds the underscore out of oscillators, and the reasons given
 * there are still good ones: nothing to license, nothing to download, written
 * to the exact length of the video, and deterministic — an exported file sounds
 * exactly like the preview. For an explainer, where the music is furniture, it
 * is the right answer.
 *
 * It is the wrong answer when the music is supposed to be *noticed*. Three
 * oscillators in a small room is a convincing bed and it is not a piece of
 * music, and no amount of tuning the mood table changes that. So this is
 * offered beside it rather than instead of it, and every property the synth has
 * that the generator lacks is a real cost the person is choosing to pay:
 *
 *  - It costs a request, and a few seconds of waiting.
 *  - It is not deterministic. Two renders of the same project produce two
 *    different pieces, so the bed is cached by its own description and length —
 *    otherwise the preview and the export would not even be the same music.
 *  - It has to be generated at a fixed length and then fitted, where the synth
 *    is simply written to the length asked for.
 *
 * The mood stays the control. It is what the person already understands and
 * what the director already writes into a storyboard; this only changes how the
 * mood is realised.
 */

import type { MusicMood } from "./music";

/**
 * What each mood sounds like, in words a generator can act on.
 *
 * Written as instrumentation and tempo rather than as feeling: "calm" produces
 * nothing usable, and "sparse felt piano, soft pad, slow, no drums" produces a
 * bed. Every one ends by ruling out the two things that make a generated bed
 * unusable under narration — a vocal, and a strong beat.
 */
const MOOD_PROMPTS: Record<Exclude<MusicMood, "none">, string> = {
  calm: "sparse felt piano and a soft warm pad, slow, gentle, unhurried, no drums",
  curious: "light plucked synth and soft mallets, gently inquisitive, mid tempo, playful but restrained",
  driving: "steady pulsing synth bass and muted arpeggio, forward momentum, confident, understated percussion",
  warm: "warm analogue pad and soft electric piano, rounded and reassuring, slow, intimate",
  serious: "low sustained strings and a slow deep pulse, weighty and composed, no melody on top",
};

const NEVER = "instrumental only, no vocals, no lyrics, no spoken word, no sudden hits, even dynamics, loopable background underscore";

/** The full description sent to the generator for a mood. */
export function bedPrompt(mood: MusicMood, subject?: string): string {
  if (mood === "none") return "";
  const about = subject?.trim()
    ? ` Suits a short explainer about ${subject.trim().slice(0, 90)}.`
    : "";
  return `${MOOD_PROMPTS[mood]}.${about} ${NEVER}.`;
}

/**
 * A stable key for a bed, so the same video does not get different music each
 * time it is watched or exported.
 *
 * Length is rounded to five seconds: a bed is looped or trimmed to fit anyway,
 * and keying on the exact duration would miss the cache every time a scene's
 * narration came back a tenth of a second longer.
 */
export function bedKey(mood: MusicMood, seconds: number, subject?: string): string {
  return `${mood}:${Math.round(seconds / 5) * 5}:${(subject ?? "").trim().slice(0, 90).toLowerCase()}`;
}

/** How long a bed to ask for. Capped: past this it is cheaper to loop. */
export function bedSeconds(duration: number): number {
  return Math.max(10, Math.min(120, Math.ceil(duration)));
}

/**
 * Level for a generated bed, and how far it drops under speech.
 *
 * Lower than the synthesised bed's own level: a real recording carries far more
 * energy across the midrange than three oscillators do, so matching their gain
 * puts it on top of the narration. Set by listening.
 *
 * Declared here rather than in either consumer because the preview and the
 * exporter both duck by hand, with the same arithmetic, and a bed that is
 * mixed differently in the file from the way it was mixed in the preview is
 * the one divergence nobody would think to check for.
 */
export const BED_LEVEL = 0.16;
export const BED_DUCK = 0.35;
/** Overlap between loops in the export, so the seam is not a click. */
export const BED_CROSSFADE = 0.25;

export interface GeneratedBed {
  key: string;
  /** Same-origin URL, already stored. */
  url: string;
}

/**
 * Ask the server for a bed, once per key.
 *
 * In-flight requests are shared rather than queued: the preview and the export
 * both want the same bed, and the export usually starts while the preview is
 * still holding one. Two requests would be two different pieces of music and
 * twice the cost.
 */
const beds = new Map<string, Promise<GeneratedBed | null>>();

export function fetchBed(
  mood: MusicMood,
  duration: number,
  subject?: string,
  signal?: AbortSignal
): Promise<GeneratedBed | null> {
  if (mood === "none") return Promise.resolve(null);
  const key = bedKey(mood, duration, subject);
  const existing = beds.get(key);
  if (existing) return existing;

  const request = (async (): Promise<GeneratedBed | null> => {
    try {
      const res = await fetch("/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          kind: "music",
          prompt: bedPrompt(mood, subject),
          seconds: bedSeconds(duration),
        }),
        signal,
      });
      const json = (await res.json()) as { success?: boolean; url?: string };
      if (!json.success || !json.url) return null;
      return { key, url: json.url };
    } catch {
      // A bed that will not generate falls back to the synthesised one, which
      // is the whole reason that code is still here.
      return null;
    }
  })();

  beds.set(key, request);
  // A failure must not be cached forever: the next attempt should be allowed to
  // succeed, since the usual cause is a missing key somebody has just added.
  void request.then((value) => {
    if (!value) beds.delete(key);
  });
  return request;
}

/** Testing seam. */
export function forgetBeds() {
  beds.clear();
}
