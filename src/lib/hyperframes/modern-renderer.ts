import { BOARD_HEIGHT, BOARD_WIDTH } from "@/lib/whiteboard/scene";
import {
  clamp,
  clamp01,
  easeInOutCubic,
  easeOutCubic,
  easeOutQuint,
  lerp,
  noise1,
  range,
  smootherstep,
  spring,
} from "@/lib/video/easing";
import {
  drawGlassPanel,
  drawGrain,
  drawLetterbox,
  drawLightDrift,
  drawVignette,
  supportsFilter,
  withAlpha,
} from "@/lib/video/grade";
import {
  buildPhrases,
  phraseAt,
  planCues,
  readingTime,
  speechEnergy,
  type Cue,
  type SubtitlePhrase,
  type WordTiming,
} from "@/lib/video/timing";
import { accentGlow, themeOf, type Theme, type ThemeName } from "./theme";
import {
  countUp,
  drawBodyLines,
  drawDisplay,
  drawEyebrow,
  layoutDisplay,
  wrapAt,
} from "./type";

/**
 * Hyperframes — the modern video engine.
 *
 * The rule this engine is built around: a scene is a shot, not a slide. Every
 * frame has one subject, the camera is always moving a little, the type is
 * composed rather than listed, and — the part that makes it feel alive — the
 * whole thing is scheduled against the narration's real word timings, so the
 * picture changes on the words that describe it.
 *
 * Seven shot types cover an explainer. Which one a scene gets is decided by
 * what the scene actually contains: a number becomes a metric shot, a sequence
 * becomes a process shot, an opening becomes a title. Nothing cycles through
 * layouts by index, because that is how four scenes end up looking like one
 * template used four times.
 */

/* ---------------------------------- types --------------------------------- */

export type SceneRole =
  | "hero"
  | "statement"
  | "split"
  | "metric"
  | "process"
  | "contrast"
  | "takeaway";

export interface ModernRenderScene {
  heading: string;
  bullets: string[];
  narration: string;
  image?: HTMLImageElement | null;
  index: number;
  totalScenes: number;
  keywords?: string[];
  stat?: string;
  statCaption?: string;
  visualTheme?: ThemeName;
}

export interface SceneTiming {
  lead: number;
  speech: number;
  tail: number;
}

export interface ModernPlan {
  role: SceneRole;
  /** Heading entrance. */
  heading: Cue;
  /** One cue per bullet, step or chip, aligned to the narration. */
  beats: Cue[];
  /** When the statistic is actually said, so the counter lands on it. */
  stat: Cue | null;
  phrases: SubtitlePhrase[];
  words: WordTiming[];
  timing: SceneTiming;
}

export interface ModernRenderOptions {
  /** Seconds into this scene. */
  time: number;
  /** Total length of this scene. */
  duration: number;
  fontSans: string;
  /** 0..1 through the whole video, for the chapter rail. */
  globalProgress?: number;
}

/* ---------------------------------- plan ---------------------------------- */

/**
 * Picks the shot type from the scene's own content.
 *
 * The alternation on bullet-heavy scenes is deliberate: two process shots in a
 * row is the one repetition a viewer notices.
 */
export function roleFor(scene: {
  index: number;
  totalScenes: number;
  bullets: string[];
  stat?: string;
  image?: unknown;
}): SceneRole {
  if (scene.index === 0) return "hero";
  if (scene.totalScenes > 2 && scene.index === scene.totalScenes - 1) return "takeaway";
  if (scene.stat?.trim()) return "metric";
  if (scene.bullets.length >= 3) return scene.index % 2 === 1 ? "process" : "split";
  if (scene.bullets.length === 2) return scene.index % 2 === 1 ? "contrast" : "split";
  return "statement";
}

/** Schedules a scene's beats against the voice track. */
export function planModernScene(
  scene: ModernRenderScene,
  words: WordTiming[],
  timing: SceneTiming,
): ModernPlan {
  const role = roleFor(scene);
  const { lead, speech, tail } = timing;

  const [heading] = planCues(
    [{ minSpan: 0.7, maxSpan: 1.6 }],
    words,
    { lead, speech, tail, preroll: 0, minGap: 0 },
  );

  // The gap between beats is set by how long the *previous* line takes to
  // read, not by a fixed rhythm: a six-word bullet needs longer on screen
  // alone than a two-word one.
  const slowest = scene.bullets.reduce((most, bullet) => Math.max(most, readingTime(bullet)), 0.9);

  const beats = planCues(
    scene.bullets.map((bullet) => ({ text: bullet, minSpan: 0.5, maxSpan: 1.5 })),
    words,
    { lead, speech, tail, preroll: 0.3, minGap: Math.min(slowest, Math.max(0.6, speech / 5)) },
  );

  const stat = scene.stat
    ? planCues([{ text: scene.stat, minSpan: 0.9, maxSpan: 1.8 }], words, {
        lead,
        speech,
        tail,
        preroll: 0.25,
        minGap: 0,
      })[0] ?? null
    : null;

  return {
    role,
    heading: heading ?? { at: 0, span: 1, anchored: false },
    beats,
    stat,
    phrases: buildPhrases(words).map((phrase) => ({
      ...phrase,
      start: phrase.start + lead,
      end: phrase.end + lead,
      words: phrase.words.map((entry) => ({
        ...entry,
        start: entry.start + lead,
        end: entry.end + lead,
      })),
    })),
    words: words.map((entry) => ({ ...entry, start: entry.start + lead, end: entry.end + lead })),
    timing,
  };
}

/* -------------------------------- background ------------------------------- */

/** Ken Burns, with the direction alternating so no two shots drift alike. */
function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  theme: Theme,
  options: ModernRenderOptions,
  intensity: number,
) {
  const { time, duration } = options;
  const p = clamp01(time / Math.max(0.01, duration));
  const image = scene.image;

  if (image?.complete && image.naturalWidth > 0) {
    const forward = scene.index % 2 === 0;
    const eased = easeInOutCubic(p);
    const zoom = forward ? lerp(1.02, 1.16, eased) : lerp(1.16, 1.03, eased);
    const panX = (forward ? 1 : -1) * lerp(-26, 26, eased);
    const panY = lerp(-14, 14, eased) * (scene.index % 3 === 0 ? 1 : -0.6);

    const scale =
      Math.max(BOARD_WIDTH / image.naturalWidth, BOARD_HEIGHT / image.naturalHeight) * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;

    ctx.save();
    if (intensity > 0 && supportsFilter(ctx)) {
      // Shots whose subject is elsewhere throw the plate out of focus.
      ctx.filter = `blur(${intensity * 16}px) saturate(1.08)`;
    }
    ctx.drawImage(image, (BOARD_WIDTH - width) / 2 + panX, (BOARD_HEIGHT - height) / 2 + panY, width, height);
    ctx.restore();
  } else {
    const drift = noise1(time * 0.08, scene.index * 7) * 60;
    const gradient = ctx.createLinearGradient(drift, 0, BOARD_WIDTH - drift, BOARD_HEIGHT);
    gradient.addColorStop(0, theme.backdrop[0]);
    gradient.addColorStop(0.55, theme.backdrop[1]);
    gradient.addColorStop(1, theme.backdrop[2]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  }

  // The grade: what turns a stock picture into a shot the type can live on.
  const grade = ctx.createLinearGradient(0, 0, 0, BOARD_HEIGHT);
  grade.addColorStop(0, theme.gradeTop);
  grade.addColorStop(0.42, withAlpha(theme.backdrop[2], theme.dark ? 0.42 : 0.2));
  grade.addColorStop(1, theme.gradeBottom);
  ctx.fillStyle = grade;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
}

/** A side scrim, so left- or right-set type always has ground under it. */
function drawSideScrim(ctx: CanvasRenderingContext2D, theme: Theme, side: "left" | "right") {
  const gradient =
    side === "left"
      ? ctx.createLinearGradient(0, 0, BOARD_WIDTH * 0.72, 0)
      : ctx.createLinearGradient(BOARD_WIDTH, 0, BOARD_WIDTH * 0.28, 0);
  gradient.addColorStop(0, withAlpha(theme.backdrop[2], theme.dark ? 0.88 : 0.9));
  gradient.addColorStop(0.55, withAlpha(theme.backdrop[2], theme.dark ? 0.4 : 0.45));
  gradient.addColorStop(1, withAlpha(theme.backdrop[2], 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
}

/* ---------------------------------- shots --------------------------------- */

const MARGIN = 92;
const CONTENT_WIDTH = BOARD_WIDTH - MARGIN * 2;
/**
 * Nothing a shot composes may cross this line: below it lives the subtitle
 * scrim, and type over type is the fastest way to make a video look unfinished.
 */
const SAFE_BOTTOM = 548;

/** Word-by-word entrance timing, in reading order. */
function staggered(cue: Cue, count: number, time: number, per = 0.075) {
  const total = Math.max(0.0001, cue.span);
  return (index: number) => {
    const start = cue.at + Math.min(index * per, total * 0.55);
    return range(time, start, start + Math.max(0.28, total * 0.55));
  };
}

function eyebrowFor(scene: ModernRenderScene): string {
  const number = `${String(scene.index + 1).padStart(2, "0")}`;
  const keyword = scene.keywords?.[0]?.trim();
  return keyword ? `${number} — ${keyword}` : `${number} / ${String(scene.totalScenes).padStart(2, "0")}`;
}

function drawAccentRule(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  x: number,
  y: number,
  width: number,
  progress: number,
  height = 4,
) {
  const t = easeOutQuint(clamp01(progress));
  if (t <= 0) return;
  ctx.save();
  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0, theme.accent);
  gradient.addColorStop(1, withAlpha(theme.accent, 0.15));
  ctx.fillStyle = gradient;
  ctx.shadowColor = accentGlow(theme, 0.45);
  ctx.shadowBlur = 16;
  ctx.fillRect(x, y, width * t, height);
  ctx.restore();
}

/** THE TITLE SHOT — the frame is the headline. */
function shotHero(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;
  drawSideScrim(ctx, theme, "left");

  const heading = layoutDisplay(ctx, scene.heading, {
    family: options.fontSans,
    maxWidth: CONTENT_WIDTH * 0.78,
    maxSize: 96,
    minSize: 48,
    weight: 900,
    maxLines: 3,
    lineRatio: 1.02,
    emphasis: scene.keywords,
  });

  const baseY = BOARD_HEIGHT * 0.62 - heading.height + heading.size;

  drawEyebrow(ctx, eyebrowFor(scene), {
    x: MARGIN + 38,
    y: baseY - heading.size * 0.92 - 34,
    align: "left",
    theme,
    family: options.fontSans,
    reveal: range(time, plan.heading.at, plan.heading.at + 0.4),
  });

  drawDisplay(ctx, heading, {
    x: MARGIN,
    y: baseY,
    align: "left",
    theme,
    reveal: staggered(plan.heading, heading.count, time, 0.085),
  });

  // Clear of the emphasis underline: two accent rules a few pixels apart read
  // as a mistake rather than as a hierarchy.
  const ruleY = baseY + (heading.lines.length - 1) * heading.lineHeight + heading.size * 0.66;
  drawAccentRule(
    ctx,
    theme,
    MARGIN,
    ruleY,
    186,
    range(time, plan.heading.at + 0.45, plan.heading.at + 1.05),
    4,
  );

  // One kicker line only. A title shot that starts listing is not a title shot.
  const kicker = scene.bullets[0];
  const cue = plan.beats[0];
  if (kicker && cue) {
    drawBodyLines(ctx, wrapAt(ctx, kicker, options.fontSans, 28, CONTENT_WIDTH * 0.56, 2), {
      x: MARGIN,
      y: ruleY + 52,
      align: "left",
      theme,
      family: options.fontSans,
      size: 28,
      lineHeight: 38,
      reveal: range(time, cue.at, cue.at + 0.5),
    });
  }
}

/** THE STATEMENT — one sentence, centred, everything else out of the way. */
function shotStatement(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;

  ctx.save();
  ctx.fillStyle = withAlpha(theme.backdrop[2], theme.dark ? 0.42 : 0.3);
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.restore();

  const heading = layoutDisplay(ctx, scene.heading, {
    family: options.fontSans,
    maxWidth: CONTENT_WIDTH * 0.86,
    maxSize: 82,
    minSize: 42,
    weight: 800,
    maxLines: 3,
    lineRatio: 1.12,
    emphasis: scene.keywords,
  });

  const centreY = BOARD_HEIGHT * 0.46 - heading.height / 2 + heading.size;

  drawEyebrow(ctx, eyebrowFor(scene), {
    x: BOARD_WIDTH / 2,
    y: centreY - heading.size - 46,
    align: "center",
    theme,
    family: options.fontSans,
    reveal: range(time, plan.heading.at, plan.heading.at + 0.4),
  });

  drawDisplay(ctx, heading, {
    x: BOARD_WIDTH / 2,
    y: centreY,
    align: "center",
    theme,
    reveal: staggered(plan.heading, heading.count, time, 0.09),
  });

  const supportY = Math.min(
    centreY + (heading.lines.length - 1) * heading.lineHeight + 68,
    SAFE_BOTTOM - 44,
  );
  drawAccentRule(
    ctx,
    theme,
    BOARD_WIDTH / 2 - 60,
    supportY - 34,
    120,
    range(time, plan.heading.at + 0.5, plan.heading.at + 1),
    3,
  );

  scene.bullets.slice(0, 2).forEach((bullet, index) => {
    const cue = plan.beats[index];
    if (!cue) return;
    drawBodyLines(ctx, wrapAt(ctx, bullet, options.fontSans, 29, CONTENT_WIDTH * 0.72, 2), {
      x: BOARD_WIDTH / 2,
      y: supportY + index * 40,
      align: "center",
      theme,
      family: options.fontSans,
      size: 29,
      lineHeight: 40,
      reveal: range(time, cue.at, cue.at + 0.45),
    });
  });
}

/** THE SPLIT — artwork held in frame on one side, the argument on the other. */
function shotSplit(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time, duration } = options;

  // Half a split screen is not a composition. Without artwork this shot has
  // nothing to hold its other side, so it becomes a statement instead.
  const hasPlate = Boolean(scene.image?.complete && scene.image.naturalWidth > 0);
  if (!hasPlate) {
    shotStatement(ctx, scene, plan, theme, options);
    return;
  }

  const imageRight = scene.index % 2 === 1;
  drawSideScrim(ctx, theme, imageRight ? "left" : "right");

  const cardW = 520;
  const cardH = 400;
  const cardX = imageRight ? BOARD_WIDTH - MARGIN - cardW : MARGIN;
  const cardY = (BOARD_HEIGHT - cardH) / 2 - 14;
  const entrance = spring(range(time, plan.heading.at + 0.1, plan.heading.at + 0.95));

  if (scene.image && entrance > 0) {
    ctx.save();
    ctx.globalAlpha = clamp01(entrance);
    const slide = (1 - entrance) * (imageRight ? 70 : -70);
    ctx.translate(cardX + cardW / 2 + slide, cardY + cardH / 2);
    // A degree of tilt reads as a physical object rather than a div.
    ctx.rotate(((imageRight ? -1 : 1) * 1.1 * Math.PI) / 180);
    ctx.translate(-cardW / 2, -cardH / 2);

    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 46;
    ctx.shadowOffsetY = 22;
    ctx.beginPath();
    ctx.roundRect(0, 0, cardW, cardH, 26);
    ctx.fillStyle = theme.backdrop[0];
    ctx.fill();
    ctx.shadowColor = "transparent";

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, cardW, cardH, 26);
    ctx.clip();
    // The plate inside the card pushes the opposite way to the background.
    const push = 1.06 + smootherstep(clamp01(time / duration)) * 0.07;
    const scale =
      Math.max(cardW / scene.image.naturalWidth, cardH / scene.image.naturalHeight) * push;
    const width = scene.image.naturalWidth * scale;
    const height = scene.image.naturalHeight * scale;
    ctx.drawImage(scene.image, (cardW - width) / 2, (cardH - height) / 2, width, height);

    const sheen = ctx.createLinearGradient(0, cardH * 0.45, 0, cardH);
    sheen.addColorStop(0, "rgba(0,0,0,0)");
    sheen.addColorStop(1, withAlpha(theme.backdrop[2], 0.6));
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, cardW, cardH);
    ctx.restore();

    ctx.strokeStyle = theme.panelBorder;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, cardW - 1, cardH - 1, 26);
    ctx.stroke();
    ctx.restore();
  }

  const textX = imageRight ? MARGIN : BOARD_WIDTH - MARGIN - (cardW - 40);
  const textWidth = BOARD_WIDTH - MARGIN * 2 - cardW - 64;

  const heading = layoutDisplay(ctx, scene.heading, {
    family: options.fontSans,
    maxWidth: textWidth,
    maxSize: 58,
    minSize: 34,
    weight: 800,
    maxLines: 3,
    lineRatio: 1.06,
    emphasis: scene.keywords,
  });

  const headY = BOARD_HEIGHT * 0.36;

  drawEyebrow(ctx, eyebrowFor(scene), {
    x: textX + 38,
    y: headY - heading.size - 34,
    align: "left",
    theme,
    family: options.fontSans,
    reveal: range(time, plan.heading.at, plan.heading.at + 0.4),
  });

  drawDisplay(ctx, heading, {
    x: textX,
    y: headY,
    align: "left",
    theme,
    reveal: staggered(plan.heading, heading.count, time, 0.07),
  });

  let rowY = headY + (heading.lines.length - 1) * heading.lineHeight + 58;
  scene.bullets.slice(0, 4).forEach((bullet, index) => {
    const cue = plan.beats[index];
    if (!cue) return;
    const t = spring(range(time, cue.at, cue.at + Math.max(0.4, cue.span * 0.8)));
    if (t <= 0) return;

    const lines = wrapAt(ctx, bullet, options.fontSans, 26, textWidth - 42, 2);

    ctx.save();
    ctx.globalAlpha = clamp01(t);
    ctx.translate((1 - t) * -22, 0);

    // A marker rather than a bullet glyph: it can carry the accent and the
    // "this one is live" state without adding a second colour.
    const live = time < (plan.beats[index + 1]?.at ?? Infinity);
    ctx.fillStyle = live ? theme.accent : withAlpha(theme.accent, 0.4);
    ctx.beginPath();
    ctx.roundRect(textX, rowY - 18, 4, 22 + (lines.length - 1) * 32, 2);
    ctx.fill();

    ctx.font = `500 26px ${options.fontSans}`;
    ctx.fillStyle = theme.ink;
    ctx.textAlign = "left";
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 14;
    lines.forEach((line, lineIndex) => {
      ctx.fillText(line, textX + 22, rowY + lineIndex * 32);
    });
    ctx.restore();

    rowY += 32 * lines.length + 22;
  });
}

/**
 * THE METRIC — one number, arriving on the word that says it.
 *
 * Composed off-centre: the argument reads down the left, the number holds the
 * right. A centred number with a centred caption and a centred row of chips is
 * three centred things fighting for the same axis.
 */
function shotMetric(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;

  ctx.save();
  ctx.fillStyle = withAlpha(theme.backdrop[2], theme.dark ? 0.5 : 0.35);
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.restore();

  const columnWidth = 470;
  const ringX = BOARD_WIDTH - MARGIN - 196;
  const ringY = 322;
  const radius = 158;

  const heading = layoutDisplay(ctx, scene.heading, {
    family: options.fontSans,
    maxWidth: columnWidth,
    maxSize: 48,
    minSize: 30,
    weight: 800,
    maxLines: 3,
    lineRatio: 1.08,
    emphasis: scene.keywords,
  });

  drawEyebrow(ctx, eyebrowFor(scene), {
    x: MARGIN + 38,
    y: 168,
    align: "left",
    theme,
    family: options.fontSans,
    reveal: range(time, plan.heading.at, plan.heading.at + 0.4),
  });

  drawDisplay(ctx, heading, {
    x: MARGIN,
    y: 226,
    align: "left",
    theme,
    reveal: staggered(plan.heading, heading.count, time, 0.06),
  });

  // Proof points read down the column, under the claim they support.
  let rowY = 226 + (heading.lines.length - 1) * heading.lineHeight + 74;
  scene.bullets.slice(0, 3).forEach((bullet, index) => {
    const cue = plan.beats[index];
    if (!cue || rowY > SAFE_BOTTOM) return;
    const t = spring(range(time, cue.at, cue.at + 0.55));
    if (t <= 0) return;

    const lines = wrapAt(ctx, bullet, options.fontSans, 25, columnWidth - 34, 2);
    ctx.save();
    ctx.globalAlpha = clamp01(t);
    ctx.translate((1 - t) * -18, 0);

    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(MARGIN + 5, rowY - 7, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `500 25px ${options.fontSans}`;
    ctx.fillStyle = theme.inkMuted;
    ctx.textAlign = "left";
    lines.forEach((line, lineIndex) => ctx.fillText(line, MARGIN + 24, rowY + lineIndex * 32));
    ctx.restore();

    rowY += 32 * lines.length + 18;
  });

  if (!scene.stat) return;

  const cue = plan.stat ?? plan.heading;
  const count = range(time, cue.at, cue.at + Math.max(0.7, cue.span));
  if (count <= 0) return;

  // A ring that closes around the number as it counts.
  ctx.save();
  ctx.translate(ringX, ringY);
  ctx.rotate(-Math.PI / 2);
  ctx.lineCap = "round";
  ctx.strokeStyle = withAlpha(theme.ink, 0.1);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = theme.accent;
  ctx.shadowColor = accentGlow(theme, 0.5);
  ctx.shadowBlur = 22;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2 * easeOutQuint(count));
  ctx.stroke();
  ctx.restore();

  const settle = spring(count);
  ctx.save();
  ctx.translate(ringX, ringY);
  ctx.scale(lerp(0.88, 1, settle), lerp(0.88, 1, settle));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let size = 118;
  const shown = countUp(scene.stat, count);
  ctx.font = `900 ${size}px ${options.fontSans}`;
  while (ctx.measureText(shown).width > radius * 1.7 && size > 46) {
    size -= 6;
    ctx.font = `900 ${size}px ${options.fontSans}`;
  }

  ctx.shadowColor = accentGlow(theme, 0.45);
  ctx.shadowBlur = 34;
  ctx.fillStyle = theme.ink;
  ctx.fillText(shown, 0, 0);
  ctx.restore();

  if (scene.statCaption) {
    drawBodyLines(ctx, [scene.statCaption.toUpperCase()], {
      x: ringX,
      y: ringY + radius + 46,
      align: "center",
      theme,
      family: options.fontSans,
      size: 21,
      lineHeight: 28,
      reveal: range(time, cue.at + 0.3, cue.at + 0.8),
      colour: theme.inkMuted,
    });
  }
}

/** THE PROCESS — a rail that advances to whichever step is being spoken. */
function shotProcess(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;
  drawSideScrim(ctx, theme, "left");

  const heading = layoutDisplay(ctx, scene.heading, {
    family: options.fontSans,
    maxWidth: CONTENT_WIDTH * 0.62,
    maxSize: 50,
    minSize: 32,
    weight: 800,
    maxLines: 2,
    lineRatio: 1.08,
    emphasis: scene.keywords,
  });

  drawEyebrow(ctx, eyebrowFor(scene), {
    x: MARGIN + 38,
    y: 128,
    align: "left",
    theme,
    family: options.fontSans,
    reveal: range(time, plan.heading.at, plan.heading.at + 0.4),
  });

  drawDisplay(ctx, heading, {
    x: MARGIN,
    y: 190,
    align: "left",
    theme,
    reveal: staggered(plan.heading, heading.count, time, 0.06),
  });

  const steps = scene.bullets.slice(0, 4);
  const blockTop = 190 + (heading.lines.length - 1) * heading.lineHeight + 62;
  const available = Math.max(120, SAFE_BOTTOM - blockTop);
  const rowH = Math.min(102, available / Math.max(1, steps.length));
  // Centre the rail in whatever room the heading left, so a two-step scene
  // does not sit in the top corner of an empty frame.
  const top = blockTop + Math.max(0, (available - rowH * (steps.length - 1) - 40) / 2);
  const railX = MARGIN + 26;

  // The rail itself, drawn down to whichever step the narration has reached.
  const lastCue = plan.beats[steps.length - 1];
  const railEnd = lastCue ? clamp01(range(time, plan.beats[0]?.at ?? 0, lastCue.at)) : 0;

  ctx.save();
  ctx.strokeStyle = withAlpha(theme.ink, 0.12);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(railX, top - 12);
  ctx.lineTo(railX, top - 12 + rowH * (steps.length - 1) + 24);
  ctx.stroke();

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.shadowColor = accentGlow(theme, 0.5);
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(railX, top - 12);
  ctx.lineTo(railX, top - 12 + (rowH * (steps.length - 1) + 24) * easeOutCubic(railEnd));
  ctx.stroke();
  ctx.restore();

  steps.forEach((step, index) => {
    const cue = plan.beats[index];
    if (!cue) return;
    const t = spring(range(time, cue.at, cue.at + Math.max(0.45, cue.span * 0.9)));
    if (t <= 0) return;

    const nextAt = plan.beats[index + 1]?.at ?? Infinity;
    const live = time >= cue.at && time < nextAt;
    const y = top + index * rowH;

    ctx.save();
    ctx.globalAlpha = clamp01(t) * (live ? 1 : 0.72);
    ctx.translate((1 - t) * -26, 0);

    // Node on the rail.
    ctx.fillStyle = live ? theme.accent : theme.backdrop[0];
    ctx.strokeStyle = live ? theme.accent : withAlpha(theme.ink, 0.35);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(railX, y - 6, live ? 9 : 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (live) {
      // A soft halo on the live node, breathing with the voice.
      const energy = speechEnergy(plan.words, time);
      ctx.fillStyle = accentGlow(theme, 0.18 + energy * 0.16);
      ctx.beginPath();
      ctx.arc(railX, y - 6, 18 + energy * 7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = `700 14px ${options.fontSans}`;
    ctx.letterSpacing = "2.5px";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = live ? theme.accent : theme.inkMuted;
    ctx.fillText(`STEP ${String(index + 1).padStart(2, "0")}`, railX + 34, y - 18);
    ctx.letterSpacing = "0px";

    const lines = wrapAt(ctx, step, options.fontSans, 27, CONTENT_WIDTH * 0.56, 2, 600);
    ctx.font = `600 27px ${options.fontSans}`;
    ctx.fillStyle = theme.ink;
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 16;
    lines.forEach((line, lineIndex) => {
      ctx.fillText(line, railX + 34, y + 14 + lineIndex * 32);
    });
    ctx.restore();
  });
}

/** THE CONTRAST — two panels, one divider, both halves arriving on cue. */
function shotContrast(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;

  ctx.save();
  ctx.fillStyle = withAlpha(theme.backdrop[2], theme.dark ? 0.52 : 0.34);
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.restore();

  const heading = layoutDisplay(ctx, scene.heading, {
    family: options.fontSans,
    maxWidth: CONTENT_WIDTH * 0.8,
    maxSize: 52,
    minSize: 32,
    weight: 800,
    maxLines: 2,
    lineRatio: 1.08,
    emphasis: scene.keywords,
  });

  drawEyebrow(ctx, eyebrowFor(scene), {
    x: BOARD_WIDTH / 2,
    y: 122,
    align: "center",
    theme,
    family: options.fontSans,
    reveal: range(time, plan.heading.at, plan.heading.at + 0.4),
  });

  drawDisplay(ctx, heading, {
    x: BOARD_WIDTH / 2,
    y: 186,
    align: "center",
    theme,
    reveal: staggered(plan.heading, heading.count, time, 0.06),
  });

  const panelW = 466;
  const panelH = 236;
  const panelY = 290;
  const gap = 48;
  const left = BOARD_WIDTH / 2 - gap / 2 - panelW;
  const right = BOARD_WIDTH / 2 + gap / 2;

  const dividerT = smootherstep(range(time, plan.heading.at + 0.5, plan.heading.at + 1.2));
  if (dividerT > 0) {
    ctx.save();
    const height = panelH * dividerT;
    const gradient = ctx.createLinearGradient(0, panelY, 0, panelY + panelH);
    gradient.addColorStop(0, withAlpha(theme.accent, 0));
    gradient.addColorStop(0.5, withAlpha(theme.accent, 0.55));
    gradient.addColorStop(1, withAlpha(theme.accent, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(BOARD_WIDTH / 2 - 1, panelY + (panelH - height) / 2, 2, height);
    ctx.restore();
  }

  scene.bullets.slice(0, 2).forEach((bullet, index) => {
    const cue = plan.beats[index];
    if (!cue) return;
    const t = spring(range(time, cue.at, cue.at + Math.max(0.5, cue.span)));
    if (t <= 0) return;

    const x = index === 0 ? left : right;
    ctx.save();
    ctx.globalAlpha = clamp01(t);
    ctx.translate((1 - t) * (index === 0 ? -54 : 54), 0);

    ctx.fillStyle = theme.panel;
    ctx.strokeStyle = theme.panelBorder;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.roundRect(x, panelY, panelW, panelH, 22);
    ctx.fill();
    ctx.stroke();

    // The index is the only colour difference between the two sides.
    ctx.fillStyle = index === 0 ? withAlpha(theme.ink, 0.42) : theme.accent;
    ctx.font = `900 52px ${options.fontSans}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(index === 0 ? "01" : "02", x + 36, panelY + 78);

    const lines = wrapAt(ctx, bullet, options.fontSans, 28, panelW - 72, 3, 600);
    ctx.font = `600 28px ${options.fontSans}`;
    ctx.fillStyle = theme.ink;
    // Text block sits under the index and is centred in the panel's lower half.
    const textTop = panelY + 130 + ((3 - lines.length) * 36) / 2;
    lines.forEach((line, lineIndex) => {
      ctx.fillText(line, x + 36, textTop + lineIndex * 36);
    });
    ctx.restore();
  });
}

/** THE CLOSE — the point, held, then the video signs off. */
function shotTakeaway(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time, duration } = options;

  ctx.save();
  ctx.fillStyle = withAlpha(theme.backdrop[2], theme.dark ? 0.58 : 0.4);
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  const bloom = ctx.createRadialGradient(
    BOARD_WIDTH / 2,
    BOARD_HEIGHT * 0.42,
    20,
    BOARD_WIDTH / 2,
    BOARD_HEIGHT * 0.42,
    BOARD_WIDTH * 0.55,
  );
  bloom.addColorStop(0, accentGlow(theme, 0.12));
  bloom.addColorStop(1, withAlpha(theme.accent, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.restore();

  const heading = layoutDisplay(ctx, scene.heading, {
    family: options.fontSans,
    maxWidth: CONTENT_WIDTH * 0.82,
    maxSize: 74,
    minSize: 40,
    weight: 900,
    maxLines: 3,
    lineRatio: 1.06,
    emphasis: scene.keywords,
  });

  const centreY = BOARD_HEIGHT * 0.42 - heading.height / 2 + heading.size;

  drawEyebrow(ctx, "THE TAKEAWAY", {
    x: BOARD_WIDTH / 2,
    y: centreY - heading.size - 48,
    align: "center",
    theme,
    family: options.fontSans,
    reveal: range(time, plan.heading.at, plan.heading.at + 0.4),
  });

  drawDisplay(ctx, heading, {
    x: BOARD_WIDTH / 2,
    y: centreY,
    align: "center",
    theme,
    reveal: staggered(plan.heading, heading.count, time, 0.08),
  });

  const listY = Math.min(
    centreY + (heading.lines.length - 1) * heading.lineHeight + 74,
    SAFE_BOTTOM - 88,
  );
  drawAccentRule(
    ctx,
    theme,
    BOARD_WIDTH / 2 - 70,
    listY - 40,
    140,
    range(time, plan.heading.at + 0.5, plan.heading.at + 1.1),
    3,
  );

  scene.bullets.slice(0, 3).forEach((bullet, index) => {
    const cue = plan.beats[index];
    if (!cue) return;
    drawBodyLines(ctx, wrapAt(ctx, bullet, options.fontSans, 28, CONTENT_WIDTH * 0.76, 2), {
      x: BOARD_WIDTH / 2,
      y: listY + index * 40,
      align: "center",
      theme,
      family: options.fontSans,
      size: 28,
      lineHeight: 38,
      reveal: range(time, cue.at, cue.at + 0.5),
    });
  });

  // The last two seconds belong to the sign-off, not to another bullet.
  const signOff = smootherstep(range(time, duration - 1.9, duration - 0.9));
  if (signOff > 0) {
    ctx.save();
    ctx.globalAlpha = signOff;
    ctx.textAlign = "center";
    ctx.font = `700 15px ${options.fontSans}`;
    ctx.letterSpacing = "6px";
    ctx.fillStyle = theme.inkMuted;
    ctx.fillText("END", BOARD_WIDTH / 2, BOARD_HEIGHT - 108);
    ctx.letterSpacing = "0px";
    ctx.restore();
  }
}

/* -------------------------------- subtitles -------------------------------- */

/**
 * Burned-in captions, driven by the same word timings as everything else.
 *
 * The active word is lifted in the accent colour rather than boxed in neon:
 * the point is to show which word is being said, and a capsule that jumps
 * every 300ms is a social-media affectation, not a production value.
 */
export function drawSubtitles(
  ctx: CanvasRenderingContext2D,
  plan: ModernPlan,
  theme: Theme,
  time: number,
  fontSans: string,
) {
  const current = phraseAt(plan.phrases, time);
  if (!current) return;

  const { phrase, wordIndex } = current;
  const appear = smootherstep(range(time, phrase.start - 0.12, phrase.start + 0.16));
  if (appear <= 0) return;

  const size = 34;
  ctx.save();
  ctx.font = `800 ${size}px ${fontSans}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  const gap = ctx.measureText(" ").width;
  const parts = phrase.words.map((entry) => ({
    text: entry.word,
    width: ctx.measureText(entry.word).width,
  }));
  const total = parts.reduce((sum, part) => sum + part.width, 0) + gap * (parts.length - 1);

  const baseline = BOARD_HEIGHT - 74;
  let x = (BOARD_WIDTH - total) / 2;

  // A soft scrim rather than a card: the frame stays open.
  const scrim = ctx.createLinearGradient(0, baseline - 74, 0, baseline + 40);
  scrim.addColorStop(0, withAlpha(theme.backdrop[2], 0));
  scrim.addColorStop(1, withAlpha(theme.backdrop[2], theme.dark ? 0.72 : 0.8));
  ctx.fillStyle = scrim;
  ctx.fillRect(0, baseline - 74, BOARD_WIDTH, 114);

  ctx.globalAlpha = appear;
  parts.forEach((part, index) => {
    const spoken = index <= wordIndex;
    const isActive = index === wordIndex;
    const hit = isActive
      ? 1 - smootherstep(range(time, phrase.words[index].start, phrase.words[index].start + 0.16))
      : 0;

    ctx.save();
    ctx.translate(x + part.width / 2, baseline + (1 - appear) * 16);
    ctx.scale(1 + hit * 0.06, 1 + hit * 0.06);
    ctx.textAlign = "center";

    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = 7;
    ctx.strokeStyle = theme.dark ? "rgba(0,0,0,0.72)" : "rgba(255,255,255,0.8)";
    ctx.strokeText(part.text, 0, 0);

    if (isActive) {
      ctx.shadowColor = accentGlow(theme, 0.45);
      ctx.shadowBlur = 18;
      ctx.fillStyle = theme.accent;
    } else {
      ctx.fillStyle = spoken ? theme.ink : withAlpha(theme.ink, 0.55);
    }
    ctx.fillText(part.text, 0, 0);
    ctx.restore();

    x += part.width + gap;
  });

  ctx.restore();
}

/* ------------------------------- chapter rail ------------------------------ */

function drawChapterRail(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  progress: number,
  index: number,
  total: number,
) {
  const y = BOARD_HEIGHT - 5;
  ctx.save();
  ctx.fillStyle = withAlpha(theme.ink, 0.1);
  ctx.fillRect(0, y, BOARD_WIDTH, 3);

  const width = BOARD_WIDTH * clamp01(progress);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, y, width, 3);
  ctx.shadowColor = accentGlow(theme, 0.6);
  ctx.shadowBlur = 10;
  ctx.fillRect(Math.max(0, width - 2), y, 2, 3);
  ctx.restore();

  // Chapter ticks, so the length of the video is legible at a glance.
  if (total <= 1) return;
  ctx.save();
  for (let i = 1; i < total; i += 1) {
    const x = (BOARD_WIDTH * i) / total;
    ctx.fillStyle = withAlpha(theme.ink, i <= index ? 0.5 : 0.22);
    ctx.fillRect(x - 1, y - 2, 2, 7);
  }
  ctx.restore();
}

/* ------------------------------- transitions ------------------------------- */

export interface Transition {
  /** Fade to black at the cut. */
  dip: number;
  /** Scale applied to the whole frame. */
  scale: number;
  /** Horizontal push, in pixels. */
  shift: number;
  /** Blur radius, where the browser supports it. */
  blur: number;
}

/**
 * A cut with weight.
 *
 * Three flavours, chosen by scene index so a video does not repeat the same
 * transition twice running: a dip through black, a push, and a whip that
 * blurs out and back. Each is expressed as a transform on the finished frame,
 * so no scene ever has to be rendered twice.
 */
export function transitionFor(index: number, time: number, duration: number): Transition {
  const inT = smootherstep(range(time, 0, 0.42));
  const outT = smootherstep(range(time, duration - 0.34, duration));
  const flavour = index % 3;

  if (flavour === 0) {
    return {
      dip: (1 - inT) * 0.85 + outT * 0.85,
      scale: lerp(1.05, 1, inT) * lerp(1, 1.02, outT),
      shift: 0,
      blur: 0,
    };
  }
  if (flavour === 1) {
    return {
      dip: (1 - inT) * 0.4 + outT * 0.55,
      scale: 1,
      shift: (1 - inT) * 90 - outT * 70,
      blur: (1 - inT) * 5 + outT * 5,
    };
  }
  return {
    dip: (1 - inT) * 0.55 + outT * 0.7,
    scale: lerp(1.12, 1, inT) * lerp(1, 1.06, outT),
    shift: 0,
    blur: (1 - inT) * 9 + outT * 7,
  };
}

/* ------------------------------- public api ------------------------------- */

const SHOTS: Record<
  SceneRole,
  (
    ctx: CanvasRenderingContext2D,
    scene: ModernRenderScene,
    plan: ModernPlan,
    theme: Theme,
    options: ModernRenderOptions,
  ) => void
> = {
  hero: shotHero,
  statement: shotStatement,
  split: shotSplit,
  metric: shotMetric,
  process: shotProcess,
  contrast: shotContrast,
  takeaway: shotTakeaway,
};

/** How far the background is thrown out of focus for each shot type. */
const DEFOCUS: Record<SceneRole, number> = {
  hero: 0,
  statement: 0.35,
  split: 0.75,
  metric: 0.6,
  process: 0.55,
  contrast: 0.7,
  takeaway: 0.45,
};

export function renderModernScene(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  options: ModernRenderOptions,
) {
  const theme = themeOf(scene.visualTheme);
  const transition = transitionFor(scene.index, options.time, options.duration);

  ctx.save();
  ctx.translate(BOARD_WIDTH / 2 + transition.shift, BOARD_HEIGHT / 2);
  ctx.scale(transition.scale, transition.scale);
  ctx.translate(-BOARD_WIDTH / 2, -BOARD_HEIGHT / 2);

  drawBackdrop(ctx, scene, theme, options, DEFOCUS[plan.role]);
  drawLightDrift(
    ctx,
    BOARD_WIDTH,
    BOARD_HEIGHT,
    options.time + scene.index * 3.7,
    theme.accent,
    theme.dark ? 0.14 : 0.08,
  );

  SHOTS[plan.role](ctx, scene, plan, theme, options);

  if (plan.phrases.length) drawSubtitles(ctx, plan, theme, options.time, options.fontSans);

  drawVignette(ctx, BOARD_WIDTH, BOARD_HEIGHT, theme.dark ? 0.6 : 0.28);
  drawGrain(ctx, BOARD_WIDTH, BOARD_HEIGHT, options.time, theme.dark ? 0.055 : 0.03);
  ctx.restore();

  drawChapterRail(
    ctx,
    theme,
    options.globalProgress ?? (scene.index + options.time / options.duration) / scene.totalScenes,
    scene.index,
    scene.totalScenes,
  );
  drawLetterbox(ctx, BOARD_WIDTH, BOARD_HEIGHT, 0);

  if (transition.dip > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${clamp(transition.dip, 0, 1)})`;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.restore();
  }
}

/** The opening plate: the title, assembled. */
export function renderModernCover(
  ctx: CanvasRenderingContext2D,
  options: {
    title: string;
    description: string;
    fontSans: string;
    progress: number;
    theme?: ThemeName;
    image?: HTMLImageElement | null;
  },
) {
  const theme = themeOf(options.theme);
  const p = clamp01(options.progress);
  const time = p * 3;

  drawBackdrop(
    ctx,
    {
      heading: options.title,
      bullets: [],
      narration: "",
      index: 0,
      totalScenes: 1,
      image: options.image,
    },
    theme,
    { time, duration: 3, fontSans: options.fontSans },
    0.25,
  );

  ctx.save();
  ctx.fillStyle = withAlpha(theme.backdrop[2], theme.dark ? 0.45 : 0.3);
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.restore();

  drawLightDrift(ctx, BOARD_WIDTH, BOARD_HEIGHT, time, theme.accent, 0.2);

  const title = layoutDisplay(ctx, options.title, {
    family: options.fontSans,
    maxWidth: CONTENT_WIDTH * 0.84,
    maxSize: 88,
    minSize: 44,
    weight: 900,
    maxLines: 3,
    lineRatio: 1.04,
  });

  const centreY = BOARD_HEIGHT * 0.52 - title.height / 2 + title.size;
  const push = 1 + (1 - easeOutCubic(p)) * 0.04;

  ctx.save();
  ctx.translate(BOARD_WIDTH / 2, BOARD_HEIGHT / 2);
  ctx.scale(push, push);
  ctx.translate(-BOARD_WIDTH / 2, -BOARD_HEIGHT / 2);

  drawAccentRule(ctx, theme, BOARD_WIDTH / 2 - 34, centreY - title.size - 54, 68, range(p, 0.02, 0.3), 4);

  drawDisplay(ctx, title, {
    x: BOARD_WIDTH / 2,
    y: centreY,
    align: "center",
    theme,
    reveal: (index) => range(p, 0.08 + index * 0.045, 0.34 + index * 0.045),
  });

  if (options.description) {
    drawBodyLines(
      ctx,
      wrapAt(ctx, options.description, options.fontSans, 29, CONTENT_WIDTH * 0.7, 2),
      {
        x: BOARD_WIDTH / 2,
        y: centreY + (title.lines.length - 1) * title.lineHeight + 68,
        align: "center",
        theme,
        family: options.fontSans,
        size: 29,
        lineHeight: 40,
        reveal: range(p, 0.45, 0.75),
      },
    );
  }
  ctx.restore();

  drawVignette(ctx, BOARD_WIDTH, BOARD_HEIGHT, theme.dark ? 0.62 : 0.3);
  drawGrain(ctx, BOARD_WIDTH, BOARD_HEIGHT, time, theme.dark ? 0.055 : 0.03);

  // Open from black, and hand over to the first scene without a hard cut.
  const dip = (1 - smootherstep(range(p, 0, 0.16))) * 1 + smootherstep(range(p, 0.9, 1)) * 0.85;
  if (dip > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${clamp(dip, 0, 1)})`;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.restore();
  }
}

export { drawGlassPanel, themeOf };
