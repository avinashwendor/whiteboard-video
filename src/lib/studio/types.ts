import type { SceneSpec } from "@/lib/whiteboard/scene";
import type { ImageProviderId, ImageStyle } from "@/lib/ai/types";
import type { Storyboard } from "@/lib/validation/schemas";
import type { WordTiming } from "@/lib/video/timing";

export type Mode = "write" | "image" | "storyboard" | "voice" | "create";

export const MODES: Mode[] = ["write", "image", "storyboard", "voice", "create"];

export interface ImageAsset {
  url: string;
  provider: ImageProviderId;
  model: string;
  width: number;
  height: number;
  canvasSafe: boolean;
  /**
   * How the picture should be presented. A photograph is taped up like a
   * print; marker artwork belongs on the board bare, with no frame at all.
   */
  kind?: "photo" | "drawn";
  fallbackFrom?: ImageProviderId;
  fallbackReason?: string;
  promptUsed?: string;
  style?: ImageStyle;
  /** IndexedDB key, set once the bytes are cached locally. */
  cacheKey?: string;
}

export interface AudioAsset {
  url: string;
  provider: string;
  model: string;
  voiceId: string;
  language?: string;
  /** Filled in by the browser once the clip has loaded. */
  duration?: number;
  /**
   * When each word was spoken. Everything visual in a scene is scheduled
   * against these, so a beat lands on the sentence that describes it.
   */
  words?: WordTiming[];
  /** IndexedDB key, set once the bytes are cached locally. */
  cacheKey?: string;
}

export type VideoStyle = "whiteboard" | "hyperframes";

export interface SceneAsset {
  heading: string;
  bullets: string[];
  narration: string;
  imagePrompt: string;
  /** Search phrase used when this scene wants real photography. */
  photoQuery?: string;
  /** Supporting visual the director asked this scene to carry. */
  supportVisual?: "photo" | "generated" | "none";
  /** Where the plate came from, shown on the scene card. */
  imageNote?: string;
  /** Composed board layout -- used for whiteboard doodle scenes. */
  scene?: SceneSpec;
  image?: ImageAsset;
  audio?: AudioAsset;
  status: "pending" | "running" | "done" | "error";
  error?: string;
  /** Hyperframes kinetic typography keywords and callout pills */
  keywords?: string[];
  stat?: string;
  statCaption?: string;
  visualTheme?: "studio-dark" | "cyber-blue" | "sunset" | "clean-light";
}

export interface ProjectAsset extends Omit<Storyboard, "scenes"> {
  scenes: SceneAsset[];
  /** Poster frame -- a rendered PNG so history and cards have a thumbnail. */
  cover?: ImageAsset;
  /** Visual engine mode */
  videoStyle?: VideoStyle;
  /** Intro card duration in seconds */
  introDuration?: number;
  /** Voice start delay in seconds after scene opens */
  voiceDelay?: number;
  /** Underscore chosen for this video by the director. */
  musicMood?: "calm" | "curious" | "driving" | "warm" | "serious" | "none";
}

export interface GenerationMeta {
  model?: string;
  provider?: string;
  durationMs?: number;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  imageModel?: string;
  voiceId?: string;
  language?: string;
}

export type GenerationStatus = "running" | "done" | "error";

export interface Generation {
  id: string;
  mode: Mode;
  prompt: string;
  createdAt: number;
  status: GenerationStatus;
  /** What the UI is doing right now, shown while `status === "running"`. */
  stage?: string;
  /** 0..1 for multi-step work. */
  progress?: number;
  text?: string;
  image?: ImageAsset;
  audio?: AudioAsset;
  project?: ProjectAsset;
  meta: GenerationMeta;
  error?: { code: string; message: string };
}

export interface Settings {
  textModel: string;
  imageProvider: ImageProviderId;
  imageModel: string;
  imageSize: string;
  imageStyle: ImageStyle | "auto";
  voiceId: string;
  language: string;
  speed: number;
  sceneCount: number;
  tone: "explainer" | "story" | "advert" | "lesson";
  /** Overall video production style: Hand-drawn Whiteboard vs Hyperframes Modern Video */
  videoStyle: VideoStyle;
  /**
   * Whiteboard scene artwork. "rich" is the default: every board is drawn, and
   * the director decides per scene whether it also carries a real photograph
   * or a generated illustration.
   */
  sceneArt: "rich" | "scene" | "image" | "hybrid";
  /**
   * Modern Video plates: a real photograph found on the web and verified, or
   * one generated from the scene's prompt.
   */
  modernArt: "photo" | "generated";
  /** True once the user picks a voice by hand, so the director stops casting. */
  voicePinned?: boolean;
  /** VOICE mode: speak the box verbatim, or let Omega write the script first. */
  voiceSource: "verbatim" | "script";
  /** Silence/lead-in before voice starts in seconds */
  voiceDelay: number;
  /** Duration of the intro cover card in seconds */
  introDuration: number;
}

export const DEFAULT_SETTINGS: Settings = {
  textModel: "",
  imageProvider: "pollinations",
  imageModel: "",
  imageSize: "1280x720",
  imageStyle: "auto",
  voiceId: "4459a9a5-69d6-4680-b970-e13dc51845b6", // Siya (English · Bright Conversationalist)
  language: "en",
  speed: 1,
  sceneCount: 4,
  tone: "explainer",
  videoStyle: "whiteboard",
  sceneArt: "rich",
  modernArt: "photo",
  voiceSource: "verbatim",
  voiceDelay: 0.6,
  introDuration: 3.0,
};

export const IMAGE_SIZES = [
  { value: "1024x1024", label: "Square · 1024" },
  { value: "1280x720", label: "Widescreen · 16:9" },
  { value: "720x1280", label: "Portrait · 9:16" },
  { value: "1536x640", label: "Banner · 12:5" },
] as const;

export function parseSize(size: string): { width: number; height: number } {
  const [width, height] = size.split("x").map((value) => Number.parseInt(value, 10));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { width: 1280, height: 720 };
  return { width, height };
}
