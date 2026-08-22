import { AppError } from "@/lib/utils/errors";
import { fetchWithTimeout, raiseForStatus, readJson } from "@/lib/utils/http";
import type { WordTiming } from "@/lib/video/timing";
import type { TTSInput, TTSProvider, TTSResult, VoiceInfo } from "./types";

/**
 * Deepgram Aura TTS, with its own recogniser used as a stopwatch.
 *
 * Aura will not tell you when it said each word -- but Deepgram is a
 * speech-to-text company, and running the clip we just generated back through
 * `/v1/listen` returns word-level timings for the audio that actually exists.
 * That is forced alignment by the back door, it costs one cheap transcription,
 * and it keeps the entire animation engine -- which schedules every beat
 * against the voice -- working exactly as it does on Cartesia.
 *
 * If the alignment pass fails the clip is still returned; the renderer falls
 * back to estimating word times from the transcript.
 */

const BASE = "https://api.deepgram.com/v1";
const TIMEOUT_MS = 90_000;
const ALIGN_TIMEOUT_MS = 60_000;

export const DEFAULT_TTS_MODEL = process.env.DEEPGRAM_MODEL?.trim() || "aura-2-hera-en";
/** Recogniser used only to time our own audio. */
const ALIGN_MODEL = process.env.DEEPGRAM_ALIGN_MODEL?.trim() || "nova-3";

function apiKey(): string {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) {
    throw new AppError("missing_key", {
      userMessage: "Voice generation isn't configured. Add DEEPGRAM_API_KEY to .env.local.",
      detail: "DEEPGRAM_API_KEY missing",
    });
  }
  return key;
}

function headers(contentType = "application/json"): HeadersInit {
  return {
    "Content-Type": contentType,
    Authorization: `Token ${apiKey()}`,
  };
}

/* --------------------------------- voices --------------------------------- */

interface DeepgramModel {
  name?: string;
  canonical_name?: string;
  languages?: string[];
  metadata?: { accent?: string; tags?: string[]; image?: string; color?: string };
}

let voiceCache: { at: number; voices: VoiceInfo[] } | null = null;
const VOICE_TTL_MS = 30 * 60_000;

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function listVoices(): Promise<VoiceInfo[]> {
  if (voiceCache && Date.now() - voiceCache.at < VOICE_TTL_MS) return voiceCache.voices;

  const res = await fetchWithTimeout(`${BASE}/models`, {
    headers: headers(),
    timeoutMs: 20_000,
    label: "deepgram models",
  });
  if (!res.ok) await raiseForStatus(res, "deepgram models");

  const json = await readJson<{ tts?: DeepgramModel[] }>(res, "deepgram models");
  const voices: VoiceInfo[] = [];

  for (const model of json.tts ?? []) {
    const id = model.canonical_name;
    if (!id) continue;
    const tags = model.metadata?.tags ?? [];
    const accent = model.metadata?.accent;
    const languages = model.languages ?? [];

    voices.push({
      id,
      name: titleCase(model.name ?? id),
      // The tag list is the only description Deepgram publishes, and it is
      // genuinely the most useful thing to show in a picker.
      description: [accent, ...tags.filter((tag) => tag !== "masculine" && tag !== "feminine")]
        .filter(Boolean)
        .join(" · "),
      language: languages[0],
      languages,
      gender: tags.includes("feminine") ? "feminine" : tags.includes("masculine") ? "masculine" : undefined,
      accent,
      // Deepgram publishes no Indian-accented English voice.
      isIndian: false,
    });
  }

  if (!voices.length) {
    throw new AppError("provider_error", {
      userMessage: "Couldn't load the voice list from Deepgram.",
      detail: "deepgram returned zero tts models",
    });
  }

  // Aura-2 first, then alphabetical: the older `aura-*` models are still
  // listed and are noticeably less natural.
  voices.sort((a, b) => {
    const second = (id: string) => (id.startsWith("aura-2-") ? 0 : 1);
    return second(a.id) - second(b.id) || a.name.localeCompare(b.name);
  });

  voiceCache = { at: Date.now(), voices };
  return voices;
}

async function listLanguages(): Promise<string[]> {
  const voices = await listVoices();
  const set = new Set<string>();
  for (const voice of voices) {
    for (const language of voice.languages ?? []) set.add(language);
  }
  return [...set].sort((a, b) => (a === "en" ? -1 : b === "en" ? 1 : a.localeCompare(b)));
}

/* --------------------------------- timing --------------------------------- */

interface ListenResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        words?: Array<{ word?: string; punctuated_word?: string; start?: number; end?: number }>;
      }>;
    }>;
  };
}

/** Times the clip we just made by transcribing it. */
async function alignWords(
  audio: ArrayBuffer,
  contentType: string,
  signal?: AbortSignal,
): Promise<{ words: WordTiming[]; duration?: number }> {
  const params = new URLSearchParams({
    model: ALIGN_MODEL,
    // Punctuation is what lets the subtitle grouping break on sentences.
    punctuate: "true",
    smart_format: "true",
  });

  const res = await fetchWithTimeout(`${BASE}/listen?${params}`, {
    method: "POST",
    headers: headers(contentType),
    body: audio,
    timeoutMs: ALIGN_TIMEOUT_MS,
    label: "deepgram align",
    signal,
  });
  if (!res.ok) return { words: [] };

  const json = await readJson<ListenResponse>(res, "deepgram align");
  const spoken = json.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];

  const words: WordTiming[] = [];
  for (const entry of spoken) {
    const word = entry.punctuated_word ?? entry.word;
    if (!word || !Number.isFinite(entry.start) || !Number.isFinite(entry.end)) continue;
    words.push({ word, start: entry.start as number, end: entry.end as number });
  }

  return { words, duration: json.metadata?.duration };
}

/**
 * The alignment pass is a recogniser pointed at our own audio, and a bad run
 * does not fail -- it succeeds with a fraction of the words and a duration
 * that matches neither them nor the script. Seen live: a 55-word narration
 * came back with 8 timings and a length of 81.9s, which the video engine then
 * honoured as forty-eight seconds of a static board in silence.
 *
 * So the result is checked against the text we asked to be spoken, which is
 * the one thing here we know to be true.
 */
function sanityCheck(
  transcript: string,
  words: WordTiming[],
  duration: number | undefined,
): { words: WordTiming[]; duration: number | undefined } {
  const expected = transcript.split(/\s+/).filter(Boolean).length;

  // Partial transcriptions mistime every beat after the gap. Estimating from
  // the script is worse than good timings and far better than wrong ones.
  if (words.length && expected > 4 && words.length < expected * 0.6) {
    console.warn(
      `deepgram alignment covered ${words.length}/${expected} words; falling back to estimated timings`,
    );
    words = [];
  }

  const lastEnd = words.length ? words[words.length - 1].end : undefined;
  if (lastEnd !== undefined) {
    // A clip that runs seconds past its own last word is trailing silence, and
    // the scene would hold on it.
    if (duration === undefined || duration > lastEnd + 5) duration = lastEnd + 0.35;
    return { words, duration };
  }

  // With no timings the script is the only yardstick left: nobody reads at
  // less than about one and a half words a second.
  if (duration !== undefined && duration > expected / 1.5 + 5) {
    console.warn(`deepgram reported ${duration.toFixed(1)}s for ${expected} words; ignoring it`);
    duration = undefined;
  }
  return { words, duration };
}

/* --------------------------------- speech --------------------------------- */

async function generateSpeech(input: TTSInput): Promise<TTSResult> {
  const transcript = input.transcript.trim();
  if (!transcript) {
    throw new AppError("invalid_request", { userMessage: "There's no text to speak." });
  }

  const model = input.modelId ?? input.voiceId ?? DEFAULT_TTS_MODEL;
  const params = new URLSearchParams({ model, encoding: "mp3" });

  const res = await fetchWithTimeout(`${BASE}/speak?${params}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ text: transcript }),
    timeoutMs: TIMEOUT_MS,
    label: "deepgram tts",
    signal: input.signal,
  });

  if (!res.ok) await raiseForStatus(res, "deepgram tts");

  const audio = await res.arrayBuffer();
  if (audio.byteLength < 512) {
    throw new AppError("malformed_response", {
      detail: `deepgram returned ${audio.byteLength} bytes of audio`,
    });
  }

  const contentType = res.headers.get("content-type") ?? "audio/mpeg";

  let words: WordTiming[] = [];
  let duration: number | undefined;
  try {
    const aligned = await alignWords(audio, contentType, input.signal);
    words = aligned.words;
    duration = aligned.duration;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    // Timing is a quality feature, not a requirement: the renderer estimates
    // word times from the transcript when they are missing.
    console.warn("deepgram alignment failed, falling back to estimated timings", err);
  }

  ({ words, duration } = sanityCheck(transcript, words, duration));

  // Deepgram's /v1/speak has no speed parameter. When the caller asks for a
  // non-default speed, scale the timings proportionally so the visual schedule
  // stays honest: a 1.2× request compresses timings to 1/1.2 of their length.
  const requestedSpeed = input.speed ?? 1;
  if (requestedSpeed !== 1 && (words.length || duration !== undefined)) {
    console.warn(
      `deepgram: speed=${requestedSpeed} requested but the API has no speed control; ` +
      `scaling timings by 1/${requestedSpeed} to approximate the effect`,
    );
    const factor = 1 / requestedSpeed;
    words = words.map((w) => ({ word: w.word, start: w.start * factor, end: w.end * factor }));
    if (duration !== undefined) duration = duration * factor;
  }

  return {
    audio,
    contentType,
    provider: "deepgram",
    model,
    voiceId: model,
    duration,
    words: words.length ? words : undefined,
  };
}

export const deepgram: TTSProvider = {
  id: "deepgram",
  isConfigured() {
    return Boolean(process.env.DEEPGRAM_API_KEY?.trim());
  },
  listVoices,
  listLanguages,
  generateSpeech,
};
