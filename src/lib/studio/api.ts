"use client";

import type { SceneSpec } from "@/lib/whiteboard/scene";
import type { EditOp } from "./edit-plan";
import type { ModelInfo, VoiceInfo } from "@/lib/ai/types";
import type { Storyboard } from "@/lib/validation/schemas";
import type { WordTiming } from "@/lib/video/timing";

/** One error type for everything the browser gets back from our routes. */
export class ApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

interface Failure {
  success: false;
  error?: { code?: string; message?: string };
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("network", "Couldn't reach the server. Check your connection.");
  }

  const json = (await res.json().catch(() => null)) as (T & { success?: boolean }) | Failure | null;

  if (!res.ok || !json || (json as Failure).success === false) {
    const failure = json as Failure | null;
    throw new ApiError(
      failure?.error?.code ?? "provider_error",
      failure?.error?.message ?? "Something went wrong. Try again in a moment.",
    );
  }

  return json as T;
}

/* ---------------------------------- text ---------------------------------- */

export interface TextResult {
  text: string;
  model: string;
  provider: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export function generateText(
  body: { prompt: string; systemPrompt?: string; model?: string },
  signal?: AbortSignal,
): Promise<TextResult> {
  return post<TextResult>("/api/generate", body, signal);
}

type StreamFrame =
  | { type: "delta"; text: string }
  | { type: "done"; text: string; model: string; provider: string }
  | { type: "error"; code: string; message: string };

/** NDJSON stream reader for the WRITE mode's live typing. */
export async function streamText(
  body: { prompt: string; systemPrompt?: string; model?: string },
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<TextResult> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  if (!res.ok || !res.body) {
    const failure = (await res.json().catch(() => null)) as Failure | null;
    throw new ApiError(
      failure?.error?.code ?? "provider_error",
      failure?.error?.message ?? "Text generation is unavailable right now.",
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: TextResult | null = null;

  const handle = (line: string) => {
    if (!line.trim()) return;
    let frame: StreamFrame;
    try {
      frame = JSON.parse(line) as StreamFrame;
    } catch {
      return;
    }
    if (frame.type === "delta") onDelta(frame.text);
    else if (frame.type === "done") {
      final = { text: frame.text, model: frame.model, provider: frame.provider };
    } else if (frame.type === "error") throw new ApiError(frame.code, frame.message);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  if (buffer) handle(buffer);

  if (!final) throw new ApiError("malformed_response", "The response ended unexpectedly.");
  return final;
}

/* ---------------------------------- image ---------------------------------- */

export interface ServerImageResponse {
  image: {
    url: string;
    provider: "pollinations";
    model: string;
    width: number;
    height: number;
    canvasSafe: boolean;
    fallbackFrom?: "puter";
    fallbackReason?: string;
  };
  prompt: { original: string; used: string; style?: string };
}

export function generateServerImage(
  body: {
    prompt: string;
    model?: string;
    width?: number;
    height?: number;
    style?: string;
    quality?: "standard" | "high";
    seed?: number;
    enhance?: boolean;
    fallbackFrom?: "puter";
    fallbackReason?: string;
  },
  signal?: AbortSignal,
): Promise<ServerImageResponse> {
  return post<ServerImageResponse>("/api/image", body, signal);
}

export interface PromptResponse {
  original: string;
  used: string;
  style: string;
}

export function enhancePrompt(
  body: { prompt: string; style?: string },
  signal?: AbortSignal,
): Promise<PromptResponse> {
  return post<PromptResponse>("/api/prompt", body, signal);
}

/* ---------------------------------- scene ---------------------------------- */

export function generateScene(
  body: { brief: string; usedLayouts?: string[]; hasPhoto?: boolean; model?: string },
  signal?: AbortSignal,
): Promise<{ scene: SceneSpec }> {
  return post<{ scene: SceneSpec }>("/api/scene", body, signal);
}

/** Re-looks-up the icon geometry after a board has been edited by hand. */
export function resolveBoard(
  body: { scene: SceneSpec; model?: string },
  signal?: AbortSignal,
): Promise<{ scene: SceneSpec }> {
  return post<{ scene: SceneSpec }>("/api/board", body, signal);
}

/* ---------------------------------- visual --------------------------------- */

export interface VisualResponse {
  image: {
    url: string;
    provider: "tavily";
    model: string;
    width: number;
    height: number;
    canvasSafe: boolean;
  } | null;
  /** The model's one-line verdict, kept for the result card. */
  reason: string;
  sourceUrl?: string;
  stats?: { found: number; downloaded: number; dropped: string[] };
}

/** A real photograph for one scene, searched and then actually looked at. */
export function curateVisual(
  body: { brief: string; query: string; model?: string },
  signal?: AbortSignal,
): Promise<VisualResponse> {
  return post<VisualResponse>("/api/visual", body, signal);
}

/* ----------------------------------- tts ----------------------------------- */

export interface SpeechResponse {
  audioUrl: string;
  provider: string;
  model: string;
  voiceId: string;
  contentType: string;
  bytes: number;
  /** Exact clip length, when the container let the server work it out. */
  duration?: number;
  /** When each word was spoken -- the clock the video animates against. */
  words?: WordTiming[];
}

export function generateSpeech(
  body: { transcript: string; voiceId: string; language?: string; speed?: number; modelId?: string },
  signal?: AbortSignal,
): Promise<SpeechResponse> {
  return post<SpeechResponse>("/api/tts", body, signal);
}

/* ---------------------------------- create --------------------------------- */

export interface CreateResponse {
  storyboard: Storyboard;
  model: string;
  provider: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export function createStoryboard(
  body: {
    prompt: string;
    model?: string;
    sceneCount?: number;
    language?: string;
    tone?: string;
    videoStyle?: string;
  },
  signal?: AbortSignal,
): Promise<CreateResponse> {
  return post<CreateResponse>("/api/create", body, signal);
}

/* ----------------------------------- edit ---------------------------------- */

export interface EditPlanResponse {
  summary: string;
  ops: EditOp[];
  /** Operations the planner produced that could not be understood. */
  rejected?: string[];
}

/**
 * Asks the model what a plain-language instruction should do to the project.
 * Nothing is applied here -- the ops come back and `applyOps` runs them.
 */
export function planEdit(
  body: {
    instruction: string;
    project: unknown;
    sceneNumber?: number;
    voices?: Array<{
      id: string;
      name: string;
      gender?: string;
      language?: string;
      accent?: string;
      description?: string;
    }>;
    can?: { photoSearch?: boolean; generateImage?: boolean; lineArt?: boolean };
    model?: string;
  },
  signal?: AbortSignal,
): Promise<EditPlanResponse> {
  return post<EditPlanResponse>("/api/edit", body, signal);
}

/* -------------------------------- discovery -------------------------------- */

export interface CatalogueResponse {
  provider: string;
  models?: ModelInfo[];
  voices?: VoiceInfo[];
  languages?: string[];
  notice?: string;
}

export async function fetchCatalogue(
  provider: string,
  signal?: AbortSignal,
): Promise<CatalogueResponse> {
  try {
    const res = await fetch(`/api/models?provider=${encodeURIComponent(provider)}`, {
      signal,
      cache: "no-store",
    });
    if (!res.ok) return { provider, models: [], notice: "Couldn't load this catalogue." };
    return (await res.json()) as CatalogueResponse;
  } catch {
    // Includes the abort fired when the effect is torn down -- an empty
    // catalogue is the correct answer for a request nobody is waiting on.
    return { provider, models: [] };
  }
}

export interface Capabilities {
  text: { provider: string; configured: boolean };
  image: {
    providers: Array<{ id: string; configured: boolean; note?: string; lineArt?: boolean }>;
  };
  voice: { provider: string; configured: boolean };
}

export async function fetchCapabilities(signal?: AbortSignal): Promise<Capabilities | null> {
  try {
    const res = await fetch("/api/capabilities", { signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Capabilities;
  } catch {
    return null;
  }
}
