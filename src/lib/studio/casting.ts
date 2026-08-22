import type { VoiceInfo } from "@/lib/ai/types";

/**
 * Casting the narrator.
 *
 * The director describes the voice it wants -- "warm", "authoritative",
 * feminine -- rather than naming one, so the choice survives swapping the whole
 * speech provider. This matches that brief against the live catalogue.
 */

export interface VoiceBrief {
  gender?: "feminine" | "masculine" | "any";
  qualities?: string[];
}

/** `en-GB` and `en` are the same language for casting purposes. */
function baseTag(tag: string): string {
  return tag.toLowerCase().split("-")[0];
}

export function speaksLanguage(voice: VoiceInfo, language: string): boolean {
  const wanted = baseTag(language || "en");
  return [voice.language, ...(voice.languages ?? [])]
    .filter((tag): tag is string => Boolean(tag))
    .some((tag) => baseTag(tag) === wanted);
}

/**
 * Picks a narrator for a brief.
 *
 * The narration's language is a requirement, not a preference. It used to be
 * worth a single point against three for gender and two per matching quality,
 * so a Spanish voice that fit the brief outscored an English one and read an
 * English script in Spanish. Casting now only ever happens inside the right
 * language, and falls back to the whole catalogue only when nothing speaks it.
 */
export function castVoice(options: {
  brief?: VoiceBrief;
  catalogue: VoiceInfo[];
  language: string;
  /** The voice already chosen, kept when nothing scores. */
  current: string;
  /** True once the user picks a voice by hand, which ends all casting. */
  pinned?: boolean;
}): string {
  const { brief, catalogue, language, current, pinned } = options;
  if (!brief || !catalogue.length || pinned) return current;

  const eligible = catalogue.filter((voice) => speaksLanguage(voice, language));
  const pool = eligible.length ? eligible : catalogue;

  const wanted = (brief.qualities ?? []).map((quality) => quality.toLowerCase());
  let best = current;
  let bestScore = -1;

  for (const voice of pool) {
    const haystack = `${voice.description ?? ""} ${voice.accent ?? ""}`.toLowerCase();
    let points = wanted.reduce((sum, quality) => sum + (haystack.includes(quality) ? 2 : 0), 0);
    if (brief.gender && brief.gender !== "any") {
      points += voice.gender === brief.gender ? 3 : -4;
    }
    if (points > bestScore) {
      bestScore = points;
      best = voice.id;
    }
  }

  if (bestScore > 0) return best;

  // Nothing scored: keep the current voice if it speaks the language, and
  // otherwise take any voice that does over one that does not.
  const chosen = catalogue.find((voice) => voice.id === current);
  return chosen && speaksLanguage(chosen, language) ? current : (pool[0]?.id ?? current);
}
