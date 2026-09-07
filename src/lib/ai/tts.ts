import { cartesia } from "./cartesia";
import { deepgram } from "./deepgram";
import { elevenlabs } from "./elevenlabs";
import type { TTSProvider } from "./types";

/**
 * Which voice engine speaks.
 *
 * Both implement the same contract, so nothing above this file knows or cares
 * which one ran. Deepgram leads when it is configured: it is the one whose
 * word timings come from transcribing the real audio, and the account that is
 * actually funded.
 */

export type TTSProviderId = "deepgram" | "cartesia" | "elevenlabs";

const PROVIDERS: Record<TTSProviderId, TTSProvider> = {
  deepgram,
  cartesia,
  elevenlabs,
};

/**
 * Preference order, filtered down to whatever has a key.
 *
 * ElevenLabs leads when it is configured. All three report word timings, so
 * the tie-break is the voices: it is the one whose catalogue a person is
 * likely to have picked a specific voice from, and picking a voice is the
 * whole reason anybody chooses a speech vendor. Deepgram stays ahead of
 * Cartesia beneath it for the reason it always did.
 *
 * `TTS_PROVIDER` overrides the order, and an explicit request from the caller
 * overrides both — which is what the picker in the UI sends.
 */
const ORDER: TTSProviderId[] = ["elevenlabs", "deepgram", "cartesia"];

/** The ids, for a zod enum. Derived so a new engine is accepted everywhere at once. */
export const TTS_PROVIDER_IDS = ORDER as [TTSProviderId, ...TTSProviderId[]];

/** Shown in the picker. Kept here so the label and the id cannot drift. */
export const TTS_PROVIDER_LABELS: Record<TTSProviderId, string> = {
  elevenlabs: "ElevenLabs",
  deepgram: "Deepgram",
  cartesia: "Cartesia",
};

export function ttsProviders(): Array<{
  id: TTSProviderId;
  label: string;
  configured: boolean;
}> {
  return ORDER.map((id) => ({
    id,
    label: TTS_PROVIDER_LABELS[id],
    configured: PROVIDERS[id].isConfigured(),
  }));
}

export function resolveTts(requested?: string): TTSProvider {
  if (requested && requested in PROVIDERS) {
    const chosen = PROVIDERS[requested as TTSProviderId];
    if (chosen.isConfigured()) return chosen;
  }

  const preferred = process.env.TTS_PROVIDER?.trim() as TTSProviderId | undefined;
  if (preferred && PROVIDERS[preferred]?.isConfigured()) return PROVIDERS[preferred];

  for (const id of ORDER) {
    if (PROVIDERS[id].isConfigured()) return PROVIDERS[id];
  }

  // Nothing is configured. Return the default so the caller raises the usual
  // "add a key" error rather than a null dereference.
  return PROVIDERS.deepgram;
}

export function defaultTtsProviderId(): TTSProviderId {
  return (resolveTts().id as TTSProviderId) ?? "deepgram";
}
