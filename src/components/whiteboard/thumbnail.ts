"use client";

import { renderCover } from "./renderer";
import { boardOf, type BoardFormat } from "@/lib/whiteboard/scene";
import { renderModernCover } from "@/lib/hyperframes/modern-renderer";
import type { VideoStyle } from "@/lib/studio/types";
import type { ThemeName } from "@/lib/hyperframes/theme";
import { setBoardStock, type BoardStockName } from "@/lib/whiteboard/palette";

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
  /** The palette the modern engine graded this film in. */
  theme?: ThemeName;
  /** The surface a whiteboard video is drawn on. */
  boardStock?: BoardStockName;
  /** The shape the film was made in. A vertical poster for a vertical video. */
  format?: BoardFormat;
}): { url: string; width: number; height: number } | null {
  if (typeof document === "undefined") return null;

  const board = boardOf(options.format);
  const canvas = document.createElement("canvas");
  canvas.width = board.width;
  canvas.height = board.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const styles = getComputedStyle(document.documentElement);
  const read = (token: string) => styles.getPropertyValue(token).trim();
  const hand = read("--font-hand");
  const sans = read("--font-geist-sans");
  const display = read("--font-display");
  const poster = read("--font-poster");
  const sansStack = sans ? `${sans}, sans-serif` : "sans-serif";

  // The poster is the first frame of this film, so it is drawn on this film's
  // surface. A gallery of whiteboard thumbnails that are all white when half
  // the videos are chalkboards is worse than no thumbnail at all.
  setBoardStock(options.boardStock);

  try {
    if (options.videoStyle === "hyperframes") {
      renderModernCover(ctx, {
        title: options.title,
        description: options.description,
        fontSans: sansStack,
        fontDisplay: display ? `${display}, ${sansStack}` : sansStack,
        fontPoster: poster ? `${poster}, ${sansStack}` : sansStack,
        theme: options.theme,
        progress: 0.85,
        board,
      });
    } else {
      renderCover(ctx, {
        title: options.title,
        description: options.description,
        fontHand: hand ? `${hand}, cursive` : "cursive",
        fontSans: sansStack,
        progress: 1,
        board,
      });
    }

    // Downscale before encoding: a full-size poster is megabytes, and the
    // gallery never shows it larger than a card.
    // 640 on the long edge, whatever shape that edge is on — a vertical
    // poster squeezed into a 16:9 card is the video's first frame with the
    // wrong story about what shape the video is.
    const thumb = document.createElement("canvas");
    const scale = 640 / Math.max(board.width, board.height);
    thumb.width = Math.round(board.width * scale);
    thumb.height = Math.round(board.height * scale);
    const thumbCtx = thumb.getContext("2d");
    if (!thumbCtx) return null;
    thumbCtx.imageSmoothingQuality = "high";
    thumbCtx.drawImage(canvas, 0, 0, thumb.width, thumb.height);

    return { url: thumb.toDataURL("image/jpeg", 0.86), width: thumb.width, height: thumb.height };
  } catch {
    return null;
  }
}
