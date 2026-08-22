import { z } from "zod";
import { omega } from "./omega";
import type { ImageStyle } from "./types";

/**
 * Raw user wishes make poor image prompts. Omega rewrites them into a brief the
 * image model can actually render -- while respecting the style the user asked
 * for, rather than flattening everything into "cinematic photorealistic".
 */

export const IMAGE_STYLES = [
  "photorealistic",
  "illustration",
  "icon",
  "diagram",
  "logo",
  "poster",
  "product",
  "character",
  "background",
  "whiteboard",
] as const;

const enhancementSchema = z.object({
  style: z.enum(IMAGE_STYLES),
  prompt: z.string().min(12).max(1200),
  negative: z.string().max(400).optional(),
});

export type PromptEnhancement = z.infer<typeof enhancementSchema>;

/** Style-specific rendering language appended after the model's rewrite. */
const STYLE_DIRECTION: Record<ImageStyle, string> = {
  photorealistic:
    "photographic, natural lighting, realistic materials and skin texture, shallow depth of field, 35mm lens",
  illustration:
    "hand-crafted illustration, confident linework, deliberate limited palette, editorial feel",
  icon: "single centred icon, flat vector, minimal geometry, generous padding, plain background, no text",
  diagram:
    "clean explanatory diagram, clear labelled shapes, orthogonal layout, generous whitespace, flat colour",
  logo: "flat vector logomark, balanced negative space, plain background, reproducible at small sizes",
  poster: "graphic poster composition, strong focal hierarchy, bold shapes, print-ready framing",
  product:
    "studio product photography, seamless backdrop, soft key light with gentle fill, crisp edges, commercial finish",
  character:
    "character design sheet, expressive silhouette, consistent proportions, clean background",
  background:
    "wide environment plate, uncluttered centre for overlaid content, consistent lighting, no subject in focus",
  // Deliberately describes the IMAGE, not a scene containing a whiteboard.
  // "on a whiteboard" reliably produced a photograph of a meeting room with a
  // whiteboard in it, which is useless as board artwork.
  whiteboard:
    "flat 2d hand-drawn doodle illustration, thick black marker outlines, plain solid white background, no room, no scenery, no furniture, no photograph, no 3d render, no perspective, no shading, no gradients, no text, bold simple shapes with one or two flat accent colours, generous white space, sticker style",
};

const SYSTEM = `You turn short user requests into precise image-generation briefs.

Rules:
- Pick the single best style from: ${IMAGE_STYLES.join(", ")}.
- Honour any style the user names. Never make something photorealistic when they asked for an icon, diagram, logo or sketch.
- The prompt must describe subject, composition, lighting/materials and mood in one dense paragraph. No lists, no preamble, no quotes.
- Never invent brand names, real people, or text overlays unless the user asked for them.
- Reply with JSON only: {"style": "...", "prompt": "...", "negative": "..."}`;

/** Cheap keyword pass used when the LLM is unavailable or returns nonsense. */
export function classifyStyle(request: string): ImageStyle {
  const text = request.toLowerCase();
  const rules: Array<[RegExp, ImageStyle]> = [
    [/\bwhiteboard|marker sketch|hand[- ]drawn explainer\b/, "whiteboard"],
    [/\blogo|logomark|wordmark|brand mark\b/, "logo"],
    [/\bicon|glyph|favicon|app icon\b/, "icon"],
    [/\bdiagram|flow ?chart|architecture|schematic|infographic\b/, "diagram"],
    [/\bposter|flyer|album cover|banner\b/, "poster"],
    [/\bproduct shot|packshot|on a white background|product photo\b/, "product"],
    [/\bcharacter|mascot|avatar|hero design\b/, "character"],
    [/\bwallpaper|background|backdrop|texture\b/, "background"],
    [/\billustration|illustrated|drawing|painting|anime|cartoon|watercolou?r\b/, "illustration"],
  ];
  for (const [pattern, style] of rules) {
    if (pattern.test(text)) return style;
  }
  return "photorealistic";
}

function stripFence(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function fallbackEnhancement(request: string, style?: ImageStyle): PromptEnhancement {
  const resolved = style ?? classifyStyle(request);
  return {
    style: resolved,
    prompt: `${request.trim()}. ${STYLE_DIRECTION[resolved]}.`,
  };
}

export interface EnhanceOptions {
  request: string;
  /** Locks the style instead of letting the model choose. */
  style?: ImageStyle;
  model?: string;
  signal?: AbortSignal;
}

/**
 * Never throws: a weak prompt is far better than a failed generation, so any
 * LLM problem degrades to the keyword classifier.
 */
export async function enhanceImagePrompt(options: EnhanceOptions): Promise<PromptEnhancement> {
  const { request, style, model, signal } = options;

  if (!omega.isConfigured()) return fallbackEnhancement(request, style);

  const instruction = style
    ? `${request}\n\nThe style MUST be "${style}".`
    : request;

  try {
    const { text } = await omega.generateText({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: instruction },
      ],
      model,
      temperature: 0.6,
      maxTokens: 600,
      json: true,
      signal,
    });

    const candidate = firstJsonObject(stripFence(text));
    if (!candidate) return fallbackEnhancement(request, style);

    const parsed = enhancementSchema.safeParse(JSON.parse(candidate));
    if (!parsed.success) return fallbackEnhancement(request, style);

    const resolvedStyle = style ?? parsed.data.style;
    return {
      style: resolvedStyle,
      prompt: `${parsed.data.prompt.trim()} ${STYLE_DIRECTION[resolvedStyle]}.`.trim(),
      negative: parsed.data.negative?.trim() || undefined,
    };
  } catch {
    return fallbackEnhancement(request, style);
  }
}

/** Applies the house look for a style without calling the LLM. */
export function decorateWithStyle(prompt: string, style: ImageStyle): string {
  return `${prompt.trim()} ${STYLE_DIRECTION[style]}.`;
}

export { STYLE_DIRECTION };
