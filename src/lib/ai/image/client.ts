"use client";

import { enhancePrompt, generateServerImage } from "@/lib/studio/api";
import type { ImageAsset } from "@/lib/studio/types";
import type { ImageProviderId, ImageStyle } from "../types";
import { generateImage as puterGenerate, PuterUnavailableError } from "./puter";

/**
 * The image fallback chain, driven from the browser because Puter is a
 * browser-only SDK:
 *
 *   Puter  ->  Pollinations  ->  surfaced error
 *
 * A fallback is never silent. The result carries `fallbackFrom` and a plain
 * sentence explaining what happened, and the result card shows it.
 */

export interface ImageRequestOptions {
  prompt: string;
  provider: ImageProviderId;
  model?: string;
  width: number;
  height: number;
  style?: ImageStyle | "auto";
  quality?: "standard" | "high";
  seed?: number;
  /** Skip the LLM rewrite (already-engineered prompts, e.g. storyboard scenes). */
  enhance?: boolean;
  onStage?: (stage: string) => void;
  signal?: AbortSignal;
}

export async function generateImage(options: ImageRequestOptions): Promise<ImageAsset> {
  const {
    prompt,
    provider,
    model,
    width,
    height,
    style,
    quality,
    seed,
    enhance = true,
    onStage,
    signal,
  } = options;

  const requestedStyle = style && style !== "auto" ? style : undefined;

  if (provider !== "puter") {
    onStage?.("Generating image");
    const result = await generateServerImage(
      { prompt, model, width, height, style: requestedStyle, quality, seed, enhance },
      signal,
    );
    return {
      ...result.image,
      promptUsed: result.prompt.used,
      style: result.prompt.style as ImageStyle | undefined,
    };
  }

  // Puter path. It needs the upgraded prompt too, so ask the server for it
  // first -- and if that fails, fall back to the words the user typed.
  let usedPrompt = prompt;
  let resolvedStyle = requestedStyle;
  if (enhance) {
    onStage?.("Refining the prompt");
    try {
      const enhanced = await enhancePrompt({ prompt, style: requestedStyle }, signal);
      usedPrompt = enhanced.used;
      resolvedStyle = enhanced.style as ImageStyle;
    } catch {
      // Prompt polish is a nicety, not a requirement.
    }
  }

  onStage?.("Generating image with Puter");
  try {
    const result = await puterGenerate({
      prompt: usedPrompt,
      model,
      width,
      height,
      quality,
      seed,
      signal,
    });
    return { ...result, promptUsed: usedPrompt, style: resolvedStyle, canvasSafe: result.canvasSafe ?? true };
  } catch (err) {
    if (signal?.aborted) throw err;

    const reason =
      err instanceof PuterUnavailableError
        ? err.reason
        : err instanceof Error
          ? err.message
          : "Puter didn't respond.";

    onStage?.("Puter unavailable — switching to Pollinations");
    const result = await generateServerImage(
      {
        prompt: usedPrompt,
        width,
        height,
        style: resolvedStyle,
        quality,
        seed,
        // The prompt has already been through the rewriter.
        enhance: false,
        fallbackFrom: "puter",
        fallbackReason: reason.slice(0, 300),
      },
      signal,
    );

    return {
      ...result.image,
      promptUsed: result.prompt.used,
      style: (result.prompt.style as ImageStyle | undefined) ?? resolvedStyle,
      fallbackFrom: "puter",
      fallbackReason: reason,
    };
  }
}
