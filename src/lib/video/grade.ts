import { clamp01, hash, noise1, range, smootherstep } from "./easing";

/**
 * The finishing pass.
 *
 * A composition can be perfectly laid out and still look like a slide, because
 * what a camera does to an image -- grain, falloff, bloom, the way highlights
 * smear -- is absent. These are cheap approximations of exactly that, applied
 * over the top of a finished frame.
 *
 * Everything is a pure function of time: no random(), no accumulating state, so
 * a recorded frame is identical to the previewed one.
 */

let grainTile: HTMLCanvasElement | null = null;
let grainPattern: CanvasPattern | null = null;

/** One noise tile, reused. Regenerating per frame would crawl and cost. */
function tile(): HTMLCanvasElement | null {
  if (grainTile) return grainTile;
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const image = ctx.createImageData(160, 160);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.floor(hash(i * 0.017) * 255);
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  grainTile = canvas;
  return canvas;
}

/**
 * Film grain.
 *
 * The tile is offset by a value that changes only a few times a second, which
 * is what real grain does -- moving it every frame reads as video noise.
 */
export function drawGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  strength = 0.05,
) {
  const source = tile();
  if (!source) return;
  if (!grainPattern) grainPattern = ctx.createPattern(source, "repeat");
  if (!grainPattern) return;

  const step = Math.floor(time * 12);
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.globalCompositeOperation = "overlay";
  ctx.translate(hash(step) * 160 - 160, hash(step + 91) * 160 - 160);
  ctx.fillStyle = grainPattern;
  ctx.fillRect(0, 0, width + 320, height + 320);
  ctx.restore();
}

/** Lens falloff. Straight black at the corners, nothing in the centre. */
export function drawVignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength = 0.55,
) {
  const gradient = ctx.createRadialGradient(
    width / 2,
    height * 0.46,
    height * 0.28,
    width / 2,
    height / 2,
    width * 0.78,
  );
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.65, `rgba(0,0,0,${strength * 0.35})`);
  gradient.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * A soft coloured light drifting across the frame.
 *
 * One moving highlight does more for the sense of a lit space than any number
 * of static glows, because it means something in the scene is moving.
 */
export function drawLightDrift(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  colour: string,
  strength = 0.16,
) {
  const x = width * (0.5 + noise1(time * 0.09, 4) * 0.42);
  const y = height * (0.36 + noise1(time * 0.07, 19) * 0.3);
  const radius = width * (0.42 + noise1(time * 0.05, 7) * 0.08);

  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, withAlpha(colour, strength));
  gradient.addColorStop(0.5, withAlpha(colour, strength * 0.28));
  gradient.addColorStop(1, withAlpha(colour, 0));

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** Anamorphic-ish bloom streak, used only on a scene's opening accent. */
export function drawFlare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  colour: string,
  strength: number,
) {
  if (strength <= 0) return;
  const gradient = ctx.createLinearGradient(x - width / 2, y, x + width / 2, y);
  gradient.addColorStop(0, withAlpha(colour, 0));
  gradient.addColorStop(0.5, withAlpha(colour, strength));
  gradient.addColorStop(1, withAlpha(colour, 0));

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = gradient;
  ctx.fillRect(x - width / 2, y - 2.5, width, 5);
  ctx.restore();
}

/** Cinema bars. Held at full height, they frame the whole video as film. */
export function drawLetterbox(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bar: number,
) {
  if (bar <= 0) return;
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, bar);
  ctx.fillRect(0, height - bar, width, bar);
  ctx.restore();
}

/** Turns `#rrggbb` into an rgba() string. Anything else is passed through. */
export function withAlpha(colour: string, alpha: number): string {
  const value = clamp01(alpha);
  if (colour.startsWith("#") && (colour.length === 7 || colour.length === 4)) {
    const full =
      colour.length === 4
        ? `#${colour[1]}${colour[1]}${colour[2]}${colour[2]}${colour[3]}${colour[3]}`
        : colour;
    const r = parseInt(full.slice(1, 3), 16);
    const g = parseInt(full.slice(3, 5), 16);
    const b = parseInt(full.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${value})`;
  }
  if (colour.startsWith("rgba")) return colour;
  if (colour.startsWith("rgb(")) return colour.replace("rgb(", "rgba(").replace(")", `, ${value})`);
  return colour;
}

/** True when this browser will actually honour `ctx.filter`. */
export function supportsFilter(ctx: CanvasRenderingContext2D): boolean {
  return typeof ctx.filter === "string";
}

/**
 * A frosted panel: the frame behind it, blurred, clipped to a rounded rect.
 *
 * Where `ctx.filter` is unavailable the panel falls back to a flat tint, which
 * is duller but never wrong.
 */
export function drawGlassPanel(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  box: { x: number; y: number; width: number; height: number },
  options: { radius?: number; tint?: string; border?: string; blur?: number } = {},
) {
  const radius = options.radius ?? 22;
  const blur = options.blur ?? 26;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.width, box.height, radius);
  ctx.clip();

  if (supportsFilter(ctx)) {
    ctx.filter = `blur(${blur}px) saturate(1.25)`;
    // Drawn oversized so the blur has real pixels to pull in at the edges.
    ctx.drawImage(
      source,
      box.x - blur,
      box.y - blur,
      box.width + blur * 2,
      box.height + blur * 2,
      box.x - blur,
      box.y - blur,
      box.width + blur * 2,
      box.height + blur * 2,
    );
    ctx.filter = "none";
  }

  ctx.fillStyle = options.tint ?? "rgba(10, 14, 24, 0.52)";
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.restore();

  if (options.border) {
    ctx.save();
    ctx.strokeStyle = options.border;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.roundRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1, radius);
    ctx.stroke();
    ctx.restore();
  }
}

/** Fade to black at both ends of the whole video. */
export function openingFade(time: number, duration: number, span = 0.5): number {
  const up = smootherstep(range(time, 0, span));
  const down = 1 - smootherstep(range(time, duration - span, duration));
  return clamp01(Math.min(up, down));
}
