"use client";

import { BOARD_HEIGHT, BOARD_WIDTH } from "@/lib/whiteboard/scene";
import { boardStock, COLOURS, type BoardStock } from "@/lib/whiteboard/palette";
import { withAlpha } from "@/lib/video/grade";
import { clamp01, easeOutCubic, lerp, noise1, range, smootherstep } from "@/lib/video/easing";
import type { Cue } from "@/lib/video/timing";
import {
  drawMarkerPen,
  drawScene,
  drawTitleHighlight,
  sceneCamera,
  type PreparedScene,
} from "./scene-render";

/**
 * The board.
 *
 * Every frame is a pure function of time, so the same code paints the live
 * preview, a scrub and each frame the recorder captures.
 */

export { BOARD_WIDTH, BOARD_HEIGHT };
export { clamp01 };

/* --------------------------------- surface -------------------------------- */

/** One grain tile per stock: the strength differs, so the tile has to. */
const grainPatterns = new Map<string, CanvasPattern | null>();

/**
 * Paper grain, baked once per surface into a small tile.
 *
 * Flat fills are the giveaway that a "whiteboard" is a canvas element. A little
 * noise under everything is most of the difference, and one 128px tile costs
 * nothing to repeat sixty times a second. Kraft carries far more of it than a
 * whiteboard does, which is why the strength comes from the stock.
 */
function grain(ctx: CanvasRenderingContext2D, stock: BoardStock): CanvasPattern | null {
  const cached = grainPatterns.get(stock.name);
  if (cached !== undefined) return cached;

  const tile = document.createElement("canvas");
  tile.width = 128;
  tile.height = 128;
  const tileCtx = tile.getContext("2d");
  if (!tileCtx) return null;

  const image = tileCtx.createImageData(128, 128);
  for (let i = 0; i < image.data.length; i += 4) {
    // Deterministic so the grain never crawls between frames.
    const value = 128 + (Math.sin(i * 12.9898) * 43758.5453) % 12;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = stock.grain;
  }
  tileCtx.putImageData(image, 0, 0);

  const pattern = ctx.createPattern(tile, "repeat");
  grainPatterns.set(stock.name, pattern);
  return pattern;
}

export function drawBoard(ctx: CanvasRenderingContext2D) {
  const stock = boardStock();

  ctx.fillStyle = stock.colours.paper;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  ctx.save();
  // Light falling on a surface: brighter where the room light is, dirtier
  // toward the edges. On a dark stock the same three stops read as a lamp
  // above a board rather than as a wash over paper, which is why the values
  // belong to the stock instead of being written here.
  const wash = ctx.createRadialGradient(
    BOARD_WIDTH * 0.46,
    BOARD_HEIGHT * 0.38,
    BOARD_HEIGHT * 0.18,
    BOARD_WIDTH * 0.5,
    BOARD_HEIGHT * 0.5,
    BOARD_WIDTH * 0.82,
  );
  wash.addColorStop(0, stock.wash[0]);
  wash.addColorStop(0.55, stock.wash[1]);
  wash.addColorStop(1, stock.wash[2]);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  const texture = grain(ctx, stock);
  if (texture) {
    ctx.fillStyle = texture;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  }

  // Bezel: the shadow the frame casts onto the board, then a hairline.
  const bezel = ctx.createLinearGradient(0, 0, 0, 26);
  bezel.addColorStop(0, stock.bezel);
  bezel.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = bezel;
  ctx.fillRect(0, 0, BOARD_WIDTH, 26);

  ctx.strokeStyle = stock.edge;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, BOARD_WIDTH - 3, BOARD_HEIGHT - 3);
  ctx.restore();
}

/* ---------------------------------- types --------------------------------- */

export interface RenderScene {
  scene?: PreparedScene | null;
  /** Bitmap artwork, either alongside the drawing or instead of it. */
  image?: HTMLImageElement | null;
  /** A photograph is taped up; marker artwork sits on the board bare. */
  imageKind?: "photo" | "drawn";
  heading: string;
  index: number;
}

export interface RenderOptions {
  /** Seconds into this scene. */
  time: number;
  /** How long the scene runs in total. */
  duration: number;
  /** Beat schedule, already aligned to the narration. */
  cues: Cue[];
  fontHand: string;
  fontSans: string;
}

function contain(
  image: HTMLImageElement,
  box: { x: number; y: number; width: number; height: number },
) {
  const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/* ---------------------------------- frame --------------------------------- */

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  scene: RenderScene,
  options: RenderOptions,
) {
  drawBoard(ctx);

  const { time, duration, cues } = options;

  if (scene.scene && scene.scene.beats.length) {
    const camera = sceneCamera(scene.scene, cues, time, {
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
    }, duration);

    ctx.save();
    // Zoom about the centre of the board, then pan.
    ctx.translate(BOARD_WIDTH / 2, BOARD_HEIGHT / 2);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-BOARD_WIDTH / 2 + camera.x, -BOARD_HEIGHT / 2 + camera.y);

    drawTitleHighlight(ctx, scene.scene, cues, time, options.fontHand);
    drawScene(ctx, scene.scene, cues, time, options.fontHand);

    // Bitmap artwork rides along as a taped-up photo, in the column the
    // layout set aside for it.
    if (scene.image?.complete && scene.image.naturalWidth > 0 && scene.scene.photoBox) {
      if (scene.imageKind === "drawn") {
        drawBoardArt(ctx, scene.image, scene.scene.photoBox, time, duration);
      } else {
        drawPhotoCard(ctx, scene.image, scene.scene.photoBox, time, duration);
      }
    }
    ctx.restore();
    return;
  }

  // No vector board: the bitmap carries the scene, under a written heading.
  drawImageScene(ctx, scene, options);
}

/**
 * A print taped to the board, corner first.
 *
 * It lands slightly rotated with real tape over the top corners, because a
 * perfectly square inset reads as a UI panel and breaks the illusion the rest
 * of the frame is working to build.
 */
function drawPhotoCard(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  box: { x: number; y: number; width: number; height: number },
  time: number,
  duration: number,
) {
  const appear = smootherstep(range(time, duration * 0.22, duration * 0.22 + 0.7));
  if (appear <= 0) return;

  // The card takes the photo's own shape inside the reserved band, so a wide
  // frame does not sit in a tall box surrounded by white card.
  const inner = contain(image, { x: 0, y: 0, width: box.width, height: box.height });
  const cardW = inner.width + 18;
  const cardH = inner.height + 44;
  const cardX = box.x + (box.width - cardW) / 2;
  const cardY = box.y + (box.height - cardH) / 2;

  ctx.save();
  ctx.globalAlpha = appear;
  ctx.translate(cardX + cardW / 2, cardY + cardH / 2 + (1 - appear) * -18);
  ctx.rotate((-1.6 * Math.PI) / 180 + noise1(time * 0.16, 3) * 0.004);
  ctx.translate(-cardW / 2, -cardH / 2);

  ctx.shadowColor = "rgba(35, 30, 20, 0.22)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cardW, cardH);
  ctx.shadowColor = "transparent";

  const fitted = { x: 9, y: 9, width: inner.width, height: inner.height };
  // Pulled back from full saturation so a photograph sits on a line-art board
  // instead of shouting over it -- the same thing a printed photo does.
  if (typeof ctx.filter === "string") ctx.filter = "saturate(0.78) contrast(1.04)";
  ctx.drawImage(image, fitted.x, fitted.y, fitted.width, fitted.height);
  if (typeof ctx.filter === "string") ctx.filter = "none";

  ctx.strokeStyle = withAlpha(COLOURS.ink, 0.16);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0.75, 0.75, cardW - 1.5, cardH - 1.5);

  // Tape.
  ctx.fillStyle = "rgba(238, 226, 178, 0.72)";
  ctx.save();
  ctx.translate(-10, 10);
  ctx.rotate((-38 * Math.PI) / 180);
  ctx.fillRect(-34, -11, 68, 22);
  ctx.restore();
  ctx.save();
  ctx.translate(cardW + 10, 10);
  ctx.rotate((38 * Math.PI) / 180);
  ctx.fillRect(-34, -11, 68, 22);
  ctx.restore();

  ctx.restore();
}

/**
 * Marker artwork, placed on the board with no frame at all.
 *
 * A generated sketch is already ink on white: taping it up like a photograph
 * would put a paper border around something that is meant to be part of the
 * same drawing. It just appears, the way the rest of the board does.
 */
function drawBoardArt(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  box: { x: number; y: number; width: number; height: number },
  time: number,
  duration: number,
) {
  const appear = smootherstep(range(time, duration * 0.2, duration * 0.2 + 0.85));
  if (appear <= 0) return;

  const fitted = contain(image, box);

  ctx.save();
  ctx.globalAlpha = appear;
  // Wiped on left to right, like everything else the marker draws.
  ctx.beginPath();
  ctx.rect(fitted.x, fitted.y, fitted.width * appear, fitted.height);
  ctx.clip();

  // Diffusion rarely returns a truly white page -- it returns a light grey
  // one, which lands on the board as a visible rectangle. Pushing the levels
  // before multiplying drives that background to white so only the strokes
  // survive, and the paper shows through around them.
  if (typeof ctx.filter === "string") {
    ctx.filter = "grayscale(1) brightness(1.18) contrast(1.7)";
  }
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(image, fitted.x, fitted.y, fitted.width, fitted.height);
  if (typeof ctx.filter === "string") ctx.filter = "none";
  ctx.restore();
}

/** Bitmap-only scene: the heading is written on, then the picture develops. */
function drawImageScene(
  ctx: CanvasRenderingContext2D,
  scene: RenderScene,
  options: RenderOptions,
) {
  const { time, duration } = options;
  const cue = options.cues[0];
  const headingFrom = cue?.at ?? 0;
  const headingSpan = cue?.span ?? Math.min(1.4, duration * 0.2);

  ctx.fillStyle = COLOURS.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `400 56px ${options.fontHand}`;

  const heading = scene.heading.toUpperCase();
  const reveal = easeOutCubic(range(time, headingFrom, headingFrom + headingSpan));
  const width = ctx.measureText(heading).width;

  ctx.save();
  ctx.beginPath();
  ctx.rect(BOARD_WIDTH / 2 - width / 2 - 4, 38, width * reveal + 8, 90);
  ctx.clip();
  ctx.fillText(heading, BOARD_WIDTH / 2, 104);
  ctx.restore();
  ctx.textAlign = "left";

  if (reveal > 0.02 && reveal < 0.99) {
    drawMarkerPen(ctx, BOARD_WIDTH / 2 - width / 2 + width * reveal, 104, COLOURS.ink);
  }

  if (!(scene.image?.complete && scene.image.naturalWidth > 0)) return;

  const box = { x: 130, y: 150, width: BOARD_WIDTH - 260, height: BOARD_HEIGHT - 210 };
  const fitted = contain(scene.image, box);
  const develop = smootherstep(range(time, headingFrom + headingSpan * 0.6, duration * 0.62));
  if (develop <= 0) return;

  // A slow push on the picture keeps the second half of the scene alive.
  const push = 1 + smootherstep(range(time, 0, duration)) * 0.045;

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = withAlpha(COLOURS.ink, 0.34);
  ctx.lineWidth = 3;
  ctx.shadowColor = "rgba(35, 30, 20, 0.18)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  ctx.fillRect(fitted.x - 7, fitted.y - 7, fitted.width + 14, fitted.height + 14);
  ctx.shadowColor = "transparent";
  ctx.strokeRect(fitted.x - 7, fitted.y - 7, fitted.width + 14, fitted.height + 14);

  ctx.beginPath();
  ctx.rect(fitted.x, fitted.y, fitted.width * develop, fitted.height);
  ctx.clip();
  ctx.globalAlpha = develop;
  const cx = fitted.x + fitted.width / 2;
  const cy = fitted.y + fitted.height / 2;
  ctx.translate(cx, cy);
  ctx.scale(push, push);
  ctx.translate(-cx, -cy);
  ctx.drawImage(scene.image, fitted.x, fitted.y, fitted.width, fitted.height);
  ctx.restore();
}

/* ---------------------------------- cover --------------------------------- */

/** Title card shown before the first scene. */
export function renderCover(
  ctx: CanvasRenderingContext2D,
  options: {
    title: string;
    description: string;
    fontHand: string;
    fontSans: string;
    progress?: number;
  },
) {
  drawBoard(ctx);

  const progress = clamp01(options.progress ?? 1);
  const centreX = BOARD_WIDTH / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLOURS.ink;
  ctx.font = `400 78px ${options.fontHand}`;

  const title = options.title.toUpperCase();
  const lines = wrapText(ctx, title, BOARD_WIDTH - 220, 3);
  const lineHeight = 96;
  const startY = BOARD_HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2 - 30;

  const widths = lines.map((line) => ctx.measureText(line).width);
  const total = widths.reduce((sum, value) => sum + value, 0) || 1;
  let budget = total * easeOutCubic(range(progress, 0.02, 0.56));

  const nib: { x: number; y: number; active: boolean; colour: string } = {
    x: 0,
    y: 0,
    active: false,
    colour: COLOURS.ink,
  };

  lines.forEach((line, index) => {
    if (budget <= 0) return;
    const shown = Math.min(widths[index], budget);
    budget -= shown;
    const y = startY + index * lineHeight;

    ctx.save();
    ctx.beginPath();
    ctx.rect(centreX - widths[index] / 2 - 6, y - 78, shown + 12, 110);
    ctx.clip();
    ctx.fillText(line, centreX, y);
    ctx.restore();

    if (shown > 0 && shown < widths[index]) {
      nib.x = centreX - widths[index] / 2 + shown;
      nib.y = y - 14;
      nib.active = true;
    }
  });

  // Marker underline, drawn after the words land.
  const underline = easeOutCubic(range(progress, 0.5, 0.76));
  if (underline > 0) {
    const width = Math.min(420, Math.max(...widths, 240)) * 0.66;
    const y = startY + (lines.length - 1) * lineHeight + 38;
    ctx.strokeStyle = COLOURS.blue;
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(centreX - width / 2, y);
    // A hand does not draw a rule dead straight.
    ctx.quadraticCurveTo(
      centreX - width / 2 + (width * underline) / 2,
      y + 5,
      centreX - width / 2 + width * underline,
      y + 2,
    );
    ctx.stroke();

    if (underline < 0.99) {
      nib.x = centreX - width / 2 + width * underline;
      nib.y = y + 2;
      nib.active = true;
      nib.colour = COLOURS.blue;
    }
  }

  if (nib.active) drawMarkerPen(ctx, nib.x, nib.y, nib.colour);

  const caption = smootherstep(range(progress, 0.62, 0.92));
  if (caption > 0 && options.description) {
    ctx.globalAlpha = caption;
    ctx.font = `400 28px ${options.fontSans}`;
    ctx.fillStyle = withAlpha(COLOURS.ink, 0.72);
    const captionLines = wrapText(ctx, options.description, 780, 2);
    const captionY = startY + (lines.length - 1) * lineHeight + 108 + (1 - caption) * 12;
    captionLines.forEach((line, index) => ctx.fillText(line, centreX, captionY + index * 38));
    ctx.globalAlpha = 1;
  }

  ctx.textAlign = "left";
}

/**
 * The closing card.
 *
 * The one sentence the viewer should leave with, written out. A video that
 * ends on its last diagram asks the audience to work out what it all meant;
 * this says it. Cheap to render, and the single most reliable way to make an
 * explainer actually land.
 */
export function renderOutro(
  ctx: CanvasRenderingContext2D,
  options: {
    title: string;
    description: string;
    fontHand: string;
    fontSans: string;
    progress: number;
  },
) {
  drawBoard(ctx);

  const progress = clamp01(options.progress);
  const centreX = BOARD_WIDTH / 2;

  // A rule above the line, drawn first, to frame it.
  const rule = easeOutCubic(range(progress, 0.04, 0.3));
  if (rule > 0) {
    ctx.save();
    ctx.strokeStyle = COLOURS.blue;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(centreX - 150, 196);
    ctx.lineTo(centreX - 150 + 300 * rule, 199);
    ctx.stroke();
    ctx.restore();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLOURS.ink;
  ctx.font = `400 56px ${options.fontHand}`;

  const lines = wrapText(ctx, options.description, BOARD_WIDTH - 260, 4);
  const lineHeight = 74;
  const startY = BOARD_HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2 + 8;

  const widths = lines.map((line) => ctx.measureText(line).width);
  const total = widths.reduce((sum, value) => sum + value, 0) || 1;
  let budget = total * easeOutCubic(range(progress, 0.12, 0.72));
  // Assignments happen inside the callback below, so the pen lives on an
  // object; a plain `let` would be narrowed to its initial null afterwards.
  const pen: { nib: { x: number; y: number } | null } = { nib: null };

  lines.forEach((line, index) => {
    if (budget <= 0) return;
    const shown = Math.min(widths[index], budget);
    budget -= shown;
    const y = startY + index * lineHeight;

    ctx.save();
    ctx.beginPath();
    ctx.rect(centreX - widths[index] / 2 - 6, y - 60, shown + 12, 88);
    ctx.clip();
    ctx.fillText(line, centreX, y);
    ctx.restore();

    if (shown > 0 && shown < widths[index]) {
      pen.nib = { x: centreX - widths[index] / 2 + shown, y: y - 12 };
    }
  });

  if (pen.nib && progress < 0.8) drawMarkerPen(ctx, pen.nib.x, pen.nib.y, COLOURS.ink);

  const tag = smootherstep(range(progress, 0.72, 0.95));
  if (tag > 0) {
    ctx.globalAlpha = tag;
    ctx.font = `400 26px ${options.fontSans}`;
    ctx.fillStyle = withAlpha(COLOURS.ink, 0.6);
    ctx.fillText(options.title, centreX, startY + (lines.length - 1) * lineHeight + 92);
    ctx.globalAlpha = 1;
  }

  ctx.textAlign = "left";
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  if (ctx.measureText(value).width <= maxWidth) return [value];

  const words = value.split(/\s+/).filter(Boolean);
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
  return lines;
}

/** Kept for callers that still interpolate by hand. */
export { lerp };
