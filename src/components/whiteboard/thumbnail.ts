"use client";

import { BOARD_HEIGHT, BOARD_WIDTH, renderCover } from "./renderer";
import { renderModernCover } from "@/lib/hyperframes/modern-renderer";
import type { VideoStyle } from "@/lib/studio/types";

/**
 * Renders the title card once, off screen, so the gallery has a real poster
 * frame. A data URL keeps it self-contained: it survives a server restart and
 * costs no extra request.
 */
export function renderThumbnail(options: {
  title: string;
  description: string;
  /** The poster has to be the video it belongs to, not always a whiteboard. */
  videoStyle?: VideoStyle;
}): { url: string; width: number; height: number } | null {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = BOARD_WIDTH;
  canvas.height = BOARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const styles = getComputedStyle(document.documentElement);
  const hand = styles.getPropertyValue("--font-hand").trim();
  const sans = styles.getPropertyValue("--font-geist-sans").trim();

  try {
    if (options.videoStyle === "hyperframes") {
      renderModernCover(ctx, {
        title: options.title,
        description: options.description,
        fontSans: sans ? `${sans}, sans-serif` : "sans-serif",
        progress: 0.85,
      });
    } else {
      renderCover(ctx, {
        title: options.title,
        description: options.description,
        fontHand: hand ? `${hand}, cursive` : "cursive",
        fontSans: sans ? `${sans}, sans-serif` : "sans-serif",
        progress: 1,
      });
    }

    // Downscale before encoding: a full-size poster is megabytes, and the
    // gallery never shows it larger than a card.
    const thumb = document.createElement("canvas");
    thumb.width = 640;
    thumb.height = 360;
    const thumbCtx = thumb.getContext("2d");
    if (!thumbCtx) return null;
    thumbCtx.imageSmoothingQuality = "high";
    thumbCtx.drawImage(canvas, 0, 0, thumb.width, thumb.height);

    return { url: thumb.toDataURL("image/jpeg", 0.86), width: thumb.width, height: thumb.height };
  } catch {
    return null;
  }
}
