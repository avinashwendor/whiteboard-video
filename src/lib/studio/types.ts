import type { BoardFormat, SceneSpec } from "@/lib/whiteboard/scene";
import type { ImageProviderId, ImageStyle } from "@/lib/ai/types";
import type { Storyboard } from "@/lib/validation/schemas";
import type { WordTiming } from "@/lib/video/timing";
import type { ThemeName } from "@/lib/hyperframes/theme";
import type { SceneRole } from "@/lib/hyperframes/roles";
import type { Glyph } from "@/lib/hyperframes/glyphs";
import type { BoardStockName } from "@/lib/whiteboard/palette";

export type Mode = "write" | "image" | "voice" | "create";

export const MODES: Mode[] = ["write", "image", "voice", "create"];

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
  visualTheme?: ThemeName;
  /** The composition the director asked for, when the scene can carry it. */
  shot?: SceneRole;
  /**
   * Line icons for this scene, resolved from its own words.
   *
   * Geometry travels with the scene because the catalogue it came from is a
   * third of a megabyte and belongs on the server.
   */
  glyphs?: Glyph[];
}

export interface ProjectAsset extends Omit<Storyboard, "scenes"> {
  scenes: SceneAsset[];
  /** Poster frame -- a rendered PNG so history and cards have a thumbnail. */
  cover?: ImageAsset;
  /** Visual engine mode */
  videoStyle?: VideoStyle;
  /**
   * The shape of the frame: widescreen, vertical or square.
   *
   * Stored on the project rather than chosen at export, because it is not a
   * crop. A vertical board lays four icons out in a column, a pie's labels
   * become a legend and bars lie on their side — the drawing is composed for
   * the shape it is going into, so the shape has to be known while it is being
   * made. Absent means widescreen, which is what every project made before this
   * existed was.
   */
  format?: BoardFormat;
  /** Intro card duration in seconds */
  introDuration?: number;
  /** Voice start delay in seconds after scene opens */
  voiceDelay?: number;
  /** Underscore chosen for this video by the director. */
  musicMood?: "calm" | "curious" | "driving" | "warm" | "serious" | "none";
  /**
   * How the mood is realised.
   *
   * "synth" is the built-in underscore: instant, free, deterministic, and
   * furniture. "generated" asks ElevenLabs for a real piece in the same mood —
   * better when the music is meant to be noticed, and it costs a request, a few
   * seconds, and determinism. The mood still chooses the feel either way.
   */
  musicSource?: "synth" | "generated";
  /**
   * The surface a whiteboard video is drawn on.
   *
   * Ignored by the modern engine, which has its own palettes. Chosen by the
   * director, because "explain photosynthesis" wants a chalkboard and "how a
   * bridge is built" wants a blueprint, and no keyword list sees that.
   */
  boardStock?: BoardStockName;
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
  /**
   * Which speech engine narrates.
   *
   * "" means "whichever is configured", which is what this always did and is
   * still the right default — the engines are interchangeable behind one
   * contract and the preference order is a considered one. It is a setting
   * because voices are not interchangeable: somebody who has picked a specific
   * ElevenLabs voice does not want a Deepgram one because the order changed.
   */
  voiceProvider: string;
  language: string;
  speed: number;
  sceneCount: number;
  tone: "explainer" | "story" | "advert" | "lesson";
  /**
   * Overall video production style: Hand-drawn Whiteboard vs Hyperframes
   * Modern Video, or "auto" to let the director read the idea and pick
   * whichever one actually suits it before writing the script.
   */
  videoStyle: VideoStyle | "auto";
  /** Widescreen, vertical or square. See `ProjectAsset.format`. */
  format: BoardFormat;
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
  // Empty on purpose. Which voice is right depends on which engine answered,
  // and the engines have no ids in common — a Cartesia id was hardcoded here
  // and stopped resolving the moment a third engine led the order. The live
  // catalogue picks the default, which is the only thing that can.
  voiceId: "",
  voiceProvider: "",
  language: "en",
  speed: 1,
  sceneCount: 6,
  tone: "explainer",
  videoStyle: "auto",
  format: "landscape",
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
