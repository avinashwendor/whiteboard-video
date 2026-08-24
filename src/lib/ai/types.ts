import type { WordTiming } from "@/lib/video/timing";

/**
 * Provider-agnostic contracts. Everything the UI touches is expressed here so a
 * provider can be swapped without a single component changing.
 */

/**
 * One piece of a multimodal turn.
 *
 * Omega speaks the OpenAI shape, so an image rides along as a `data:` URL in
 * an `image_url` part. That is what lets the same model that writes the script
 * also look at a photograph and say whether it is fit to use.
 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface TextGenerationInput {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for a JSON object response where supported. */
  json?: boolean;
  signal?: AbortSignal;
  /**
   * Told what the provider reported about the call itself.
   *
   * `streamText` yields text and only text, so a caller that streams had no way
   * to learn why generation stopped — and `finish_reason: "length"` is the
   * difference between a reply that is malformed and one that was cut off,
   * which are worth handling differently and were previously guessed at.
   * Called at most once, after the last token.
   */
  onMeta?: (meta: { finishReason?: string; usage?: TokenUsage }) => void;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface TextGenerationResult {
  text: string;
  model: string;
  provider: string;
  usage?: TokenUsage;
  finishReason?: string;
}

export interface TextProvider {
  readonly id: string;
  isConfigured(): boolean;
  listModels(): Promise<ModelInfo[]>;
  generateText(input: TextGenerationInput): Promise<TextGenerationResult>;
  streamText(input: TextGenerationInput): AsyncIterable<string>;
}

export interface ModelInfo {
  id: string;
  label: string;
  description?: string;
}

/* ---------------------------------- image --------------------------------- */

export type ImageStyle =
  | "photorealistic"
  | "illustration"
  | "icon"
  | "diagram"
  | "logo"
  | "poster"
  | "product"
  | "character"
  | "background"
  | "whiteboard";

export interface ImageGenerationInput {
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
  quality?: "standard" | "high";
  seed?: number;
  transparent?: boolean;
  signal?: AbortSignal;
}

export interface ImageGenerationResult {
  /** Either a remote URL or a data: URL -- the UI treats both the same. */
  url: string;
  provider: ImageProviderId;
  model: string;
  width: number;
  height: number;
  /** Set when this provider ran only because an earlier one failed. */
  fallbackFrom?: ImageProviderId;
  fallbackReason?: string;
  /**
   * False when the bitmap is a cross-origin URL, which would taint the
   * whiteboard canvas and block video export.
   */
  canvasSafe?: boolean;
}

/**
 * `sketch` is our own vector renderer rather than a remote service, and
 * `tavily` is a real photograph found on the web and verified before use.
 */
export type ImageProviderId = "puter" | "pollinations" | "sketch" | "tavily";

export interface ImageProvider {
  readonly id: ImageProviderId;
  readonly runsOn: "server" | "browser";
  isConfigured(): boolean;
  /** True when the provider can actually honour a requested model. */
  hasPremiumModels?(): boolean;
  listModels(): Promise<ModelInfo[]>;
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}

/* ----------------------------------- tts ---------------------------------- */

export interface TTSInput {
  transcript: string;
  voiceId: string;
  modelId?: string;
  language?: string;
  speed?: number;
  signal?: AbortSignal;
}

export interface TTSResult {
  /** Audio bytes, already encoded in `contentType`. */
  audio: ArrayBuffer;
  contentType: string;
  provider: string;
  model: string;
  voiceId: string;
  /** Seconds, when the container makes it cheap to know. */
  duration?: number;
  /**
   * When each word was spoken. Present only on providers that report it; the
   * video falls back to an estimate from the transcript when it is missing.
   */
  words?: WordTiming[];
}

export interface VoiceInfo {
  id: string;
  name: string;
  description?: string;
  language?: string;
  languages?: string[];
  gender?: string;
  country?: string;
  isIndian?: boolean;
  accent?: string;
}

export interface TTSProvider {
  readonly id: string;
  isConfigured(): boolean;
  listVoices(): Promise<VoiceInfo[]>;
  listLanguages(): Promise<string[]>;
  generateSpeech(input: TTSInput): Promise<TTSResult>;
}
