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

/**
 * The shape of the board.
 *
 * A video is watched somewhere, and where decides its shape: a 16:9 board is
 * right on a laptop and wrong on a phone, where it occupies a sixth of the
 * screen with black above and below it.
 *
 * This is not a scale factor. A row of four icons is 1052 pixels wide, which is
 * a comfortable row on a 1280-wide board and does not exist on a 720-wide one —
 * scaled to fit it becomes four thumbnails in a strip, which is a worse drawing
 * than the same four icons stacked down the page. So the layouts below branch
 * on `tall` and arrange themselves differently: rows become columns, a pie's
 * leader lines become a legend, vertical bars become horizontal ones, and a
 * timeline's spine turns on its side.
 *
 * Everything else — the typography, the icon set, the pen, the camera — is the
 * same in every shape, which is what keeps a vertical cut recognisably the same
 * hand as the widescreen one.
 */
export type BoardFormat = "landscape" | "portrait" | "square";

export interface Board {
  id: BoardFormat;
  width: number;
  height: number;
  /** Baseline of the heading. */
  titleY: number;
  titleSize: number;
  /** The band the drawing lives in, below the heading. */
  contentTop: number;
  contentBottom: number;
  /** Left and right breathing room. Text is never wider than the gap between. */
  margin: number;
  /** Taller than it is wide. The one thing the layouts actually branch on. */
  tall: boolean;
}

export const BOARDS: Record<BoardFormat, Board> = {
  landscape: {
    id: "landscape",
    width: 1280,
    height: 720,
    titleY: 100,
    titleSize: 62,
    contentTop: 162,
    contentBottom: 672,
    margin: 80,
    tall: false,
  },
  /**
   * 720×1280 rather than 1080×1920: the same short edge as the landscape board,
   * so type set at 62 is the same size on the screen in both, and the icon
   * geometry and stroke weights carry across unchanged. The exporter scales to
   * whatever height is asked for.
   */
  portrait: {
    id: "portrait",
    width: 720,
    height: 1280,
    // A heading that wraps to three lines is ordinary at this width, so it is
    // given the room rather than allowed to run into the drawing.
    titleY: 150,
    titleSize: 60,
    contentTop: 306,
    contentBottom: 1160,
    margin: 56,
    tall: true,
  },
  square: {
    id: "square",
    width: 1080,
    height: 1080,
    titleY: 128,
    titleSize: 62,
    contentTop: 238,
    contentBottom: 992,
    margin: 72,
    // Wide enough for a row of four, so it takes the landscape arrangements.
    tall: false,
  },
};

export const DEFAULT_BOARD_FORMAT: BoardFormat = "landscape";

export function boardOf(format: BoardFormat | undefined): Board {
  return BOARDS[format ?? DEFAULT_BOARD_FORMAT] ?? BOARDS.landscape;
}

export function isBoardFormat(value: unknown): value is BoardFormat {
  return value === "landscape" || value === "portrait" || value === "square";
}

/**
 * The landscape board, still exported under its old names.
 *
 * Everything that renders one frame at a time now takes a `Board`, but the
 * thumbnail, the recorder and a handful of callers only ever wanted "how big is
 * the default board", and rewriting those to thread a format through would be
 * churn for nothing.
 */
export const BOARD_WIDTH = BOARDS.landscape.width;
export const BOARD_HEIGHT = BOARDS.landscape.height;


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

function titleBeat(title: string, b: Board): Beat {
  return {
    origin: { x: b.width / 2, y: b.titleY },
    prims: [
      text(uppercase(title), b.width / 2, b.titleY, b.titleSize, {
        maxWidth: b.width - b.margin * 2,
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

function layoutIcons(spec: Extract<SceneSpec, { layout: "icons" | "steps" }>, b: Board): Beat[] {
  const beats: Beat[] = [titleBeat(spec.title, b)];
  const count = spec.items.length;

  if (b.tall) {
    // Four things read as a grid; anything else, and anything that is a
    // *sequence*, reads down the page. A four-step sequence in a 2×2 grid asks
    // the viewer to work out the reading order, which is the one thing a
    // numbered process must not do.
    const grid = spec.layout === "icons" && count === 4;
    const rows = grid ? 2 : count;
    const cols = grid ? 2 : 1;
    const cellW = (b.width - b.margin * 2) / cols;
    const cellH = (b.contentBottom - b.contentTop) / rows;
    // The caption hangs below the icon, so the icon sits above centre by half
    // of what the caption takes.
    const labelSize = grid ? 24 : 28;
    const captionAllowance = labelSize + 22;
    const size = grid
      ? Math.min(196, cellH - captionAllowance - 40)
      : Math.min(count === 1 ? 320 : 268, cellH - captionAllowance - 34);

    spec.items.forEach((entry, index) => {
      const col = grid ? index % 2 : 0;
      const row = grid ? Math.floor(index / 2) : index;
      const cx = b.margin + cellW * (col + 0.5);
      const cy = b.contentTop + cellH * (row + 0.5) - captionAllowance / 2;
      beats.push(iconBeat(entry, cx, cy, size, labelSize, cellW - 24));

      // A step arrow points the way the eye is already travelling.
      if (spec.layout === "steps" && index < count - 1) {
        const from = cy + size / 2 + captionAllowance + 10;
        const to = cy + cellH - size / 2 - 14;
        if (to - from > 24) {
          const { shaft, head } = arrow(cx, from, cx, to, 26);
          beats.push({
            origin: { x: cx, y: (from + to) / 2 },
            prims: [shape(shaft, { width: 8 }), shape(head, { fill: COLOURS.ink, width: 4 })],
          });
        }
      }
    });

    return beats;
  }

  /**
   * Sized to fill the board. The row sat in the middle of a lot of empty paper
   * before, which reads as an unfinished slide rather than a drawing.
   *
   * The size is a preference capped by the width available, and the gap is a
   * fraction of the size rather than a number — so the same row that fills a
   * 1280-wide board fills a 1080-wide one instead of hanging its outermost
   * caption over the edge. On the widescreen board the cap never bites and the
   * numbers come out where they always were.
   */
  const preferred = count === 1 ? 330 : count === 2 ? 290 : count === 3 ? 248 : 206;
  const gapRatio = count === 2 ? 0.66 : count === 3 ? 0.48 : 0.37;
  const usable = b.width - b.margin * 2;
  const size = Math.min(preferred, usable / (count + (count - 1) * gapRatio));
  const gap = size * gapRatio;
  const span = count * size + (count - 1) * gap;
  const startX = b.width / 2 - span / 2 + size / 2;
  // Centre the icon row and its captions in the content area.
  const captionAllowance = 44;
  const cy = (b.contentTop + b.contentBottom) / 2 - captionAllowance / 2;

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

function layoutCompare(spec: Extract<SceneSpec, { layout: "compare" }>, b: Board): Beat[] {
  const beats: Beat[] = [titleBeat(spec.title, b)];

  if (b.tall) {
    // Two halves, one above the other, with the rule between them lying flat.
    // Side by side in a 720-wide frame each column is 300 pixels, which is
    // narrower than one icon and its caption.
    const midY = (b.contentTop + b.contentBottom) / 2;
    beats.push({
      origin: { x: b.width / 2, y: midY },
      prims: [
        shape(line(b.margin, midY, b.width - b.margin, midY), { width: 9, crisp: true }),
      ],
    });

    const halves = [
      { data: spec.left, top: b.contentTop, bottom: midY - 14 },
      { data: spec.right, top: midY + 14, bottom: b.contentBottom },
    ] as const;

    for (const { data, top, bottom } of halves) {
      const cols = data.items.length;
      const iconSize = cols >= 3 ? 116 : cols === 2 ? 148 : 170;
      const gap = cols >= 3 ? 40 : 76;
      const span = cols * iconSize + (cols - 1) * gap;
      const startX = b.width / 2 - span / 2 + iconSize / 2;
      const hasStat = Boolean(data.stat);
      const statRoom = hasStat ? 128 : 0;
      const rowCy = top + (bottom - statRoom - top) / 2 - 14;

      data.items.forEach((entry, index) => {
        const cx = startX + index * (iconSize + gap);
        const prims: Prim[] = iconPrims(entry, cx, rowCy, iconSize, entry.colour as ColourKey | undefined);
        if (entry.badge) {
          prims.push(
            ...badgePrims(entry.badge, cx + iconSize * 0.36, rowCy - iconSize * 0.36, iconSize * 0.42),
          );
        }
        prims.push(
          text(uppercase(entry.label ?? data.title), cx, rowCy + iconSize / 2 + 34, 24, {
            maxWidth: iconSize + gap * 0.8,
          }),
        );
        beats.push({ prims, origin: { x: cx, y: rowCy } });
      });

      if (data.stat) {
        const statY = bottom - 54;
        const prims: Prim[] = [
          text(data.stat, b.width / 2, statY, 76, { maxWidth: b.width - b.margin * 2 }),
        ];
        if (data.statCaption) {
          prims.push(
            text(uppercase(data.statCaption), b.width / 2, statY + 44, 25, {
              maxWidth: b.width - b.margin * 2,
            }),
          );
        }
        beats.push({ prims, origin: { x: b.width / 2, y: statY } });
      }
    }

    return beats;
  }

  const midX = b.width / 2;

  beats.push({
    origin: { x: midX, y: (b.contentTop + b.contentBottom) / 2 },
    prims: [shape(line(midX, b.contentTop, midX, b.contentBottom), { width: 9, crisp: true })],
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
    const areaTop = b.contentTop + 24;
    const areaBottom = hasStat ? b.contentBottom - 150 : b.contentBottom - 20;
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
      const statY = b.contentBottom - 70;
      const prims: Prim[] = [text(data.stat, centre, statY, 78, { maxWidth: 320 })];
      if (data.statCaption) {
        prims.push(text(uppercase(data.statCaption), centre, statY + 46, 26, { maxWidth: 320 }));
      }
      beats.push({ prims, origin: { x: centre, y: statY } });
    }
  }

  return beats;
}

function layoutPie(spec: Extract<SceneSpec, { layout: "pie" }>, b: Board): Beat[] {
  const beats: Beat[] = [titleBeat(spec.title, b)];
  const hasIcons = Boolean(spec.items?.length);
  const total = spec.data.reduce((sum, entry) => sum + entry.value, 0) || 1;

  if (b.tall) {
    /**
     * A legend under the circle, not leader lines out of it.
     *
     * The lines need room on both sides for a caption and a percentage. At 720
     * wide there is about 140 pixels either side of a usable circle, and a
     * two-line caption in 140 pixels is four words stacked over each other. A
     * legend is what a narrow page does instead, and it reads better anyway:
     * one column, in the order the slices were drawn.
     */
    const iconsRoom = hasIcons ? 150 : 0;
    const rowH = 52;
    const legendH = spec.data.length * rowH;
    const available = b.contentBottom - b.contentTop - iconsRoom;
    const radius = Math.max(96, Math.min(200, (available - legendH - 76) / 2));
    const cx = b.width / 2;
    const cy = b.contentTop + radius + 12;

    let turn = 0;
    const legendTop = cy + radius + 58;

    spec.data.forEach((entry, index) => {
      const share = entry.value / total;
      const end = turn + share;
      const colour = colourOf(entry.colour ?? SERIES[index % SERIES.length]);
      const rowY = legendTop + index * rowH;

      beats.push({
        origin: { x: cx, y: cy },
        prims: [
          shape(slice(cx, cy, radius, turn, end), { fill: colour, width: 7 }),
          // Swatch, label, percentage — the three things a legend row is.
          shape(rr(b.margin, rowY - 17, 32, 32, 7), { fill: colour, width: 4 }),
          text(uppercase(entry.label), b.margin + 48, rowY + 8, 26, {
            align: "left",
            maxWidth: b.width - b.margin * 2 - 150,
          }),
          text(`${Math.round(share * 100)}%`, b.width - b.margin, rowY + 8, 28, {
            align: "right",
            maxWidth: 110,
          }),
        ],
      });
      turn = end;
    });

    if (spec.items?.length) {
      const size = 86;
      const gap = 54;
      const span = spec.items.length * size + (spec.items.length - 1) * gap;
      const startX = b.width / 2 - span / 2 + size / 2;
      const rowY = b.contentBottom - 62;
      spec.items.forEach((entry, index) => {
        beats.push(iconBeat(entry, startX + index * (size + gap), rowY, size, 22, size + gap * 0.8));
      });
    }

    return beats;
  }

  const radius = hasIcons ? 148 : 186;
  const cx = b.width / 2;
  const cy = hasIcons ? b.contentTop + radius + 14 : (b.contentTop + b.contentBottom) / 2;

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
    const startX = b.width / 2 - span / 2 + size / 2;
    const rowY = b.contentBottom - 74;
    spec.items.forEach((entry, index) => {
      beats.push(iconBeat(entry, startX + index * (size + gap), rowY, size, 22, size + gap * 0.7));
    });
  }

  return beats;
}

function layoutBars(spec: Extract<SceneSpec, { layout: "bars" }>, b: Board): Beat[] {
  const beats: Beat[] = [titleBeat(spec.title, b)];
  const max = Math.max(...spec.data.map((entry) => entry.value), 1);
  const count = spec.data.length;

  if (b.tall) {
    /**
     * Bars lie down in a portrait frame.
     *
     * Standing up they are as tall as the frame allows and as narrow as five
     * of them will fit, and the label under each one is a word turned on its
     * side. Lying down, the label sits where it is read — to the left of the
     * bar, on the same line — and the bar has the whole width to grow into,
     * which is the axis with room to spare in this shape.
     */
    const labelW = 176;
    const valueW = 96;
    const left = b.margin + labelW;
    const right = b.width - b.margin - valueW;
    const iconsRoom = spec.items?.length ? 140 : 0;
    const areaTop = b.contentTop + 16;
    const areaBottom = b.contentBottom - iconsRoom - 16;
    const rowH = (areaBottom - areaTop) / count;
    const barH = Math.max(28, Math.min(78, rowH * 0.6));

    beats.push({
      origin: { x: left, y: (areaTop + areaBottom) / 2 },
      prims: [shape(line(left, areaTop - 14, left, areaBottom + 14), { width: 9, crisp: true })],
    });

    spec.data.forEach((entry, index) => {
      const span = Math.max(34, ((right - left) * entry.value) / max);
      const cy = areaTop + rowH * (index + 0.5);
      const y = cy - barH / 2;

      beats.push({
        origin: { x: left, y: cy },
        prims: [
          shape(rr(left, y, span, barH, 10), {
            fill: colourOf(entry.colour ?? SERIES[index % SERIES.length]),
            width: 7,
          }),
          text(uppercase(entry.label), left - 20, cy + 9, 25, {
            align: "right",
            maxWidth: labelW - 12,
          }),
          text(String(entry.value), left + span + 18, cy + 11, 32, {
            align: "left",
            maxWidth: valueW,
          }),
        ],
      });
    });

    if (spec.items?.length) {
      const size = 84;
      const gap = 56;
      const iconSpan = spec.items.length * size + (spec.items.length - 1) * gap;
      const iconStart = b.width / 2 - iconSpan / 2 + size / 2;
      spec.items.forEach((entry, index) => {
        beats.push(
          iconBeat(entry, iconStart + index * (size + gap), b.contentBottom - 60, size, 22, size + gap * 0.8),
        );
      });
    }

    return beats;
  }

  const baseline = spec.items?.length ? b.contentBottom - 170 : b.contentBottom - 60;
  const top = b.contentTop + 60;
  const barWidth = count <= 3 ? 128 : 96;
  const gap = count <= 3 ? 110 : 72;
  const span = count * barWidth + (count - 1) * gap;
  const startX = b.width / 2 - span / 2;

  beats.push({
    origin: { x: b.width / 2, y: baseline },
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
    const iconStart = b.width / 2 - iconSpan / 2 + size / 2;
    spec.items.forEach((entry, index) => {
      beats.push(
        iconBeat(entry, iconStart + index * (size + iconGap), b.contentBottom - 72, size, 22, size + iconGap * 0.7),
      );
    });
  }

  return beats;
}

function layoutTimeline(spec: Extract<SceneSpec, { layout: "timeline" }>, b: Board): Beat[] {
  const beats: Beat[] = [titleBeat(spec.title, b)];
  const count = spec.items.length;

  if (b.tall) {
    // The spine stands up and the stops read down it, each with its icon beside
    // it and its label beside that — the shape of every timeline ever drawn in
    // a notebook, which is a portrait page.
    const spineX = b.margin + 46;
    const top = b.contentTop + 60;
    const bottom = b.contentBottom - 60;
    const size = count >= 4 ? 104 : 124;
    const iconCx = spineX + 96 + size / 2;
    const labelX = iconCx + size / 2 + 26;

    beats.push({
      origin: { x: spineX, y: (top + bottom) / 2 },
      prims: [shape(line(spineX, top - 46, spineX, bottom + 46), { width: 9, crisp: true })],
    });

    const step = count === 1 ? 0 : (bottom - top) / (count - 1);

    spec.items.forEach((entry, index) => {
      const cy = count === 1 ? (top + bottom) / 2 : top + index * step;
      const prims: Prim[] = iconPrims(entry, iconCx, cy, size, entry.colour as ColourKey | undefined);

      if (entry.badge) {
        prims.push(
          ...badgePrims(entry.badge, iconCx + size * 0.36, cy - size * 0.36, size * 0.4),
        );
      }
      prims.push(
        shape(circle(spineX, cy, 15), {
          fill: colourOf(entry.colour ?? SERIES[index % SERIES.length]),
          width: 6,
        }),
      );
      if (entry.label) {
        prims.push(
          text(uppercase(entry.label), labelX, cy + 9, 26, {
            align: "left",
            maxWidth: b.width - b.margin - labelX,
          }),
        );
      }

      beats.push({ prims, origin: { x: iconCx, y: cy } });
    });

    return beats;
  }

  const lineY = b.contentBottom - 150;
  // A margin plus room for the first stop's caption to sit under it.
  const left = b.margin + 120;
  const right = b.width - left;

  beats.push({
    origin: { x: b.width / 2, y: lineY },
    prims: [shape(line(left - 60, lineY, right + 60, lineY), { width: 9, crisp: true })],
  });

  const step = count === 1 ? 0 : (right - left) / (count - 1);
  const size = count >= 4 ? 108 : 128;

  spec.items.forEach((entry, index) => {
    const cx = count === 1 ? b.width / 2 : left + index * step;
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

function layoutStat(spec: Extract<SceneSpec, { layout: "stat" }>, b: Board): Beat[] {
  const beats: Beat[] = [titleBeat(spec.title, b)];
  const centreY = (b.contentTop + b.contentBottom) / 2;
  const wide = b.width - b.margin * 2;

  // A single figure works in any shape; it only ever needs re-centring, and a
  // taller frame can afford a bigger icon above it.
  const iconSize = b.tall ? 224 : 168;
  const iconLift = b.tall ? 208 : 130;
  const statSize = b.tall ? 168 : 156;

  if (spec.icon) {
    beats.push({
      origin: { x: b.width / 2, y: centreY - iconLift },
      prims: iconPrims(
        { icon: spec.icon, glyph: spec.glyph },
        b.width / 2,
        centreY - iconLift,
        iconSize,
      ),
    });
  }

  const statY = spec.icon ? centreY + (b.tall ? 96 : 70) : centreY + 20;
  const prims: Prim[] = [text(spec.stat, b.width / 2, statY, statSize, { maxWidth: wide })];
  if (spec.caption) {
    prims.push(
      text(uppercase(spec.caption), b.width / 2, statY + (b.tall ? 76 : 66), b.tall ? 34 : 32, {
        maxWidth: Math.min(wide, 720),
      }),
    );
  }
  beats.push({ prims, origin: { x: b.width / 2, y: statY } });

  return beats;
}

/**
 * The band a taped photograph occupies when a scene has one.
 *
 * Fixed per shape, because the board is squeezed to fit around it rather than
 * the other way round -- a card that floats over whatever the layout happened
 * to draw will sooner or later land on top of it.
 *
 * In a wide frame the card goes beside the drawing; in a tall one it goes above
 * it, because a column narrow enough to leave room beside a card is not a
 * column anything can be drawn in.
 */
export function photoBoxFor(b: Board): { x: number; y: number; width: number; height: number } {
  if (b.tall) {
    return { x: b.margin + 42, y: b.contentTop - 6, width: b.width - (b.margin + 42) * 2, height: 300 };
  }
  if (b.id === "square") {
    return { x: 700, y: 300, width: 308, height: 288 };
  }
  // Inset from the right edge: the card is taped on at a slight angle, and the
  // tape itself overhangs the corners, so the band has to leave room for both.
  return { x: 846, y: 190, width: 344, height: 320 };
}

/** The landscape card, still exported for callers that only draw that board. */
export const PHOTO_BOX = photoBoxFor(BOARDS.landscape);

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
 * Rebuilds a beat inside the smaller area a photo leaves behind.
 *
 * Done to the geometry here rather than with a canvas transform at paint time,
 * so everything downstream -- the pen, the camera, the bounding boxes -- is
 * already working in final board coordinates and needs to know nothing.
 */
function squeezeBeat(
  beat: Beat,
  b: Board,
  scale: number,
  centreX: number,
  centreY: number,
  anchorY = (b.contentTop + b.contentBottom) / 2,
  /** Hard limit for text, so a long heading wraps instead of running off. */
  columnWidth = b.width,
): Beat {
  const mapX = (x: number) => centreX + (x - b.width / 2) * scale;
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
        d: transform(prim.d, scale, centreX - (b.width / 2) * scale, centreY - anchorY * scale),
        width: Math.max(2.5, prim.width * scale),
      };
    }),
  };
}

export interface ComposeOptions {
  /** True when a photograph will be taped to the board beside the drawing. */
  photo?: boolean;
  /** The shape being drawn for. Defaults to the widescreen board. */
  board?: Board | BoardFormat;
}

export function composeScene(spec: SceneSpec, options: ComposeOptions = {}): ComposedScene {
  const b =
    typeof options.board === "string" ? boardOf(options.board) : (options.board ?? BOARDS.landscape);

  const beats = (() => {
    switch (spec.layout) {
      case "icons":
      case "steps":
        return layoutIcons(spec, b);
      case "compare":
        return layoutCompare(spec, b);
      case "pie":
        return layoutPie(spec, b);
      case "bars":
        return layoutBars(spec, b);
      case "timeline":
        return layoutTimeline(spec, b);
      case "stat":
        return layoutStat(spec, b);
    }
  })();

  if (!options.photo) return { beats, photoBox: null };

  const photoBox = photoBoxFor(b);

  if (b.tall) {
    // The card sits under the heading and the drawing takes the band below it.
    // The heading is left where it is: it is already the right size for this
    // width, and shrinking it to make room for a photograph is the wrong thing
    // to give up.
    const bandTop = photoBox.y + photoBox.height + 46;
    const bandBottom = b.contentBottom;
    const scale = Math.max(
      0.42,
      Math.min(1, (bandBottom - bandTop) / (b.contentBottom - b.contentTop)),
    );
    return {
      beats: beats.map((beat, index) =>
        index === 0
          ? beat
          : squeezeBeat(
              beat,
              b,
              scale,
              b.width / 2,
              (bandTop + bandBottom) / 2,
              undefined,
              b.width - b.margin * 2,
            ),
      ),
      photoBox,
    };
  }

  // Everything moves into the left column, but the heading keeps most of its
  // size and its place at the top -- only the diagram is genuinely squeezed,
  // and it is re-centred in the space the heading leaves.
  const columnRight = photoBox.x - 40;
  const columnCentre = columnRight / 2 + 12;
  const bandCentre = (b.titleY + 84 + b.contentBottom) / 2;
  // Text may use the column minus a margin on each side of its centre.
  const columnWidth = Math.min(columnRight - 32, (columnCentre - 24) * 2);

  return {
    beats: beats.map((beat, index) =>
      index === 0
        ? squeezeBeat(beat, b, PHOTO_TITLE_SQUEEZE, columnCentre, b.titleY, b.titleY, columnWidth)
        : squeezeBeat(beat, b, PHOTO_SQUEEZE, columnCentre, bandCentre, undefined, columnWidth),
    ),
    photoBox,
  };
}

export { ICON_NAMES, poly };
