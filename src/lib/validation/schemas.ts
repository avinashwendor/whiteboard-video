import { z } from "zod";
import { IMAGE_STYLES } from "@/lib/ai/prompt-engineering";

/**
 * Every request body crosses this boundary. Limits here are the first line of
 * abuse protection: bounded prompt length, bounded image size, and a closed set
 * of provider names so the browser can never point us at an arbitrary backend.
 */

export const MAX_PROMPT_CHARS = 2_000;
export const MAX_TRANSCRIPT_CHARS = 4_000;
export const MIN_IMAGE_DIM = 256;
export const MAX_IMAGE_DIM = 1_536;

/** Model ids stay in a conservative charset -- no path traversal, no URLs. */
const modelId = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9._:\-\/]+$/, "Unsupported model id");

const dimension = z
  .number()
  .int()
  .min(MIN_IMAGE_DIM)
  .max(MAX_IMAGE_DIM)
  .refine((value) => value % 8 === 0, "Dimensions must be a multiple of 8");

export const promptField = z
  .string()
  .trim()
  .min(3, "Say a little more about what you want.")
  .max(MAX_PROMPT_CHARS, `Keep prompts under ${MAX_PROMPT_CHARS} characters.`);

export const generateRequestSchema = z.object({
  prompt: promptField,
  systemPrompt: z.string().trim().max(4_000).optional(),
  model: modelId.optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(64).max(8_000).optional(),
  stream: z.boolean().optional(),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const imageRequestSchema = z.object({
  prompt: promptField,
  /** Only server-runnable providers are accepted here; Puter runs in the browser. */
  provider: z.literal("pollinations").optional(),
  model: modelId.optional(),
  width: dimension.optional(),
  height: dimension.optional(),
  quality: z.enum(["standard", "high"]).optional(),
  style: z.enum(IMAGE_STYLES).optional(),
  /** Ask Omega to rewrite the prompt before it reaches the image model. */
  enhance: z.boolean().optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
  transparent: z.boolean().optional(),
  /** Set by the client when Puter failed, so the response can say so. */
  fallbackFrom: z.literal("puter").optional(),
  fallbackReason: z.string().trim().max(300).optional(),
});
export type ImageRequest = z.infer<typeof imageRequestSchema>;

export const ttsRequestSchema = z.object({
  /** Voice engine to use. Falls back to whatever is configured. */
  provider: z.enum(["deepgram", "cartesia"]).optional(),
  transcript: z
    .string()
    .trim()
    .min(1, "There's nothing to speak.")
    .max(MAX_TRANSCRIPT_CHARS, `Keep narration under ${MAX_TRANSCRIPT_CHARS} characters.`),
  voiceId: z.string().trim().min(1).max(120),
  modelId: modelId.optional(),
  language: z
    .string()
    .trim()
    .max(12)
    .regex(/^[a-zA-Z-]+$/, "Unsupported language code")
    .optional(),
  speed: z.number().min(0.6).max(1.5).optional(),
});
export type TtsRequest = z.infer<typeof ttsRequestSchema>;

export const visualRequestSchema = z.object({
  /** What the scene is about, in the script's own words. */
  brief: z.string().trim().min(3).max(600),
  /** Search phrase, usually narrower than the brief. */
  query: z.string().trim().min(3).max(200),
  model: modelId.optional(),
});
export type VisualRequest = z.infer<typeof visualRequestSchema>;

/**
 * A plain-language edit against an existing project.
 *
 * `project` arrives already pruned by the editor -- word timings and resolved
 * icon geometry are stripped client-side, because raw they are most of a
 * project's bytes and none of its meaning.
 */
export const editRequestSchema = z.object({
  instruction: promptField,
  project: z.looseObject({
    title: z.string().trim().max(200),
    scenes: z.array(z.unknown()).min(1).max(12),
  }),
  /** The scene open in the editor, numbered from 1 as the person sees it. */
  sceneNumber: z.number().int().min(1).max(12).optional(),
  /** The narrators this deployment can actually cast. */
  voices: z
    .array(
      z.object({
        id: z.string().trim().max(120),
        name: z.string().trim().max(80),
        gender: z.string().trim().max(24).optional(),
        language: z.string().trim().max(12).optional(),
        accent: z.string().trim().max(60).optional(),
        description: z.string().trim().max(200).optional(),
      }),
    )
    .max(120)
    .optional(),
  /** What is configured, so nothing impossible gets planned. */
  can: z
    .object({
      photoSearch: z.boolean().optional(),
      generateImage: z.boolean().optional(),
      lineArt: z.boolean().optional(),
    })
    .optional(),
  model: modelId.optional(),
});
export type EditRequest = z.infer<typeof editRequestSchema>;

export const createRequestSchema = z.object({
  prompt: promptField,
  model: modelId.optional(),
  sceneCount: z.number().int().min(1).max(6).optional(),
  language: z
    .string()
    .trim()
    .max(12)
    .regex(/^[a-zA-Z-]+$/)
    .optional(),
  tone: z.enum(["explainer", "story", "advert", "lesson"]).optional(),
  videoStyle: z.enum(["whiteboard", "hyperframes"]).optional(),
});
export type CreateRequest = z.infer<typeof createRequestSchema>;

/**
 * The structured plan Omega must return for CREATE. Kept robust with optional
 * kinetic metadata for Hyperframes modern video mode.
 */
export const sceneSchema = z.object({
  heading: z.string().trim().min(1).max(120),
  bullets: z.array(z.string().trim().min(1).max(160)).min(1).max(4),
  image_prompt: z.string().trim().min(10).max(900),
  narration: z.string().trim().min(10).max(1200),
  keywords: z.array(z.string()).optional(),
  stat: z.string().optional(),
  stat_caption: z.string().optional(),
  icon: z.string().optional(),
  /** What to search the web for when this scene wants a real photograph. */
  photo_query: z.string().trim().max(160).optional(),
  /**
   * Which supporting visual this scene should carry beside the drawing.
   * The director picks per scene so a video varies instead of repeating one
   * treatment five times.
   */
  support_visual: z.enum(["photo", "generated", "none"]).optional(),
});

export const storyboardSchema = z.object({
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().min(1).max(400),
  image_prompt: z.string().trim().min(10).max(900),
  narration: z.string().trim().min(10).max(4_000),
  scenes: z.array(sceneSchema).min(1).max(6),
  video_style: z.enum(["whiteboard", "hyperframes"]).optional(),
  /**
   * One art direction for the whole video. Prefixed onto every scene's image
   * prompt so six shots read as one film rather than six stock pictures.
   */
  visual_style: z.string().trim().max(300).optional(),
  /** Palette the renderer should grade the video in. */
  visual_theme: z.enum(["studio-dark", "cyber-blue", "sunset", "clean-light"]).optional(),
  /** Underscore for the whole video. */
  music_mood: z.enum(["calm", "curious", "driving", "warm", "serious", "none"]).optional(),
  /**
   * The qualities the narrator should have. Matched against the voice
   * catalogue rather than naming a voice, so it survives a provider swap.
   */
  voice_brief: z
    .object({
      gender: z.enum(["feminine", "masculine", "any"]).optional(),
      qualities: z.array(z.string().trim().max(24)).max(5).optional(),
    })
    .optional(),
});
export type Storyboard = z.infer<typeof storyboardSchema>;
export type Scene = z.infer<typeof sceneSchema>;

/** Turns a ZodError into one short sentence a person can act on. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "That request wasn't valid.";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
