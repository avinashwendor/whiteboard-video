import { AppError } from "@/lib/utils/errors";
import { fetchWithTimeout, raiseForStatus, readJson } from "@/lib/utils/http";
import type { WordTiming } from "@/lib/video/timing";
import type { TTSInput, TTSProvider, TTSResult, VoiceInfo } from "./types";

/**
 * Cartesia TTS.
 *
 * Plain fetch rather than the SDK: this is one POST returning audio, and going
 * direct keeps the version header pinned to something we control instead of
 * whatever an SDK release decides to send.
 *
 * Two routes, deliberately. `/tts/sse` is the one we want, because it is the
 * only one that will tell us when each word was spoken -- and word timings are
 * what let the video animate *with* the narration rather than alongside it.
 * The catch is that SSE only emits raw PCM, so we assemble the WAV ourselves.
 * `/tts/bytes` stays as the fallback: a smaller mp3, no timings, still a video.
 */

const BASE = "https://api.cartesia.ai";
const API_VERSION = process.env.CARTESIA_VERSION?.trim() || "2026-08-14";
const TIMEOUT_MS = 90_000;

/** SSE speaks raw PCM only, so this is the format the WAV is built at. */
const PCM_SAMPLE_RATE = 44_100;

/** Set CARTESIA_TIMESTAMPS=0 to force the smaller, timing-free mp3 route. */
const WANT_TIMESTAMPS = process.env.CARTESIA_TIMESTAMPS?.trim() !== "0";

export const DEFAULT_TTS_MODEL = process.env.CARTESIA_MODEL?.trim() || "sonic-3";

/** Newest first -- the first one the account can actually use wins. */
const MODEL_PREFERENCE = ["sonic-3.5", "sonic-3", "sonic-latest", "sonic-2", "sonic-english"];

function apiKey(): string {
  const key = process.env.CARTESIA_API_KEY?.trim();
  if (!key) {
    throw new AppError("missing_key", {
      userMessage: "Voice generation isn't configured. Add CARTESIA_API_KEY to .env.local.",
      detail: "CARTESIA_API_KEY missing",
    });
  }
  return key;
}

function headers(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Cartesia-Version": API_VERSION,
    "X-API-Key": apiKey(),
  };
}

/* --------------------------------- voices --------------------------------- */

interface CartesiaAccent {
  accent?: string;
  locale?: string;
  is_native?: boolean;
}

interface CartesiaVoice {
  id?: string;
  name?: string;
  description?: string;
  language?: string;
  languages?: string[];
  gender?: string;
  country?: string;
  accents?: CartesiaAccent[];
}

let voiceCache: { at: number; voices: VoiceInfo[] } | null = null;
const VOICE_TTL_MS = 15 * 60_000;

export interface IndianVoicePreset {
  id: string;
  name: string;
  language: string;
  gender: string;
  tag: string;
}

export const INDIAN_VOICE_PRESETS: IndianVoicePreset[] = [
  {
    id: "39d518b7-fd0b-4676-9b8b-29d64ff31e12",
    name: "Aarav",
    language: "en-IN",
    gender: "Male",
    tag: "Indian English · Warm Storyteller",
  },
  {
    id: "c63361f8-d142-4c62-8da7-8f8149d973d6",
    name: "Krishna",
    language: "en-IN",
    gender: "Male",
    tag: "Indian English · Friendly & Natural",
  },
  {
    id: "393dd459-f8d8-4c3e-a86b-ec43a1113d0b",
    name: "Rahul",
    language: "hi",
    gender: "Male",
    tag: "Hindi · Conversational",
  },
  {
    id: "209d9a43-03eb-40d8-a7b7-51a6d54c052f",
    name: "Anita",
    language: "hi",
    gender: "Female",
    tag: "Hindi · Soft & Clear",
  },
  {
    id: "4459a9a5-69d6-4680-b970-e13dc51845b6",
    name: "Siya",
    language: "en",
    gender: "Female",
    tag: "English · Bright Conversationalist",
  },
  {
    id: "d2870b91-1b4c-47ab-81a8-3718d8e9c222",
    name: "Arun",
    language: "ta",
    gender: "Male",
    tag: "Tamil · Expressive",
  },
  {
    id: "7f98e662-142d-41ba-89a2-12452640ce6d",
    name: "Lakshmi",
    language: "ta",
    gender: "Female",
    tag: "Tamil · Upbeat",
  },
  {
    id: "38bded0a-3ab4-42d1-8e47-2e0b6b10ced9",
    name: "Vikram",
    language: "te",
    gender: "Male",
    tag: "Telugu · Colorful",
  },
  {
    id: "f227bc18-3704-47fe-b759-8c78a450fdfa",
    name: "Suresh",
    language: "mr",
    gender: "Male",
    tag: "Marathi · Articulate",
  },
  {
    id: "5c32dce6-936a-4892-b131-bafe474afe5f",
    name: "Anika",
    language: "mr",
    gender: "Female",
    tag: "Marathi · Energetic",
  },
  {
    id: "7c6219d2-e8d2-462c-89d8-7ecba7c75d65",
    name: "Divya",
    language: "kn",
    gender: "Female",
    tag: "Kannada · Cheerful",
  },
  {
    id: "991c62ce-631f-48b0-8060-2a0ebecbd15b",
    name: "Jaspreet",
    language: "pa",
    gender: "Female",
    tag: "Punjabi · Engaging",
  },
  {
    id: "8bacd442-a107-4ec1-b6f1-2fcb3f6f4d56",
    name: "Gurpreet",
    language: "pa",
    gender: "Male",
    tag: "Punjabi · Warm",
  },
  {
    id: "4590a461-bc68-4a50-8d14-ac04f5923d22",
    name: "Isha",
    language: "gu",
    gender: "Female",
    tag: "Gujarati · Youthful",
  },
  {
    id: "b426013c-002b-4e89-8874-8cd20b68373a",
    name: "Latha",
    language: "ml",
    gender: "Female",
    tag: "Malayalam · Bright",
  },
];

async function listVoices(): Promise<VoiceInfo[]> {
  if (voiceCache && Date.now() - voiceCache.at < VOICE_TTL_MS) return voiceCache.voices;

  const collected: VoiceInfo[] = [];
  let startingAfter: string | undefined;

  // Retrieve up to 4 pages (400 voices) to cover all regional and accent catalogues
  for (let page = 0; page < 4; page += 1) {
    const params = new URLSearchParams({ limit: "100" });
    if (startingAfter) params.set("starting_after", startingAfter);

    const res = await fetchWithTimeout(`${BASE}/voices/?${params}`, {
      headers: headers(),
      timeoutMs: 20_000,
      label: "cartesia voices",
    });
    if (!res.ok) await raiseForStatus(res, "cartesia voices");

    const json = await readJson<{
      data?: CartesiaVoice[];
      has_more?: boolean;
      next_page?: string;
    }>(res, "cartesia voices");

    const batch = json.data ?? [];
    for (const voice of batch) {
      if (!voice.id || !voice.name) continue;

      const hasIndianAccent = (voice.accents || []).some(
        (a) =>
          (a.locale && (a.locale.includes("IN") || a.locale.includes("-in"))) ||
          (a.accent && (a.accent.includes("indian") || a.accent.includes("hindi"))),
      );
      const isIndian =
        voice.country === "IN" ||
        voice.language === "hi" ||
        voice.language === "ta" ||
        voice.language === "te" ||
        voice.language === "mr" ||
        voice.language === "kn" ||
        voice.language === "pa" ||
        voice.language === "gu" ||
        voice.language === "ml" ||
        voice.language === "bn" ||
        hasIndianAccent;

      const nativeAccent = (voice.accents || []).find((a) => a.is_native)?.accent;
      const languages = [
        ...(voice.language ? [voice.language] : []),
        ...(voice.languages ?? []),
        ...(hasIndianAccent && voice.language === "en" ? ["en-IN"] : []),
      ];

      collected.push({
        id: voice.id,
        name: voice.name,
        description: voice.description,
        language: hasIndianAccent && voice.language === "en" ? "en-IN" : voice.language,
        languages: [...new Set(languages)],
        gender: voice.gender,
        country: voice.country,
        isIndian,
        accent: nativeAccent,
      });
    }

    if (!json.has_more || !batch.length) break;
    startingAfter = batch[batch.length - 1]?.id;
    if (!startingAfter) break;
  }

  if (!collected.length) {
    throw new AppError("provider_error", {
      userMessage: "Couldn't load the voice list from Cartesia.",
      detail: "cartesia returned zero voices",
    });
  }

  // Sort Indian voices towards the top for accessibility
  collected.sort((a, b) => {
    if (a.isIndian && !b.isIndian) return -1;
    if (!a.isIndian && b.isIndian) return 1;
    return a.name.localeCompare(b.name);
  });

  voiceCache = { at: Date.now(), voices: collected };
  return collected;
}

/** Distinct languages across the catalogue, prioritizing Indian languages */
export async function listLanguages(): Promise<string[]> {
  const voices = await listVoices();
  const set = new Set<string>(["en-IN", "en", "hi", "ta", "te", "mr", "kn", "pa", "gu", "ml", "bn"]);
  for (const voice of voices) {
    if (voice.language) set.add(voice.language);
    for (const language of voice.languages ?? []) set.add(language);
  }
  return [...set].sort((a, b) => {
    const priority = ["en-IN", "hi", "ta", "te", "mr", "kn", "pa", "gu", "ml", "bn", "en"];
    const ai = priority.indexOf(a);
    const bi = priority.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

/* ---------------------------------- speech --------------------------------- */

/**
 * The `voice` field has shifted shape across Cartesia versions. Rather than bet
 * on one, we try the documented spellings in order and remember the winner.
 */
type VoiceShape = (id: string) => unknown;
const VOICE_SHAPES: Array<{ name: string; build: VoiceShape }> = [
  { name: "object-with-mode", build: (id) => ({ mode: "id", id }) },
  { name: "object", build: (id) => ({ id }) },
  { name: "string", build: (id) => id },
];
let resolvedVoiceShape: number | null = null;

function requestBody(input: TTSInput, shapeIndex: number) {
  // Normalize en-IN to en for Cartesia API model call
  const targetLanguage = input.language === "en-IN" ? "en" : input.language;
  const payload: Record<string, unknown> = {
    model_id: input.modelId ?? DEFAULT_TTS_MODEL,
    transcript: input.transcript,
    voice: VOICE_SHAPES[shapeIndex].build(input.voiceId),
    output_format: {
      container: "mp3",
      sample_rate: 44100,
      bit_rate: 128000,
    },
  };
  if (targetLanguage) payload.language = targetLanguage;
  if (typeof input.speed === "number" && input.speed !== 1) {
    payload.generation_config = { speed: clampSpeed(input.speed) };
  }
  return JSON.stringify(payload);
}

function clampSpeed(speed: number): number {
  return Math.min(1.5, Math.max(0.6, Number(speed.toFixed(2))));
}

/* ------------------------------- wav assembly ------------------------------ */

/**
 * Wraps signed 16-bit PCM in a canonical WAV header.
 *
 * Uncompressed audio is the price of word timings, and for a browser playing
 * back from its own origin it is one worth paying: no decode ambiguity, exact
 * durations, and a clip whose length we know before it is ever played.
 */
function toWav(pcm: Uint8Array, sampleRate: number, channels = 1): ArrayBuffer {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;

  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  ascii(36, "data");
  view.setUint32(40, pcm.byteLength, true);

  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out.buffer;
}

/* ---------------------------------- sse ----------------------------------- */

interface SseFrame {
  type?: string;
  data?: string;
  word_timestamps?: { words?: string[]; start?: number[]; end?: number[] };
  error?: string;
  message?: string;
}

function sseBody(input: TTSInput, shapeIndex: number): string {
  const targetLanguage = input.language === "en-IN" ? "en" : input.language;
  const payload: Record<string, unknown> = {
    model_id: input.modelId ?? DEFAULT_TTS_MODEL,
    transcript: input.transcript,
    voice: VOICE_SHAPES[shapeIndex].build(input.voiceId),
    output_format: {
      container: "raw",
      encoding: "pcm_s16le",
      sample_rate: PCM_SAMPLE_RATE,
    },
    add_timestamps: true,
  };
  if (targetLanguage) payload.language = targetLanguage;
  if (typeof input.speed === "number" && input.speed !== 1) {
    payload.generation_config = { speed: clampSpeed(input.speed) };
  }
  return JSON.stringify(payload);
}

/**
 * Streams one narration clip and its word timings.
 *
 * Frames arrive interleaved -- audio, then the words that audio covers -- so
 * both are collected in one pass and only reconciled at the end.
 */
async function streamSpeech(input: TTSInput, shapeIndex: number): Promise<TTSResult | null> {
  const res = await fetchWithTimeout(`${BASE}/tts/sse`, {
    method: "POST",
    headers: headers(),
    body: sseBody(input, shapeIndex),
    timeoutMs: TIMEOUT_MS,
    label: "cartesia tts sse",
    signal: input.signal,
  });

  if (!res.ok) {
    // A rejected voice shape is worth another spelling; an empty account or a
    // bad key is not, so those are raised rather than swallowed.
    if (res.status !== 400 && res.status !== 422) await raiseForStatus(res, "cartesia tts sse");
    return null;
  }
  if (!res.body) return null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  const words: WordTiming[] = [];
  let bytes = 0;
  let buffer = "";
  let failed = false;

  const handle = (payload: string) => {
    let frame: SseFrame;
    try {
      frame = JSON.parse(payload) as SseFrame;
    } catch {
      return;
    }

    if (frame.type === "error") {
      failed = true;
      return;
    }
    if (frame.type === "chunk" && frame.data) {
      const decoded = Buffer.from(frame.data, "base64");
      const view = new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
      chunks.push(view);
      bytes += view.byteLength;
      return;
    }
    if (frame.type === "timestamps" && frame.word_timestamps?.words) {
      const { words: spoken = [], start = [], end = [] } = frame.word_timestamps;
      spoken.forEach((word, index) => {
        const from = start[index];
        const to = end[index];
        if (!word || !Number.isFinite(from) || !Number.isFinite(to)) return;
        words.push({ word, start: from, end: to });
      });
    }
  };

  // Frames are `event:`/`data:` pairs separated by a blank line; only the data
  // matters, and a single frame can span several reads.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      for (const line of block.split("\n")) {
        if (line.startsWith("data:")) handle(line.slice(5).trim());
      }
      split = buffer.indexOf("\n\n");
    }
  }

  if (failed || bytes < 2_048) return null;

  const pcm = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    pcm.set(chunk, offset);
    offset += chunk.byteLength;
  }

  words.sort((a, b) => a.start - b.start);
  const samples = pcm.byteLength / 2;

  return {
    audio: toWav(pcm, PCM_SAMPLE_RATE),
    contentType: "audio/wav",
    provider: "cartesia",
    model: input.modelId ?? DEFAULT_TTS_MODEL,
    voiceId: input.voiceId,
    duration: samples / PCM_SAMPLE_RATE,
    words: words.length ? words : undefined,
  };
}

async function generateSpeech(input: TTSInput): Promise<TTSResult> {
  const transcript = input.transcript.trim();
  if (!transcript) {
    throw new AppError("invalid_request", { userMessage: "There's no text to speak." });
  }

  const order =
    resolvedVoiceShape === null
      ? VOICE_SHAPES.map((_, index) => index)
      : [resolvedVoiceShape, ...VOICE_SHAPES.map((_, i) => i).filter((i) => i !== resolvedVoiceShape)];

  // The timed route first. It costs one synthesis either way, and the timings
  // are what the whole video is animated against -- so it is worth an attempt
  // even on the shapes we have not confirmed yet.
  if (WANT_TIMESTAMPS) {
    for (const shapeIndex of order) {
      try {
        const streamed = await streamSpeech({ ...input, transcript }, shapeIndex);
        if (streamed) {
          resolvedVoiceShape = shapeIndex;
          return streamed;
        }
      } catch (err) {
        // Out of credit, or a bad key: trying the next voice spelling cannot
        // help, and the mp3 route is about to fail the same way.
        if (err instanceof AppError && (err.code === "out_of_credit" || err.code === "missing_key")) {
          throw err;
        }
        // A caller that gave up is not a provider failure worth retrying.
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        console.warn("cartesia sse unavailable, falling back to mp3", err);
        break;
      }
    }
  }

  let lastFailure: AppError | null = null;

  for (const shapeIndex of order) {
    const res = await fetchWithTimeout(`${BASE}/tts/bytes`, {
      method: "POST",
      headers: headers(),
      body: requestBody({ ...input, transcript }, shapeIndex),
      timeoutMs: TIMEOUT_MS,
      label: "cartesia tts",
      signal: input.signal,
    });

    if (res.ok) {
      resolvedVoiceShape = shapeIndex;
      const audio = await res.arrayBuffer();
      if (audio.byteLength < 512) {
        throw new AppError("malformed_response", {
          detail: `cartesia returned ${audio.byteLength} bytes of audio`,
        });
      }
      return {
        audio,
        contentType: res.headers.get("content-type") ?? "audio/mpeg",
        provider: "cartesia",
        model: input.modelId ?? DEFAULT_TTS_MODEL,
        voiceId: input.voiceId,
      };
    }

    // Only a shape/validation rejection is worth retrying with another
    // spelling. Anything else -- and especially a 402, which means the account
    // is empty -- should surface immediately rather than after six attempts.
    if (res.status !== 400 && res.status !== 422) await raiseForStatus(res, "cartesia tts");

    let detail = "";
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      detail = "<unreadable>";
    }
    lastFailure = new AppError("invalid_request", {
      userMessage: "Cartesia rejected that voice request.",
      detail: `cartesia tts ${res.status} (${VOICE_SHAPES[shapeIndex].name}): ${detail}`,
    });
  }

  throw lastFailure ?? new AppError("provider_error", { detail: "cartesia tts exhausted retries" });
}

export const cartesia: TTSProvider = {
  id: "cartesia",
  isConfigured() {
    return Boolean(process.env.CARTESIA_API_KEY?.trim());
  },
  listVoices,
  listLanguages,
  generateSpeech,
};

/** Best available narration model, verified against the account's catalogue. */
export async function resolveTtsModel(requested?: string): Promise<string> {
  if (requested) return requested;
  return DEFAULT_TTS_MODEL;
}

export { MODEL_PREFERENCE as TTS_MODEL_PREFERENCE };
