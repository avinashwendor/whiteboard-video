"use client";

import { composeScene, type Beat, type Prim, type SceneSpec } from "@/lib/whiteboard/scene";
import { COLOURS } from "@/lib/whiteboard/palette";
import {
  clamp,
  clamp01,
  easeInOutCubic,
  easeOutCubic,
  lerp,
  noise1,
  range,
  smootherstep,
} from "@/lib/video/easing";
import { planCues, type Cue, type WordTiming } from "@/lib/video/timing";
import { buildRoughPath, type RoughPath } from "./rough";

/**
 * Drawing a scene, the way a hand would.
 *
 * Three things separate this from a slide that fades in:
 *
 *   1. One stroke at a time. Every shape gets its own slice of its beat, in
 *      order, so the marker is only ever drawing one line -- and the pen can
 *      therefore be *somewhere* rather than nowhere.
 *   2. The pen travels. Between two strokes it lifts, arcs across to the next
 *      start point and comes back down, which is the single biggest reason
 *      hand-drawn video reads as hand-drawn.
 *   3. The narration decides when. Beats are placed by `planCues` against the
 *      real word timings of the voice track, so a drawing appears as it is
 *      being talked about.
 *
 * The frame stays a pure function of time, so the preview, a scrub and every
 * recorded frame agree.
 */

interface PreparedShape {
  kind: "shape";
  rough: RoughPath;
  fill?: string;
  stroke: boolean;
  width: number;
  /** Marker colour for this stroke. Defaults to ink. */
  colour?: string;
  /** Slice of the beat this stroke owns, 0..1. */
  from: number;
  to: number;
}

interface PreparedText {
  kind: "text";
  prim: Extract<Prim, { kind: "text" }>;
  from: number;
  to: number;
}

type PreparedPrim = PreparedShape | PreparedText;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PreparedBeat {
  prims: PreparedPrim[];
  origin: { x: number; y: number };
  box: Box;
  /** Text this beat carries, used to find it in the narration. */
  label: string;
  /** Rough cost of drawing it, in seconds, at a comfortable hand speed. */
  effort: number;
}

export interface PreparedScene {
  beats: PreparedBeat[];
  /** Where the taped photograph goes, when the board made room for one. */
  photoBox: Box | null;
  /**
   * The heading itself, so a highlighter can sweep exactly the words that were
   * written. Measuring it here would mean guessing at the marker face before
   * the canvas has one, so the text is kept and measured at paint time.
   */
  title: Extract<Prim, { kind: "text" }> | null;
}

/* -------------------------------- preparing -------------------------------- */

/** Marker speed in board units per second -- a real hand, not a plotter. */
const INK_SPEED = 900;
const MIN_STROKE = 0.09;
const MAX_STROKE = 0.75;
/** How long the marker takes to cross the board between two strokes. */
const TRAVEL_SECONDS = 1.1;
/**
 * Shortest arc worth drawing.
 *
 * Where strokes are shoulder to shoulder there is no gap to travel in, so the
 * pen borrows this much from the end of the stroke it is leaving. Long enough
 * to read as a movement, short enough that the ink it abandons is already all
 * but complete.
 */
const MIN_TRAVEL = 0.22;

function textBox(prim: Extract<Prim, { kind: "text" }>): Box {
  const width = Math.min(prim.maxWidth, prim.text.length * prim.size * 0.52);
  const x =
    prim.align === "center" ? prim.x - width / 2 : prim.align === "right" ? prim.x - width : prim.x;
  return { x, y: prim.y - prim.size, width, height: prim.size * 1.35 };
}

function union(boxes: Box[]): Box {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const box of boxes) {
    // A path we could not measure contributes nothing. Folding its empty box
    // in would drag the beat's bounds back to the origin and send the camera
    // to the top-left corner of a board it should be centred on.
    if (!(box.width > 0) || !(box.height > 0)) continue;
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }

  if (!Number.isFinite(left)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function labelOf(beat: Beat): string {
  return beat.prims
    .filter((prim): prim is Extract<Prim, { kind: "text" }> => prim.kind === "text")
    .map((prim) => prim.text)
    .join(" ");
}

export function prepareScene(spec: SceneSpec, options: { photo?: boolean } = {}): PreparedScene {
  const composed = composeScene(spec, options);
  const beats: PreparedBeat[] = [];
  let seed = 3;
  let title: Extract<Prim, { kind: "text" }> | null = null;

  composed.beats.forEach((beat, beatIndex) => {
    // Build first, so each stroke's slice can be weighted by its real length.
    const built: Array<{ prim: PreparedPrim; cost: number; box: Box }> = [];

    for (const prim of beat.prims) {
      if (prim.kind === "text") {
        const box = textBox(prim);
        // Writing is slower per pixel than drawing an outline.
        const cost = clamp(prim.text.length * 0.035, 0.28, 1.5);
        built.push({ prim: { kind: "text", prim, from: 0, to: 1 }, cost, box });
        continue;
      }

      const rough = buildRoughPath(prim.d, (seed += 17), prim.crisp);
      if (!rough) continue;

      let box: Box = { x: 0, y: 0, width: 0, height: 0 };
      try {
        const measured = rough.measure.getBBox();
        box = { x: measured.x, y: measured.y, width: measured.width, height: measured.height };
      } catch {
        /* a path we cannot measure simply does not steer the camera */
      }

      built.push({
        prim: {
          kind: "shape",
          rough,
          fill: prim.fill,
          stroke: prim.stroke,
          width: prim.width,
          colour: prim.colour,
          from: 0,
          to: 1,
        },
        cost: clamp(rough.length / INK_SPEED, MIN_STROKE, MAX_STROKE),
        box,
      });
    }

    if (!built.length) return;

    // Slice the beat between its strokes, in drawing order, with a sliver of
    // overlap so the pen never visibly stalls between two of them.
    const effort = built.reduce((sum, entry) => sum + entry.cost, 0);
    let cursor = 0;
    for (const entry of built) {
      const share = entry.cost / effort;
      entry.prim.from = cursor;
      entry.prim.to = Math.min(1, cursor + share * 1.06);
      cursor += share;
    }

    const box = union(built.map((entry) => entry.box));
    if (beatIndex === 0) {
      const first = beat.prims.find(
        (prim): prim is Extract<Prim, { kind: "text" }> => prim.kind === "text",
      );
      title = first ?? null;
    }

    beats.push({
      prims: built.map((entry) => entry.prim),
      origin: beat.origin,
      box,
      label: labelOf(beat),
      effort,
    });
  });

  return { beats, title, photoBox: composed.photoBox };
}

export function disposeScene(scene: PreparedScene) {
  for (const beat of scene.beats) {
    for (const prim of beat.prims) {
      if (prim.kind === "shape") prim.rough.measure.remove();
    }
  }
}

/* ---------------------------------- cues ---------------------------------- */

export interface SceneTiming {
  /** Silence before the voice starts. */
  lead: number;
  /** Length of the narration clip. */
  speech: number;
  /** Hold after the voice stops, before the scene hands over. */
  tail: number;
}

/**
 * Places every beat of a board against the narration.
 *
 * The title always opens the scene; each following beat is pinned to the words
 * that describe it, and anything the narration never names is spread evenly
 * through the room its neighbours leave.
 */
export function planSceneCues(
  scene: PreparedScene,
  words: WordTiming[],
  timing: SceneTiming,
): Cue[] {
  return planCues(
    scene.beats.map((beat, index) => ({
      // The title is the scene opening, not something to hunt for mid-sentence.
      text: index === 0 ? undefined : beat.label,
      minSpan: Math.max(0.5, beat.effort * 0.75),
      maxSpan: Math.max(1.1, beat.effort * 2.1),
      weight: beat.effort,
    })),
    words,
    { lead: timing.lead, speech: timing.speech, tail: timing.tail, preroll: 0.5, minGap: 0.4 },
  );
}

/* --------------------------------- camera --------------------------------- */

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

/**
 * How far the camera commits to the beat it is following.
 *
 * Deliberately small. A board is composed to be read whole at 1280x720, so a
 * camera that truly frames each beat crops the heading straight out of shot.
 * What is wanted is the sense of a hand-held rostrum drifting over the work,
 * not a follow-cam.
 */
const CAMERA_PUSH = 0.18;
const CAMERA_MAX_SCALE = 1.05;

/**
 * A slow push toward whatever is being drawn, easing back out to the whole
 * board once the scene has settled -- so the last thing the viewer sees is the
 * finished picture, entire.
 */
export function sceneCamera(
  scene: PreparedScene,
  cues: Cue[],
  time: number,
  board: { width: number; height: number },
  duration: number,
): Camera {
  if (!scene.beats.length || !cues.length) return { x: 0, y: 0, scale: 1 };

  const targetFor = (index: number): Camera => {
    const box = scene.beats[index]?.box;
    if (!box || box.width <= 0 || box.height <= 0) return { x: 0, y: 0, scale: 1 };
    const fit = Math.min(
      (board.width * 0.62) / Math.max(160, box.width),
      (board.height * 0.62) / Math.max(120, box.height),
    );
    const scale = clamp(lerp(1, clamp(fit, 1, 1.5), CAMERA_PUSH), 1, CAMERA_MAX_SCALE);

    // Panning further than the zoom has cropped would pull the paper's own
    // edge into frame, so the offset is bounded by whatever slack the scale
    // actually bought.
    const slackX = (board.width * (scale - 1)) / (2 * scale);
    const slackY = (board.height * (scale - 1)) / (2 * scale);

    return {
      x: clamp((board.width / 2 - (box.x + box.width / 2)) * CAMERA_PUSH, -slackX, slackX),
      y: clamp((board.height / 2 - (box.y + box.height / 2)) * CAMERA_PUSH, -slackY, slackY),
      scale,
    };
  };

  // Which beat the camera is on, and how far it has travelled toward the next.
  let active = 0;
  for (let i = 0; i < cues.length; i += 1) if (time >= cues[i].at) active = i;

  const from = targetFor(active);
  const next = active + 1 < cues.length ? targetFor(active + 1) : null;
  const handover = next
    ? smootherstep(range(time, cues[active + 1].at - 0.55, cues[active + 1].at + 0.25))
    : 0;

  let camera: Camera = next
    ? {
        x: lerp(from.x, next.x, handover),
        y: lerp(from.y, next.y, handover),
        scale: lerp(from.scale, next.scale, handover),
      }
    : from;

  // Pull back to the whole board for the final beat of the scene.
  const lastCue = cues[cues.length - 1];
  const settle = smootherstep(range(time, lastCue.at + lastCue.span, duration - 0.25));
  camera = {
    x: lerp(camera.x, 0, settle),
    y: lerp(camera.y, 0, settle),
    scale: lerp(camera.scale, 1, settle),
  };

  // A breath of handheld drift keeps a static board from looking frozen.
  const drift = 1 + noise1(time * 0.13, 5) * 0.004;
  const scale = Math.max(1, camera.scale * drift);
  const slackX = (board.width * (scale - 1)) / (2 * scale);
  const slackY = (board.height * (scale - 1)) / (2 * scale);

  return {
    x: clamp(camera.x + noise1(time * 0.22, 11) * 4, -slackX, slackX),
    y: clamp(camera.y + noise1(time * 0.19, 27) * 3, -slackY, slackY),
    scale,
  };
}

/* ---------------------------------- text ---------------------------------- */

function wrap(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  maxLines = 2,
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

/**
 * Writes text on, left to right, and reports where the nib ended up.
 *
 * The clip advances by measured width rather than by character count, so a
 * wide letter takes longer to appear than a narrow one -- which is what makes
 * the reveal look like writing instead of a wipe.
 */
function drawText(
  ctx: CanvasRenderingContext2D,
  prim: Extract<Prim, { kind: "text" }>,
  reveal: number,
  fontHand: string,
): { x: number; y: number; writing: boolean } | null {
  ctx.font = `400 ${prim.size}px ${fontHand}`;
  ctx.fillStyle = prim.colour;
  ctx.textAlign = prim.align;
  ctx.textBaseline = "alphabetic";
  if (prim.tracking) ctx.letterSpacing = `${prim.tracking}px`;

  const lines = wrap(ctx, prim.text, prim.maxWidth, 2);
  const lineHeight = prim.size * 1.12;
  const startY = prim.y - ((lines.length - 1) * lineHeight) / 2;

  const widths = lines.map((entry) => ctx.measureText(entry).width);
  const total = widths.reduce((sum, width) => sum + width, 0) || 1;
  let budget = total * clamp01(reveal);
  let nib: { x: number; y: number; writing: boolean } | null = null;

  lines.forEach((entry, index) => {
    if (budget <= 0) return;
    const width = widths[index];
    const shown = Math.min(width, budget);
    budget -= shown;

    const y = startY + index * lineHeight;
    const left =
      prim.align === "center" ? prim.x - width / 2 : prim.align === "right" ? prim.x - width : prim.x;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left - 4, y - prim.size, shown + 8, prim.size * 1.5);
    ctx.clip();
    ctx.fillText(entry, prim.x, y);
    ctx.restore();

    // Reported whether or not the line is finished: a completed caption is
    // still where the marker was left standing.
    nib = { x: left + shown, y: y - prim.size * 0.18, writing: shown < width - 0.5 };
  });

  if (prim.tracking) ctx.letterSpacing = "0px";
  ctx.textAlign = "left";
  return nib;
}

/* ----------------------------------- pen ---------------------------------- */

/** Realistic dry-erase whiteboard marker, drawn at the active nib. */
export function drawMarkerPen(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  inkColor: string = COLOURS.ink,
  scale = 0.85,
  lift = 0,
) {
  ctx.save();
  ctx.translate(x, y);

  // The shadow drops away from the board as the pen lifts between strokes.
  ctx.save();
  ctx.globalAlpha = 0.15 - lift * 0.06;
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.ellipse(
    (10 + lift * 16) * scale,
    (14 + lift * 12) * scale,
    (16 + lift * 5) * scale,
    (7 + lift * 2) * scale,
    Math.PI / 6,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.translate(-lift * 9 * scale, -lift * 13 * scale);
  ctx.rotate(-Math.PI / 4.2 - lift * 0.12);

  // 1. Chisel nib
  ctx.fillStyle = inkColor;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-4 * scale, -13 * scale);
  ctx.lineTo(4.5 * scale, -15 * scale);
  ctx.lineTo(2.5 * scale, 0);
  ctx.closePath();
  ctx.fill();

  // 2. Plastic collar
  ctx.fillStyle = "#2c3038";
  ctx.beginPath();
  ctx.moveTo(-5.5 * scale, -13 * scale);
  ctx.lineTo(5.5 * scale, -15 * scale);
  ctx.lineTo(8.5 * scale, -30 * scale);
  ctx.lineTo(-8.5 * scale, -30 * scale);
  ctx.closePath();
  ctx.fill();

  // 3. Ink colour ring
  ctx.fillStyle = inkColor;
  ctx.fillRect(-9 * scale, -36 * scale, 18 * scale, 6 * scale);

  // 4. Barrel
  ctx.fillStyle = "#f8f9fa";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(-9.5 * scale, -125 * scale, 19 * scale, 89 * scale);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.fillRect(-6.5 * scale, -120 * scale, 3 * scale, 78 * scale);

  // 5. Cap
  ctx.fillStyle = "#17181c";
  ctx.fillRect(-9.5 * scale, -136 * scale, 19 * scale, 11 * scale);

  ctx.restore();
}

/* --------------------------------- drawing -------------------------------- */

interface Nib {
  x: number;
  y: number;
  color: string;
  /** 0 on the board, 1 fully lifted between two strokes. */
  lift: number;
}

interface StrokeEnd {
  x: number;
  y: number;
  at: number;
}

/**
 * Where the marker is, tracked across the beat loop.
 *
 * A plain `let` would be narrowed to its initial `null` by the time the loop
 * has finished, because the assignments happen inside a callback -- so the pen
 * lives on an object instead.
 */
interface PenState {
  nib: Nib | null;
  lastEnd: StrokeEnd | null;
}

function pointOn(rough: RoughPath, fraction: number): { x: number; y: number } | null {
  if (!(rough.length > 0)) return null;
  try {
    const point = rough.measure.getPointAtLength(rough.length * clamp01(fraction));
    return { x: point.x, y: point.y };
  } catch {
    return null;
  }
}

/**
 * Paints the board at `time`.
 *
 * Each beat runs across its own cue window. Inside a beat the strokes run in
 * sequence, and the marker is placed wherever ink is currently landing -- or,
 * in the gap between two strokes, part-way through its arc to the next one.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: PreparedScene,
  cues: Cue[],
  time: number,
  fontHand: string,
) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const pen: PenState = { nib: null, lastEnd: null };
  /**
   * Start fraction of the stroke the pen is currently following.
   *
   * Prims overlap by design, so more than one can be mid-draw. Whichever came
   * later in the array used to win by accident; the hand follows the stroke
   * that started most recently instead, which is the one a person would be
   * drawing.
   */
  let newest = -Infinity;

  scene.beats.forEach((beat, beatIndex) => {
    const cue = cues[beatIndex];
    if (!cue || time < cue.at) return;

    const local = clamp01((time - cue.at) / Math.max(0.001, cue.span));

    // Beats arrive with a small rise rather than snapping into place.
    const settle = smootherstep(range(local, 0, 0.22));
    ctx.save();
    ctx.globalAlpha = lerp(0.3, 1, settle);
    ctx.translate(0, (1 - settle) * 10);

    for (const prim of beat.prims) {
      const slice = range(local, prim.from, prim.to);
      if (slice <= 0) continue;

      if (prim.kind === "text") {
        // A pen accelerating into a word and easing out of it.
        const written = drawText(ctx, prim.prim, easeInOutCubic(slice), fontHand);
        if (written?.writing && slice < 1 && prim.from >= newest) {
          newest = prim.from;
          pen.nib = { x: written.x, y: written.y + (1 - settle) * 10, color: COLOURS.ink, lift: 0 };
          pen.lastEnd = null;
        } else if (written) {
          pen.lastEnd = { x: written.x, y: written.y, at: cue.at + prim.to * cue.span };
        }
        continue;
      }

      const { rough } = prim;
      const drawn = easeInOutCubic(slice);

      if (prim.fill) {
        const flood = range(drawn, 0.45, 1);
        if (flood > 0) {
          const previous = ctx.globalAlpha;
          ctx.globalAlpha = previous * easeOutCubic(flood);
          ctx.fillStyle = prim.fill;
          ctx.fill(rough.fillPath);
          ctx.globalAlpha = previous;
        }
      }

      if (prim.stroke) {
        ctx.strokeStyle = prim.colour ?? COLOURS.ink;
        ctx.lineWidth = prim.width;
        if (drawn >= 1) {
          ctx.setLineDash([]);
        } else {
          ctx.setLineDash([rough.length, rough.length]);
          ctx.lineDashOffset = rough.length * (1 - drawn);

          const point = pointOn(rough, drawn);
          if (point && drawn > 0.005 && prim.from >= newest) {
            newest = prim.from;
            pen.nib = {
              x: point.x,
              y: point.y + (1 - settle) * 10,
              color: prim.colour ?? prim.fill ?? COLOURS.ink,
              lift: 0,
            };
            pen.lastEnd = null;
          }
        }
        ctx.stroke(rough.outline);
        ctx.setLineDash([]);
      }

      // Remember where this stroke finished, so the pen can travel from it.
      if (drawn >= 1) {
        const end = pointOn(rough, 1);
        if (end) pen.lastEnd = { x: end.x, y: end.y, at: cue.at + prim.to * cue.span };
      }
    }

    ctx.restore();
  });

  /*
   * The marker between strokes.
   *
   * Two things used to go wrong here. Prims tile a beat back to back with a
   * sliver of overlap, so there was never a frame with nothing inking — which
   * meant this whole block was unreachable inside a beat and the nib simply
   * jumped from the end of one stroke to the start of the next. And during
   * that overlap two prims were live at once, so whichever came later in the
   * array won, and the pen snapped forward before the first had finished.
   *
   * Now the pen leaves a stroke slightly before its ink ends and arrives at
   * the next one exactly as it begins, borrowing the lead-in from the tail of
   * the stroke it is leaving when there is no real gap. Still a pure function
   * of time — no velocity, no springs — because `drawScene` is what the
   * exporter calls, frame by frame, out of order.
   */
  const travel = nextStroke(scene, cues, time);
  const resting = pen.lastEnd;

  if (travel && resting && time < travel.at) {
    // Never eat more of the outgoing stroke than it can spare.
    const spare = Math.max(0, travel.at - resting.at);
    const lead = Math.min(TRAVEL_SECONDS, Math.max(MIN_TRAVEL, spare));
    const from = travel.at - lead;

    if (time >= from) {
      const t = smootherstep(range(time, from, travel.at));
      pen.nib = {
        x: lerp(pen.nib?.x ?? resting.x, travel.x, t),
        // An arc, not a slide: the marker comes off the board and back down.
        y: lerp(pen.nib?.y ?? resting.y, travel.y, t) - Math.sin(t * Math.PI) * 46,
        color: COLOURS.ink,
        lift: Math.sin(t * Math.PI),
      };
    }
  }

  if (pen.nib) drawMarkerPen(ctx, pen.nib.x, pen.nib.y, pen.nib.color, 0.85, pen.nib.lift);
}

/** Where the next stroke of the scene begins, and when. */
function nextStroke(
  scene: PreparedScene,
  cues: Cue[],
  time: number,
): StrokeEnd | null {
  for (let beatIndex = 0; beatIndex < scene.beats.length; beatIndex += 1) {
    const cue = cues[beatIndex];
    if (!cue) continue;
    for (const prim of scene.beats[beatIndex].prims) {
      const startsAt = cue.at + prim.from * cue.span;
      if (startsAt <= time) continue;

      if (prim.kind === "text") {
        const box = textBox(prim.prim);
        return { x: box.x, y: box.y + box.height * 0.8, at: startsAt };
      }
      const point = pointOn(prim.rough, 0);
      if (point) return { x: point.x, y: point.y, at: startsAt };
    }
  }
  return null;
}

/**
 * A highlighter pass across the heading, once it has been written.
 *
 * It is a small thing that does a lot: the eye is told where the scene's point
 * is, in a gesture nobody would mistake for a computer.
 */
export function drawTitleHighlight(
  ctx: CanvasRenderingContext2D,
  scene: PreparedScene,
  cues: Cue[],
  time: number,
  fontHand: string,
) {
  const title = scene.title;
  const cue = cues[0];
  if (!title || !cue) return;

  const from = cue.at + cue.span + 0.35;
  const sweep = smootherstep(range(time, from, from + 0.55));
  if (sweep <= 0) return;

  ctx.save();
  ctx.font = `400 ${title.size}px ${fontHand}`;
  if (title.tracking) ctx.letterSpacing = `${title.tracking}px`;
  const lines = wrap(ctx, title.text, title.maxWidth, 2);
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width));
  if (title.tracking) ctx.letterSpacing = "0px";

  const left =
    title.align === "center"
      ? title.x - width / 2
      : title.align === "right"
        ? title.x - width
        : title.x;
  const lineHeight = title.size * 1.12;
  const baseline = title.y + ((lines.length - 1) * lineHeight) / 2;

  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = COLOURS.yellow;

  // A marker stroke under the words, not a block behind them: it sits low,
  // runs slightly past the text at each end, and is drawn on a small slant.
  const pad = 12;
  const height = Math.min(title.size * 0.34, 26);
  ctx.translate(left - pad, baseline - height * 0.28);
  ctx.rotate((-0.5 * Math.PI) / 180);
  ctx.beginPath();
  ctx.roundRect(0, 0, (width + pad * 2) * sweep, height, height / 2);
  ctx.fill();
  ctx.restore();
}
