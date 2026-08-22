import { BOARD_HEIGHT, BOARD_WIDTH } from "@/lib/whiteboard/scene";
import { clamp01, easeOutBack, noise1, smootherstep, range } from "@/lib/video/easing";
import { EMOJI_FONT } from "./emoji";
import type { Theme } from "./theme";

/**
 * The printed vocabulary.
 *
 * Every mark in a Modern frame is made from these: paper with a ruled grid,
 * cards that sit on it with a hard offset shadow, a marker swipe behind the
 * words that matter, outlined numerals, and photographs mounted in a frame
 * rather than bled behind the type.
 *
 * The hard shadow is the whole trick. A blurred drop shadow reads as a
 * template; a solid offset one reads as something printed and stacked, and it
 * is what keeps these frames from looking like every other generated deck.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* ---------------------------------- paper --------------------------------- */

/**
 * The ground, with its ruled grid drifting.
 *
 * The drift is a few pixels over a whole scene -- far too slow to notice as
 * motion, but it stops the background reading as a still image behind moving
 * type, which is the thing that makes generated video look pasted together.
 */
export function drawGround(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  time: number,
  options: { cell?: number; dots?: boolean } = {},
) {
  const cell = options.cell ?? 46;

  ctx.save();
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  const drift = (time * 1.6) % cell;
  ctx.strokeStyle = theme.grid;
  ctx.fillStyle = theme.grid;
  ctx.lineWidth = 1;

  if (options.dots) {
    for (let y = -cell + drift; y < BOARD_HEIGHT + cell; y += cell) {
      for (let x = -cell + drift; x < BOARD_WIDTH + cell; x += cell) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    ctx.beginPath();
    for (let x = -cell + drift; x < BOARD_WIDTH + cell; x += cell) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, BOARD_HEIGHT);
    }
    for (let y = -cell + drift; y < BOARD_HEIGHT + cell; y += cell) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(BOARD_WIDTH, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------------------------------- cards --------------------------------- */

export function roundedPath(ctx: CanvasRenderingContext2D, box: Box, radius: number) {
  const r = Math.min(radius, box.width / 2, box.height / 2);
  ctx.beginPath();
  ctx.moveTo(box.x + r, box.y);
  ctx.lineTo(box.x + box.width - r, box.y);
  ctx.quadraticCurveTo(box.x + box.width, box.y, box.x + box.width, box.y + r);
  ctx.lineTo(box.x + box.width, box.y + box.height - r);
  ctx.quadraticCurveTo(
    box.x + box.width,
    box.y + box.height,
    box.x + box.width - r,
    box.y + box.height,
  );
  ctx.lineTo(box.x + r, box.y + box.height);
  ctx.quadraticCurveTo(box.x, box.y + box.height, box.x, box.y + box.height - r);
  ctx.lineTo(box.x, box.y + r);
  ctx.quadraticCurveTo(box.x, box.y, box.x + r, box.y);
  ctx.closePath();
}

export interface CardOptions {
  fill: string;
  radius?: number;
  /** Solid offset shadow, in pixels. 0 turns it off. */
  offset?: number;
  shadow?: string;
  stroke?: string;
  strokeWidth?: number;
  /** 0..1 build-on: the card rises the last few pixels into place. */
  enter?: number;
  alpha?: number;
}

/** A card on the paper: hard shadow first, then the fill on top of it. */
export function drawCard(ctx: CanvasRenderingContext2D, box: Box, options: CardOptions) {
  const enter = options.enter ?? 1;
  if (enter <= 0) return;

  const radius = options.radius ?? 28;
  // The card overshoots by a hair and settles. Flat easing into position is
  // what makes motion graphics feel like a slide transition.
  const settle = easeOutBack(clamp01(enter), 1.1);
  const offset = (options.offset ?? 10) * clamp01(settle);
  const lift = (1 - settle) * 30;
  const placed: Box = { ...box, y: box.y + lift };

  ctx.save();
  ctx.globalAlpha = (options.alpha ?? 1) * clamp01(enter * 1.6);

  if (offset > 0.4) {
    roundedPath(ctx, { ...placed, x: placed.x + offset, y: placed.y + offset }, radius);
    ctx.fillStyle = options.shadow ?? "#1D1D1B";
    ctx.fill();
  }

  roundedPath(ctx, placed, radius);
  ctx.fillStyle = options.fill;
  ctx.fill();

  if (options.stroke) {
    ctx.strokeStyle = options.stroke;
    ctx.lineWidth = options.strokeWidth ?? 3;
    ctx.stroke();
  }
  ctx.restore();
}

/* -------------------------------- highlight ------------------------------- */

/**
 * The marker swipe.
 *
 * Drawn behind the words, wiping left to right at the moment the narrator
 * reaches them. It is the one piece of motion that carries meaning rather than
 * decoration, so it is worth doing properly: slightly taller than the x-height,
 * a little skewed at the ends like a real marker, never a neat rectangle.
 */
export function drawMarker(
  ctx: CanvasRenderingContext2D,
  box: Box,
  colour: string,
  progress: number,
) {
  const wipe = clamp01(progress);
  if (wipe <= 0.001) return;

  const width = box.width * wipe;
  const slant = Math.min(10, box.height * 0.24);

  ctx.save();
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(box.x, box.y + slant * 0.5);
  ctx.lineTo(box.x + width, box.y);
  ctx.lineTo(box.x + width, box.y + box.height - slant * 0.3);
  ctx.lineTo(box.x, box.y + box.height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* -------------------------------- numerals -------------------------------- */

/**
 * A big outlined numeral with its own offset fill behind it.
 *
 * Used for chapter markers and agenda cards. The offset copy is what gives it
 * the letterpress feel the flat vocabulary otherwise lacks.
 */
export function drawOutlineNumeral(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  options: {
    family: string;
    stroke: string;
    shadow: string;
    offset?: number;
    align?: CanvasTextAlign;
    lineWidth?: number;
    fill?: string;
  },
) {
  const offset = options.offset ?? size * 0.055;

  ctx.save();
  ctx.font = `700 ${size}px ${options.family}`;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = options.shadow;
  ctx.fillText(text, x + offset, y + offset);

  if (options.fill) {
    ctx.fillStyle = options.fill;
    ctx.fillText(text, x, y);
  }

  ctx.strokeStyle = options.stroke;
  ctx.lineWidth = options.lineWidth ?? Math.max(3, size * 0.018);
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.restore();
}

/* -------------------------------- pictures -------------------------------- */

function contain(image: HTMLImageElement, box: Box): Box {
  const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/**
 * A photograph mounted in a frame, drifting inside it.
 *
 * The drift is the point. A still photograph behind moving type is the single
 * clearest tell of a generated video, so the picture always travels -- slowly,
 * in a direction set by the scene's index so no two consecutive shots move the
 * same way, and inside a clipped frame so the movement reads as a camera on
 * the subject rather than a sliding image.
 */
export function drawFramedPhoto(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  box: Box,
  options: {
    time: number;
    duration: number;
    index: number;
    theme: Theme;
    radius?: number;
    enter?: number;
    /** Solid offset shadow behind the frame. */
    offset?: number;
    /** Skip the card and shadow -- used for full-bleed grounds. */
    bare?: boolean;
  },
) {
  if (!image.complete || image.naturalWidth <= 0) return;

  const enter = options.enter ?? 1;
  if (enter <= 0.001) return;

  const radius = options.radius ?? 26;
  const lift = (1 - enter) * 22;
  const frame: Box = { ...box, y: box.y + lift };

  ctx.save();
  ctx.globalAlpha = clamp01(enter * 1.3);

  if (!options.bare) {
    const offset = (options.offset ?? 10) * enter;
    if (offset > 0.4) {
      roundedPath(ctx, { ...frame, x: frame.x + offset, y: frame.y + offset }, radius);
      ctx.fillStyle = options.theme.shadow;
      ctx.fill();
    }
  }

  roundedPath(ctx, frame, radius);
  ctx.save();
  ctx.clip();

  // Ken Burns: a slow push with a drift, alternating so a run of shots does
  // not all slide the same way.
  const progress = clamp01(options.time / Math.max(0.001, options.duration));
  const eased = smootherstep(progress);
  const direction = options.index % 4;
  const zoom = 1.07 + eased * 0.07;
  const travel = 26;
  const dx = (direction === 0 ? 1 : direction === 2 ? -1 : 0) * travel * (eased - 0.5) * 2;
  const dy = (direction === 1 ? 1 : direction === 3 ? -1 : 0.35) * travel * (eased - 0.5) * 2;

  const fitted = contain(image, frame);
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  ctx.translate(cx + dx, cy + dy);
  ctx.scale(zoom, zoom);
  ctx.translate(-cx, -cy);
  ctx.drawImage(image, fitted.x, fitted.y, fitted.width, fitted.height);
  ctx.restore();

  if (!options.bare) {
    roundedPath(ctx, frame, radius);
    ctx.strokeStyle = options.theme.shadow;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A photograph as the whole ground, washed back so type can live on it.
 *
 * Same drift, but the paper colour is laid over it heavily -- the picture is
 * atmosphere here, not subject.
 */
export function drawWashedPhoto(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  theme: Theme,
  options: { time: number; duration: number; index: number; wash?: number },
) {
  if (!image.complete || image.naturalWidth <= 0) return;

  const full: Box = { x: 0, y: 0, width: BOARD_WIDTH, height: BOARD_HEIGHT };
  ctx.save();
  const progress = clamp01(options.time / Math.max(0.001, options.duration));
  const eased = smootherstep(progress);
  const direction = options.index % 2 === 0 ? 1 : -1;
  const zoom = 1.1 + eased * 0.08;
  const fitted = contain(image, full);

  ctx.translate(BOARD_WIDTH / 2 + direction * 30 * (eased - 0.5) * 2, BOARD_HEIGHT / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-BOARD_WIDTH / 2, -BOARD_HEIGHT / 2);
  ctx.drawImage(image, fitted.x, fitted.y, fitted.width, fitted.height);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = theme.ground;
  ctx.globalAlpha = options.wash ?? 0.82;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.restore();
}

/* --------------------------------- accents -------------------------------- */

/** A shape that breaks the edge of the frame, the way a sticker would. */
export function drawEdgeShape(
  ctx: CanvasRenderingContext2D,
  kind: "circle" | "square" | "pill",
  box: Box,
  colour: string,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colour;
  if (kind === "circle") {
    ctx.beginPath();
    ctx.ellipse(
      box.x + box.width / 2,
      box.y + box.height / 2,
      box.width / 2,
      box.height / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  } else {
    roundedPath(ctx, box, kind === "pill" ? box.height / 2 : 34);
    ctx.fill();
  }
  ctx.restore();
}

/** An arrow between two cards in a process rail. */
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  colour: string,
  progress: number,
) {
  const grow = clamp01(progress);
  if (grow <= 0.01) return;

  const x = from.x + (to.x - from.x) * grow;
  const y = from.y + (to.y - from.y) * grow;

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(x, y);
  ctx.stroke();

  if (grow > 0.72) {
    const head = 11;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - head * Math.cos(angle - 0.42), y - head * Math.sin(angle - 0.42));
    ctx.lineTo(x - head * Math.cos(angle + 0.42), y - head * Math.sin(angle + 0.42));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Staggered entry for a row of things. */
export function stagger(progress: number, index: number, count: number, overlap = 0.55): number {
  const span = 1 / Math.max(1, count - (count - 1) * overlap);
  const start = index * span * (1 - overlap);
  return smootherstep(range(progress, start, start + span));
}


/* ---------------------------------- emoji --------------------------------- */

/**
 * The accent glyph, dropped onto the frame.
 *
 * It arrives with a small overshoot and a tilt, then breathes -- a couple of
 * pixels of float and a degree of rotation, on a slow noise so it never
 * repeats visibly. A static emoji pasted on a moving frame looks like a
 * sticker someone forgot to animate.
 */
export function drawEmoji(
  ctx: CanvasRenderingContext2D,
  glyph: string,
  x: number,
  y: number,
  size: number,
  options: { enter?: number; time?: number; tilt?: number; seed?: number; alpha?: number } = {},
) {
  const enter = clamp01(options.enter ?? 1);
  if (enter <= 0.001) return;

  const time = options.time ?? 0;
  const seed = options.seed ?? 0;
  const pop = easeOutBack(enter, 1.5);
  const float = noise1(time * 0.5 + seed, seed) * 5;
  const sway = noise1(time * 0.34 + seed * 2, seed + 7) * 0.035;

  ctx.save();
  ctx.globalAlpha = (options.alpha ?? 1) * clamp01(enter * 1.8);
  ctx.translate(x, y + float + (1 - pop) * 18);
  ctx.rotate(((options.tilt ?? 0) * Math.PI) / 180 + sway);
  ctx.scale(pop, pop);
  ctx.font = `${size}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, 0, 0);
  ctx.restore();
}
