import { clamp01, easeOutCubic, easeOutQuint, lerp, smootherstep } from "@/lib/video/easing";
import { withAlpha } from "@/lib/video/grade";
import { inkShadow, type Theme } from "./theme";

/**
 * Kinetic typography.
 *
 * Type is the leading subject of a modern explainer, so it is laid out properly:
 * measured, auto-fitted to its box, wrapped on real widths, and revealed word
 * by word out from behind a mask -- the way a title sequence does it, rather
 * than by fading a whole paragraph up at once.
 */

export interface DisplayWord {
  text: string;
  x: number;
  width: number;
  emphasis: boolean;
}

export interface DisplayLine {
  words: DisplayWord[];
  width: number;
}

export interface DisplayLayout {
  lines: DisplayLine[];
  size: number;
  lineHeight: number;
  height: number;
  weight: number;
  family: string;
  /** Words in reading order, so a caller can time them one by one. */
  count: number;
}

export interface DisplayOptions {
  family: string;
  maxWidth: number;
  maxSize: number;
  minSize?: number;
  weight?: number;
  maxLines?: number;
  lineRatio?: number;
  tracking?: number;
  /** Words to lift into the accent colour. Matched case- and punctuation-free. */
  emphasis?: string[];
  uppercase?: boolean;
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Fits text into a box.
 *
 * The size steps down until the text wraps inside `maxLines` without any line
 * overrunning, which is what stops a long heading from either overflowing the
 * frame or being silently truncated.
 */
export function layoutDisplay(
  ctx: CanvasRenderingContext2D,
  text: string,
  options: DisplayOptions,
): DisplayLayout {
  const weight = options.weight ?? 800;
  const maxLines = options.maxLines ?? 3;
  const minSize = options.minSize ?? Math.max(16, options.maxSize * 0.45);
  const lineRatio = options.lineRatio ?? 1.08;
  const emphasis = new Set((options.emphasis ?? []).flatMap((entry) => entry.split(/\s+/)).map(normalise));

  const source = options.uppercase ? text.toUpperCase() : text;
  const words = source.split(/\s+/).filter(Boolean);

  let size = options.maxSize;
  let lines: string[][] = [];

  for (;;) {
    ctx.font = `${weight} ${size}px ${options.family}`;
    if (options.tracking) ctx.letterSpacing = `${options.tracking}px`;

    lines = [];
    let current: string[] = [];
    let overflow = false;

    for (const word of words) {
      const candidate = [...current, word];
      if (ctx.measureText(candidate.join(" ")).width <= options.maxWidth || !current.length) {
        current = candidate;
        if (!current.length) continue;
        if (ctx.measureText(word).width > options.maxWidth) overflow = true;
      } else {
        lines.push(current);
        current = [word];
      }
    }
    if (current.length) lines.push(current);

    if ((lines.length <= maxLines && !overflow) || size <= minSize) break;
    size -= Math.max(2, Math.round(size * 0.06));
  }

  ctx.font = `${weight} ${size}px ${options.family}`;
  const spaceWidth = ctx.measureText(" ").width;

  let index = 0;
  const laid: DisplayLine[] = lines.slice(0, maxLines).map((line) => {
    let cursor = 0;
    const built = line.map((word) => {
      const width = ctx.measureText(word).width;
      const entry: DisplayWord = {
        text: word,
        x: cursor,
        width,
        emphasis: emphasis.has(normalise(word)),
      };
      cursor += width + spaceWidth;
      index += 1;
      return entry;
    });
    return { words: built, width: Math.max(0, cursor - spaceWidth) };
  });

  if (options.tracking) ctx.letterSpacing = "0px";

  return {
    lines: laid,
    size,
    lineHeight: size * lineRatio,
    height: laid.length * size * lineRatio,
    weight,
    family: options.family,
    count: index,
  };
}

export interface DrawDisplayOptions {
  /** Left edge for "left", centre line for "center". */
  x: number;
  /** Baseline of the first line. */
  y: number;
  align: "left" | "center";
  theme: Theme;
  /** 0..1 entrance for the word at `index`, in reading order. */
  reveal: (index: number) => number;
  colour?: string;
  tracking?: number;
  /** Shadow keeps type readable over artwork; off for type on flat panels. */
  shadow?: boolean;
  /** Accent bar wiping in behind emphasised words. */
  highlight?: boolean;
}

/**
 * Draws a laid-out block, one word at a time.
 *
 * Each word rises out from behind its own baseline mask and settles -- the
 * clip is the whole trick, because type that simply fades looks like a slide
 * and type that arrives from behind an edge looks like film.
 */
export function drawDisplay(
  ctx: CanvasRenderingContext2D,
  layout: DisplayLayout,
  options: DrawDisplayOptions,
): void {
  const { theme } = options;
  const shadow = inkShadow(theme);
  let index = 0;

  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  if (options.tracking) ctx.letterSpacing = `${options.tracking}px`;
  ctx.font = `${layout.weight} ${layout.size}px ${layout.family}`;

  layout.lines.forEach((line, lineIndex) => {
    const baseline = options.y + lineIndex * layout.lineHeight;
    const originX = options.align === "center" ? options.x - line.width / 2 : options.x;

    for (const word of line.words) {
      const t = clamp01(options.reveal(index));
      index += 1;
      if (t <= 0) continue;

      const rise = easeOutQuint(t);
      const settle = easeOutCubic(t);
      const x = originX + word.x;
      // The mask exists to hide a word on its way up. Once it has landed the
      // clip is dropped -- keeping it would cut the drop shadow off square and
      // leave a visible dark rectangle around every word.
      const rising = t < 0.999;

      ctx.save();
      if (rising) {
        // Nothing above the cap height, nothing below the descender.
        ctx.beginPath();
        ctx.rect(
          x - layout.size * 0.14,
          baseline - layout.size * 1.06,
          word.width + layout.size * 0.28,
          layout.size * 1.36,
        );
        ctx.clip();
      }

      if (word.emphasis && options.highlight !== false) {
        // A marker stroke under the word, not a block behind it. A filled
        // rectangle reads as selected text; a rule reads as emphasis.
        const wipe = smootherstep(clamp01((t - 0.3) / 0.5));
        const height = Math.max(3, layout.size * 0.085);
        ctx.save();
        ctx.fillStyle = withAlpha(theme.accent, 0.6);
        ctx.beginPath();
        ctx.roundRect(
          x - layout.size * 0.03,
          baseline + layout.size * 0.14,
          (word.width + layout.size * 0.06) * wipe,
          height,
          height / 2,
        );
        ctx.fill();
        ctx.restore();
      }

      ctx.globalAlpha = settle;
      if (options.shadow !== false && !rising) {
        ctx.shadowColor = shadow.colour;
        ctx.shadowBlur = shadow.blur;
        ctx.shadowOffsetY = layout.size * 0.06;
      }
      ctx.fillStyle = word.emphasis ? theme.accent : options.colour ?? theme.ink;
      ctx.fillText(word.text, x, baseline + (1 - rise) * layout.size * 0.92);
      ctx.restore();
    }
  });

  if (options.tracking) ctx.letterSpacing = "0px";
  ctx.restore();
}

/** The small tracked-out label above a heading. */
export function drawEyebrow(
  ctx: CanvasRenderingContext2D,
  text: string,
  options: {
    x: number;
    y: number;
    align: "left" | "center";
    theme: Theme;
    family: string;
    reveal: number;
    size?: number;
  },
) {
  const t = clamp01(options.reveal);
  if (t <= 0) return;
  const size = options.size ?? 15;

  ctx.save();
  ctx.globalAlpha = t;
  ctx.font = `700 ${size}px ${options.family}`;
  ctx.letterSpacing = "4.5px";
  ctx.textAlign = options.align === "center" ? "center" : "left";
  ctx.textBaseline = "alphabetic";

  const label = text.toUpperCase();
  const width = ctx.measureText(label).width;
  const left = options.align === "center" ? options.x - width / 2 : options.x;

  // A short accent rule leads the label in.
  const rule = easeOutCubic(t) * 26;
  ctx.fillStyle = options.theme.accent;
  ctx.fillRect(left - 38, options.y - size * 0.38, rule, 3);

  ctx.fillStyle = options.theme.accent;
  ctx.fillText(label, options.x, options.y);
  ctx.letterSpacing = "0px";
  ctx.restore();
}

/** Body copy: fades and lifts as one line, no per-word theatre. */
export function drawBodyLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  options: {
    x: number;
    y: number;
    align: "left" | "center";
    theme: Theme;
    family: string;
    size: number;
    lineHeight: number;
    reveal: number;
    colour?: string;
  },
) {
  const t = clamp01(options.reveal);
  if (t <= 0) return;

  ctx.save();
  ctx.globalAlpha = t;
  ctx.font = `500 ${options.size}px ${options.family}`;
  ctx.textAlign = options.align === "center" ? "center" : "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = options.colour ?? options.theme.inkMuted;
  const lift = (1 - easeOutCubic(t)) * 14;
  lines.forEach((line, index) => {
    ctx.fillText(line, options.x, options.y + index * options.lineHeight + lift);
  });
  ctx.restore();
}

/** Wraps plain copy at a given size. */
export function wrapAt(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
  size: number,
  maxWidth: number,
  maxLines = 2,
  weight = 500,
): string[] {
  ctx.font = `${weight} ${size}px ${family}`;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  const last = lines[lines.length - 1];
  if (last && ctx.measureText(last).width > maxWidth) {
    let trimmed = last;
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1);
    }
    lines[lines.length - 1] = `${trimmed}…`;
  }
  return lines;
}

/** Counts a number up, keeping whatever prefix and suffix it was written with. */
export function countUp(value: string, progress: number): string {
  const match = value.match(/[\d][\d,.]*/);
  if (!match) return value;

  const raw = match[0];
  const numeric = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return value;

  const t = easeOutQuint(clamp01(progress));
  const decimals = raw.includes(".") ? (raw.split(".")[1]?.length ?? 0) : 0;
  const counted = lerp(0, numeric, t);
  const rendered =
    decimals > 0
      ? counted.toFixed(decimals)
      : Math.round(counted).toLocaleString(numeric >= 10_000 ? "en-IN" : "en-US");

  return value.slice(0, match.index) + rendered + value.slice((match.index ?? 0) + raw.length);
}
