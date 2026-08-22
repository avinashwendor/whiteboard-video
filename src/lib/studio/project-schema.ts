import { z } from "zod";
import { sceneSpecSchema } from "@/lib/whiteboard/scene";
import type { ProjectAsset } from "./types";

/**
 * The project, as it looks when a person has been editing it by hand.
 *
 * This is deliberately looser than the schemas in `lib/validation`: those guard
 * a network boundary, this one guards a text box. Someone pasting JSON into the
 * editor should be stopped when they have broken something the renderer needs
 * -- a missing narration, a scene spec that no longer matches a layout -- and
 * left alone otherwise. Unknown keys pass straight through so a field added
 * later is never silently deleted by a round trip through this file.
 */

const imageAssetSchema = z.looseObject({
  url: z.string().trim().min(1, "an image needs a url"),
  provider: z.string().trim().min(1),
  model: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  canvasSafe: z.boolean(),
  kind: z.enum(["photo", "drawn"]).optional(),
});

const wordSchema = z.looseObject({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});

const audioAssetSchema = z.looseObject({
  url: z.string().trim().min(1, "a voice clip needs a url"),
  provider: z.string(),
  model: z.string(),
  voiceId: z.string(),
  duration: z.number().positive().optional(),
  words: z.array(wordSchema).optional(),
});

const themeSchema = z.enum(["studio-dark", "cyber-blue", "sunset", "clean-light"]);

export const editableSceneSchema = z.looseObject({
  heading: z.string().trim().max(160),
  bullets: z.array(z.string().trim().max(240)).max(8),
  narration: z.string().trim().max(4_000),
  imagePrompt: z.string().trim().max(1_200),
  photoQuery: z.string().trim().max(200).optional(),
  supportVisual: z.enum(["photo", "generated", "none"]).optional(),
  imageNote: z.string().optional(),
  scene: sceneSpecSchema.optional(),
  image: imageAssetSchema.optional(),
  audio: audioAssetSchema.optional(),
  status: z.enum(["pending", "running", "done", "error"]),
  error: z.string().optional(),
  keywords: z.array(z.string().trim().max(60)).max(12).optional(),
  stat: z.string().trim().max(24).optional(),
  statCaption: z.string().trim().max(60).optional(),
  visualTheme: themeSchema.optional(),
});

export const editableProjectSchema = z.looseObject({
  title: z.string().trim().min(1, "the video needs a title").max(200),
  description: z.string().trim().max(600),
  scenes: z.array(editableSceneSchema).min(1, "a video needs at least one scene").max(12),
  cover: imageAssetSchema.optional(),
  videoStyle: z.enum(["whiteboard", "hyperframes"]).optional(),
  visual_theme: themeSchema.optional(),
  introDuration: z.number().min(0).max(20).optional(),
  voiceDelay: z.number().min(0).max(10).optional(),
  musicMood: z.enum(["calm", "curious", "driving", "warm", "serious", "none"]).optional(),
});

/**
 * Parses hand-edited JSON.
 *
 * Returns the project or one sentence naming the field that is wrong -- the
 * editor shows it under the text box, so it has to read like a note from a
 * colleague rather than a validator dump.
 */
export function parseProjectJson(raw: string): { project: ProjectAsset } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return { error: `That isn't valid JSON — ${err instanceof Error ? err.message : "parse error"}` };
  }

  const parsed = editableProjectSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join(".");
    return { error: path ? `${path}: ${issue.message}` : issue.message };
  }

  return { project: parsed.data as unknown as ProjectAsset };
}

/** Pretty-prints a project for the JSON panel. */
export function formatProjectJson(project: ProjectAsset): string {
  return JSON.stringify(project, null, 2);
}
