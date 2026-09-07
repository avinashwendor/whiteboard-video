import { AppError } from "@/lib/utils/errors";
import { fetchWithTimeout, raiseForStatus, readJson } from "@/lib/utils/http";
import type { WordTiming } from "@/lib/video/timing";
import type { TTSInput, TTSProvider, TTSResult, VoiceInfo } from "./types";

/**
 * ElevenLabs: speech, and audio that does not exist yet.
 *
 * Three things, and the third is the one worth having.
 *
 * Speech sits beside Cartesia and Deepgram under the same `TTSProvider`
 * contract, so nothing above `tts.ts` knows which of the three spoke. It is
 * asked for character-level timestamps, which are folded back into word
 * timings here — that is what lets a video animate *with* the narration rather
 * than alongside it, and it is the only reason to prefer one speech vendor over
 * another in this codebase.
 *
 * Sound effects and music are GENERATED rather than searched, and that is a
 * different thing from what `lib/media/` does. A catalogue answers "what is the
 * closest whoosh somebody has already uploaded"; this answers "make me a
 * whoosh". For the sound-effect library in `overlay/sfx.ts` that is strictly
 * better: every entry there already carries a plain-words query — "riser build
 * up sweep", "deep boom bass drop" — which was written to be searchable and
 * turns out to be exactly the right generation prompt. And a generated effect
 * has no licence attached to it at all, which removes the one thing that makes
 * catalogue audio awkward in a client's video.
 *
 * What ElevenLabs does NOT do is video. There is no video-generation endpoint,
 * on any tier, and the b-roll clips come from Pexels for that reason.
 *
 * Needs `ELEVENLABS_API_KEY`.
 */

const BASE = "https://api.elevenlabs.io/v1";
const TIMEOUT_MS = 120_000;

/**
 * The default speech model.
 *
 * `eleven_multilingual_v2` rather than one of the flash models: this app
 * narrates finished videos, where nobody is waiting on the first token and the
 * quality difference is audible. Override with `ELEVENLABS_MODEL`.
 */
export const DEFAULT_MODEL =
  process.env.ELEVENLABS_MODEL?.trim() || "eleven_multilingual_v2";

/** "Rachel" — ElevenLabs' own default, present on every account. */
const DEFAULT_VOICE = process.env.ELEVENLABS_VOICE?.trim() || "21m00Tcm4TlvDq8ikWAM";

export function isConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) {
    throw new AppError("missing_key", {
      userMessage:
        "ElevenLabs isn't configured. Add ELEVENLABS_API_KEY to .env.local.",
      detail: "ELEVENLABS_API_KEY missing",
    });
  }
  return key;
}

function headers(json = true): HeadersInit {
  return {
    "xi-api-key": apiKey(),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

/* ---------------------------------- speech --------------------------------- */

interface ElevenVoice {
  voice_id: string;
  name?: string;
  labels?: Record<string, string>;
  description?: string;
  fine_tuning?: { language?: string };
  verified_languages?: Array<{ language?: string; accent?: string }>;
}

interface ElevenAlignment {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

interface ElevenSpeechResponse {
  audio_base64?: string;
  alignment?: ElevenAlignment;
  normalized_alignment?: ElevenAlignment;
}

/**
 * Fold character timings back into words.
 *
 * ElevenLabs reports per *character*, which is more precision than anything
 * here can use and less structure than it needs — the video animates on words.
 * A word runs from the start of its first character to the end of its last,
 * and whitespace is what separates them.
 *
 * Returns nothing rather than guessing when the arrays disagree in length: a
 * silently misaligned timing track is worse than none, because the caller's
 * fallback (estimating from the transcript) is at least honest about being an
 * estimate.
 */
function wordsFromCharacters(alignment: ElevenAlignment | undefined): WordTiming[] | undefined {
  const chars = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (!chars?.length || !starts?.length || !ends?.length) return undefined;
  if (chars.length !== starts.length || chars.length !== ends.length) return undefined;

  const words: WordTiming[] = [];
  let text = "";
  let start = 0;

  const flush = (end: number) => {
    const trimmed = text.trim();
    if (trimmed) words.push({ word: trimmed, start, end });
    text = "";
  };

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      flush(ends[i]);
      continue;
    }
    if (!text) start = starts[i];
    text += ch;
  }
  flush(ends[ends.length - 1]);

  return words.length ? words : undefined;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = Buffer.from(value, "base64");
  // A fresh copy rather than a view onto Node's pooled buffer: `Buffer` slices
  // share memory with a larger allocation, and handing that to a caller who
  // expects to own it is a bug that only shows up under load.
  const out = new ArrayBuffer(binary.byteLength);
  new Uint8Array(out).set(binary);
  return out;
}

/**
 * ElevenLabs says "male"/"female"; the rest of this app says
 * "masculine"/"feminine".
 *
 * `castVoice` compares `voice.gender` against the director's brief with `===`,
 * so an unnormalised label does not merely fail to match — it scores −4 against
 * every voice of the requested gender and +0 against the others, which makes
 * the casting reliably pick the *opposite* one. Asked for a warm feminine
 * narrator it cast "Roger". Silent, and wrong in the most visible possible way.
 */
function normaliseGender(value: string | undefined): string | undefined {
  const v = value?.trim().toLowerCase();
  if (v === "male") return "masculine";
  if (v === "female") return "feminine";
  return v || undefined;
}

export const elevenlabs: TTSProvider = {
  id: "elevenlabs",
  isConfigured,

  async listVoices(): Promise<VoiceInfo[]> {
    if (!isConfigured()) return [];
    const res = await fetchWithTimeout(`${BASE}/voices`, {
      headers: headers(false),
      timeoutMs: 30_000,
    });
    if (!res.ok) return [];
    const json = await readJson<{ voices?: ElevenVoice[] }>(res, "ElevenLabs");
    return (json.voices ?? []).map((voice) => {
      const labels = voice.labels ?? {};
      const accent = labels.accent;
      return {
        id: voice.voice_id,
        name: voice.name ?? voice.voice_id,
        description: voice.description ?? labels.description,
        gender: normaliseGender(labels.gender),
        accent,
        language: voice.fine_tuning?.language,
        languages: voice.verified_languages
          ?.map((l) => l.language)
          .filter((l): l is string => Boolean(l)),
        // Surfaced the same way Cartesia's are, so the voice picker can group
        // them without knowing which vendor a voice came from.
        isIndian: accent?.toLowerCase().includes("indian") ?? false,
      };
    });
  },

  async listLanguages(): Promise<string[]> {
    if (!isConfigured()) return [];
    const res = await fetchWithTimeout(`${BASE}/models`, {
      headers: headers(false),
      timeoutMs: 30_000,
    });
    if (!res.ok) return [];
    const json = await readJson<
      Array<{ model_id: string; languages?: Array<{ language_id?: string }> }>
    >(res, "ElevenLabs");
    const model = json.find((m) => m.model_id === DEFAULT_MODEL) ?? json[0];
    return (model?.languages ?? [])
      .map((l) => l.language_id)
      .filter((l): l is string => Boolean(l));
  },

  async generateSpeech(input: TTSInput): Promise<TTSResult> {
    const voiceId = input.voiceId?.trim() || DEFAULT_VOICE;
    const modelId = input.modelId?.trim() || DEFAULT_MODEL;

    // `with-timestamps` rather than the plain endpoint: it returns the audio
    // base64-encoded alongside a character alignment, which is the whole reason
    // to reach for this provider over a cheaper one.
    const res = await fetchWithTimeout(
      `${BASE}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`,
      {
        method: "POST",
        headers: headers(),
        timeoutMs: TIMEOUT_MS,
        signal: input.signal,
        body: JSON.stringify({
          text: input.transcript,
          model_id: modelId,
          ...(input.language ? { language_code: input.language } : {}),
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            // Narration for a video wants to be even rather than expressive:
            // a line that performs differently on each generation cannot be
            // regenerated without re-cutting the video around it.
            style: 0,
            use_speaker_boost: true,
            ...(input.speed ? { speed: input.speed } : {}),
          },
        }),
      }
    );
    if (!res.ok) await raiseForStatus(res, "ElevenLabs");

    const json = await readJson<ElevenSpeechResponse>(res, "ElevenLabs");
    if (!json.audio_base64) {
      throw new AppError("malformed_response", {
        userMessage: "The voice came back empty. Try again.",
        detail: "ElevenLabs returned no audio_base64",
      });
    }

    const audio = base64ToArrayBuffer(json.audio_base64);
    // The normalised alignment is the one aligned to the text as spoken —
    // numbers read out, abbreviations expanded — which is what the caller's
    // transcript will not match. The raw one aligns to the characters that
    // were sent, so it is the one whose words can be looked up.
    const words = wordsFromCharacters(json.alignment ?? json.normalized_alignment);

    return {
      audio,
      contentType: "audio/mpeg",
      provider: "elevenlabs",
      model: modelId,
      voiceId,
      duration: words?.length ? words[words.length - 1].end : undefined,
      words,
    };
  },
};

/* -------------------------------- generation -------------------------------- */

export interface GeneratedAudio {
  bytes: ArrayBuffer;
  contentType: string;
}

/**
 * Generate a sound effect from a description.
 *
 * `prompt_influence` at 0.4 rather than the default: higher values follow the
 * words more literally and produce something that sounds like a demonstration
 * of the phrase rather than an effect. The library's own descriptions are
 * short — "whoosh transition", "deep boom bass drop" — and a short prompt
 * followed too literally is a thin sound.
 *
 * Duration is clamped to what the API accepts, and to what an effect should be:
 * the library's longest hold is four seconds, and an effect that outlasts the
 * moment it marks stops being punctuation.
 */
export async function generateSfx(
  prompt: string,
  seconds = 2,
  signal?: AbortSignal
): Promise<GeneratedAudio> {
  const res = await fetchWithTimeout(`${BASE}/sound-generation`, {
    method: "POST",
    headers: headers(),
    timeoutMs: TIMEOUT_MS,
    signal,
    body: JSON.stringify({
      text: prompt,
      duration_seconds: Math.max(0.5, Math.min(22, seconds)),
      prompt_influence: 0.4,
    }),
  });
  if (!res.ok) await raiseForStatus(res, "ElevenLabs");
  return { bytes: await res.arrayBuffer(), contentType: "audio/mpeg" };
}

/**
 * Generate a music bed.
 *
 * Length is capped at five minutes, which is far longer than anything this
 * editor produces and is the point at which the request starts taking long
 * enough that a person assumes it has hung.
 */
export async function generateMusic(
  prompt: string,
  seconds = 30,
  signal?: AbortSignal
): Promise<GeneratedAudio> {
  const res = await fetchWithTimeout(`${BASE}/music`, {
    method: "POST",
    headers: headers(),
    timeoutMs: TIMEOUT_MS,
    signal,
    body: JSON.stringify({
      prompt,
      music_length_ms: Math.round(Math.max(10, Math.min(300, seconds)) * 1000),
    }),
  });
  if (!res.ok) await raiseForStatus(res, "ElevenLabs");
  return { bytes: await res.arrayBuffer(), contentType: "audio/mpeg" };
}
