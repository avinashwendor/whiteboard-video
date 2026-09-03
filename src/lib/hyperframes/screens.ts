import { BOARD_HEIGHT, BOARD_WIDTH } from "@/lib/whiteboard/scene";
import {
  clamp,
  clamp01,
  easeOutBack,
  easeOutCubic,
  easeOutQuint,
  lerp,
  range,
  smootherstep,
} from "@/lib/video/easing";
import { withAlpha } from "@/lib/video/grade";
import type { Theme } from "./theme";
import {
  cascade,
  drawBloom,
  drawBrackets,
  drawConnector,
  drawGhostNumeral,
  drawGhostType,
  drawNode,
  drawSectionMark,
  drawSurface,
  squirclePath,
  sway,
  type Point,
} from "./surface";
import {
  countUp,
  drawBodyLines,
  drawDisplay,
  layoutDisplay,
  wrapAt,
} from "./type";
import {
  CONTENT_WIDTH,
  MARGIN,
  SAFE_BOTTOM,
  display,
  drawMark,
  drawRule,
  eyebrowFor,
  pictureOf,
  poster,
  staggered,
  type ModernPlan,
  type ModernRenderOptions,
  type ModernRenderScene,
} from "./stage";

/**
 * The screen library.
 *
 * Twenty-three compositions beyond the original set, and the reason there are
 * this many is not variety for its own sake. A scene is now cut into two,
 * three or four panels, each of which needs its own screen -- so a six-scene
 * film asks for eighteen of these, and a library of eleven would have every
 * film repeating itself twice over before the halfway mark.
 *
 * Each one is written for a *job*: a ranked hierarchy is a pyramid, a filter
 * that loses people at each step is a funnel, two things that share something
 * is a venn. Choosing by job rather than by looks is what stops the engine
 * putting a process rail under content that is not a process, which is the
 * single most common way generated video stops meaning anything.
 *
 * Every screen obeys the same three house rules. Nothing crosses `SAFE_BOTTOM`
 * -- the subtitle band lives below it. Everything arrives on a cue rather than
 * on a timer, so the picture changes on the word that describes it. And the
 * accent is used once: one plate, one dot, or one rule, never all three.
 */

type Shot = (
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) => void;

/** The cue for the nth item, falling back to the heading's. */
function beat(plan: ModernPlan, index: number) {
  return plan.beats[index] ?? plan.heading;
}

/** The heading, laid and drawn in the house way, returning its block height. */
function heading(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
  box: { x: number; y: number; width: number; align: "left" | "center"; size?: number; lines?: number },
) {
  const laid = layoutDisplay(ctx, scene.heading, {
    family: display(options),
    maxWidth: box.width,
    maxSize: box.size ?? 54,
    minSize: 26,
    weight: 800,
    maxLines: box.lines ?? 2,
    lineRatio: 1.08,
    emphasis: scene.keywords,
  });
  drawDisplay(ctx, laid, {
    x: box.x,
    y: box.y,
    align: box.align,
    theme,
    shadow: theme.finish !== "print",
    reveal: staggered(plan.heading, laid.count, options.time, 0.06),
  });
  return laid.height;
}

/** The section label every screen wears in the top-left. */
function label(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  theme: Theme,
  options: ModernRenderOptions,
  text?: string,
) {
  drawSectionMark(ctx, theme, MARGIN * 0.7, 74, text ?? eyebrowFor(scene), {
    family: options.fontSans,
    progress: range(options.time, 0.05, 0.6),
    width: BOARD_WIDTH - MARGIN * 0.7,
  });
}

/* ================================= titles ================================= */

/**
 * THE QUOTE — someone's own words, and the marks that say they are quoted.
 *
 * The oversized quotation mark is doing structural work, not decoration: it
 * tells the eye where the sentence starts before a single word is read, which
 * is what lets the type itself be set without any label above it.
 */
const shotQuote: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const enter = smootherstep(range(time, 0, 0.7));

  ctx.save();
  ctx.globalAlpha = enter * 0.5;
  ctx.font = `900 340px ${display(options)}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = withAlpha(theme.mark, 0.5);
  ctx.fillText("“", MARGIN * 0.55, 300);
  ctx.restore();

  const laid = layoutDisplay(ctx, scene.heading, {
    family: display(options),
    maxWidth: CONTENT_WIDTH * 0.92,
    maxSize: 64,
    minSize: 32,
    weight: 700,
    maxLines: 4,
    lineRatio: 1.2,
    emphasis: scene.keywords,
  });
  const top = BOARD_HEIGHT * 0.44 - laid.height / 2 + laid.size;
  drawDisplay(ctx, laid, {
    x: MARGIN + 40,
    y: top,
    align: "left",
    theme,
    shadow: theme.finish !== "print",
    reveal: staggered(plan.heading, laid.count, time, 0.055),
  });

  const attribution = scene.bullets[0];
  if (attribution) {
    const cue = beat(plan, 0);
    drawRule(ctx, theme, MARGIN + 40, top + (laid.lines.length - 1) * laid.lineHeight + 44, 54, range(time, cue.at, cue.at + 0.4), 4);
    drawBodyLines(ctx, [attribution], {
      x: MARGIN + 40,
      y: top + (laid.lines.length - 1) * laid.lineHeight + 92,
      align: "left",
      theme,
      family: options.fontSans,
      size: 24,
      lineHeight: 32,
      reveal: range(time, cue.at + 0.15, cue.at + 0.6),
    });
  }
};

/**
 * THE WORD — one word, as large as the frame will take.
 *
 * For the term a whole scene turns on. It works precisely because it refuses
 * to explain itself: the narration is doing that, and a definition set under
 * the word would halve its size for no gain.
 */
const shotBigWord: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const word = scene.heading.split(/\s+/).filter(Boolean).slice(0, 2);

  drawGhostType(ctx, word.join(" "), {
    lines: word,
    family: poster(options),
    colour: theme.dark ? withAlpha(theme.ink, 0.9) : withAlpha(theme.ink, 0.92),
    at: 0.46,
    span: word.length > 1 ? 0.92 : 0.7,
    time,
    drift: 0.3,
    progress: smootherstep(range(time, plan.heading.at, plan.heading.at + 0.75)),
  });

  const caption = scene.bullets[0];
  if (caption) {
    const cue = beat(plan, 0);
    drawBodyLines(ctx, wrapAt(ctx, caption, options.fontSans, 26, CONTENT_WIDTH * 0.6, 2), {
      x: BOARD_WIDTH / 2,
      y: SAFE_BOTTOM - 40,
      align: "center",
      theme,
      family: options.fontSans,
      size: 26,
      lineHeight: 36,
      reveal: range(time, cue.at, cue.at + 0.5),
    });
  }
  label(ctx, scene, theme, options);
};

/**
 * THE CHAPTER — a number, a label, and a rule.
 *
 * The cheapest screen in the library and one of the most useful: it gives a
 * long film a spine. A viewer who knows they are on part three of five will
 * sit through part three.
 */
const shotChapter: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const number = String(scene.index + 1).padStart(2, "0");
  const enter = range(time, plan.heading.at, plan.heading.at + 0.8);

  drawGhostNumeral(ctx, number, BOARD_WIDTH / 2, BOARD_HEIGHT * 0.36, 300, {
    family: display(options),
    colour: withAlpha(theme.ink, 0.16),
    align: "center",
    progress: enter,
  });

  drawRule(ctx, theme, BOARD_WIDTH / 2 - 60, BOARD_HEIGHT * 0.52, 120, range(time, plan.heading.at + 0.2, plan.heading.at + 0.7), 5);

  const laid = layoutDisplay(ctx, scene.heading, {
    family: display(options),
    maxWidth: CONTENT_WIDTH * 0.8,
    maxSize: 58,
    minSize: 30,
    weight: 800,
    maxLines: 2,
    lineRatio: 1.08,
  });
  drawDisplay(ctx, laid, {
    x: BOARD_WIDTH / 2,
    y: BOARD_HEIGHT * 0.52 + 78,
    align: "center",
    theme,
    shadow: false,
    reveal: staggered(plan.heading, laid.count, time, 0.06),
  });
};

/* ================================= numbers ================================ */

/** The number itself, set as large as it will go and counting up to its value. */
function bigNumber(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  theme: Theme,
  options: ModernRenderOptions,
  progress: number,
  align: CanvasTextAlign = "center",
) {
  const t = clamp01(progress);
  if (t <= 0.001) return;
  ctx.save();
  ctx.font = `900 ${size}px ${display(options)}`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = `${-size * 0.035}px`;
  // Counting is the whole point: a number that simply appears is a label, and
  // a number that climbs is an event.
  ctx.fillStyle = theme.finish === "print" ? theme.ink : chromeOrInk(ctx, theme, y, size);
  ctx.globalAlpha = easeOutCubic(clamp01(t * 3));
  ctx.fillText(countUp(value, t), x, y);
  ctx.letterSpacing = "0px";
  ctx.restore();
}

/** Metal on the dark finishes, ink everywhere else. */
function chromeOrInk(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  baseline: number,
  size: number,
): string | CanvasGradient {
  if (theme.finish === "print" || !theme.dark) return theme.ink;
  return chromeFillLocal(ctx, theme, baseline - size * 0.86, size * 1.05);
}

function chromeFillLocal(
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

/**
 * THREE NUMBERS — figures that belong together, given equal weight.
 *
 * Equal weight is the design. The moment one is bigger than the others the
 * frame is making an argument about which matters, and if that argument is
 * the point then it wanted a single metric screen instead.
 */
const shotMetricTrio: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const figures = [scene.stat ?? "", ...scene.bullets].filter(Boolean).slice(0, 3);
  const width = CONTENT_WIDTH / Math.max(1, figures.length);

  figures.forEach((figure, index) => {
    const cue = index === 0 ? (plan.stat ?? plan.heading) : beat(plan, index - 1);
    const t = range(time, cue.at, cue.at + 1);
    const x = MARGIN + width * index + width / 2;

    // Split "84% of failures" into the number and what it measures.
    const match = figure.match(/^([^\sA-Za-z]*[\d][\d.,]*\s*[%x×+]*)\s*(.*)$/);
    const value = match?.[1]?.trim() || figure;
    const caption = match?.[2]?.trim() || (index === 0 ? scene.statCaption : "");

    bigNumber(ctx, value, x, BOARD_HEIGHT * 0.5, 108, theme, options, t);
    if (caption) {
      drawBodyLines(ctx, wrapAt(ctx, caption, options.fontSans, 21, width - 40, 2), {
        x,
        y: BOARD_HEIGHT * 0.5 + 52,
        align: "center",
        theme,
        family: options.fontSans,
        size: 21,
        lineHeight: 28,
        reveal: range(time, cue.at + 0.35, cue.at + 0.8),
      });
    }
    if (index > 0) {
      ctx.save();
      ctx.globalAlpha = clamp01(t);
      ctx.strokeStyle = theme.hairline;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(MARGIN + width * index, BOARD_HEIGHT * 0.5 - 92);
      ctx.lineTo(MARGIN + width * index, BOARD_HEIGHT * 0.5 + 82);
      ctx.stroke();
      ctx.restore();
    }
  });

  heading(ctx, scene, plan, theme, options, {
    x: BOARD_WIDTH / 2,
    y: 188,
    width: CONTENT_WIDTH * 0.8,
    align: "center",
    size: 44,
    lines: 2,
  });
  label(ctx, scene, theme, options);
};

/** Reads a 0-100 value out of "84%", "3.4x", "seven of ten". */
function shareOf(stat: string | undefined): number {
  if (!stat) return 0.62;
  const number = Number.parseFloat(stat.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(number)) return 0.62;
  if (stat.includes("%")) return clamp(number / 100, 0, 1);
  if (/x|×/i.test(stat)) return clamp(number / 10, 0.08, 1);
  return clamp(number > 1 ? number / 100 : number, 0.05, 1);
}

/**
 * THE DIAL — a value as an arc filling round.
 *
 * An arc reads as a proportion faster than a numeral does, so the numeral in
 * the middle is confirmation rather than the message. Drawn as three quarters
 * of a circle rather than a full ring: a closed ring reads as "complete" no
 * matter what fraction of it is coloured.
 */
const shotGauge: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const cue = plan.stat ?? plan.heading;
  const t = easeOutQuint(range(time, cue.at, cue.at + 1.3));
  const share = shareOf(scene.stat);

  const cx = BOARD_WIDTH / 2;
  const cy = BOARD_HEIGHT * 0.48;
  const radius = 150;
  const from = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 22;

  ctx.strokeStyle = withAlpha(theme.ink, 0.12);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, from, from + sweep);
  ctx.stroke();

  if (t > 0.001) {
    if (theme.finish !== "print") drawBloom(ctx, cx, cy, radius * 1.5, theme.accent, 0.22 * t);
    ctx.strokeStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, from, from + sweep * share * t);
    ctx.stroke();
  }
  ctx.restore();

  bigNumber(ctx, scene.stat ?? "", cx, cy + 26, 92, theme, options, t);
  if (scene.statCaption) {
    drawBodyLines(ctx, [scene.statCaption], {
      x: cx,
      y: cy + 76,
      align: "center",
      theme,
      family: options.fontSans,
      size: 22,
      lineHeight: 30,
      reveal: range(time, cue.at + 0.5, cue.at + 1),
    });
  }

  heading(ctx, scene, plan, theme, options, {
    x: BOARD_WIDTH / 2,
    y: 176,
    width: CONTENT_WIDTH * 0.76,
    align: "center",
    size: 42,
    lines: 2,
  });
};

/**
 * THE BAR — how far along, with the two ends named.
 *
 * Named ends are what make this different from a loading indicator: "2019" to
 * "today", "nothing" to "everything". Without them a filled bar says only
 * that some quantity exists.
 */
const shotProgress: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const cue = plan.stat ?? plan.heading;
  const t = easeOutQuint(range(time, cue.at, cue.at + 1.2));
  const share = shareOf(scene.stat);

  const track = { x: MARGIN, y: BOARD_HEIGHT * 0.5 - 17, width: CONTENT_WIDTH, height: 34 };

  ctx.save();
  ctx.fillStyle = withAlpha(theme.ink, 0.1);
  squirclePath(ctx, track, [17, 17, 17, 17]);
  ctx.fill();
  ctx.restore();

  if (t > 0.001) {
    ctx.save();
    squirclePath(ctx, { ...track, width: Math.max(track.height, track.width * share * t) }, [17, 17, 17, 17]);
    ctx.fillStyle = theme.accent;
    ctx.fill();
    ctx.restore();
  }

  bigNumber(
    ctx,
    scene.stat ?? "",
    track.x + Math.max(track.height, track.width * share * t),
    track.y - 34,
    76,
    theme,
    options,
    t,
    "center",
  );

  const ends = [scene.bullets[0], scene.bullets[1]];
  ends.forEach((text, index) => {
    if (!text) return;
    drawBodyLines(ctx, [text], {
      x: index === 0 ? track.x : track.x + track.width,
      y: track.y + track.height + 42,
      align: "left",
      theme,
      family: options.fontSans,
      size: 21,
      lineHeight: 28,
      reveal: range(time, beat(plan, index).at, beat(plan, index).at + 0.5),
    });
  });

  heading(ctx, scene, plan, theme, options, {
    x: MARGIN,
    y: 176,
    width: CONTENT_WIDTH * 0.8,
    align: "left",
    size: 44,
    lines: 2,
  });
  label(ctx, scene, theme, options);
};

/**
 * BARS — quantities ranked against each other.
 *
 * Sorted as written rather than by value, because the order the narration
 * says them in is the order the viewer is following. Re-sorting by size is
 * correct in a report and wrong in a film.
 */
const shotBars: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const items = scene.bullets.slice(0, 5);
  const base = SAFE_BOTTOM - 70;
  const top = 250;
  const slot = CONTENT_WIDTH / Math.max(1, items.length);
  const width = Math.min(120, slot * 0.5);

  items.forEach((item, index) => {
    const cue = beat(plan, index);
    const t = easeOutQuint(range(time, cue.at, cue.at + 0.8));
    // Descending by position, so the shape reads even when the labels do not
    // carry numbers of their own.
    const share = 1 - index * (0.62 / Math.max(1, items.length));
    const height = (base - top) * share * t;
    const x = MARGIN + slot * index + slot / 2 - width / 2;

    if (height > 1) {
      ctx.save();
      squirclePath(ctx, { x, y: base - height, width, height }, [10, 10, 0, 0]);
      ctx.fillStyle = index === 0 ? theme.accent : withAlpha(theme.ink, 0.26);
      ctx.fill();
      ctx.restore();
    }

    drawBodyLines(ctx, wrapAt(ctx, item, options.fontSans, 19, slot - 18, 2), {
      x: x + width / 2,
      y: base + 34,
      align: "center",
      theme,
      family: options.fontSans,
      size: 19,
      lineHeight: 25,
      reveal: range(time, cue.at + 0.2, cue.at + 0.7),
    });
  });

  ctx.save();
  ctx.strokeStyle = theme.hairline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(MARGIN, base + 0.5);
  ctx.lineTo(BOARD_WIDTH - MARGIN, base + 0.5);
  ctx.stroke();
  ctx.restore();

  heading(ctx, scene, plan, theme, options, {
    x: MARGIN,
    y: 176,
    width: CONTENT_WIDTH * 0.8,
    align: "left",
    size: 42,
    lines: 2,
  });
  label(ctx, scene, theme, options);
};

/**
 * THE RING — a part of a whole.
 *
 * A ring rather than a pie, and only the first segment in the accent: a pie
 * chart in five colours is five arguments, and a scene makes one.
 */
const shotDonut: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const items = scene.bullets.slice(0, 4);
  const cx = BOARD_WIDTH * 0.34;
  const cy = BOARD_HEIGHT * 0.5;
  const radius = 138;

  const shares = items.map((_, index) => 1 / Math.max(1, items.length) + (index === 0 ? 0.12 : -0.04));
  const total = shares.reduce((sum, value) => sum + value, 0) || 1;

  let angle = -Math.PI / 2;
  items.forEach((item, index) => {
    const cue = beat(plan, index);
    const t = easeOutQuint(range(time, cue.at, cue.at + 0.7));
    const span = (shares[index] / total) * Math.PI * 2;

    if (t > 0.001) {
      ctx.save();
      ctx.lineWidth = 46;
      ctx.strokeStyle = index === 0 ? theme.accent : withAlpha(theme.ink, 0.14 + index * 0.08);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, angle, angle + span * t);
      ctx.stroke();
      ctx.restore();
    }

    const y = cy - (items.length - 1) * 27 + index * 54;
    ctx.save();
    ctx.globalAlpha = clamp01(t);
    ctx.fillStyle = index === 0 ? theme.accent : withAlpha(theme.ink, 0.3 + index * 0.1);
    ctx.beginPath();
    ctx.arc(BOARD_WIDTH * 0.6, y - 6, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawBodyLines(ctx, wrapAt(ctx, item, options.fontSans, 23, CONTENT_WIDTH * 0.34, 2), {
      x: BOARD_WIDTH * 0.6 + 24,
      y,
      align: "left",
      theme,
      family: options.fontSans,
      size: 23,
      lineHeight: 30,
      colour: theme.ink,
      reveal: range(time, cue.at + 0.2, cue.at + 0.7),
    });
    angle += span;
  });

  if (scene.stat) {
    bigNumber(ctx, scene.stat, cx, cy + 20, 68, theme, options, range(time, plan.heading.at, plan.heading.at + 1));
  }

  heading(ctx, scene, plan, theme, options, {
    x: MARGIN,
    y: 168,
    width: CONTENT_WIDTH * 0.7,
    align: "left",
    size: 40,
    lines: 1,
  });
  label(ctx, scene, theme, options);
};

/* ================================ sequences =============================== */

/**
 * THE TIMELINE — points along a line.
 *
 * The line is drawn once, left to right, and the points arrive on it. Drawing
 * the line per-point instead makes each step look independent, which is the
 * opposite of what a timeline is claiming.
 */
const shotTimeline: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const items = scene.bullets.slice(0, 5);
  const y = BOARD_HEIGHT * 0.46;
  const from = MARGIN + 30;
  const to = BOARD_WIDTH - MARGIN - 30;
  const draw = easeOutQuint(range(time, plan.heading.at, plan.heading.at + 1.1));

  ctx.save();
  ctx.strokeStyle = withAlpha(theme.ink, 0.24);
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from, y);
  ctx.lineTo(lerp(from, to, draw), y);
  ctx.stroke();
  ctx.restore();

  const step = items.length > 1 ? (to - from) / (items.length - 1) : 0;
  items.forEach((item, index) => {
    const cue = beat(plan, index);
    const t = range(time, cue.at, cue.at + 0.7);
    if (t <= 0.001) return;
    const x = items.length > 1 ? from + step * index : (from + to) / 2;
    const above = index % 2 === 0;

    ctx.save();
    ctx.globalAlpha = clamp01(t * 1.6);
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(x, y, 9 * easeOutBack(clamp01(t), 1.6), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(theme.ink, 0.28);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + (above ? -14 : 14));
    ctx.lineTo(x, y + (above ? -44 : 44) * easeOutCubic(clamp01(t)));
    ctx.stroke();
    ctx.restore();

    drawBodyLines(ctx, wrapAt(ctx, item, options.fontSans, 21, Math.max(120, step - 24), 3), {
      x,
      y: y + (above ? -64 : 92),
      align: "center",
      theme,
      family: options.fontSans,
      size: 21,
      lineHeight: 28,
      colour: theme.ink,
      reveal: range(time, cue.at + 0.15, cue.at + 0.65),
    });
  });

  heading(ctx, scene, plan, theme, options, {
    x: MARGIN,
    y: 172,
    width: CONTENT_WIDTH * 0.72,
    align: "left",
    size: 42,
    lines: 1,
  });
  label(ctx, scene, theme, options);
};

/**
 * THE LOOP — stages that come back round.
 *
 * The arrows between the stages point the way round, which is the only thing
 * separating a cycle from a ring of unrelated items. Laid out clockwise from
 * the top, where a viewer starts reading a circle.
 */
const shotCycle: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const items = scene.bullets.slice(0, 5);
  const cx = BOARD_WIDTH / 2;
  const cy = BOARD_HEIGHT * 0.5;
  const radius = 132;

  items.forEach((item, index) => {
    const cue = beat(plan, index);
    const t = range(time, cue.at, cue.at + 0.7);
    const angle = -Math.PI / 2 + (index / Math.max(1, items.length)) * Math.PI * 2;
    const next = -Math.PI / 2 + ((index + 1) / Math.max(1, items.length)) * Math.PI * 2;

    // The arc to the next stage, drawn before the node so it sits behind it.
    if (t > 0.2 && items.length > 1) {
      ctx.save();
      ctx.strokeStyle = withAlpha(theme.ink, 0.22);
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, angle + 0.28, lerp(angle + 0.28, next - 0.28, easeOutCubic(clamp01((t - 0.2) / 0.6))));
      ctx.stroke();
      ctx.restore();
    }

    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    drawNode(ctx, x, y, String(index + 1), theme, {
      family: display(options),
      radius: 22,
      enter: t,
      colour: index === 0 ? theme.accent : theme.accentAlt,
    });

    const outward = 1.62;
    drawBodyLines(ctx, wrapAt(ctx, item, options.fontSans, 19, 190, 2), {
      x: cx + Math.cos(angle) * radius * outward,
      y: cy + Math.sin(angle) * radius * outward + 6,
      align: "center",
      theme,
      family: options.fontSans,
      size: 19,
      lineHeight: 25,
      colour: theme.ink,
      reveal: range(time, cue.at + 0.2, cue.at + 0.7),
    });
  });

  heading(ctx, scene, plan, theme, options, {
    x: BOARD_WIDTH / 2,
    y: 158,
    width: CONTENT_WIDTH * 0.5,
    align: "center",
    size: 36,
    lines: 2,
  });
};

/**
 * THE FUNNEL — stages that lose something at every step.
 *
 * Each band is narrower than the one above it, and that narrowing *is* the
 * argument. Equal-width bands would be a list; this shape says attrition
 * before a word of it is read.
 */
const shotFunnel: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const items = scene.bullets.slice(0, 5);
  const top = 236;
  const bandHeight = Math.min(74, (SAFE_BOTTOM - top - 24) / Math.max(1, items.length));
  const widest = CONTENT_WIDTH * 0.62;

  items.forEach((item, index) => {
    const cue = beat(plan, index);
    const t = easeOutQuint(range(time, cue.at, cue.at + 0.65));
    if (t <= 0.001) return;

    const shrink = 1 - (index / Math.max(1, items.length)) * 0.55;
    const width = widest * shrink;
    const y = top + index * (bandHeight + 10);
    const x = BOARD_WIDTH * 0.42 - width / 2;

    ctx.save();
    ctx.globalAlpha = clamp01(t * 1.4);
    // A trapezoid, not a rectangle: the sides slope in toward the next band.
    const nextWidth = widest * (1 - ((index + 1) / Math.max(1, items.length)) * 0.55);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.lineTo(BOARD_WIDTH * 0.42 + nextWidth / 2, y + bandHeight);
    ctx.lineTo(BOARD_WIDTH * 0.42 - nextWidth / 2, y + bandHeight);
    ctx.closePath();
    ctx.fillStyle = index === 0 ? theme.accent : withAlpha(theme.accent, 0.7 - index * 0.13);
    ctx.fill();
    ctx.restore();

    drawBodyLines(ctx, wrapAt(ctx, item, options.fontSans, 21, CONTENT_WIDTH * 0.3, 2), {
      x: BOARD_WIDTH * 0.42 + widest / 2 + 40,
      y: y + bandHeight * 0.62,
      align: "left",
      theme,
      family: options.fontSans,
      size: 21,
      lineHeight: 27,
      colour: theme.ink,
      reveal: range(time, cue.at + 0.15, cue.at + 0.6),
    });
  });

  heading(ctx, scene, plan, theme, options, {
    x: MARGIN,
    y: 172,
    width: CONTENT_WIDTH * 0.7,
    align: "left",
    size: 40,
    lines: 1,
  });
  label(ctx, scene, theme, options);
};

/**
 * THE PYRAMID — a ranked hierarchy, widest at the base.
 *
 * Built from the bottom up as the narration climbs it, because a hierarchy
 * assembled top-down implies the apex came first, and the whole claim of a
 * pyramid is that it rests on what is underneath.
 */
const shotPyramid: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const items = scene.bullets.slice(0, 4);
  const rows = items.length;
  const base = SAFE_BOTTOM - 40;
  const height = Math.min(70, (base - 240) / Math.max(1, rows));
  const widest = CONTENT_WIDTH * 0.56;

  items.forEach((item, index) => {
    // Item 0 is the apex in the script's order, so it is drawn at the top and
    // revealed last; the rows fill upward.
    const fromBottom = rows - 1 - index;
    const cue = beat(plan, index);
    const t = easeOutQuint(range(time, cue.at, cue.at + 0.6));
    if (t <= 0.001) return;

    const y = base - (fromBottom + 1) * height;
    const scale = (fromBottom + 1) / rows;
    const width = widest * scale;
    const x = BOARD_WIDTH * 0.42 - width / 2;
    const narrower = widest * (fromBottom / rows);

    ctx.save();
    ctx.globalAlpha = clamp01(t * 1.4);
    ctx.beginPath();
    ctx.moveTo(BOARD_WIDTH * 0.42 - narrower / 2, y);
    ctx.lineTo(BOARD_WIDTH * 0.42 + narrower / 2, y);
    ctx.lineTo(x + width, y + height - 6);
    ctx.lineTo(x, y + height - 6);
    ctx.closePath();
    ctx.fillStyle = index === 0 ? theme.accent : withAlpha(theme.ink, 0.14 + fromBottom * 0.06);
    ctx.fill();
    ctx.restore();

    drawBodyLines(ctx, wrapAt(ctx, item, options.fontSans, 20, CONTENT_WIDTH * 0.32, 2), {
      x: BOARD_WIDTH * 0.42 + widest / 2 + 36,
      y: y + height * 0.55,
      align: "left",
      theme,
      family: options.fontSans,
      size: 20,
      lineHeight: 26,
      colour: theme.ink,
      reveal: range(time, cue.at + 0.15, cue.at + 0.6),
    });
  });

  heading(ctx, scene, plan, theme, options, {
    x: MARGIN,
    y: 170,
    width: CONTENT_WIDTH * 0.7,
    align: "left",
    size: 40,
    lines: 1,
  });
  label(ctx, scene, theme, options);
};

/**
 * THE ROADMAP — phases on a track, running left to right.
 *
 * The track is continuous and the markers sit on it, so the gaps between
 * phases read as duration rather than as separation. Alternating the cards
 * above and below keeps four phases legible in a frame that would not hold
 * four side by side.
 */
const shotRoadmap: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const items = scene.bullets.slice(0, 4);
  const y = BOARD_HEIGHT * 0.47;
  const from = MARGIN;
  const to = BOARD_WIDTH - MARGIN;

  ctx.save();
  ctx.strokeStyle = withAlpha(theme.ink, 0.16);
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from, y);
  ctx.lineTo(to, y);
  ctx.stroke();
  ctx.restore();

  const step = (to - from) / Math.max(1, items.length);
  items.forEach((item, index) => {
    const cue = beat(plan, index);
    const t = range(time, cue.at, cue.at + 0.8);
    if (t <= 0.001) return;
    const x = from + step * index + step / 2;
    const above = index % 2 === 0;

    // The track colours in behind each phase as it arrives.
    ctx.save();
    ctx.globalAlpha = clamp01(t);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(from + step * index, y);
    ctx.lineTo(from + step * index + step * easeOutQuint(clamp01(t)), y);
    ctx.stroke();
    ctx.restore();

    const card = {
      x: x - 108,
      y: above ? y - 150 : y + 42,
      width: 216,
      height: 104,
    };
    drawSurface(ctx, card, theme, { enter: t, radius: 16, glow: 0.6 });
    drawBodyLines(ctx, wrapAt(ctx, item, options.fontSans, 20, card.width - 34, 3, 600), {
      x: card.x + 17,
      y: card.y + 40,
      align: "left",
      theme,
      family: options.fontSans,
      size: 20,
      lineHeight: 26,
      colour: theme.ink,
      reveal: range(time, cue.at + 0.25, cue.at + 0.7),
    });

    ctx.save();
    ctx.globalAlpha = clamp01(t * 1.5);
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(x, y, 11 * easeOutBack(clamp01(t), 1.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  heading(ctx, scene, plan, theme, options, {
    x: MARGIN,
    y: 152,
    width: CONTENT_WIDTH * 0.7,
    align: "left",
    size: 38,
    lines: 1,
  });
};

/* =============================== comparisons ============================== */

/**
 * VERSUS — two options facing off.
 *
 * Different from `contrast` on purpose: contrast is before-and-after, which is
 * one thing over time, and this is a live choice between two. So the divider
 * is vertical and central, and neither side is given the accent -- the moment
 * one is coloured, the frame has answered the question for the viewer.
 */
const shotVersus: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const sides = scene.bullets.slice(0, 2);
  const mid = BOARD_WIDTH / 2;

  sides.forEach((side, index) => {
    const cue = beat(plan, index);
    const t = range(time, cue.at, cue.at + 0.75);
    const box = {
      x: index === 0 ? MARGIN : mid + 44,
      y: 230,
      width: (CONTENT_WIDTH - 88) / 2,
      height: SAFE_BOTTOM - 268,
    };
    drawSurface(ctx, box, theme, { enter: t, radius: 20, glow: 0.7 });

    drawMark(ctx, scene, plan, index, box.x + box.width / 2, box.y + 82, 62, theme, {
      enter: smootherstep(range(time, cue.at + 0.15, cue.at + 0.8)),
      time,
      seed: index,
    });

    const laid = layoutDisplay(ctx, side, {
      family: display(options),
      maxWidth: box.width - 60,
      maxSize: 34,
      minSize: 20,
      weight: 800,
      maxLines: 3,
      lineRatio: 1.16,
    });
    drawDisplay(ctx, laid, {
      x: box.x + box.width / 2,
      y: box.y + box.height * 0.62,
      align: "center",
      theme,
      shadow: false,
      reveal: staggered(cue, laid.count, time, 0.05),
    });
  });

  // The divider, and the word on it.
  const split = easeOutQuint(range(time, plan.heading.at, plan.heading.at + 0.7));
  if (split > 0.001) {
    ctx.save();
    ctx.strokeStyle = theme.hairline;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mid, 230);
    ctx.lineTo(mid, 230 + (SAFE_BOTTOM - 268) * split);
    ctx.stroke();

    ctx.globalAlpha = split;
    ctx.fillStyle = theme.ground;
    ctx.beginPath();
    ctx.arc(mid, BOARD_HEIGHT * 0.5, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `800 22px ${display(options)}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = theme.mark;
    ctx.fillText("VS", mid, BOARD_HEIGHT * 0.5 + 1);
    ctx.restore();
  }

  heading(ctx, scene, plan, theme, options, {
    x: BOARD_WIDTH / 2,
    y: 172,
    width: CONTENT_WIDTH * 0.7,
    align: "center",
    size: 40,
    lines: 1,
  });
};

/**
 * THE MATRIX — two variables crossed.
 *
 * The axes are what make it a matrix rather than four boxes, so they are drawn
 * first and labelled. One quadrant carries the accent, because a two-by-two
 * always exists to point at one of its corners.
 */
const shotMatrix: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const items = scene.bullets.slice(0, 4);
  const size = Math.min(CONTENT_WIDTH * 0.52, SAFE_BOTTOM - 250);
  const left = BOARD_WIDTH * 0.5 - size / 2;
  const top = 232;
  const cell = size / 2;

  const grid = easeOutQuint(range(time, plan.heading.at, plan.heading.at + 0.8));
  ctx.save();
  ctx.strokeStyle = theme.hairline;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(left, top, size * grid, size * grid);
  ctx.beginPath();
  ctx.moveTo(left + cell, top);
  ctx.lineTo(left + cell, top + size * grid);
  ctx.moveTo(left, top + cell);
  ctx.lineTo(left + size * grid, top + cell);
  ctx.stroke();
  ctx.restore();

  items.forEach((item, index) => {
    const cue = beat(plan, index);
    const t = range(time, cue.at, cue.at + 0.7);
    if (t <= 0.001) return;
    const col = index % 2;
    const row = Math.floor(index / 2);
    const box = { x: left + col * cell, y: top + row * cell, width: cell, height: cell };

    if (index === 0) {
      ctx.save();
      ctx.globalAlpha = clamp01(t) * 0.16;
      ctx.fillStyle = theme.accent;
      ctx.fillRect(box.x + 1, box.y + 1, box.width - 2, box.height - 2);
      ctx.restore();
    }

    drawBodyLines(ctx, wrapAt(ctx, item, options.fontSans, 20, cell - 40, 3, 600), {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      align: "center",
      theme,
      family: options.fontSans,
      size: 20,
      lineHeight: 27,
      colour: theme.ink,
      reveal: range(time, cue.at + 0.1, cue.at + 0.6),
    });
  });

  heading(ctx, scene, plan, theme, options, {
    x: BOARD_WIDTH / 2,
    y: 170,
    width: CONTENT_WIDTH * 0.68,
    align: "center",
    size: 38,
    lines: 1,
  });
  label(ctx, scene, theme, options);
};

/**
 * THE OVERLAP — what two things share.
 *
 * The intersection is drawn in the accent and the circles are not, so the eye
 * goes to the overlap. That is the only reason to reach for this shape: if the
 * point is the two circles rather than what they share, it wanted `versus`.
 */
const shotVenn: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const sides = scene.bullets.slice(0, 2);
  const cy = BOARD_HEIGHT * 0.48;
  const radius = 148;
  const offset = 96;

  sides.forEach((side, index) => {
    const cue = beat(plan, index);
    const t = easeOutQuint(range(time, cue.at, cue.at + 0.75));
    if (t <= 0.001) return;
    const cx = BOARD_WIDTH / 2 + (index === 0 ? -offset : offset);

    ctx.save();
    ctx.globalAlpha = clamp01(t);
    ctx.fillStyle = withAlpha(index === 0 ? theme.accentAlt : theme.ink, 0.14);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * easeOutBack(clamp01(t), 0.8), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(theme.ink, 0.3);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    drawBodyLines(ctx, wrapAt(ctx, side, options.fontSans, 21, 220, 2), {
      x: cx + (index === 0 ? -radius * 0.62 : radius * 0.62),
      y: cy + 6,
      align: "center",
      theme,
      family: options.fontSans,
      size: 21,
      lineHeight: 28,
      colour: theme.ink,
      reveal: range(time, cue.at + 0.25, cue.at + 0.7),
    });
  });

  // The shared middle, drawn last and last to arrive.
  const shared = scene.keywords?.[0] ?? scene.stat;
  const meet = easeOutQuint(range(time, plan.heading.at + 1, plan.heading.at + 1.8));
  if (meet > 0.001) {
    ctx.save();
    ctx.globalAlpha = meet;
    ctx.beginPath();
    ctx.arc(BOARD_WIDTH / 2 - offset, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(BOARD_WIDTH / 2 + offset, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(theme.accent, 0.55);
    ctx.fill();
    ctx.restore();

    if (shared) {
      ctx.save();
      ctx.globalAlpha = meet;
      ctx.font = `800 24px ${display(options)}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = theme.accentInk;
      ctx.fillText(shared.toUpperCase(), BOARD_WIDTH / 2, cy + 1);
      ctx.restore();
    }
  }

  heading(ctx, scene, plan, theme, options, {
    x: BOARD_WIDTH / 2,
    y: 166,
    width: CONTENT_WIDTH * 0.6,
    align: "center",
    size: 38,
    lines: 1,
  });
};

/**
 * GAINED AND GIVEN UP — a ticked column and a crossed one.
 *
 * The marks carry the meaning, so they are drawn properly -- a tick that grows
 * along its own stroke and a cross that arrives as two strokes -- rather than
 * being set as characters in a font, which never quite lines up.
 */
const shotProsCons: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const half = Math.ceil(scene.bullets.length / 2);
  const columns = [scene.bullets.slice(0, half), scene.bullets.slice(half)];
  const width = (CONTENT_WIDTH - 60) / 2;

  columns.forEach((column, side) => {
    const x = MARGIN + side * (width + 60);
    const good = side === 0;

    column.forEach((item, row) => {
      const index = side === 0 ? row : half + row;
      const cue = beat(plan, index);
      const t = easeOutQuint(range(time, cue.at, cue.at + 0.6));
      if (t <= 0.001) return;
      const y = 268 + row * 62;

      ctx.save();
      ctx.globalAlpha = clamp01(t * 1.4);
      ctx.strokeStyle = good ? theme.accent : withAlpha(theme.ink, 0.5);
      ctx.lineWidth = 3.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      if (good) {
        // One continuous stroke, revealed along its own length.
        const p = easeOutCubic(clamp01(t));
        ctx.moveTo(x, y);
        ctx.lineTo(x + 7 * Math.min(1, p * 2.5), y + 8 * Math.min(1, p * 2.5));
        if (p > 0.4) ctx.lineTo(x + 7 + 12 * ((p - 0.4) / 0.6), y + 8 - 17 * ((p - 0.4) / 0.6));
      } else {
        const p = easeOutCubic(clamp01(t));
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 16 * Math.min(1, p * 2), y + 8 * Math.min(1, p * 2));
        if (p > 0.5) {
          ctx.moveTo(x + 16, y - 8);
          ctx.lineTo(x + 16 - 16 * ((p - 0.5) / 0.5), y - 8 + 16 * ((p - 0.5) / 0.5));
        }
      }
      ctx.stroke();
      ctx.restore();

      drawBodyLines(ctx, wrapAt(ctx, item, options.fontSans, 21, width - 46, 2), {
        x: x + 34,
        y: y + 7,
        align: "left",
        theme,
        family: options.fontSans,
        size: 21,
        lineHeight: 28,
        colour: theme.ink,
        reveal: range(time, cue.at + 0.15, cue.at + 0.6),
      });
    });
  });

  heading(ctx, scene, plan, theme, options, {
    x: MARGIN,
    y: 178,
    width: CONTENT_WIDTH * 0.7,
    align: "left",
    size: 42,
    lines: 1,
  });
  label(ctx, scene, theme, options);
};

/* ================================ structure =============================== */

/**
 * THE STACK — layers resting on each other.
 *
 * Built bottom-up, and each layer is drawn slightly narrower than the one
 * below so the pile reads as physical. A stack of identical rectangles is a
 * list rotated ninety degrees; the taper is what makes it a structure.
 */
const shotStack: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const items = scene.bullets.slice(0, 5);
  const rows = items.length;
  const height = Math.min(66, (SAFE_BOTTOM - 250) / Math.max(1, rows));
  const base = SAFE_BOTTOM - 30;

  items.forEach((item, index) => {
    const fromBottom = rows - 1 - index;
    const cue = beat(plan, index);
    const t = range(time, cue.at, cue.at + 0.65);
    if (t <= 0.001) return;

    const inset = fromBottom * 16;
    const box = {
      x: MARGIN + 40 + inset,
      y: base - (fromBottom + 1) * (height + 8),
      width: CONTENT_WIDTH * 0.52 - inset * 2,
      height,
    };
    drawSurface(ctx, box, theme, {
      enter: t,
      radius: 12,
      fill: index === 0 ? theme.accent : undefined,
      glow: 0.5,
    });

    drawBodyLines(ctx, wrapAt(ctx, item, options.fontSans, 20, box.width - 40, 1, 600), {
      x: box.x + 22,
      y: box.y + height * 0.62,
      align: "left",
      theme,
      family: options.fontSans,
      size: 20,
      lineHeight: 26,
      colour: index === 0 ? theme.accentInk : theme.ink,
      reveal: range(time, cue.at + 0.2, cue.at + 0.6),
    });
  });

  heading(ctx, scene, plan, theme, options, {
    x: BOARD_WIDTH * 0.66,
    y: 300,
    width: CONTENT_WIDTH * 0.34,
    align: "left",
    size: 40,
    lines: 4,
  });
  label(ctx, scene, theme, options);
};

/**
 * THE ORBIT — one thing at the centre, everything else around it.
 *
 * For a subject with dependents: a platform and what runs on it, a cause and
 * its effects. The spokes are drawn from the centre outward so the direction
 * of the relationship is unambiguous.
 */
const shotOrbit: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const items = scene.bullets.slice(0, 5);
  const cx = BOARD_WIDTH / 2;
  const cy = BOARD_HEIGHT * 0.5;
  const radius = 172;
  const core = easeOutQuint(range(time, plan.heading.at, plan.heading.at + 0.7));

  items.forEach((item, index) => {
    const cue = beat(plan, index);
    const t = range(time, cue.at, cue.at + 0.7);
    if (t <= 0.001) return;
    const angle = -Math.PI / 2 + (index / Math.max(1, items.length)) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius * 0.78;

    ctx.save();
    ctx.globalAlpha = clamp01(t);
    ctx.strokeStyle = withAlpha(theme.ink, 0.2);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * 76, cy + Math.sin(angle) * 60);
    ctx.lineTo(
      lerp(cx + Math.cos(angle) * 76, x, easeOutCubic(clamp01(t))),
      lerp(cy + Math.sin(angle) * 60, y, easeOutCubic(clamp01(t))),
    );
    ctx.stroke();
    ctx.restore();

    const box = { x: x - 84 + sway(index, time, 2), y: y - 30, width: 168, height: 60 };
    drawSurface(ctx, box, theme, { enter: t, radius: 12, glow: 0.5 });
    drawBodyLines(ctx, wrapAt(ctx, item, options.fontSans, 18, box.width - 26, 2, 600), {
      x: box.x + box.width / 2,
      y: box.y + 26,
      align: "center",
      theme,
      family: options.fontSans,
      size: 18,
      lineHeight: 23,
      colour: theme.ink,
      reveal: range(time, cue.at + 0.25, cue.at + 0.7),
    });
  });

  if (core > 0.001) {
    if (theme.finish !== "print") drawBloom(ctx, cx, cy, 190, theme.accent, 0.26 * core);
    ctx.save();
    ctx.globalAlpha = core;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, 72 * easeOutBack(core, 1.2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const word = (scene.keywords?.[0] ?? scene.heading).split(/\s+/)[0];
    ctx.save();
    ctx.globalAlpha = core;
    ctx.font = `800 22px ${display(options)}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = theme.accentInk;
    ctx.fillText(word.toUpperCase().slice(0, 10), cx, cy + 1);
    ctx.restore();
  }

  label(ctx, scene, theme, options);
};

/**
 * THE FLOW — boxes joined by arrows.
 *
 * The plainest structural screen in the library, and the right answer more
 * often than the decorative ones: when the point is that A causes B causes C,
 * anything cleverer is in the way.
 */
const shotFlow: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const items = scene.bullets.slice(0, 4);
  const y = BOARD_HEIGHT * 0.5;
  const boxWidth = Math.min(230, (CONTENT_WIDTH - (items.length - 1) * 56) / Math.max(1, items.length));
  const total = boxWidth * items.length + 56 * (items.length - 1);
  const startX = BOARD_WIDTH / 2 - total / 2;

  items.forEach((item, index) => {
    const cue = beat(plan, index);
    const t = range(time, cue.at, cue.at + 0.7);
    if (t <= 0.001) return;
    const x = startX + index * (boxWidth + 56);
    const box = { x, y: y - 58, width: boxWidth, height: 116 };

    drawSurface(ctx, box, theme, {
      enter: t,
      radius: 14,
      fill: index === items.length - 1 ? theme.accent : undefined,
      glow: 0.7,
    });
    drawBodyLines(ctx, wrapAt(ctx, item, options.fontSans, 20, box.width - 34, 3, 600), {
      x: box.x + box.width / 2,
      y: box.y + 46,
      align: "center",
      theme,
      family: options.fontSans,
      size: 20,
      lineHeight: 26,
      colour: index === items.length - 1 ? theme.accentInk : theme.ink,
      reveal: range(time, cue.at + 0.2, cue.at + 0.65),
    });

    if (index < items.length - 1) {
      const route: Point[] = [
        { x: x + boxWidth + 8, y },
        { x: x + boxWidth + 48, y },
      ];
      drawConnector(ctx, route, withAlpha(theme.ink, 0.45), range(time, cue.at + 0.35, cue.at + 0.8), {
        dash: 5,
        width: 2,
      });
      // The arrowhead, once the line has arrived.
      const head = easeOutCubic(range(time, cue.at + 0.6, cue.at + 0.9));
      if (head > 0.01) {
        ctx.save();
        ctx.globalAlpha = head;
        ctx.fillStyle = withAlpha(theme.ink, 0.55);
        ctx.beginPath();
        ctx.moveTo(x + boxWidth + 50, y);
        ctx.lineTo(x + boxWidth + 40, y - 6);
        ctx.lineTo(x + boxWidth + 40, y + 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  });

  heading(ctx, scene, plan, theme, options, {
    x: BOARD_WIDTH / 2,
    y: 176,
    width: CONTENT_WIDTH * 0.7,
    align: "center",
    size: 40,
    lines: 1,
  });
  label(ctx, scene, theme, options);
};

/**
 * THE LIST — lines called out one at a time, between brackets.
 *
 * The brackets move down the list as the narration reaches each line, which is
 * the entire idea: a viewer always knows which line is being spoken about. A
 * static list with everything visible makes them find it themselves.
 */
const shotList: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const items = scene.bullets.slice(0, 5);
  const size = items.length > 3 ? 34 : 42;
  const lineHeight = size * 1.9;
  const top = BOARD_HEIGHT * 0.46 - (items.length - 1) * lineHeight * 0.5;
  const right = BOARD_WIDTH - MARGIN;

  let active = -1;
  items.forEach((_, index) => {
    if (time >= beat(plan, index).at) active = index;
  });

  items.forEach((item, index) => {
    const cue = beat(plan, index);
    const t = range(time, cue.at, cue.at + 0.5);
    if (t <= 0.001) return;
    const y = top + index * lineHeight;

    ctx.save();
    ctx.globalAlpha = clamp01(t) * (index === active ? 1 : 0.45);
    ctx.font = `800 ${size}px ${display(options)}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = theme.ink;
    ctx.fillText(item, right - (1 - easeOutCubic(clamp01(t))) * -18, y);
    const width = ctx.measureText(item).width;
    ctx.restore();

    if (index === active) {
      drawBrackets(
        ctx,
        { x: right - width, y: y - size * 0.6, width, height: size * 1.2 },
        theme.mark,
        { progress: range(time, cue.at, cue.at + 0.35), size: 18, gap: 12, width: 2.5 },
      );
    }
  });

  heading(ctx, scene, plan, theme, options, {
    x: MARGIN,
    y: BOARD_HEIGHT * 0.42,
    width: CONTENT_WIDTH * 0.32,
    align: "left",
    size: 34,
    lines: 4,
  });
};

/* ================================== media ================================= */

/**
 * FULL BLEED — the photograph is the frame, and the type sits on it.
 *
 * The scrim is not optional and is not a rectangle: a gradient rising from the
 * bottom third holds white type over an unpredictable image without covering
 * the picture. A flat overlay across the whole frame would work as reliably
 * and would waste the photograph.
 */
const shotFullBleed: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const picture = pictureOf(scene);

  if (picture) {
    const scale = Math.max(BOARD_WIDTH / picture.naturalWidth, BOARD_HEIGHT / picture.naturalHeight);
    // A slow push across the whole scene, so the plate is never a still.
    const push = 1 + (time / Math.max(1, options.duration)) * 0.06;
    const width = picture.naturalWidth * scale * push;
    const height = picture.naturalHeight * scale * push;
    ctx.save();
    ctx.globalAlpha = smootherstep(range(time, 0, 0.8));
    ctx.drawImage(picture, (BOARD_WIDTH - width) / 2, (BOARD_HEIGHT - height) / 2, width, height);
    ctx.restore();
  }

  const scrim = ctx.createLinearGradient(0, BOARD_HEIGHT * 0.28, 0, BOARD_HEIGHT);
  scrim.addColorStop(0, withAlpha(theme.ground, 0));
  scrim.addColorStop(0.55, withAlpha(theme.ground, 0.72));
  scrim.addColorStop(1, withAlpha(theme.ground, 0.96));
  ctx.save();
  ctx.fillStyle = scrim;
  ctx.fillRect(0, BOARD_HEIGHT * 0.28, BOARD_WIDTH, BOARD_HEIGHT * 0.72);
  ctx.restore();

  const laid = layoutDisplay(ctx, scene.heading, {
    family: display(options),
    maxWidth: CONTENT_WIDTH * 0.8,
    maxSize: 66,
    minSize: 32,
    weight: 800,
    maxLines: 3,
    lineRatio: 1.06,
    emphasis: scene.keywords,
  });
  drawDisplay(ctx, laid, {
    x: MARGIN,
    y: SAFE_BOTTOM - 40 - (laid.lines.length - 1) * laid.lineHeight,
    align: "left",
    theme,
    reveal: staggered(plan.heading, laid.count, time, 0.06),
  });

  const caption = scene.bullets[0];
  if (caption) {
    const cue = beat(plan, 0);
    drawRule(ctx, theme, MARGIN, SAFE_BOTTOM - 120 - (laid.lines.length - 1) * laid.lineHeight, 62, range(time, cue.at, cue.at + 0.4), 4);
  }
  label(ctx, scene, theme, options);
};

/**
 * THE GRID — a tile per idea, each with its own icon.
 *
 * The tiles are identical on purpose. This is the one screen whose job is to
 * say "these are the same kind of thing", and any variation in size or colour
 * immediately says the opposite.
 */
const shotGrid: Shot = (ctx, scene, plan, theme, options) => {
  const { time } = options;
  const items = scene.bullets.slice(0, 6);
  const columns = items.length <= 4 ? Math.min(items.length, 2) : 3;
  const rows = Math.ceil(items.length / columns);
  const tile = Math.min(216, (CONTENT_WIDTH - (columns - 1) * 26) / columns);
  const height = Math.min(tile, (SAFE_BOTTOM - 250 - (rows - 1) * 26) / rows);
  const gridWidth = tile * columns + 26 * (columns - 1);
  const startX = BOARD_WIDTH / 2 - gridWidth / 2;
  const startY = BOARD_HEIGHT * 0.52 - (height * rows + 26 * (rows - 1)) / 2 + 40;

  items.forEach((item, index) => {
    const cue = beat(plan, index);
    const t = cascade(range(time, cue.at, cue.at + 0.9), 0, 1);
    if (t <= 0.001) return;
    const col = index % columns;
    const row = Math.floor(index / columns);
    const box = {
      x: startX + col * (tile + 26),
      y: startY + row * (height + 26),
      width: tile,
      height,
    };

    drawSurface(ctx, box, theme, { enter: t, radius: box.width * 0.16, glow: 0.7 });
    drawMark(ctx, scene, plan, index, box.x + box.width / 2, box.y + height * 0.36, Math.min(58, height * 0.34), theme, {
      enter: range(t, 0.25, 1),
      time,
      seed: index,
    });
    drawBodyLines(ctx, wrapAt(ctx, item, options.fontSans, 18, box.width - 28, 2, 600), {
      x: box.x + box.width / 2,
      y: box.y + height * 0.74,
      align: "center",
      theme,
      family: options.fontSans,
      size: 18,
      lineHeight: 24,
      colour: theme.ink,
      reveal: range(t, 0.4, 1),
    });
  });

  heading(ctx, scene, plan, theme, options, {
    x: BOARD_WIDTH / 2,
    y: 176,
    width: CONTENT_WIDTH * 0.72,
    align: "center",
    size: 40,
    lines: 1,
  });
  label(ctx, scene, theme, options);
};

/* ================================ the shelf =============================== */

/** Every screen added beyond the original set, by name. */
export const EXTRA_SHOTS: Partial<Record<string, Shot>> = {
  quote: shotQuote,
  bigWord: shotBigWord,
  chapter: shotChapter,
  metricTrio: shotMetricTrio,
  gauge: shotGauge,
  progress: shotProgress,
  bars: shotBars,
  donut: shotDonut,
  timeline: shotTimeline,
  cycle: shotCycle,
  funnel: shotFunnel,
  pyramid: shotPyramid,
  roadmap: shotRoadmap,
  versus: shotVersus,
  matrix: shotMatrix,
  venn: shotVenn,
  prosCons: shotProsCons,
  stack: shotStack,
  orbit: shotOrbit,
  flow: shotFlow,
  list: shotList,
  fullBleed: shotFullBleed,
  grid: shotGrid,
};

export type { Shot };
