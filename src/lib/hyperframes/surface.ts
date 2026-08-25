import { BOARD_HEIGHT, BOARD_WIDTH } from "@/lib/whiteboard/scene";
import {
  clamp,
  clamp01,
  easeOutBack,
  easeOutQuint,
  hash,
  lerp,
  noise1,
  range,
  smootherstep,
} from "@/lib/video/easing";
import { drawGrain, drawVignette, supportsFilter, withAlpha } from "@/lib/video/grade";
import { drawGround, type Box } from "./paper";
import type { Theme } from "./theme";
import type { Glyph } from "./glyphs";

/**
 * The editorial and glass vocabularies.
 *
 * `paper.ts` draws objects: cards with hard shadows, marker swipes, mounted
 * photographs. Everything here draws *light and framing* instead -- blooms
 * under frosted panels, crop marks around a subject, display type set so large
 * it becomes texture, brushed metal, dotted circuitry between nodes.
 *
 * The two are kept apart because they are genuinely different crafts and
 * mixing them is what makes a frame look uncertain. A hard offset shadow under
 * a frosted panel is not a hybrid, it is a mistake. Each shot asks the theme
 * for its finish and commits to one.
 */

/* ---------------------------------- ground --------------------------------- */

/**
 * Three light sources blooming under everything.
 *
 * Radial fields rather than a linear ramp, and each one drifts on its own slow
 * noise. A linear gradient is a slide background; overlapping blooms that move
 * independently read as a lit room, and the difference costs three draw calls.
 */
function drawMesh(ctx: CanvasRenderingContext2D, theme: Theme, time: number) {
  ctx.save();
  ctx.fillStyle = theme.mesh[2];
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  const fields: Array<{ colour: string; cx: number; cy: number; radius: number; seed: number }> = [
    { colour: theme.mesh[0], cx: 0.22, cy: 0.16, radius: 0.82, seed: 3 },
    { colour: theme.mesh[1], cx: 0.82, cy: 0.74, radius: 0.7, seed: 11 },
    { colour: theme.accent, cx: 0.62, cy: 0.2, radius: 0.36, seed: 23 },
  ];

  for (const [index, field] of fields.entries()) {
    // Slow enough that nobody sees it move, fast enough that no two frames of
    // the finished file are identical.
    const x = BOARD_WIDTH * (field.cx + noise1(time * 0.055, field.seed) * 0.06);
    const y = BOARD_HEIGHT * (field.cy + noise1(time * 0.047, field.seed + 5) * 0.07);
    const radius = BOARD_WIDTH * field.radius * (1 + noise1(time * 0.03, field.seed + 9) * 0.05);

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const strength = index === 2 ? 0.3 : 1;
    gradient.addColorStop(0, withAlpha(field.colour, 0.92 * strength));
    gradient.addColorStop(0.45, withAlpha(field.colour, 0.42 * strength));
    gradient.addColorStop(1, withAlpha(field.colour, 0));

    ctx.globalCompositeOperation = index === 2 ? "screen" : "source-over";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  }
  ctx.restore();
}

/**
 * The ground, in whichever vocabulary the palette is written in.
 *
 * Every shot calls this and nothing else, so a palette can change the entire
 * texture of a film without a single shot knowing which one it is.
 */
export function drawFinishGround(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  time: number,
  options: { cell?: number; dots?: boolean; grain?: number } = {},
) {
  if (theme.finish === "print") {
    drawGround(ctx, theme, time, options);
    return;
  }

  if (theme.finish === "glass") {
    drawMesh(ctx, theme, time);
    // Grain over a bloom is what stops the gradient banding on a dark screen,
    // which is the one artefact that makes a good palette look cheap.
    drawGrain(ctx, BOARD_WIDTH, BOARD_HEIGHT, time, options.grain ?? 0.035);
    return;
  }

  // Editorial: near-flat stock, one soft lift behind the subject, and enough
  // vignette that the corners fall away from the type.
  ctx.save();
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  const lift = ctx.createRadialGradient(
    BOARD_WIDTH * 0.5,
    BOARD_HEIGHT * 0.42,
    0,
    BOARD_WIDTH * 0.5,
    BOARD_HEIGHT * 0.42,
    BOARD_WIDTH * 0.72,
  );
  lift.addColorStop(0, withAlpha(theme.dark ? "#FFFFFF" : "#000000", theme.dark ? 0.045 : 0.03));
  lift.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = lift;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.restore();

  if (theme.dark) drawVignette(ctx, BOARD_WIDTH, BOARD_HEIGHT, 0.42);
  drawGrain(ctx, BOARD_WIDTH, BOARD_HEIGHT, time, options.grain ?? 0.045);
}

/* --------------------------------- framing --------------------------------- */

/**
 * The hairline frame a magazine cover puts around its own edge.
 *
 * Inset from the canvas by a full margin, so it reads as a deliberate border
 * rather than as a canvas that failed to fill its container.
 */
export function drawFrameRule(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  inset: number,
  progress = 1,
) {
  const t = easeOutQuint(clamp01(progress));
  if (t <= 0.001) return;
  ctx.save();
  ctx.strokeStyle = theme.hairline;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = t;
  ctx.strokeRect(inset, inset, BOARD_WIDTH - inset * 2, BOARD_HEIGHT - inset * 2);
  ctx.restore();
}

/**
 * Crop marks at the corners of a subject.
 *
 * Four short right angles, drawn from the corner outwards. They do one job:
 * tell the eye *this* is the thing being looked at, without putting a box
 * around it. A full box says "cell in a table"; four corners say "framed".
 */
export function drawBrackets(
  ctx: CanvasRenderingContext2D,
  box: Box,
  colour: string,
  options: { size?: number; width?: number; progress?: number; gap?: number } = {},
) {
  const t = easeOutQuint(clamp01(options.progress ?? 1));
  if (t <= 0.001) return;

  const gap = options.gap ?? 14;
  const size = (options.size ?? 34) * t;
  const outer: Box = {
    x: box.x - gap,
    y: box.y - gap,
    width: box.width + gap * 2,
    height: box.height + gap * 2,
  };

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = options.width ?? 2.5;
  ctx.lineCap = "square";
  ctx.globalAlpha = t;

  const corners: Array<[number, number, number, number]> = [
    [outer.x, outer.y, 1, 1],
    [outer.x + outer.width, outer.y, -1, 1],
    [outer.x, outer.y + outer.height, 1, -1],
    [outer.x + outer.width, outer.y + outer.height, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + dx * size, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * size);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The section marker: a filled dot, a word, and a rule running to the edge.
 *
 * Lifted straight from broadcast lower thirds because it is the most efficient
 * label in the language -- it says what this is and where it sits without
 * taking a line of the composition.
 */
export function drawSectionMark(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  x: number,
  y: number,
  label: string,
  options: { family: string; width?: number; progress?: number; size?: number },
) {
  const t = clamp01(options.progress ?? 1);
  if (t <= 0.001) return;
  const size = options.size ?? 22;

  ctx.save();
  ctx.globalAlpha = clamp01(t * 1.6);

  // The dot arrives first and overshoots -- the only bounce in the frame.
  const dot = easeOutBack(clamp01(t * 2.2), 2);
  ctx.fillStyle = theme.mark;
  ctx.beginPath();
  ctx.arc(x + size * 0.32, y, size * 0.3 * dot, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = `700 ${size}px ${options.family}`;
  ctx.letterSpacing = `${size * 0.14}px`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = theme.inkMuted;
  const text = label.toUpperCase();
  ctx.fillText(text, x + size * 0.95, y + 1);
  const textWidth = ctx.measureText(text).width;
  ctx.letterSpacing = "0px";

  const ruleFrom = x + size * 0.95 + textWidth + size * 0.9;
  const ruleTo = options.width ?? BOARD_WIDTH - 96;
  if (ruleTo > ruleFrom) {
    ctx.strokeStyle = theme.hairline;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ruleFrom, y);
    ctx.lineTo(lerp(ruleFrom, ruleTo, easeOutQuint(t)), y);
    ctx.stroke();
  }
  ctx.restore();
}

/* -------------------------------- ghost type ------------------------------- */

/**
 * The subject's own word, set enormous behind it.
 *
 * The trick every editorial cover uses and no template ever does: one word,
 * scaled until it bleeds off both edges, at a contrast just above the ground.
 * It gives a frame of flat colour a sense of depth and scale that no amount of
 * drop shadow will, and it costs one draw call.
 *
 * Deliberately allowed to crop. Fitting it inside the frame turns it back into
 * a heading, which is the opposite of what it is for.
 */
export function drawGhostType(
  ctx: CanvasRenderingContext2D,
  text: string,
  options: {
    family: string;
    colour: string;
    /** Vertical centre, as a fraction of the frame. */
    at?: number;
    /** Multiple of the frame width the glyphs should span. */
    span?: number;
    time?: number;
    /** Parallax: how far it drifts against the foreground. */
    drift?: number;
    outline?: boolean;
    weight?: number;
    lines?: string[];
    progress?: number;
  },
) {
  const words = options.lines ?? [text];
  if (!words.length || !words[0]) return;

  const t = clamp01(options.progress ?? 1);
  if (t <= 0.001) return;

  const span = (options.span ?? 1.06) * BOARD_WIDTH;
  const weight = options.weight ?? 900;
  const time = options.time ?? 0;
  const drift = (options.drift ?? 1) * (noise1(time * 0.08, 31) * 14 + time * 1.4);

  ctx.save();
  ctx.globalAlpha = t;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const centreY = BOARD_HEIGHT * (options.at ?? 0.5);
  const rows = words.length;

  words.forEach((word, index) => {
    const upper = word.toUpperCase();
    // Measured at a nominal size, then scaled -- one measurement instead of a
    // search loop, and exact.
    ctx.font = `${weight} 100px ${options.family}`;
    const width = Math.max(1, ctx.measureText(upper).width);
    const size = (span / width) * 100;
    ctx.font = `${weight} ${size}px ${options.family}`;

    const y = centreY + (index - (rows - 1) / 2) * size * 0.86;
    const x = BOARD_WIDTH / 2 + drift * (index % 2 === 0 ? 1 : -1);

    if (options.outline) {
      ctx.strokeStyle = options.colour;
      ctx.lineWidth = Math.max(1.5, size * 0.008);
      ctx.strokeText(upper, x, y);
    } else {
      ctx.fillStyle = options.colour;
      ctx.fillText(upper, x, y);
    }
  });
  ctx.restore();
}

/**
 * An outlined numeral at display scale, the way a chapter card uses one.
 *
 * Distinct from `drawOutlineNumeral` in the printed vocabulary: no offset
 * shadow, no fill, and sized to sit inside a card corner as a watermark rather
 * than to be read.
 */
export function drawGhostNumeral(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  options: { family: string; colour: string; align?: CanvasTextAlign; progress?: number },
) {
  const t = clamp01(options.progress ?? 1);
  if (t <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = t;
  ctx.font = `800 ${size}px ${options.family}`;
  ctx.textAlign = options.align ?? "right";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = options.colour;
  ctx.lineWidth = Math.max(1.5, size * 0.022);
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.restore();
}

/* ---------------------------------- glass ---------------------------------- */

/** A rounded rect with a radius per corner, clockwise from top-left. */
export function squirclePath(
  ctx: CanvasRenderingContext2D,
  box: Box,
  radii: [number, number, number, number],
) {
  const limit = Math.min(box.width, box.height) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, limit))) as [
    number,
    number,
    number,
    number,
  ];
  const { x, y, width: w, height: h } = box;

  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

export interface FrostOptions {
  radius?: number;
  /** Per-corner radii. One oversized corner is the house shape. */
  radii?: [number, number, number, number];
  /** 0..1 build-on. The panel rises and its bloom comes up with it. */
  enter?: number;
  /** Strength of the light pooled behind the panel. */
  glow?: number;
  blur?: number;
  /** Fill override; defaults to the theme's frost. */
  fill?: string;
  alpha?: number;
}

/**
 * A frosted panel: light pooled behind it, the frame blurred through it, and a
 * hairline catching the light along its top edge.
 *
 * The top-edge hairline is what sells it. A uniform 1px border reads as a
 * stroke; a border that is bright where the light is and gone where it is not
 * reads as a physical edge, and it is the single detail that separates this
 * from a rectangle with opacity on it.
 *
 * The blur samples the canvas the panel is being drawn onto, so whatever the
 * ground already painted is genuinely what shows through.
 */
export function drawFrostPanel(
  ctx: CanvasRenderingContext2D,
  box: Box,
  theme: Theme,
  options: FrostOptions = {},
) {
  const enter = clamp01(options.enter ?? 1);
  if (enter <= 0.001) return;

  const settle = easeOutBack(enter, 0.9);
  const placed: Box = { ...box, y: box.y + (1 - settle) * 26 };
  const radii: [number, number, number, number] = options.radii ?? [
    options.radius ?? 26,
    options.radius ?? 26,
    options.radius ?? 26,
    options.radius ?? 26,
  ];
  const alpha = (options.alpha ?? 1) * clamp01(enter * 1.5);

  /* the light behind it */
  const glow = options.glow ?? 1;
  if (glow > 0.01) {
    const cx = placed.x + placed.width / 2;
    const cy = placed.y + placed.height / 2;
    const radius = Math.max(placed.width, placed.height) * 0.85;
    const bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    bloom.addColorStop(0, withAlpha(theme.glassGlow, 0.9 * glow * alpha));
    bloom.addColorStop(0.6, withAlpha(theme.glassGlow, 0.28 * glow * alpha));
    bloom.addColorStop(1, withAlpha(theme.glassGlow, 0));
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = bloom;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
  }

  /* the frost itself */
  ctx.save();
  ctx.globalAlpha = alpha;
  squirclePath(ctx, placed, radii);
  ctx.clip();

  const blur = options.blur ?? 22;
  if (supportsFilter(ctx) && ctx.canvas.width > 0) {
    ctx.filter = `blur(${blur}px) saturate(1.3)`;
    // Sampling the canvas into itself: oversized so the blur has real pixels
    // to pull from at the edges rather than smearing transparency inwards.
    ctx.drawImage(
      ctx.canvas,
      Math.max(0, placed.x - blur),
      Math.max(0, placed.y - blur),
      Math.min(ctx.canvas.width, placed.width + blur * 2),
      Math.min(ctx.canvas.height, placed.height + blur * 2),
      placed.x - blur,
      placed.y - blur,
      placed.width + blur * 2,
      placed.height + blur * 2,
    );
    ctx.filter = "none";
  }

  ctx.fillStyle = options.fill ?? theme.glassFill;
  ctx.fillRect(placed.x, placed.y, placed.width, placed.height);

  // A vertical wash inside the panel: brighter at the top, where the light is.
  const wash = ctx.createLinearGradient(0, placed.y, 0, placed.y + placed.height);
  wash.addColorStop(0, withAlpha(theme.dark ? "#FFFFFF" : "#FFFFFF", theme.dark ? 0.07 : 0.3));
  wash.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = wash;
  ctx.fillRect(placed.x, placed.y, placed.width, placed.height);
  ctx.restore();

  /* the edge */
  ctx.save();
  ctx.globalAlpha = alpha;
  const edge = ctx.createLinearGradient(placed.x, placed.y, placed.x + placed.width, placed.y + placed.height);
  edge.addColorStop(0, theme.glassEdge);
  edge.addColorStop(0.35, withAlpha(theme.glassEdge, 0.35));
  edge.addColorStop(1, withAlpha(theme.glassEdge, 0.12));
  squirclePath(
    ctx,
    { x: placed.x + 0.75, y: placed.y + 0.75, width: placed.width - 1.5, height: placed.height - 1.5 },
    radii,
  );
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/**
 * Brushed metal for display type.
 *
 * Four stops, not two: a metal ramp needs a dark band across the middle of the
 * letterform or it is just a gradient. The band sits slightly above centre
 * because that is where the horizon lands on a real reflective surface.
 */
export function chromeFill(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  top: number,
  height: number,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, top, 0, top + height);
  gradient.addColorStop(0, theme.chrome[0]);
  gradient.addColorStop(0.42, theme.chrome[1]);
  gradient.addColorStop(0.58, theme.chrome[2]);
  gradient.addColorStop(1, theme.chrome[3]);
  return gradient;
}

/* -------------------------------- connectors ------------------------------- */

export interface Point {
  x: number;
  y: number;
}

/**
 * A dotted route between points, with a diamond at every bend.
 *
 * The visual language of a wiring diagram, and the reason it works on screen
 * is that the dashes give the line a direction to be drawn in. A solid line
 * either exists or does not; a dashed one arrives.
 */
export function drawConnector(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  colour: string,
  progress: number,
  options: { dash?: number; width?: number; joint?: string; jointSize?: number } = {},
) {
  const t = easeOutQuint(clamp01(progress));
  if (points.length < 2 || t <= 0.001) return;

  const segments: Array<{ from: Point; to: Point; length: number }> = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    segments.push({ from, to, length });
    total += length;
  }

  const reveal = total * t;
  let walked = 0;

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = options.width ?? 2;
  ctx.lineCap = "butt";
  const dash = options.dash ?? 7;
  ctx.setLineDash([dash, dash]);

  for (const segment of segments) {
    if (walked >= reveal) break;
    const portion = Math.min(1, (reveal - walked) / segment.length);
    ctx.beginPath();
    ctx.moveTo(segment.from.x, segment.from.y);
    ctx.lineTo(
      lerp(segment.from.x, segment.to.x, portion),
      lerp(segment.from.y, segment.to.y, portion),
    );
    ctx.stroke();
    walked += segment.length;
  }
  ctx.setLineDash([]);

  // A diamond wherever the route turns, once the line has reached it.
  const size = options.jointSize ?? 5;
  let reached = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    reached += segments[i - 1].length;
    if (reached > reveal) break;
    const point = points[i];
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = options.joint ?? colour;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * A numbered node: a filled disc with its own glow and a numeral inside.
 *
 * The glow is not decoration. On a dark ground a flat disc sits *in* the
 * background; a disc with light around it sits in front of it, and the diagram
 * gains a layer for free.
 */
export function drawNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  theme: Theme,
  options: { family: string; radius?: number; enter?: number; colour?: string },
) {
  const enter = clamp01(options.enter ?? 1);
  if (enter <= 0.001) return;
  const radius = (options.radius ?? 22) * easeOutBack(enter, 1.5);
  const colour = options.colour ?? theme.accentAlt;

  ctx.save();
  ctx.globalAlpha = clamp01(enter * 1.4);

  const bloom = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.6);
  bloom.addColorStop(0, withAlpha(colour, 0.5));
  bloom.addColorStop(1, withAlpha(colour, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(x - radius * 2.6, y - radius * 2.6, radius * 5.2, radius * 5.2);

  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = `700 ${radius * 0.95}px ${options.family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = theme.dark ? "#FFFFFF" : "#FFFFFF";
  ctx.fillText(label, x, y + radius * 0.04);
  ctx.restore();
}

/* --------------------------------- plates ---------------------------------- */

/**
 * A solid plate of colour, wiping in from one edge.
 *
 * The backing for a cut-out portrait, and the one place a saturated accent is
 * allowed to occupy real area rather than a rule or a dot.
 */
export function drawPlate(
  ctx: CanvasRenderingContext2D,
  box: Box,
  colour: string,
  progress: number,
  direction: "up" | "down" | "left" | "right" = "up",
) {
  const t = easeOutQuint(clamp01(progress));
  if (t <= 0.001) return;

  ctx.save();
  ctx.fillStyle = colour;
  const vertical = direction === "up" || direction === "down";
  const extent = (vertical ? box.height : box.width) * t;
  if (direction === "up") ctx.fillRect(box.x, box.y + box.height - extent, box.width, extent);
  else if (direction === "down") ctx.fillRect(box.x, box.y, box.width, extent);
  else if (direction === "left") ctx.fillRect(box.x + box.width - extent, box.y, extent, box.height);
  else ctx.fillRect(box.x, box.y, extent, box.height);
  ctx.restore();
}

/**
 * A stack of cards seen from the front, fanning open.
 *
 * Each card behind the first is offset and dimmed, so the group reads as a
 * quantity -- "seven of these" -- before a single word of it is read. Returns
 * the front card's box so the caller can compose inside it.
 */
export function drawCardStack(
  ctx: CanvasRenderingContext2D,
  box: Box,
  theme: Theme,
  count: number,
  progress: number,
  options: { radii?: [number, number, number, number]; spread?: number } = {},
): Box {
  const t = smootherstep(clamp01(progress));
  const spread = (options.spread ?? 58) * t;
  const radii = options.radii ?? [34, 34, 34, 34];
  const total = clamp(count, 1, 8);

  ctx.save();
  for (let index = total - 1; index >= 1; index -= 1) {
    const offset = spread * index;
    const card: Box = { ...box, x: box.x + offset };
    ctx.globalAlpha = clamp01(t * (1 - index * 0.07));
    squirclePath(ctx, card, radii);
    ctx.fillStyle = withAlpha(theme.card, theme.finish === "glass" ? 0.5 : 0.9);
    ctx.fill();
    ctx.strokeStyle = withAlpha(theme.glassEdge, 0.35);
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }
  ctx.restore();

  return box;
}

/* --------------------------------- texture --------------------------------- */

/**
 * Fine horizontal scanlines.
 *
 * Almost invisible, and that is the point: it gives a flat digital ground the
 * texture of something captured. Used on editorial frames only, where there is
 * no grain from a photograph to do the job.
 */
export function drawScanlines(
  ctx: CanvasRenderingContext2D,
  colour: string,
  strength = 0.05,
  spacing = 3,
) {
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.fillStyle = colour;
  for (let y = 0; y < BOARD_HEIGHT; y += spacing) ctx.fillRect(0, y, BOARD_WIDTH, 1);
  ctx.restore();
}

/**
 * A soft coloured bloom at a point. The cheapest way to imply a light source.
 */
export function drawBloom(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  colour: string,
  strength = 0.4,
) {
  if (strength <= 0.001 || radius <= 0) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, withAlpha(colour, strength));
  gradient.addColorStop(0.55, withAlpha(colour, strength * 0.3));
  gradient.addColorStop(1, withAlpha(colour, 0));
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

/**
 * A panel in whichever vocabulary the palette speaks.
 *
 * Shots call this rather than choosing between a printed card and a frosted
 * one, so one shot definition renders correctly in all three finishes instead
 * of needing three versions of itself.
 *
 * The `fill` argument carries the intent. Asking for the theme's own card or
 * surface colour means "a panel here", and glass answers that with frost.
 * Asking for any other colour -- the accent, most often -- means "a plate of
 * this colour", which every finish honours literally, because a deliberate
 * block of colour is a composition decision rather than a material one.
 */
export function drawSurface(
  ctx: CanvasRenderingContext2D,
  box: Box,
  theme: Theme,
  options: {
    enter?: number;
    radius?: number;
    radii?: [number, number, number, number];
    fill?: string;
    /** Printed finishes only: the hard offset shadow, in pixels. */
    offset?: number;
    shadow?: string;
    stroke?: string;
    strokeWidth?: number;
    glow?: number;
    alpha?: number;
  } = {},
) {
  const ownSurface = !options.fill || options.fill === theme.card || options.fill === theme.surface;

  if (theme.finish === "glass" && ownSurface) {
    drawFrostPanel(ctx, box, theme, {
      enter: options.enter,
      radius: options.radius,
      radii: options.radii,
      glow: options.glow,
      alpha: options.alpha,
    });
    return;
  }

  const enter = clamp01(options.enter ?? 1);
  if (enter <= 0.001) return;
  const settle = easeOutBack(enter, 1.05);
  const placed: Box = { ...box, y: box.y + (1 - settle) * 26 };
  const radii: [number, number, number, number] = options.radii ?? [
    options.radius ?? 26,
    options.radius ?? 26,
    options.radius ?? 26,
    options.radius ?? 26,
  ];
  const alpha = (options.alpha ?? 1) * clamp01(enter * 1.5);

  // A plate of colour on glass sits in light, so it gets a bloom rather than
  // a shadow -- the two are opposite ways of saying "this is in front".
  if (theme.finish === "glass") {
    const cx = placed.x + placed.width / 2;
    const cy = placed.y + placed.height / 2;
    const radius = Math.max(placed.width, placed.height) * 0.8;
    const bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    bloom.addColorStop(0, withAlpha(options.fill ?? theme.accent, 0.55 * alpha));
    bloom.addColorStop(1, withAlpha(options.fill ?? theme.accent, 0));
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = bloom;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = alpha;

  if (theme.finish === "print") {
    // The hard offset shadow, which is the whole of the printed look.
    const offset = (options.offset ?? 11) * clamp01(settle);
    if (offset > 0.4) {
      squirclePath(ctx, { ...placed, x: placed.x + offset, y: placed.y + offset }, radii);
      ctx.fillStyle = options.shadow ?? theme.shadow;
      ctx.fill();
    }
  }

  squirclePath(ctx, placed, radii);
  ctx.fillStyle = options.fill ?? theme.card;
  ctx.fill();

  if (options.stroke) {
    ctx.strokeStyle = options.stroke;
    ctx.lineWidth = options.strokeWidth ?? 2;
    ctx.stroke();
  } else if (theme.finish !== "print") {
    // No shadow at all: an editorial panel is an area of tone, held by a
    // hairline. A shadow would make it an object, and it is not one.
    ctx.strokeStyle = theme.finish === "glass" ? theme.glassEdge : theme.hairline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * How far into a build a given item is, given a stagger.
 *
 * Kept here rather than in each shot because the overlap is a house value: at
 * 0.55 the next item starts while the previous is still settling, which is
 * what makes a group arrive as one gesture instead of a queue.
 */
export function cascade(progress: number, index: number, count: number, overlap = 0.55): number {
  if (count <= 1) return clamp01(progress);
  const step = 1 / (count - (count - 1) * overlap);
  const start = index * step * (1 - overlap);
  return range(progress, start, start + step);
}

/** Deterministic per-item jitter, so a group is never mechanically even. */
export function sway(seed: number, time: number, amount = 3): number {
  return noise1(time * 0.35 + hash(seed) * 10, seed) * amount;
}

/* ---------------------------------- glyphs --------------------------------- */

export type { Glyph } from "./glyphs";

/** Lucide draws in a 24-unit box, so everything here scales from that. */
const GLYPH_VIEWBOX = 24;

/**
 * A monoline icon, drawn as line work rather than as a picture.
 *
 * Emoji are full colour and every platform has them, which makes them the
 * right answer when a frame needs one warm object in it. They are the wrong
 * answer when a frame needs six marks that belong to each other: six emoji are
 * six illustration styles at once. Line icons share a weight, a corner radius
 * and a colour, so a rail of them reads as one system -- and they can be given
 * the frame's own accent, which an emoji never can.
 *
 * The reveal is a diagonal wipe rather than a fade, because a line drawing
 * that arrives from a corner reads as being drawn and one that fades reads as
 * being pasted.
 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: Glyph,
  x: number,
  y: number,
  size: number,
  options: { colour: string; enter?: number; width?: number; wipe?: boolean } = { colour: "#000" },
) {
  const enter = clamp01(options.enter ?? 1);
  if (enter <= 0.001 || typeof Path2D === "undefined") return;

  const scale = size / GLYPH_VIEWBOX;
  const settle = easeOutBack(enter, 1.1);

  ctx.save();
  ctx.globalAlpha = clamp01(enter * 1.8);
  ctx.translate(x, y);
  ctx.scale(settle, settle);
  ctx.translate(-size / 2, -size / 2);

  if (options.wipe !== false && enter < 0.999) {
    // A band sweeping down-right across the icon's own box.
    const reveal = easeOutQuint(enter);
    ctx.beginPath();
    ctx.moveTo(-size, -size);
    ctx.lineTo(-size + size * 3 * reveal, -size);
    ctx.lineTo(-size, -size + size * 3 * reveal);
    ctx.closePath();
    ctx.clip();
  }

  ctx.scale(scale, scale);
  ctx.strokeStyle = options.colour;
  ctx.lineWidth = (options.width ?? 2) / scale / (size / 48);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = "transparent";

  for (const data of glyph.paths) {
    try {
      ctx.stroke(new Path2D(data));
    } catch {
      // A path the browser cannot parse costs one icon, never the frame.
    }
  }
  ctx.restore();
}

/**
 * The icon on its own tile: a rounded surface, the glyph inside it, a caption
 * under it.
 *
 * This is the single most recognisable object in modern product film -- the
 * app-icon-sized square with one line drawing in it -- and it works because
 * the tile gives the glyph a defined edge to be centred in. A bare icon on a
 * gradient floats; the same icon on a tile has been placed.
 */
export function drawGlyphTile(
  ctx: CanvasRenderingContext2D,
  box: Box,
  glyph: Glyph,
  theme: Theme,
  options: { enter?: number; colour?: string; label?: string; family?: string } = {},
) {
  const enter = clamp01(options.enter ?? 1);
  if (enter <= 0.001) return;

  drawSurface(ctx, box, theme, {
    enter,
    radius: box.width * 0.24,
    glow: 1,
  });

  drawGlyph(
    ctx,
    glyph,
    box.x + box.width / 2,
    box.y + box.height * (options.label ? 0.42 : 0.5),
    Math.min(box.width, box.height) * (options.label ? 0.4 : 0.46),
    {
      colour: options.colour ?? theme.accentAlt,
      enter: range(enter, 0.25, 1),
      width: 2.2,
    },
  );

  if (options.label && options.family) {
    ctx.save();
    ctx.globalAlpha = clamp01(range(enter, 0.5, 1));
    ctx.font = `700 ${Math.round(box.width * 0.11)}px ${options.family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = theme.ink;
    ctx.fillText(options.label, box.x + box.width / 2, box.y + box.height * 0.78);
    ctx.restore();
  }
}
