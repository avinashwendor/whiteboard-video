import { cartesia } from "./cartesia";
import { deepgram } from "./deepgram";
import type { TTSProvider } from "./types";

/**
 * Which voice engine speaks.
 *
 * Both implement the same contract, so nothing above this file knows or cares
 * which one ran. Deepgram leads when it is configured: it is the one whose
 * word timings come from transcribing the real audio, and the account that is
 * actually funded.
 */

export type TTSProviderId = "deepgram" | "cartesia";

const PROVIDERS: Record<TTSProviderId, TTSProvider> = { deepgram, cartesia };

/** Preference order, filtered down to whatever has a key. */
const ORDER: TTSProviderId[] = ["deepgram", "cartesia"];

export function ttsProviders(): Array<{ id: TTSProviderId; configured: boolean }> {
  return ORDER.map((id) => ({ id, configured: PROVIDERS[id].isConfigured() }));
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
