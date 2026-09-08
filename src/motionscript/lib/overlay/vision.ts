/**
 * Reading the picture, in numbers.
 *
 * The agent was given frames to look at (`glance.ts`) and that turned "has
 * never seen the video" into "has seen the video". It did not turn it into
 * "knows where the text can go". A 384px JPEG at `detail: "low"` is enough to
 * say *there is a person, roughly left of centre*; it is not enough to say
 * *the lower third is 0.34 busy and the subject's face occupies the middle
 * column between 0.31 and 0.58*, and the second sentence is the one that
 * decides an edit.
 *
 * So the frames are measured here as well as shown. Everything below is
 * arithmetic over pixels — a grid of luminance, detail and skin, a subject
 * centroid, a dominant palette, and a ranking of every named position by how
 * safe it is to put type there. It is cheap (a 96×96 draw and one
 * `getImageData` per frame), it is deterministic, and it says the one thing a
 * picture cannot: *how much*.
 *
 * The measurements are taken on the **output** frame — after the crop, after
 * the grade — because that is the frame the person watches and the one the
 * agent's `position` and `{x,y}` fields address. Measuring the footage instead
 * would hand back coordinates for a video nobody sees.
 *
 * Nothing here throws on bad input. A frame that will not decode contributes
 * no read, and an agent with fewer reads is exactly as well informed as it was
 * before this file existed.
 */

import { rectAt, SAFE_MARGIN, TEXT_SIZE, textBoxHeight } from "./presets";
import type { PositionName } from "./ops-schema";
import type { Rect } from "./types";
import { describeGradeReading, suggestGrade } from "./grade";

/* --------------------------------- shape ----------------------------------- */

/** Cells across and down. 6×6 is 36 numbers — fine enough to find a face, coarse enough to send. */
const COLS = 6;
const ROWS = 6;
/** Pixels per cell edge in the sampling canvas. 16 gives 256 samples a cell. */
const CELL = 16;
/** The sampling canvas is square regardless of aspect; statistics do not care about pixel shape. */
export const SAMPLE_EDGE = COLS * CELL;

/** Positions a caption may be asked to sit at, in the order they are offered. */
const POSITIONS: readonly PositionName[] = [
  "top",
  "top-left",
  "top-right",
  "upper-third",
  "left",
  "center",
  "right",
  "lower-third",
  "bottom",
  "bottom-left",
  "bottom-right",
];

/** Positions whose element spans most of the frame's width — mirrors `presets.isWidePosition`. */
const WIDE: ReadonlySet<PositionName> = new Set([
  "top",
  "bottom",
  "center",
  "lower-third",
  "upper-third",
]);

/* --------------------------------- types ----------------------------------- */

/** One place type could go, with the reason it is or is not a good idea. */
export interface TextZone {
  position: PositionName;
  /** 0..1. Above 0.7 is safe unaided; below 0.4 should not be used. */
  score: number;
  /** Type colour that will read against what is behind it. */
  ink: "light" | "dark";
  /** True when the background will not carry type on its own. */
  scrim: boolean;
  /** Fraction of the box sitting over the subject. Above ~0.15 covers a face. */
  overSubject: number;
  /** Detail behind the box, 0..1. */
  busy: number;
  /** Why the score is what it is, in one clause. */
  note: string;
}

/** Everything measurable about one frame of the cut. */
export interface FrameRead {
  /** Output-clock second. */
  at: number;
  /** Mean luminance of the whole frame, 0..1. */
  brightness: number;
  /** Spread of luminance across the frame, 0..1. Low is flat, high is contrasty. */
  contrast: number;
  /** Mean local detail, 0..1. High means busy footage that will fight with type. */
  busy: number;
  /** Per-cell mean luminance, row-major, `COLS × ROWS`. */
  luma: number[];
  /** Per-cell local detail, row-major. */
  detail: number[];
  /** Per-cell fraction of pixels reading as skin, row-major. */
  skin: number[];
  /**
   * Where the person is, in frame fractions, or null when nothing reads as one.
   * `spread` is how much of the frame they occupy — the shot size.
   */
  subject: { x: number; y: number; spread: number; confidence: number } | null;
  /** Dominant colours, most common first, as hex. */
  colors: string[];
  /** An accent that will pop against this frame, from the house set. */
  accent: string;
  /** Named positions ranked by how safe they are for type, best first. */
  zones: TextZone[];
  /** How much changed since the previous sampled frame, 0..1. Null for the first. */
  change: number | null;
}

/**
 * A read as it crosses the wire.
 *
 * The per-cell grids are what the zones were computed from, and once they have
 * been they are 108 numbers no model reads. Everything the tools answer with is
 * derived, so the wire format carries the derivations and drops the source.
 */
export type WireFrameRead = Omit<FrameRead, "luma" | "detail" | "skin">;

/* -------------------------------- sampling --------------------------------- */

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Does this pixel read as skin?
 *
 * The standard YCbCr rule. It is a heuristic and it is wrong at the edges —
 * wood, terracotta and some sand pass; very dark skin under a cold key can
 * fail — but it is right often enough to answer the only question being asked
 * of it, which is *is there a face roughly here*. It is never used to decide
 * anything on its own: a cell counts as subject when it is skin **and**
 * detailed, and the fallback when nothing passes is the detail map alone.
 */
function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < 55 || y > 235) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 77 && cb <= 130 && cr >= 132 && cr <= 178 && r > g && g >= b - 12;
}

/** The house accents, the same five the style guide names. */
const ACCENTS = [
  { hex: "#ffd60a", h: 50 },
  { hex: "#4ade80", h: 142 },
  { hex: "#60a5fa", h: 213 },
  { hex: "#f472b6", h: 330 },
  { hex: "#fb923c", h: 27 },
] as const;

function hueOf(r: number, g: number, b: number): { h: number; s: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max };
}

function hex(r: number, g: number, b: number): string {
  const part = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/* --------------------------------- reading --------------------------------- */

/**
 * Turn one decoded frame into numbers.
 *
 * `previous` is the frame sampled before this one, used only for the change
 * figure — a large change is a cut or a camera move, which is exactly where an
 * editor puts a caption or a transition.
 */
export function readFrame(
  data: ImageData,
  at: number,
  options: {
    /** Frame width ÷ height, so a box's aspect is honoured when it is scored. */
    aspect: number;
    /** The band burned-in subtitles occupy, in frame fractions, if they are on. */
    subtitleBand?: { from: number; to: number } | null;
    previous?: FrameRead | null;
  }
): FrameRead {
  const { width, height, data: px } = data;
  const cellW = width / COLS;
  const cellH = height / ROWS;

  const luma = new Array<number>(COLS * ROWS).fill(0);
  const detail = new Array<number>(COLS * ROWS).fill(0);
  const skin = new Array<number>(COLS * ROWS).fill(0);
  const cellR = new Array<number>(COLS * ROWS).fill(0);
  const cellG = new Array<number>(COLS * ROWS).fill(0);
  const cellB = new Array<number>(COLS * ROWS).fill(0);

  // 3 bits a channel: 512 buckets, which is coarse enough that a gradient
  // lands in one bucket rather than in forty.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();

  for (let cy = 0; cy < ROWS; cy += 1) {
    for (let cx = 0; cx < COLS; cx += 1) {
      const i = cy * COLS + cx;
      const x0 = Math.floor(cx * cellW);
      const x1 = Math.min(width, Math.ceil((cx + 1) * cellW));
      const y0 = Math.floor(cy * cellH);
      const y1 = Math.min(height, Math.ceil((cy + 1) * cellH));

      let n = 0;
      let sum = 0;
      let sumSq = 0;
      let skinCount = 0;
      let sr = 0;
      let sg = 0;
      let sb = 0;

      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const p = (y * width + x) * 4;
          const r = px[p];
          const g = px[p + 1];
          const b = px[p + 2];
          const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          n += 1;
          sum += l;
          sumSq += l * l;
          sr += r;
          sg += g;
          sb += b;
          if (isSkin(r, g, b)) skinCount += 1;

          const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
          const bucket = buckets.get(key);
          if (bucket) {
            bucket.n += 1;
            bucket.r += r;
            bucket.g += g;
            bucket.b += b;
          } else {
            buckets.set(key, { n: 1, r, g, b });
          }
        }
      }

      if (n === 0) continue;
      const mean = sum / n;
      // Standard deviation of luminance inside the cell: the cheapest honest
      // stand-in for "how much is going on here". A flat wall is near zero; a
      // bookshelf or foliage is high, and type over either needs help.
      const variance = Math.max(0, sumSq / n - mean * mean);
      luma[i] = mean;
      detail[i] = clamp01(Math.sqrt(variance) * 3.2);
      skin[i] = skinCount / n;
      cellR[i] = sr / n;
      cellG[i] = sg / n;
      cellB[i] = sb / n;
    }
  }

  const cells = COLS * ROWS;
  const brightness = luma.reduce((a, b) => a + b, 0) / cells;
  const meanSq = luma.reduce((a, b) => a + b * b, 0) / cells;
  const contrast = clamp01(Math.sqrt(Math.max(0, meanSq - brightness * brightness)) * 3.4);
  const busy = clamp01(detail.reduce((a, b) => a + b, 0) / cells);

  /* --------------------------- who is in shot ---------------------------- */
  //
  // A cell is subject when it is skin AND has some structure in it; a flat
  // beige wall passes the skin rule and is not a person. When nothing passes,
  // fall back to the detailed cells, which on a talking head is still the
  // person and on a landscape is at least the part worth not covering.
  const weights = new Array<number>(cells).fill(0);
  let skinTotal = 0;
  for (let i = 0; i < cells; i += 1) {
    const w = skin[i] > 0.12 ? skin[i] * (0.35 + detail[i]) : 0;
    weights[i] = w;
    skinTotal += skin[i];
  }
  if (!weights.some((w) => w > 0)) {
    const peak = Math.max(...detail);
    if (peak > 0.12) {
      for (let i = 0; i < cells; i += 1) {
        weights[i] = detail[i] > peak * 0.65 ? detail[i] : 0;
      }
    }
  }

  const total = weights.reduce((a, b) => a + b, 0);
  let subject: FrameRead["subject"] = null;
  if (total > 0) {
    let sx = 0;
    let sy = 0;
    let occupied = 0;
    for (let i = 0; i < cells; i += 1) {
      if (weights[i] <= 0) continue;
      const cx = ((i % COLS) + 0.5) / COLS;
      const cy = (Math.floor(i / COLS) + 0.5) / ROWS;
      sx += cx * weights[i];
      sy += cy * weights[i];
      occupied += 1;
    }
    subject = {
      x: clamp01(sx / total),
      y: clamp01(sy / total),
      spread: clamp01(occupied / cells),
      // Skin-derived is worth trusting; a detail centroid is a guess and says so.
      confidence: clamp01(skinTotal > 0.15 ? Math.min(1, skinTotal * 2.2) : 0.3),
    };
  }

  /* ------------------------------- palette -------------------------------- */
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n);
  const colors: string[] = [];
  for (const bucket of ranked) {
    const r = bucket.r / bucket.n;
    const g = bucket.g / bucket.n;
    const b = bucket.b / bucket.n;
    const value = hex(r, g, b);
    if (colors.includes(value)) continue;
    colors.push(value);
    if (colors.length === 4) break;
  }

  // An accent has to survive being put on this footage, so it is picked for
  // hue distance from what is already there — the frame's own colours are what
  // it will be competing with — and never for how it looks in isolation.
  let accent: string = ACCENTS[0].hex;
  {
    const saturated = ranked
      .slice(0, 24)
      .map((bucket) => ({
        ...hueOf(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n),
        n: bucket.n,
      }))
      .filter((c) => c.s > 0.22);
    if (saturated.length) {
      const weight = saturated.reduce((a, c) => a + c.n, 0);
      let best = -1;
      for (const candidate of ACCENTS) {
        let distance = 0;
        for (const colour of saturated) {
          const raw = Math.abs(candidate.h - colour.h);
          distance += (raw > 180 ? 360 - raw : raw) * (colour.n / weight);
        }
        if (distance > best) {
          best = distance;
          accent = candidate.hex;
        }
      }
    }
  }

  /* -------------------------------- change -------------------------------- */
  let change: number | null = null;
  if (options.previous) {
    const before = options.previous.luma;
    if (before.length === luma.length) {
      let sum = 0;
      for (let i = 0; i < luma.length; i += 1) sum += Math.abs(luma[i] - before[i]);
      change = clamp01((sum / luma.length) * 4);
    }
  }

  const zones = rankZones({ luma, detail, skin }, options.aspect, options.subtitleBand ?? null);

  return {
    at,
    brightness,
    contrast,
    busy,
    luma,
    detail,
    skin,
    subject,
    colors,
    accent,
    zones,
    change,
  };
}

/* --------------------------------- zoning ---------------------------------- */

/** Weighted mean of a per-cell map over a rectangle, by area of overlap. */
function sample(map: number[], rect: Rect): { mean: number; spread: number } {
  let weight = 0;
  let sum = 0;
  let sumSq = 0;
  for (let cy = 0; cy < ROWS; cy += 1) {
    const top = cy / ROWS;
    const bottom = (cy + 1) / ROWS;
    const overlapY = Math.min(bottom, rect.y + rect.h) - Math.max(top, rect.y);
    if (overlapY <= 0) continue;
    for (let cx = 0; cx < COLS; cx += 1) {
      const left = cx / COLS;
      const right = (cx + 1) / COLS;
      const overlapX = Math.min(right, rect.x + rect.w) - Math.max(left, rect.x);
      if (overlapX <= 0) continue;
      const w = overlapX * overlapY;
      const v = map[cy * COLS + cx];
      weight += w;
      sum += v * w;
      sumSq += v * v * w;
    }
  }
  if (weight <= 0) return { mean: 0, spread: 0 };
  const mean = sum / weight;
  return { mean, spread: Math.sqrt(Math.max(0, sumSq / weight - mean * mean)) };
}

/** The box a caption of nominal size would occupy at a named position. */
export function boxFor(position: PositionName, size: keyof typeof TEXT_SIZE = "m"): Rect {
  const w = WIDE.has(position) ? 0.8 : 0.44;
  return rectAt(position, w, textBoxHeight(TEXT_SIZE[size]));
}

/**
 * Rank every named position by how safe it is to put type there.
 *
 * The three things that make type unreadable over footage, in the order they
 * matter: it is over the subject's face, the background behind it is busy, or
 * the background behind it changes brightness underneath the words. All three
 * are measurable and all three are measured. What comes back is not "this
 * looks nice" — it is "this will be legible", which is the only judgement a
 * grid of luminance is entitled to make.
 */
export function rankZones(
  maps: Pick<FrameRead, "luma" | "detail" | "skin">,
  aspect: number,
  subtitleBand: { from: number; to: number } | null
): TextZone[] {
  const zones: TextZone[] = [];

  for (const position of POSITIONS) {
    const rect = boxFor(position);
    const detail = sample(maps.detail, rect);
    const light = sample(maps.luma, rect);
    const flesh = sample(maps.skin, rect);

    // Contrast the type would have against what is behind it, for whichever
    // ink is better. Below ~0.45 nothing reads without help.
    const ink: "light" | "dark" = light.mean < 0.55 ? "light" : "dark";
    const inkContrast = ink === "light" ? 1 - light.mean : light.mean;

    let score = 1;
    let reason = "clear";

    // Over the face is the one that is not a matter of degree.
    const overSubject = flesh.mean;
    if (overSubject > 0.06) {
      score -= Math.min(0.75, overSubject * 4.5);
      reason = "over the subject";
    }
    // Busy footage behind type.
    if (detail.mean > 0.18) {
      score -= Math.min(0.4, (detail.mean - 0.18) * 1.6);
      if (reason === "clear") reason = "busy behind the words";
    }
    // Brightness that changes underneath a line is worse than brightness that
    // is simply wrong: a scrim fixes the second and only half-fixes the first.
    if (light.spread > 0.13) {
      score -= Math.min(0.3, (light.spread - 0.13) * 1.8);
      if (reason === "clear") reason = "the background changes under the line";
    }
    if (inkContrast < 0.45) {
      score -= (0.45 - inkContrast) * 0.9;
      if (reason === "clear") reason = "low contrast either way";
    }
    // Anything the burned-in subtitles already own is not available, whatever
    // the pixels say.
    if (subtitleBand) {
      const overlap =
        Math.min(rect.y + rect.h, subtitleBand.to) - Math.max(rect.y, subtitleBand.from);
      if (overlap > 0.01) {
        score -= 0.6;
        reason = "the subtitles are here";
      }
    }
    // A 9:16 frame has a third as much width, so the corners stop being
    // corners — a half-width box in one is most of the frame.
    if (aspect < 1 && !WIDE.has(position) && position !== "center") {
      score -= 0.12;
    }
    // Edges of the frame are lost on a phone even when they look fine here.
    if (rect.y < SAFE_MARGIN * 0.9 || rect.y + rect.h > 1 - SAFE_MARGIN * 0.9) {
      score -= 0.1;
    }

    const scrim = detail.mean > 0.16 || light.spread > 0.12 || inkContrast < 0.55;

    zones.push({
      position,
      score: clamp01(score),
      ink,
      scrim,
      overSubject: Number(overSubject.toFixed(3)),
      busy: Number(detail.mean.toFixed(3)),
      note:
        reason === "clear"
          ? scrim
            ? "clear, but wants a scrim"
            : "clear"
          : reason,
    });
  }

  return zones.sort((a, b) => b.score - a.score);
}

/* ------------------------------- description -------------------------------- */

function pct(value: number): string {
  return value.toFixed(2);
}

function shotSize(spread: number): string {
  if (spread < 0.1) return "wide — they are small in frame";
  if (spread < 0.22) return "medium — room above and to the sides";
  if (spread < 0.38) return "medium-close — a punch-in would start to crowd them";
  return "close — already tight, do not push in further";
}

/** One frame, in full. Backs the `frame_at` tool, so it takes the wire form too. */
export function describeFrame(read: WireFrameRead): string {
  const lines: string[] = [
    `THE FRAME AT ${read.at.toFixed(1)}s`,
    `  brightness ${pct(read.brightness)}, contrast ${pct(read.contrast)}, detail ${pct(read.busy)}${
      read.change !== null ? `, changed ${pct(read.change)} since the frame before` : ""
    }`,
  ];

  if (read.subject) {
    lines.push(
      `  subject at x=${pct(read.subject.x)} y=${pct(read.subject.y)}, filling ${pct(read.subject.spread)} of the frame — ${shotSize(read.subject.spread)}${
        read.subject.confidence < 0.5 ? " (low confidence — this is the busiest region, not certainly a face)" : ""
      }`
    );
  } else {
    lines.push("  no subject found — nothing in this frame reads as a person");
  }

  lines.push(`  colours ${read.colors.join(" ")} · an accent that will pop here: ${read.accent}`);

  const safe = read.zones.filter((z) => z.score >= 0.6);
  const avoid = read.zones.filter((z) => z.score < 0.4);

  lines.push(
    safe.length
      ? `  TYPE GOES HERE: ${safe
          .slice(0, 5)
          .map(
            (z) =>
              `${z.position} (${pct(z.score)}${z.scrim ? ", needs a scrim" : ""}, ${z.ink} type)`
          )
          .join(", ")}`
      : "  NOWHERE IS CLEAN: every position scores under 0.6 — use a scrim, or a badge style, wherever you put it"
  );
  if (avoid.length) {
    lines.push(
      `  TYPE DOES NOT GO HERE: ${avoid
        .slice(0, 5)
        .map((z) => `${z.position} (${z.note})`)
        .join(", ")}`
    );
  }

  return lines.join("\n");
}

/**
 * The whole survey, compressed for the prompt.
 *
 * One line a frame plus a paragraph of what holds across all of them. The
 * per-frame grids are deliberately not sent: 36 numbers × 8 frames is 300
 * tokens of something no model reads carefully, and the same information is a
 * tool call away for the one frame that turns out to matter.
 */
export function describeVision(reads: WireFrameRead[], aspect: number): string {
  if (!reads.length) return "";

  const lines: string[] = [
    "WHAT THE PICTURE IS ACTUALLY DOING",
    "",
    `Measured off ${reads.length} frames of the cut — luminance, detail, skin and palette, per region, on the`,
    "finished frame after the crop. These are counts, not impressions. Positions are scored 0–1 for how well",
    "type will read there: above 0.7 is safe, 0.4–0.7 works with a scrim, below 0.4 is a caption nobody can",
    "read. Plan the placement from these, not from the pictures.",
    "",
  ];

  for (const read of reads) {
    const best = read.zones.filter((z) => z.score >= 0.55).slice(0, 4);
    const worst = read.zones.filter((z) => z.score < 0.4).slice(0, 3);
    lines.push(
      `  ${read.at.toFixed(1)}s — ${
        read.subject
          ? `subject x=${pct(read.subject.x)} y=${pct(read.subject.y)} (${shotSize(read.subject.spread)})`
          : "no person in shot"
      }; detail ${pct(read.busy)}, brightness ${pct(read.brightness)}`
    );
    lines.push(
      `        type: ${
        best.length
          ? best
              .map((z) => `${z.position} ${pct(z.score)}${z.scrim ? "/scrim" : ""}`)
              .join("  ")
          : "nowhere clean — scrim required"
      }${worst.length ? `   avoid: ${worst.map((z) => z.position).join(", ")}` : ""}`
    );
  }

  /* ----------------------------- across the cut ---------------------------- */
  const withSubject = reads.filter((r) => r.subject);
  const meanX =
    withSubject.length
      ? withSubject.reduce((a, r) => a + (r.subject?.x ?? 0), 0) / withSubject.length
      : 0.5;
  const meanSpread =
    withSubject.length
      ? withSubject.reduce((a, r) => a + (r.subject?.spread ?? 0), 0) / withSubject.length
      : 0;
  const meanBusy = reads.reduce((a, r) => a + r.busy, 0) / reads.length;
  const meanBright = reads.reduce((a, r) => a + r.brightness, 0) / reads.length;

  // The position that is reliably good, rather than the one that is best in a
  // single frame — a caption that clears the subject at 0:03 and lands on his
  // face at 0:11 is a worse choice than one that clears him throughout.
  const totals = new Map<PositionName, { sum: number; worst: number; n: number }>();
  for (const read of reads) {
    for (const zone of read.zones) {
      const entry = totals.get(zone.position) ?? { sum: 0, worst: 1, n: 0 };
      entry.sum += zone.score;
      entry.worst = Math.min(entry.worst, zone.score);
      entry.n += 1;
      totals.set(zone.position, entry);
    }
  }
  const reliable = [...totals.entries()]
    .map(([position, e]) => ({ position, mean: e.sum / e.n, worst: e.worst }))
    // Judged on the worst frame as much as the average: safety is the floor.
    .sort((a, b) => b.worst * 0.6 + b.mean * 0.4 - (a.worst * 0.6 + a.mean * 0.4));

  const counts = new Map<string, number>();
  for (const read of reads) counts.set(read.accent, (counts.get(read.accent) ?? 0) + 1);
  const accent = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#ffd60a";

  lines.push("", "ACROSS THE WHOLE CUT");
  if (withSubject.length >= Math.max(2, reads.length / 2)) {
    const side = meanX < 0.42 ? "left of centre" : meanX > 0.58 ? "right of centre" : "centred";
    lines.push(
      `  The subject sits ${side} (x≈${pct(meanX)}) and fills about ${pct(meanSpread)} of the frame — ${shotSize(meanSpread)}.`
    );
    if (side !== "centred") {
      lines.push(
        `  So the ${meanX < 0.42 ? "right" : "left"} of the frame is the side that stays free: put pictures and callouts there.`
      );
    }
  } else if (withSubject.length === 0) {
    lines.push("  Nobody is in shot in any sampled frame — this is not a talking head, and there is no face to work around.");
  }
  lines.push(
    `  Detail averages ${pct(meanBusy)}${meanBusy > 0.3 ? " — busy footage: every caption needs a scrim or a badge style" : meanBusy < 0.14 ? " — clean footage: type will read without a box" : ""}.`
  );
  lines.push(
    `  Brightness averages ${pct(meanBright)}${meanBright > 0.62 ? " — bright, so dark type or a dark scrim" : meanBright < 0.3 ? " — dark, so white type reads on its own" : ""}.`
  );
  lines.push(
    `  Positions that stay safe all the way through: ${reliable
      .slice(0, 3)
      .map((r) => `${r.position} (worst ${pct(r.worst)})`)
      .join(", ")}.`
  );
  const never = reliable.filter((r) => r.worst < 0.25).slice(-3);
  if (never.length) {
    lines.push(
      `  Positions that fail somewhere: ${never.map((r) => r.position).join(", ")} — do not hold anything there for the whole video.`
    );
  }
  lines.push(`  The accent that stands out against this footage: ${accent}. Use one accent, and use that one.`);

  // The corrective half of a grade is arithmetic once the picture has been
  // measured, and it is the half the agent has always got wrong — it was
  // choosing a look off the *subject* ("a cooking video, so warm") with no idea
  // whether the footage was already warm.
  const grading = describeGradeReading(suggestGrade(reads));
  if (grading) lines.push(grading);

  const cuts = reads.filter((r) => (r.change ?? 0) > 0.35);
  if (cuts.length) {
    lines.push(
      `  The picture changes hard at ${cuts.map((r) => `${r.at.toFixed(1)}s`).join(", ")} — those are the moments a transition, a caption or a sound effect has something to land on.`
    );
  }
  if (aspect < 1) {
    lines.push(
      "  This is a vertical frame: the middle column belongs to the speaker, captions stack rather than run wide, and the corners are not corners."
    );
  }

  return lines.join("\n");
}

/** The read nearest a given second, for the `frame_at` tool. */
export function readNearest<T extends { at: number }>(reads: T[], at: number): T | null {
  if (!reads.length) return null;
  let best = reads[0];
  for (const read of reads) {
    if (Math.abs(read.at - at) < Math.abs(best.at - at)) best = read;
  }
  return best;
}

/** Strip the per-cell grids before a read crosses the wire. */
export function toWire(read: FrameRead): WireFrameRead {
  return {
    at: read.at,
    brightness: read.brightness,
    contrast: read.contrast,
    busy: read.busy,
    subject: read.subject,
    colors: read.colors,
    accent: read.accent,
    zones: read.zones,
    change: read.change,
  };
}
