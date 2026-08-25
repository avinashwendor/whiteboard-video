import { BOARD_WIDTH } from "@/lib/whiteboard/scene";
import {
  clamp01,
  easeOutCubic,
  easeOutQuint,
  range,
} from "@/lib/video/easing";
import type { Cue, SubtitlePhrase, WordTiming } from "@/lib/video/timing";
import { chromeFill, drawGlyph } from "./surface";
import { drawEmoji } from "./paper";
import type { Theme, ThemeName } from "./theme";
import type { Glyph } from "./glyphs";
import type { SceneRole } from "./roles";
import type { Panel } from "./casting";

/**
 * The stage a screen is drawn on.
 *
 * Every composition in this engine is handed the same five things -- a
 * context, the scene, its plan, the palette and the timing -- and reaches for
 * the same handful of helpers. Those live here rather than beside any one
 * screen, because thirty-five compositions sharing a private helper in one
 * file is how a renderer becomes unreadable.
 *
 * Nothing here composes a frame. It is the vocabulary the compositions are
 * written in: the two type faces, the safe area, the entrance timing, the one
 * accent object, and the rule.
 */

export interface ModernRenderScene {
  heading: string;
  bullets: string[];
  narration: string;
  image?: HTMLImageElement | null;
  index: number;
  totalScenes: number;
  keywords?: string[];
  stat?: string;
  statCaption?: string;
  visualTheme?: ThemeName;
  /**
   * The shot the director asked for.
   *
   * Honoured whenever the scene can actually carry it. The renderer keeps the
   * veto because a layout that draws four items cannot be handed one, and an
   * empty rail is worse than the wrong-but-full alternative.
   */
  shot?: SceneRole;
  /** Line icons resolved from this scene's own words, in bullet order. */
  glyphs?: Glyph[];
}

export interface SceneTiming {
  lead: number;
  speech: number;
  tail: number;
}

export interface ModernPlan {
  /** The opening panel's screen, which is what the score is written against. */
  role: SceneRole;
  /**
   * The screens this scene cuts through, in order.
   *
   * Always at least one. A short scene has exactly one and behaves as the
   * engine always did; anything with room gets two to four, each carrying a
   * share of the scene's content.
   */
  panels: Panel[];
  /** The accent glyph for this scene, picked from what it is about. */
  glyph: string;
  /** One per drawn item, where a shot places several. */
  itemGlyphs: string[];
  /** Heading entrance. */
  heading: Cue;
  /** One cue per bullet, step or chip, aligned to the narration. */
  beats: Cue[];
  /** When the statistic is actually said, so the counter lands on it. */
  stat: Cue | null;
  phrases: SubtitlePhrase[];
  words: WordTiming[];
  timing: SceneTiming;
}

export interface ModernRenderOptions {
  /** Seconds into this scene. */
  time: number;
  /** Total length of this scene. */
  duration: number;
  /** The interface face. Captions, body copy, subtitles. */
  fontSans: string;
  /**
   * The display face: tight, heavy, drawn to be set large.
   *
   * Optional so an older caller still renders; every headline falls back to
   * the interface face rather than to a system default, which would be worse
   * than the thing being replaced.
   */
  fontDisplay?: string;
  /** Ultra-condensed poster face, for one word filling the frame. */
  fontPoster?: string;
  /** 0..1 through the whole video, for the chapter rail. */
  globalProgress?: number;
}


/* ------------------------------- the surface ------------------------------ */

/**
 * The face a shot sets its display type in.
 *
 * Headlines, statistics and numerals go here; captions and subtitles stay on
 * the interface face. Pairing a tight display cut with a neutral text face is
 * the oldest trick in editorial typography and the reason a headline can be
 * enormous without the frame feeling shouty.
 */
export function display(options: ModernRenderOptions): string {
  return options.fontDisplay ?? options.fontSans;
}

/** The poster face, for a single word at frame scale. */
export function poster(options: ModernRenderOptions): string {
  return options.fontPoster ?? display(options);
}

export const MARGIN = 96;
export const CONTENT_WIDTH = BOARD_WIDTH - MARGIN * 2;
/**
 * Nothing a shot composes may cross this line: below it lives the subtitle
 * band, and type over type is the fastest way to make a video look unfinished.
 */
export const SAFE_BOTTOM = 552;

/** Word-by-word entrance timing, in reading order. */
export function staggered(cue: Cue, count: number, time: number, per = 0.075) {
  const total = Math.max(0.0001, cue.span);
  return (index: number) => {
    const start = cue.at + Math.min(index * per, total * 0.55);
    return range(time, start, start + Math.max(0.28, total * 0.55));
  };
}

/** The small line above a heading: where you are, and what this one is about. */
export function eyebrowFor(scene: ModernRenderScene): string {
  const number = String(scene.index + 1).padStart(2, "0");
  const keyword = scene.keywords?.[0]?.trim();
  return keyword ? `${number} — ${keyword.toUpperCase()}` : `${number} / ${String(scene.totalScenes).padStart(2, "0")}`;
}

/** A short accent rule. Flat, no glow -- this is printed work. */
export function drawRule(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  x: number,
  y: number,
  width: number,
  progress: number,
  height = 5,
) {
  const t = easeOutQuint(clamp01(progress));
  if (t <= 0) return;
  ctx.save();
  // A rule is hairline work: it uses the mark weight, not the plate colour.
  ctx.fillStyle = theme.mark;
  ctx.fillRect(x, y, width * t, height);
  ctx.restore();
}

/**
 * The one object in the frame that is not a word.
 *
 * Which kind of object depends on the finish, and the rule is not arbitrary.
 * Printed frames get an emoji: full colour, warm, handmade, and it sits on
 * paper the way a sticker does. Editorial and glass frames get line work in
 * the frame's own accent, because a full-colour cartoon on a magazine cover or
 * a frosted panel is the one mark that will make the whole composition look
 * like a school project.
 *
 * Falls back to the emoji whenever no icon resolved, so a frame is never left
 * with an empty space where its subject was meant to be.
 */
export function drawMark(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  index: number,
  x: number,
  y: number,
  size: number,
  theme: Theme,
  options: { enter?: number; time?: number; tilt?: number; seed?: number; colour?: string } = {},
) {
  const glyph = scene.glyphs?.[index];
  if (theme.finish !== "print" && glyph) {
    drawGlyph(ctx, glyph, x, y, size * 0.84, {
      colour: options.colour ?? theme.accent,
      enter: options.enter,
      width: 2.4,
    });
    return;
  }
  drawEmoji(ctx, plan.itemGlyphs[index] ?? plan.glyph, x, y, size, options);
}

/** The picture a shot was given, if it is actually usable. */
export function pictureOf(scene: ModernRenderScene): HTMLImageElement | null {
  const image = scene.image;
  return image && image.complete && image.naturalWidth > 0 ? image : null;
}

/* ------------------------- brushed-metal display -------------------------- */

/**
 * One line of display type filled with brushed metal.
 *
 * Kept separate from `drawDisplay` because a gradient fill is a different
 * animal from an ink one: it has to be built in frame coordinates for the
 * highlight to stay put as the type rises, and it only reads at scale. Used
 * for a count or a title, never for a sentence.
 */
export function drawChromeLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  options: {
    x: number;
    y: number;
    size: number;
    family: string;
    theme: Theme;
    align?: CanvasTextAlign;
    reveal: number;
    weight?: number;
  },
) {
  const t = clamp01(options.reveal);
  if (t <= 0.001) return;
  const { size } = options;

  ctx.save();
  ctx.font = `${options.weight ?? 900} ${size}px ${options.family}`;
  ctx.textAlign = options.align ?? "center";
  ctx.textBaseline = "alphabetic";
  // Display type wants negative tracking; the same face at 14px would not.
  ctx.letterSpacing = `${-size * 0.03}px`;

  const width = ctx.measureText(text).width;
  const left = options.align === "left" ? options.x : options.x - width / 2;

  // Rises out from behind its own cap height, as the ink type does.
  const rise = easeOutQuint(t);
  ctx.beginPath();
  ctx.rect(left - size * 0.2, options.y - size * 1.1, width + size * 0.4, size * 1.45);
  ctx.clip();

  ctx.globalAlpha = easeOutCubic(t);
  ctx.fillStyle = chromeFill(ctx, options.theme, options.y - size * 0.88, size * 1.08);
  ctx.fillText(text, options.x, options.y + (1 - rise) * size * 0.9);
  ctx.letterSpacing = "0px";
  ctx.restore();
}

