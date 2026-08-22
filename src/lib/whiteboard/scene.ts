import { z } from "zod";
import { arrow, circle, line, poly, rr, slice } from "./geometry";
import { BADGES, DEFAULT_ICON_WIDTH, ICON_NAMES, resolveIcon, type IconShape } from "./icons";
import { COLOURS, colourOf, SERIES, type ColourKey } from "./palette";

/**
 * Scene composition.
 *
 * The model does not draw. It fills in a structured spec -- a layout plus a few
 * labelled slots -- and this module turns that into board geometry. That split
 * is what makes every scene of a video look like it came from the same hand:
 * the typography, spacing and icon set are ours, and only the content varies.
 */

export const BOARD_WIDTH = 1280;
export const BOARD_HEIGHT = 720;

/* ---------------------------------- spec ---------------------------------- */

const badge = z.enum(["check", "cross", "alert"]);
const colour = z.enum(["blue", "yellow", "orange", "green", "red", "violet", "teal", "pink"]);

/**
 * `glyph` is not something the model writes -- it is the resolved icon
 * geometry, attached on the server so the browser draws exactly the icon that
 * was chosen rather than guessing from the name again.
 */
const glyph = z.array(z.string().trim().min(2).max(4_000)).max(24).optional();

const item = z.object({
  icon: z.string().trim().min(1).max(40),
  label: z.string().trim().max(20).optional(),
  badge: badge.optional(),
  colour: colour.optional(),
  glyph,
});

const datum = z.object({
  label: z.string().trim().min(1).max(24),
  // Real quantities turn up here -- transaction counts, revenue, populations --
  // and a cap that rejects them turns a legitimate chart into a hard failure.
  // Bars are drawn relative to the largest value, so the magnitude is free.
  value: z.number().min(0).max(1e12),
  colour: colour.optional(),
});

const side = z.object({
  title: z.string().trim().min(1).max(24),
  items: z.array(item).min(1).max(3),
  stat: z.string().trim().max(10).optional(),
  statCaption: z.string().trim().max(20).optional(),
});

export const sceneSpecSchema = z.discriminatedUnion("layout", [
  z.object({
    layout: z.literal("icons"),
    title: z.string().trim().min(1).max(42),
    items: z.array(item).min(1).max(4),
  }),
  z.object({
    layout: z.literal("steps"),
    title: z.string().trim().min(1).max(42),
    items: z.array(item).min(2).max(4),
  }),
  z.object({
    layout: z.literal("compare"),
    title: z.string().trim().min(1).max(42),
    left: side,
    right: side,
  }),
  z.object({
    layout: z.literal("pie"),
    title: z.string().trim().min(1).max(42),
    data: z.array(datum).min(2).max(4),
    items: z.array(item).max(3).optional(),
  }),
  z.object({
    layout: z.literal("bars"),
    title: z.string().trim().min(1).max(42),
    data: z.array(datum).min(2).max(5),
    items: z.array(item).max(3).optional(),
  }),
  z.object({
    layout: z.literal("timeline"),
    title: z.string().trim().min(1).max(42),
    items: z.array(item).min(2).max(4),
  }),
  z.object({
    layout: z.literal("stat"),
    title: z.string().trim().min(1).max(42),
    stat: z.string().trim().min(1).max(10),
    caption: z.string().trim().max(30).optional(),
    icon: z.string().trim().max(40).optional(),
    glyph,
  }),
]);

export type SceneSpec = z.infer<typeof sceneSpecSchema>;
export type SceneItem = z.infer<typeof item>;

export const SCENE_LAYOUTS = ["icons", "steps", "compare", "pie", "bars", "timeline", "stat"] as const;

/* ------------------------------- primitives ------------------------------- */

export interface ShapePrim {
  kind: "shape";
  d: string;
  fill?: string;
  stroke: boolean;
  width: number;
  /** Stroke colour. Defaults to marker black. */
  colour?: string;
  /** Skip the hand-drawn wobble -- used for long straight rules. */
  crisp?: boolean;
}

export interface TextPrim {
  kind: "text";
  x: number;
  y: number;
  text: string;
  size: number;
  align: "left" | "center" | "right";
  colour: string;
  maxWidth: number;
  /** Extra tracking, used for the all-caps marker headings. */
  tracking?: number;
}

export type Prim = ShapePrim | TextPrim;

/** A group of primitives that appear together, like one icon and its caption. */
export interface Beat {
  prims: Prim[];
  /** Anchor for the pop-in transform. */
  origin: { x: number; y: number };
}

export interface ComposedScene {
  beats: Beat[];
  /** Where a taped photograph goes, when the scene reserved room for one. */
  photoBox: { x: number; y: number; width: number; height: number } | null;
}

/* -------------------------------- helpers --------------------------------- */

function shape(d: string, options: Partial<ShapePrim> = {}): ShapePrim {
  return {
    kind: "shape",
    d,
    fill: options.fill,
    stroke: options.stroke ?? true,
    width: options.width ?? 6,
    colour: options.colour,
    crisp: options.crisp,
  };
}

function text(
  value: string,
  x: number,
  y: number,
  size: number,
  options: Partial<TextPrim> = {},
): TextPrim {
  return {
    kind: "text",
    x,
    y,
    text: value,
    size,
    align: options.align ?? "center",
    colour: options.colour ?? COLOURS.ink,
    maxWidth: options.maxWidth ?? 320,
    tracking: options.tracking,
  };
}

/** Lucide is drawn on a 24 grid at stroke width 2. */
const GLYPH_VIEWBOX = 24;
const GLYPH_STROKE = 2.05;

/**
 * Places one icon into the board at `size` pixels square.
 *
 * Resolved geometry is preferred: it was chosen on the server from a real icon
 * set, and drawing it here means the board shows the icon that was picked
 * rather than whatever this name happens to match locally.
 */
function iconPrims(
  entry: { icon: string; glyph?: string[]; colour?: string },
  cx: number,
  cy: number,
  size: number,
  override?: ColourKey,
): Prim[] {
  const ink = override ?? (entry.colour as ColourKey | undefined);

  if (entry.glyph?.length) {
    // Legacy projects embedded 100x100 geometry directly into the spec.
    // Lucide paths use a 24x24 grid. If we see a non-arc coordinate > 30, it's legacy.
    const isLegacy = entry.glyph.some((d) => {
      const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
      let command = "";
      for (const t of tokens) {
        if (/[A-Za-z]/.test(t)) {
          command = t.toUpperCase();
          continue;
        }
        if (command !== "A" && Math.abs(parseFloat(t)) > 30) return true;
      }
      return false;
    });

    const viewBox = isLegacy ? 100 : GLYPH_VIEWBOX;
    const strokeWidthScale = isLegacy ? 1 : GLYPH_STROKE;
    const strokeWidthMin = isLegacy ? 2.5 : 3;
    
    const scale = size / viewBox;
    const originX = cx - size / 2;
    const originY = cy - size / 2;

    return entry.glyph.map((d) =>
      shape(transform(d, scale, originX, originY), {
        stroke: true,
        // Open outline paths only -- a marker draws a line, it does not flood.
        width: Math.max(strokeWidthMin, strokeWidthScale * scale),
        colour: ink ? colourOf(ink) : undefined,
      }),
    );
  }

  const { icon } = resolveIcon(entry.icon);
  const scale = size / 100;
  const originX = cx - size / 2;
  const originY = cy - size / 2;

  return icon.shapes.map((piece: IconShape) =>
    shape(transform(piece.d, scale, originX, originY), {
      fill: piece.fill ? (piece.fill === "white" ? COLOURS.white : colourOf(ink ?? piece.fill)) : undefined,
      stroke: piece.stroke ?? true,
      width: Math.max(2.5, (piece.width ?? DEFAULT_ICON_WIDTH) * scale),
    }),
  );
}

function badgePrims(kind: "check" | "cross" | "alert", cx: number, cy: number, size: number): Prim[] {
  const scale = size / 100;
  return BADGES[kind].map((piece) =>
    shape(transform(piece.d, scale, cx - size / 2, cy - size / 2), {
      fill: piece.fill ? colourOf(piece.fill) : undefined,
      stroke: piece.stroke ?? true,
      width: Math.max(2, (piece.width ?? DEFAULT_ICON_WIDTH) * scale),
    }),
  );
}

/**
 * Scales and translates path data.
 *
 * Three things make this fiddlier than a regex over the numbers:
 *
 *  - Case decides meaning. Uppercase operands are absolute and must be scaled
 *    *and* moved; lowercase ones are deltas and must only be scaled. Moving a
 *    delta turns a three-unit step into a five-hundred-unit leap.
 *  - A leading `m` is absolute however it is spelled, because there is no
 *    current point for it to be relative to yet.
 *  - Arc flags may be written with no separator at all. `a41 41 0 000 18` is
 *    seven operands, not five: the `000` is large-arc, sweep, and an x of
 *    zero. Reading it as the number zero silently shifts every operand after
 *    it by two places, which is why a handful of icons drew as nonsense.
 */
function transform(d: string, scale: number, dx: number, dy: number): string {
  const out: string[] = [];
  const NUMBER = /^[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/;

  let cursor = 0;
  let command = "";
  let operandIndex = 0;
  let seenCommand = false;
  let leadingMove = false;

  while (cursor < d.length) {
    const char = d[cursor];

    if (char === " " || char === "," || char === "\t" || char === "\n" || char === "\r") {
      cursor += 1;
      continue;
    }

    if (/[A-Za-z]/.test(char)) {
      leadingMove = !seenCommand && (char === "m" || char === "M");
      command = char;
      operandIndex = 0;
      seenCommand = true;
      out.push(char);
      cursor += 1;
      continue;
    }

    const upper = command.toUpperCase();
    const position = operandIndex % 7;

    // Arc flags are single characters, and are never scaled.
    if (upper === "A" && (position === 3 || position === 4)) {
      out.push(char);
      cursor += 1;
      operandIndex += 1;
      continue;
    }

    const match = NUMBER.exec(d.slice(cursor));
    if (!match) {
      cursor += 1;
      continue;
    }

    const value = Number.parseFloat(match[0]);
    cursor += match[0].length;

    const relative = command === command.toLowerCase() && !(leadingMove && operandIndex < 2);
    const shiftX = relative ? 0 : dx;
    const shiftY = relative ? 0 : dy;
    let mapped: number;

    if (upper === "A") {
      if (position === 0 || position === 1) mapped = value * scale;
      else if (position === 2) mapped = value; // x-axis rotation
      else if (position === 5) mapped = value * scale + shiftX;
      else mapped = value * scale + shiftY;
    } else if (upper === "H") {
      mapped = value * scale + shiftX;
    } else if (upper === "V") {
      mapped = value * scale + shiftY;
    } else {
      mapped = operandIndex % 2 === 0 ? value * scale + shiftX : value * scale + shiftY;
    }

    out.push(String(Math.round(mapped * 100) / 100));
    operandIndex += 1;
  }

  return out.join(" ");
}

function uppercase(value: string): string {
  return value.toUpperCase();
}

/* --------------------------------- layout --------------------------------- */

const TITLE_Y = 100;
const CONTENT_TOP = 162;
const CONTENT_BOTTOM = 672;

function titleBeat(title: string): Beat {
  return {
    origin: { x: BOARD_WIDTH / 2, y: TITLE_Y },
    prims: [
      text(uppercase(title), BOARD_WIDTH / 2, TITLE_Y, 62, {
        maxWidth: BOARD_WIDTH - 160,
        tracking: 1.5,
      }),
    ],
  };
}

/** One icon with an optional badge and caption, as a single beat. */
function iconBeat(
  entry: SceneItem,
  cx: number,
  cy: number,
  size: number,
  labelSize = 26,
  labelWidth = 240,
): Beat {
  const prims: Prim[] = iconPrims(entry, cx, cy, size, entry.colour as ColourKey | undefined);

  if (entry.badge) {
    const badgeSize = size * 0.4;
    prims.push(
      ...badgePrims(entry.badge, cx + size * 0.36, cy - size * 0.36, badgeSize),
    );
  }
  if (entry.label) {
    prims.push(
      text(uppercase(entry.label), cx, cy + size / 2 + labelSize + 8, labelSize, {
        maxWidth: labelWidth,
      }),
    );
  }

  return { prims, origin: { x: cx, y: cy } };
}

function layoutIcons(spec: Extract<SceneSpec, { layout: "icons" | "steps" }>): Beat[] {
  const beats: Beat[] = [titleBeat(spec.title)];
  const count = spec.items.length;
  // Sized to fill the board. The row sat in the middle of a lot of empty
  // paper before, which reads as an unfinished slide rather than a drawing.
  const size = count === 1 ? 330 : count === 2 ? 290 : count === 3 ? 248 : 206;
  const gap = count === 2 ? 190 : count === 3 ? 118 : 76;
  const span = count * size + (count - 1) * gap;
  const startX = BOARD_WIDTH / 2 - span / 2 + size / 2;
  // Centre the icon row and its captions in the content area.
  const captionAllowance = 44;
  const cy = (CONTENT_TOP + CONTENT_BOTTOM) / 2 - captionAllowance / 2;

  spec.items.forEach((entry, index) => {
    const cx = startX + index * (size + gap);
    beats.push(iconBeat(entry, cx, cy, size, 30, size + gap * 0.82));

    if (spec.layout === "steps" && index < count - 1) {
      const from = cx + size / 2 + 24;
      const to = cx + size + gap - size / 2 - 24;
      const { shaft, head } = arrow(from, cy, to, cy, 26);
      beats.push({
        origin: { x: (from + to) / 2, y: cy },
        prims: [shape(shaft, { width: 8 }), shape(head, { fill: COLOURS.ink, width: 4 })],
      });
    }
  });

  return beats;
}

function layoutCompare(spec: Extract<SceneSpec, { layout: "compare" }>): Beat[] {
  const beats: Beat[] = [titleBeat(spec.title)];
  const midX = BOARD_WIDTH / 2;

  beats.push({
    origin: { x: midX, y: (CONTENT_TOP + CONTENT_BOTTOM) / 2 },
    prims: [shape(line(midX, CONTENT_TOP, midX, CONTENT_BOTTOM), { width: 9, crisp: true })],
  });

  const sides = [
    { data: spec.left, centre: midX / 2 + 60, labelSide: -1 },
    { data: spec.right, centre: midX + midX / 2 - 60, labelSide: 1 },
  ] as const;

  for (const { data, centre, labelSide } of sides) {
    const rows = data.items.length;
    const iconSize = rows >= 3 ? 104 : 132;
    const rowGap = rows >= 3 ? 126 : 164;
    const hasStat = Boolean(data.stat);

    // Centre the item stack in whatever space the stat leaves behind.
    const areaTop = CONTENT_TOP + 24;
    const areaBottom = hasStat ? CONTENT_BOTTOM - 150 : CONTENT_BOTTOM - 20;
    const blockHeight = (rows - 1) * rowGap + iconSize;
    const blockTop = Math.max(areaTop, areaTop + (areaBottom - areaTop - blockHeight) / 2);

    data.items.forEach((entry, index) => {
      const cy = blockTop + index * rowGap + iconSize / 2;
      // Caption sits on the outer side of the icon, as on a comparison board.
      const labelX = centre + labelSide * (iconSize / 2 + 28);
      const prims: Prim[] = iconPrims(entry, centre, cy, iconSize, entry.colour as ColourKey | undefined);

      if (entry.badge) {
        prims.push(...badgePrims(entry.badge, centre + iconSize * 0.36, cy - iconSize * 0.36, iconSize * 0.42));
      }
      prims.push(
        text(uppercase(entry.label ?? data.title), labelX, cy + 8, 26, {
          align: labelSide < 0 ? "right" : "left",
          maxWidth: 200,
        }),
      );
      beats.push({ prims, origin: { x: centre, y: cy } });
    });

    if (data.stat) {
      const statY = CONTENT_BOTTOM - 70;
      const prims: Prim[] = [text(data.stat, centre, statY, 78, { maxWidth: 320 })];
      if (data.statCaption) {
        prims.push(text(uppercase(data.statCaption), centre, statY + 46, 26, { maxWidth: 320 }));
      }
      beats.push({ prims, origin: { x: centre, y: statY } });
    }
  }

  return beats;
}

function layoutPie(spec: Extract<SceneSpec, { layout: "pie" }>): Beat[] {
  const beats: Beat[] = [titleBeat(spec.title)];
  const hasIcons = Boolean(spec.items?.length);
  const radius = hasIcons ? 148 : 186;
  const cx = BOARD_WIDTH / 2;
  const cy = hasIcons ? CONTENT_TOP + radius + 14 : (CONTENT_TOP + CONTENT_BOTTOM) / 2;

  const total = spec.data.reduce((sum, entry) => sum + entry.value, 0) || 1;
  let turn = 0;

  spec.data.forEach((entry, index) => {
    const share = entry.value / total;
    const end = turn + share;
    const midTurn = turn + share / 2;
    const angle = (midTurn - 0.25) * Math.PI * 2;

    const prims: Prim[] = [
      shape(slice(cx, cy, radius, turn, end), {
        fill: colourOf(entry.colour ?? SERIES[index % SERIES.length]),
        width: 7,
      }),
    ];

    // Leader line out to a caption sitting clear of the circle.
    const anchorX = cx + Math.cos(angle) * radius;
    const anchorY = cy + Math.sin(angle) * radius;
    const outX = cx + Math.cos(angle) * (radius + 46);
    const outY = cy + Math.sin(angle) * (radius + 46);
    const toRight = Math.cos(angle) >= 0;
    const labelX = outX + (toRight ? 16 : -16);

    prims.push(shape(line(anchorX, anchorY, outX, outY), { width: 3.5, crisp: true }));
    prims.push(
      text(uppercase(entry.label), labelX, outY - 4, 24, {
        align: toRight ? "left" : "right",
        maxWidth: 190,
      }),
    );
    prims.push(
      text(`${Math.round(share * 100)}%`, labelX, outY + 26, 24, {
        align: toRight ? "left" : "right",
        maxWidth: 190,
      }),
    );

    beats.push({ prims, origin: { x: cx, y: cy } });
    turn = end;
  });

  if (spec.items?.length) {
    const size = 92;
    const gap = 150;
    const span = spec.items.length * size + (spec.items.length - 1) * gap;
    const startX = BOARD_WIDTH / 2 - span / 2 + size / 2;
    const rowY = CONTENT_BOTTOM - 74;
    spec.items.forEach((entry, index) => {
      beats.push(iconBeat(entry, startX + index * (size + gap), rowY, size, 22, size + gap * 0.7));
    });
  }

  return beats;
}

function layoutBars(spec: Extract<SceneSpec, { layout: "bars" }>): Beat[] {
  const beats: Beat[] = [titleBeat(spec.title)];

  const baseline = spec.items?.length ? CONTENT_BOTTOM - 170 : CONTENT_BOTTOM - 60;
  const top = CONTENT_TOP + 60;
  const max = Math.max(...spec.data.map((entry) => entry.value), 1);
  const count = spec.data.length;
  const barWidth = count <= 3 ? 128 : 96;
  const gap = count <= 3 ? 110 : 72;
  const span = count * barWidth + (count - 1) * gap;
  const startX = BOARD_WIDTH / 2 - span / 2;

  beats.push({
    origin: { x: BOARD_WIDTH / 2, y: baseline },
    prims: [
      shape(line(startX - 56, baseline, startX + span + 56, baseline), { width: 9, crisp: true }),
    ],
  });

  spec.data.forEach((entry, index) => {
    const height = Math.max(36, ((baseline - top) * entry.value) / max);
    const x = startX + index * (barWidth + gap);
    const y = baseline - height;

    beats.push({
      origin: { x: x + barWidth / 2, y: baseline },
      prims: [
        shape(rr(x, y, barWidth, height, 10), {
          fill: colourOf(entry.colour ?? SERIES[index % SERIES.length]),
          width: 7,
        }),
        text(String(entry.value), x + barWidth / 2, y - 22, 34, { maxWidth: barWidth + gap }),
        text(uppercase(entry.label), x + barWidth / 2, baseline + 40, 24, {
          maxWidth: barWidth + gap * 0.8,
        }),
      ],
    });
  });

  if (spec.items?.length) {
    const size = 88;
    const iconGap = 160;
    const iconSpan = spec.items.length * size + (spec.items.length - 1) * iconGap;
    const iconStart = BOARD_WIDTH / 2 - iconSpan / 2 + size / 2;
    spec.items.forEach((entry, index) => {
      beats.push(
        iconBeat(entry, iconStart + index * (size + iconGap), CONTENT_BOTTOM - 72, size, 22, size + iconGap * 0.7),
      );
    });
  }

  return beats;
}

function layoutTimeline(spec: Extract<SceneSpec, { layout: "timeline" }>): Beat[] {
  const beats: Beat[] = [titleBeat(spec.title)];
  const count = spec.items.length;
  const lineY = CONTENT_BOTTOM - 150;
  const left = 200;
  const right = BOARD_WIDTH - 200;

  beats.push({
    origin: { x: BOARD_WIDTH / 2, y: lineY },
    prims: [shape(line(left - 60, lineY, right + 60, lineY), { width: 9, crisp: true })],
  });

  const step = count === 1 ? 0 : (right - left) / (count - 1);
  const size = count >= 4 ? 108 : 128;

  spec.items.forEach((entry, index) => {
    const cx = count === 1 ? BOARD_WIDTH / 2 : left + index * step;
    const prims: Prim[] = iconPrims(entry, cx, lineY - size / 2 - 54, size, entry.colour as ColourKey | undefined);

    if (entry.badge) {
      prims.push(
        ...badgePrims(entry.badge, cx + size * 0.36, lineY - size - 54 + size * 0.14, size * 0.4),
      );
    }
    prims.push(
      shape(circle(cx, lineY, 15), {
        fill: colourOf(entry.colour ?? SERIES[index % SERIES.length]),
        width: 6,
      }),
    );
    if (entry.label) {
      prims.push(text(uppercase(entry.label), cx, lineY + 52, 24, { maxWidth: step * 0.9 || 260 }));
    }

    beats.push({ prims, origin: { x: cx, y: lineY - size / 2 - 40 } });
  });

  return beats;
}

function layoutStat(spec: Extract<SceneSpec, { layout: "stat" }>): Beat[] {
  const beats: Beat[] = [titleBeat(spec.title)];
  const centreY = (CONTENT_TOP + CONTENT_BOTTOM) / 2;

  if (spec.icon) {
    beats.push({
      origin: { x: BOARD_WIDTH / 2, y: centreY - 130 },
      prims: iconPrims({ icon: spec.icon, glyph: spec.glyph }, BOARD_WIDTH / 2, centreY - 130, 168),
    });
  }

  const statY = spec.icon ? centreY + 70 : centreY + 20;
  const prims: Prim[] = [text(spec.stat, BOARD_WIDTH / 2, statY, 156, { maxWidth: BOARD_WIDTH - 200 })];
  if (spec.caption) {
    prims.push(text(uppercase(spec.caption), BOARD_WIDTH / 2, statY + 66, 32, { maxWidth: 720 }));
  }
  beats.push({ prims, origin: { x: BOARD_WIDTH / 2, y: statY } });

  return beats;
}

/**
 * The band a taped photograph occupies when a scene has one.
 *
 * Fixed, because the board is squeezed to fit around it rather than the other
 * way round -- a card that floats over whatever the layout happened to draw
 * will sooner or later land on top of it.
 */
// Inset from the right edge: the card is taped on at a slight angle, and the
// tape itself overhangs the corners, so the band has to leave room for both.
export const PHOTO_BOX = { x: 846, y: 190, width: 344, height: 320 };

/** How much of the board's width is left for the drawing beside a photo. */
const PHOTO_SQUEEZE = 0.64;
/**
 * The heading shrinks far less than the diagram.
 *
 * Scaling it with everything else leaves a two-column board whose title reads
 * like a caption. It is still the loudest thing on the board; it just has a
 * narrower column to sit in.
 */
const PHOTO_TITLE_SQUEEZE = 0.86;

/**
 * Rebuilds a beat inside the narrower column a photo leaves behind.
 *
 * Done to the geometry here rather than with a canvas transform at paint time,
 * so everything downstream -- the pen, the camera, the bounding boxes -- is
 * already working in final board coordinates and needs to know nothing.
 */
function squeezeBeat(
  beat: Beat,
  scale: number,
  centreX: number,
  centreY: number,
  anchorY = (CONTENT_TOP + CONTENT_BOTTOM) / 2,
  /** Hard limit for text, so a long heading wraps instead of running off. */
  columnWidth = BOARD_WIDTH,
): Beat {
  const mapX = (x: number) => centreX + (x - BOARD_WIDTH / 2) * scale;
  const mapY = (y: number) => centreY + (y - anchorY) * scale;

  return {
    origin: { x: mapX(beat.origin.x), y: mapY(beat.origin.y) },
    prims: beat.prims.map((prim) => {
      if (prim.kind === "text") {
        return {
          ...prim,
          x: mapX(prim.x),
          y: mapY(prim.y),
          size: prim.size * scale,
          maxWidth: Math.min(prim.maxWidth * scale, columnWidth),
          tracking: prim.tracking ? prim.tracking * scale : undefined,
        };
      }
      return {
        ...prim,
        d: transform(prim.d, scale, centreX - (BOARD_WIDTH / 2) * scale, centreY - anchorY * scale),
        width: Math.max(2.5, prim.width * scale),
      };
    }),
  };
}

export interface ComposeOptions {
  /** True when a photograph will be taped to the board beside the drawing. */
  photo?: boolean;
}

export function composeScene(spec: SceneSpec, options: ComposeOptions = {}): ComposedScene {
  const beats = (() => {
    switch (spec.layout) {
      case "icons":
      case "steps":
        return layoutIcons(spec);
      case "compare":
        return layoutCompare(spec);
      case "pie":
        return layoutPie(spec);
      case "bars":
        return layoutBars(spec);
      case "timeline":
        return layoutTimeline(spec);
      case "stat":
        return layoutStat(spec);
    }
  })();

  if (!options.photo) return { beats, photoBox: null };

  // Everything moves into the left column, but the heading keeps most of its
  // size and its place at the top -- only the diagram is genuinely squeezed,
  // and it is re-centred in the space the heading leaves.
  const columnRight = PHOTO_BOX.x - 40;
  const columnCentre = columnRight / 2 + 12;
  const bandCentre = (TITLE_Y + 84 + CONTENT_BOTTOM) / 2;
  // Text may use the column minus a margin on each side of its centre.
  const columnWidth = Math.min(columnRight - 32, (columnCentre - 24) * 2);

  return {
    beats: beats.map((beat, index) =>
      index === 0
        ? squeezeBeat(beat, PHOTO_TITLE_SQUEEZE, columnCentre, TITLE_Y, TITLE_Y, columnWidth)
        : squeezeBeat(beat, PHOTO_SQUEEZE, columnCentre, bandCentre, undefined, columnWidth),
    ),
    photoBox: PHOTO_BOX,
  };
}

export { ICON_NAMES, poly };
