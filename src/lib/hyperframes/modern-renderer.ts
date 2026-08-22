import { BOARD_HEIGHT, BOARD_WIDTH } from "@/lib/whiteboard/scene";
import {
  clamp,
  clamp01,
  easeOutCubic,
  easeOutQuint,
  pulse,
  range,
  smootherstep,
} from "@/lib/video/easing";
import { lerp } from "@/lib/video/easing";
import { withAlpha } from "@/lib/video/grade";
import {
  buildPhrases,
  phraseAt,
  planCues,
  readingTime,
  type Cue,
  type SubtitlePhrase,
  type WordTiming,
} from "@/lib/video/timing";
import { themeOf, type Theme, type ThemeName } from "./theme";
import {
  drawArrow,
  drawCard,
  drawEdgeShape,
  drawEmoji,
  drawFramedPhoto,
  drawGround,
  drawMarker,
  drawOutlineNumeral,
  drawWashedPhoto,
} from "./paper";
import { emojiFor } from "./emoji";
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
  /** The accent glyph for this scene, picked from what it is about. */
  glyph: string;
  /** One per drawn item, where a shot places several. */
  itemGlyphs: string[];
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
  /** The shots already used, most recent last, so the film keeps varying. */
  recentRoles?: SceneRole[];
}): SceneRole {
  const pick = (): SceneRole => {
    if (scene.index === 0) return "hero";
    if (scene.totalScenes > 2 && scene.index === scene.totalScenes - 1) return "takeaway";
    if (scene.stat?.trim()) return "metric";
    if (scene.bullets.length >= 3) return "process";
    if (scene.bullets.length === 2) return "contrast";
    return "statement";
  };

  const role = pick();
  // Two back is far enough to matter: at six or eight scenes an A-B-A-B
  // alternation reads as a template just as clearly as a straight repeat.
  const recent = (scene.recentRoles ?? []).slice(-2);
  if (!recent.includes(role)) return role;
  const alternatives: Record<SceneRole, SceneRole[]> = {
    hero: ["statement"],
    statement: ["split", "contrast"],
    split: ["statement", "contrast"],
    metric: ["split", "statement"],
    process: ["split", "contrast"],
    contrast: ["split", "process"],
    takeaway: ["statement"],
  };

  for (const candidate of alternatives[role]) {
    if (recent.includes(candidate)) continue;
    if (candidate === "process" && scene.bullets.length < 3) continue;
    if (candidate === "contrast" && scene.bullets.length < 2) continue;
    if (candidate === "split" && !scene.bullets.length) continue;
    return candidate;
  }
  return role;
}

export function planModernScene(
  scene: ModernRenderScene,
  words: WordTiming[],
  timing: SceneTiming,
  recentRoles?: SceneRole[],
  /** Glyphs already used in this video, so no two frames wear the same one. */
  usedGlyphs?: Set<string>,
): ModernPlan {
  const role = roleFor({ ...scene, recentRoles });
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

  // Picked once, here, rather than per frame: it has to be stable for the
  // whole scene and unique across the video.
  const seen = usedGlyphs ?? new Set<string>();
  const glyph = emojiFor(
    [scene.keywords?.join(" "), scene.heading, scene.bullets.join(" ")],
    { avoid: seen, index: scene.index },
  );
  const itemGlyphs = scene.bullets
    .slice(0, 3)
    .map((bullet, index) => emojiFor([bullet], { avoid: seen, index: scene.index + index + 1 }));

  return {
    role,
    glyph,
    itemGlyphs,
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

/* ---------------------------------- shots --------------------------------- */

const MARGIN = 96;
const CONTENT_WIDTH = BOARD_WIDTH - MARGIN * 2;
/**
 * Nothing a shot composes may cross this line: below it lives the subtitle
 * band, and type over type is the fastest way to make a video look unfinished.
 */
const SAFE_BOTTOM = 552;

/** Word-by-word entrance timing, in reading order. */
function staggered(cue: Cue, count: number, time: number, per = 0.075) {
  const total = Math.max(0.0001, cue.span);
  return (index: number) => {
    const start = cue.at + Math.min(index * per, total * 0.55);
    return range(time, start, start + Math.max(0.28, total * 0.55));
  };
}

/** The small line above a heading: where you are, and what this one is about. */
function eyebrowFor(scene: ModernRenderScene): string {
  const number = String(scene.index + 1).padStart(2, "0");
  const keyword = scene.keywords?.[0]?.trim();
  return keyword ? `${number} — ${keyword.toUpperCase()}` : `${number} / ${String(scene.totalScenes).padStart(2, "0")}`;
}

/** A short accent rule. Flat, no glow -- this is printed work. */
function drawRule(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  x: number,
  y: number,
  width: number,
  progress: number,
  height = 5,
) {
  const t = easeOutQuint(clamp01(progress));
  if (t <= 0) return;
  ctx.save();
  ctx.fillStyle = theme.accent;
  ctx.fillRect(x, y, width * t, height);
  ctx.restore();
}

/** The picture a shot was given, if it is actually usable. */
function pictureOf(scene: ModernRenderScene): HTMLImageElement | null {
  const image = scene.image;
  return image && image.complete && image.naturalWidth > 0 ? image : null;
}

/* --------------------------------- 1. hero -------------------------------- */

/**
 * THE TITLE CARD — one big card on the paper, and the title is the whole frame.
 *
 * The card carries a rule across its top and the picture mounted at its right
 * edge, overlapping it, so the composition has one thing breaking the box. A
 * title that sits neatly inside its own rectangle reads as a template.
 */
function shotHero(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;
  const enter = smootherstep(range(time, 0, 0.7));
  const picture = pictureOf(scene);

  const card = {
    x: MARGIN * 0.62,
    y: 70,
    width: BOARD_WIDTH - MARGIN * 1.55,
    height: SAFE_BOTTOM - 88,
  };
  drawCard(ctx, card, {
    fill: theme.accent,
    radius: 34,
    offset: 12,
    shadow: theme.shadow,
    enter,
  });

  const heading = layoutDisplay(ctx, scene.heading, {
    family: options.fontSans,
    maxWidth: card.width - 150 - (picture ? 210 : 0),
    maxSize: 104,
    minSize: 46,
    weight: 800,
    maxLines: 3,
    lineRatio: 1.04,
  });

  const kicker = scene.bullets[0];
  const kickerLines = kicker
    ? wrapAt(ctx, kicker, options.fontSans, 30, card.width - 150 - (picture ? 190 : 0), 2)
    : [];

  const blockHeight = heading.height + (kickerLines.length ? 26 + kickerLines.length * 42 : 0);
  const baseY = card.y + card.height / 2 - blockHeight / 2 + heading.size * 0.82;

  // The rule sits above the type, and only when the headline leaves room for
  // it. A rule struck through a headline is worse than no rule at all.
  const ruleY = baseY - heading.size - 46;
  if (ruleY > card.y + 40) {
    const ruleWidth = card.width - 128;
    ctx.save();
    ctx.strokeStyle = theme.shadow;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(card.x + 64, ruleY);
    ctx.lineTo(card.x + 64 + ruleWidth * easeOutQuint(clamp01(enter * 1.2)), ruleY);
    ctx.stroke();
    ctx.restore();
  }

  drawDisplay(ctx, heading, {
    x: card.x + 64,
    y: baseY,
    align: "left",
    theme,
    colour: theme.shadow,
    shadow: false,
    reveal: staggered(plan.heading, heading.count, time, 0.08),
  });

  if (kickerLines.length && plan.beats[0]) {
    drawBodyLines(ctx, kickerLines, {
      x: card.x + 64,
      y: baseY + (heading.lines.length - 1) * heading.lineHeight + 74,
      align: "left",
      theme,
      family: options.fontSans,
      size: 30,
      lineHeight: 42,
      colour: withAlpha(theme.shadow, 0.78),
      reveal: range(time, plan.beats[0].at, plan.beats[0].at + 0.5),
    });
  }

  // One of the two, never both: a photograph and a glyph in the same corner
  // is two accents fighting.
  if (!picture) {
    drawEmoji(ctx, plan.glyph, card.x + card.width - 150, card.y + card.height * 0.42, 150, {
      enter: smootherstep(range(time, 0.4, 1.1)),
      time,
      tilt: -8,
      seed: scene.index,
    });
  }

  // The picture breaks the card's right edge rather than sitting inside it.
  if (picture) {
    const size = 248;
    drawFramedPhoto(ctx, picture, {
      // Overlapping the card edge, but never the frame edge -- a picture the
      // canvas crops looks like a mistake rather than a composition.
      x: Math.min(card.x + card.width - size * 0.46, BOARD_WIDTH - size - 26),
      y: card.y + card.height * 0.46 - size / 2,
      width: size,
      height: size,
    }, {
      time,
      duration: options.duration,
      index: scene.index,
      theme,
      radius: size / 2,
      offset: 10,
      enter: smootherstep(range(time, 0.35, 1.1)),
    });
  }
}

/* ------------------------------- 2. statement ------------------------------ */

/**
 * THE STATEMENT — one sentence, and a marker under the words that carry it.
 *
 * A pale accent disc sits behind the type, well off centre. It is the only
 * decoration in the frame and it exists to stop a wall of words floating in
 * white space.
 */
function shotStatement(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;
  const enter = smootherstep(range(time, 0, 0.8));
  const picture = pictureOf(scene);

  // The watermark: a disc drifting a few pixels, behind everything.
  const drift = Math.sin(time * 0.32 + scene.index) * 9;
  drawEdgeShape(
    ctx,
    "circle",
    { x: BOARD_WIDTH * 0.52, y: 96 + drift, width: 420, height: 420 },
    theme.surface,
    0.9 * enter,
  );

  const heading = layoutDisplay(ctx, scene.heading, {
    family: options.fontSans,
    maxWidth: CONTENT_WIDTH * (picture ? 0.62 : 0.86),
    maxSize: 92,
    minSize: 42,
    weight: 800,
    maxLines: 4,
    lineRatio: 1.1,
    emphasis: scene.keywords,
  });

  const baseY = BOARD_HEIGHT * 0.44 - heading.height / 2 + heading.size * 0.82;

  drawEyebrow(ctx, eyebrowFor(scene), {
    x: MARGIN,
    y: baseY - heading.size * 0.95 - 40,
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
    shadow: false,
    highlight: true,
    reveal: staggered(plan.heading, heading.count, time, 0.07),
  });

  const kicker = scene.bullets[0];
  if (kicker && plan.beats[0]) {
    drawBodyLines(ctx, wrapAt(ctx, kicker, options.fontSans, 29, CONTENT_WIDTH * 0.54, 2), {
      x: MARGIN,
      y: baseY + (heading.lines.length - 1) * heading.lineHeight + 78,
      align: "left",
      theme,
      family: options.fontSans,
      size: 29,
      lineHeight: 40,
      reveal: range(time, plan.beats[0].at, plan.beats[0].at + 0.5),
    });
  }

  if (!picture) {
    drawEmoji(ctx, plan.glyph, BOARD_WIDTH - MARGIN - 96, 214, 168, {
      enter: smootherstep(range(time, 0.35, 1.05)),
      time,
      tilt: 9,
      seed: scene.index + 3,
    });
  }

  if (picture) {
    drawFramedPhoto(ctx, picture, {
      x: BOARD_WIDTH - MARGIN - 330,
      y: 132,
      width: 330,
      height: 300,
    }, {
      time,
      duration: options.duration,
      index: scene.index,
      theme,
      enter: smootherstep(range(time, 0.4, 1.2)),
    });
  }
}

/* --------------------------------- 3. split -------------------------------- */

/** THE SPLIT — the picture on one side, the argument on the other. */
function shotSplit(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;
  const picture = pictureOf(scene);
  // Alternating sides is what keeps a run of split shots from reading as one
  // template repeated.
  const mediaLeft = scene.index % 2 === 0;

  const mediaBox = {
    x: mediaLeft ? MARGIN : BOARD_WIDTH - MARGIN - 470,
    y: 118,
    width: 470,
    height: 372,
  };
  const textX = mediaLeft ? MARGIN + 470 + 62 : MARGIN;
  const textWidth = CONTENT_WIDTH - 470 - 62;

  if (picture) {
    drawFramedPhoto(ctx, picture, mediaBox, {
      time,
      duration: options.duration,
      index: scene.index,
      theme,
      enter: smootherstep(range(time, 0.1, 0.9)),
    });
  } else {
    drawCard(ctx, mediaBox, {
      fill: theme.surface,
      offset: 10,
      shadow: theme.shadow,
      enter: smootherstep(range(time, 0.1, 0.9)),
    });
  }

  const heading = layoutDisplay(ctx, scene.heading, {
    family: options.fontSans,
    maxWidth: textWidth,
    maxSize: 62,
    minSize: 34,
    weight: 800,
    maxLines: 3,
    lineRatio: 1.08,
    emphasis: scene.keywords,
  });

  const baseY = 214;
  drawEmoji(ctx, plan.glyph, textX + 26, baseY - heading.size - 86, 54, {
    enter: smootherstep(range(time, 0.2, 0.8)),
    time,
    tilt: -6,
    seed: scene.index + 5,
  });

  drawEyebrow(ctx, eyebrowFor(scene), {
    x: textX + 62,
    y: baseY - heading.size - 74,
    align: "left",
    theme,
    family: options.fontSans,
    reveal: range(time, plan.heading.at, plan.heading.at + 0.4),
  });

  drawDisplay(ctx, heading, {
    x: textX,
    y: baseY,
    align: "left",
    theme,
    shadow: false,
    highlight: true,
    reveal: staggered(plan.heading, heading.count, time, 0.07),
  });

  let y = baseY + (heading.lines.length - 1) * heading.lineHeight + 62;
  drawRule(ctx, theme, textX, y - 18, 92, range(time, plan.heading.at + 0.4, plan.heading.at + 0.9));

  y += 26;
  scene.bullets.slice(0, 3).forEach((bullet, index) => {
    const cue = plan.beats[index];
    if (!cue) return;
    const reveal = smootherstep(range(time, cue.at, cue.at + 0.45));
    if (reveal <= 0) return;

    const lines = wrapAt(ctx, bullet, options.fontSans, 27, textWidth - 34, 2);

    ctx.save();
    ctx.globalAlpha = reveal;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(textX + 7, y - 9, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawBodyLines(ctx, lines, {
      x: textX + 34,
      y: y + (1 - reveal) * 10,
      align: "left",
      theme,
      family: options.fontSans,
      size: 27,
      lineHeight: 37,
      reveal,
    });

    y += lines.length * 37 + 24;
  });
}

/* -------------------------------- 4. metric -------------------------------- */

/** THE NUMBER — one figure, a marker swiped under it, and what it means. */
function shotMetric(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;
  const picture = pictureOf(scene);
  const statCue = plan.stat ?? plan.heading;
  const enter = smootherstep(range(time, 0, 0.8));

  const cardBox = picture
    ? { x: MARGIN, y: 128, width: CONTENT_WIDTH * 0.52, height: 352 }
    : { x: BOARD_WIDTH / 2 - 420, y: 132, width: 840, height: 348 };

  drawCard(ctx, cardBox, {
    fill: theme.card,
    offset: 12,
    shadow: theme.shadow,
    enter,
    stroke: theme.dark ? undefined : withAlpha(theme.shadow, 0.14),
    strokeWidth: 2,
  });

  const value = countUp(scene.stat ?? "", clamp01((time - statCue.at) / Math.max(0.35, statCue.span)));
  const centreX = cardBox.x + cardBox.width / 2;

  ctx.save();
  const size = Math.min(168, (cardBox.width - 96) / Math.max(2.2, value.length * 0.56));
  ctx.font = `800 ${size}px ${options.fontSans}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const metrics = ctx.measureText(value || "0");
  const numberY = cardBox.y + cardBox.height * 0.56;

  // The marker goes behind the figure, wiping in as the narrator says it.
  drawMarker(
    ctx,
    {
      x: centreX - metrics.width / 2 - 16,
      y: numberY - size * 0.62,
      width: metrics.width + 32,
      height: size * 0.72,
    },
    theme.accent,
    smootherstep(range(time, statCue.at, statCue.at + 0.55)),
  );

  ctx.fillStyle = theme.ink;
  ctx.globalAlpha = clamp01(range(time, statCue.at - 0.15, statCue.at + 0.25));
  ctx.fillText(value, centreX, numberY);
  ctx.restore();

  drawEmoji(ctx, plan.glyph, cardBox.x + 60, cardBox.y + 60, 52, {
    enter: smootherstep(range(time, 0.25, 0.85)),
    time,
    tilt: -10,
    seed: scene.index + 2,
  });

  const caption = scene.statCaption?.trim() || scene.heading;
  if (caption) {
    drawBodyLines(ctx, wrapAt(ctx, caption, options.fontSans, 27, cardBox.width - 96, 2), {
      x: centreX,
      y: numberY + 58,
      align: "center",
      theme,
      family: options.fontSans,
      size: 27,
      lineHeight: 36,
      reveal: range(time, statCue.at + 0.3, statCue.at + 0.8),
    });
  }

  if (picture) {
    drawFramedPhoto(ctx, picture, {
      x: cardBox.x + cardBox.width + 54,
      y: 128,
      width: CONTENT_WIDTH - cardBox.width - 54,
      height: 352,
    }, {
      time,
      duration: options.duration,
      index: scene.index,
      theme,
      enter: smootherstep(range(time, 0.3, 1.1)),
    });
  } else {
    const heading = layoutDisplay(ctx, scene.heading, {
      family: options.fontSans,
      maxWidth: CONTENT_WIDTH * 0.7,
      maxSize: 44,
      minSize: 26,
      weight: 700,
      maxLines: 2,
      lineRatio: 1.12,
    });
    drawDisplay(ctx, heading, {
      x: BOARD_WIDTH / 2,
      y: cardBox.y + cardBox.height + 82,
      align: "center",
      theme,
      shadow: false,
      reveal: staggered(plan.heading, heading.count, time, 0.06),
    });
  }
}

/* -------------------------------- 5. process ------------------------------- */

/**
 * THE SEQUENCE — a title, a band of accent, and the steps laid across it.
 *
 * The band is what makes this shot: the cards sit half on paper and half on
 * colour, which gives the row somewhere to live without drawing a container
 * around it.
 */
function shotProcess(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;
  const enter = smootherstep(range(time, 0, 0.6));

  const heading = layoutDisplay(ctx, scene.heading, {
    family: options.fontSans,
    maxWidth: CONTENT_WIDTH * 0.8,
    maxSize: 58,
    minSize: 32,
    weight: 800,
    maxLines: 2,
    lineRatio: 1.06,
  });

  drawDisplay(ctx, heading, {
    x: MARGIN,
    y: 118,
    align: "left",
    theme,
    shadow: false,
    reveal: staggered(plan.heading, heading.count, time, 0.06),
  });

  const bandY = 210;
  const bandHeight = 286;
  ctx.save();
  ctx.globalAlpha = enter;
  ctx.fillStyle = withAlpha(theme.accent, theme.dark ? 0.22 : 0.34);
  ctx.fillRect(0, bandY, BOARD_WIDTH * easeOutQuint(enter), bandHeight);
  ctx.restore();

  const steps = scene.bullets.slice(0, 3);
  const gap = 46;
  // Cards keep the width they would have in a row of three, so two steps do
  // not stretch into slabs -- the row is centred in the gap instead.
  const cardWidth = (CONTENT_WIDTH - gap * 2) / 3;
  const rowWidth = cardWidth * steps.length + gap * (steps.length - 1);
  const rowX = (BOARD_WIDTH - rowWidth) / 2;
  const cardHeight = 196;
  const cardY = bandY + bandHeight / 2 - cardHeight / 2;

  steps.forEach((step, index) => {
    const cue = plan.beats[index];
    if (!cue) return;
    const reveal = smootherstep(range(time, cue.at, cue.at + 0.5));
    if (reveal <= 0) return;

    const x = rowX + index * (cardWidth + gap);

    if (index > 0) {
      drawArrow(
        ctx,
        { x: x - gap + 10, y: cardY + cardHeight / 2 },
        { x: x - 6, y: cardY + cardHeight / 2 },
        // Ink, not accent: an accent arrow on an accent band disappears.
        withAlpha(theme.ink, 0.55),
        smootherstep(range(time, cue.at - 0.2, cue.at + 0.25)),
      );
    }

    drawCard(ctx, { x, y: cardY, width: cardWidth, height: cardHeight }, {
      fill: theme.card,
      radius: 22,
      offset: 9,
      shadow: theme.shadow,
      enter: reveal,
      stroke: theme.dark ? withAlpha(theme.ink, 0.1) : undefined,
      strokeWidth: 2,
    });

    // A numbered chip, then the step in its own words. Splitting the bullet
    // into a "title" and a "body" printed the same sentence twice whenever it
    // had no punctuation to split on.
    ctx.save();
    ctx.globalAlpha = reveal;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(x + 44, cardY + 46, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.shadow;
    ctx.font = `800 18px ${options.fontSans}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), x + 44, cardY + 47);
    ctx.restore();

    drawEmoji(ctx, plan.itemGlyphs[index] ?? plan.glyph, x + cardWidth - 44, cardY + 46, 40, {
      enter: reveal,
      time,
      tilt: index % 2 === 0 ? 7 : -7,
      seed: scene.index * 3 + index,
    });

    drawBodyLines(ctx, wrapAt(ctx, step, options.fontSans, 23, cardWidth - 52, 4), {
      x: x + 26,
      y: cardY + 104,
      align: "left",
      theme,
      family: options.fontSans,
      size: 23,
      lineHeight: 31,
      reveal,
    });
  });
}

/* -------------------------------- 6. contrast ------------------------------ */

/** THE COMPARISON — two cards, numbered, with the distinction marked. */
function shotContrast(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;

  const heading = layoutDisplay(ctx, scene.heading, {
    family: options.fontSans,
    maxWidth: CONTENT_WIDTH * 0.78,
    maxSize: 54,
    minSize: 30,
    weight: 800,
    maxLines: 2,
    lineRatio: 1.06,
  });

  drawDisplay(ctx, heading, {
    x: MARGIN,
    y: 112,
    align: "left",
    theme,
    shadow: false,
    reveal: staggered(plan.heading, heading.count, time, 0.06),
  });

  const pair = scene.bullets.slice(0, 2);
  const gap = 44;
  const cardWidth = (CONTENT_WIDTH - gap) / 2;
  const cardY = 196;
  const cardHeight = SAFE_BOTTOM - cardY - 16;

  pair.forEach((entry, index) => {
    const cue = plan.beats[index];
    if (!cue) return;
    const reveal = smootherstep(range(time, cue.at, cue.at + 0.55));
    if (reveal <= 0) return;

    const x = MARGIN + index * (cardWidth + gap);
    drawCard(ctx, { x, y: cardY, width: cardWidth, height: cardHeight }, {
      fill: theme.surface,
      radius: 30,
      offset: 11,
      shadow: theme.shadow,
      enter: reveal,
    });

    drawEmoji(ctx, plan.itemGlyphs[index] ?? plan.glyph, x + cardWidth - 74, cardY + 78, 68, {
      enter: reveal,
      time,
      tilt: index === 0 ? -8 : 8,
      seed: scene.index * 5 + index,
    });

    drawOutlineNumeral(ctx, String(index + 1).padStart(2, "0"), x + 40, cardY + 104, 78, {
      family: options.fontSans,
      stroke: theme.shadow,
      shadow: withAlpha(theme.accent, 0.85),
      fill: undefined,
      offset: 5,
      lineWidth: 3,
    });

    const lines = wrapAt(ctx, entry, options.fontSans, 30, cardWidth - 80, 5);
    drawBodyLines(ctx, lines, {
      x: x + 40,
      y: cardY + 172,
      align: "left",
      theme,
      family: options.fontSans,
      size: 30,
      lineHeight: 42,
      colour: theme.dark ? theme.ink : theme.shadow,
      reveal,
    });
  });
}

/* -------------------------------- 7. takeaway ------------------------------ */

/**
 * THE CHAPTER PLATE — the frame goes to colour, and one card carries the line.
 *
 * Used to close, and it is the only shot that floods the frame. After a run of
 * paper-white compositions the change of ground is what tells a viewer this
 * one matters.
 */
function shotTakeaway(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;
  const enter = smootherstep(range(time, 0, 0.75));

  ctx.save();
  ctx.globalAlpha = enter;
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.restore();

  drawOutlineNumeral(
    ctx,
    String(scene.index + 1).padStart(2, "0"),
    MARGIN * 0.34,
    SAFE_BOTTOM * 0.74,
    300,
    {
      family: options.fontSans,
      stroke: theme.shadow,
      shadow: withAlpha(theme.shadow, 0.9),
      fill: theme.accent,
      offset: 9,
      lineWidth: 5,
      align: "left",
    },
  );

  drawEmoji(ctx, plan.glyph, MARGIN * 1.1, SAFE_BOTTOM - 40, 92, {
    enter: smootherstep(range(time, 0.5, 1.15)),
    time,
    tilt: -10,
    seed: scene.index + 9,
  });

  const card = {
    x: BOARD_WIDTH * 0.345,
    y: 122,
    width: BOARD_WIDTH * 0.74,
    height: SAFE_BOTTOM - 210,
  };
  drawCard(ctx, card, {
    fill: theme.card,
    radius: 44,
    offset: 12,
    shadow: theme.shadow,
    enter: smootherstep(range(time, 0.18, 0.95)),
  });

  const heading = layoutDisplay(ctx, scene.heading, {
    family: options.fontSans,
    maxWidth: BOARD_WIDTH * 0.46,
    maxSize: 70,
    minSize: 34,
    weight: 700,
    maxLines: 2,
    lineRatio: 1.08,
  });

  const kicker = scene.bullets[0];
  const baseY = card.y + card.height / 2 - heading.height / 2 + heading.size * 0.8 - (kicker ? 22 : 0);

  drawDisplay(ctx, heading, {
    x: card.x + 78,
    y: baseY,
    align: "left",
    theme,
    colour: theme.ink,
    shadow: false,
    reveal: staggered(plan.heading, heading.count, time, 0.07),
  });

  if (kicker && plan.beats[0]) {
    drawBodyLines(ctx, wrapAt(ctx, kicker, options.fontSans, 30, BOARD_WIDTH * 0.42, 2), {
      x: card.x + 78,
      y: baseY + (heading.lines.length - 1) * heading.lineHeight + 66,
      align: "left",
      theme,
      family: options.fontSans,
      size: 30,
      lineHeight: 40,
      reveal: range(time, plan.beats[0].at, plan.beats[0].at + 0.5),
    });
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
  surface?: { ground: string; ink: string },
) {
  const ground = surface?.ground ?? theme.ground;
  const captionInk = surface?.ink ?? theme.ink;
  const current = phraseAt(plan.phrases, time);
  if (!current) return;

  const { phrase, wordIndex } = current;
  const appear = smootherstep(range(time, phrase.start - 0.12, phrase.start + 0.18));
  const leave = 1 - smootherstep(range(time, phrase.end - 0.12, phrase.end + 0.06));
  const alpha = Math.min(appear, leave);
  if (alpha <= 0.01) return;

  const size = 34;
  ctx.save();
  ctx.font = `800 ${size}px ${fontSans}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  const gap = ctx.measureText(" ").width;
  const widths = phrase.words.map((entry) => ctx.measureText(entry.word).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);

  const baseline = BOARD_HEIGHT - 74;
  const left = (BOARD_WIDTH - total) / 2;

  // Every word's box up front, so the marker can be placed between two of them
  // rather than redrawn from scratch on each one.
  const boxes: Array<{ x: number; width: number; text: string }> = [];
  let cursor = left;
  phrase.words.forEach((entry, index) => {
    boxes.push({ x: cursor, width: widths[index], text: entry.word });
    cursor += widths[index] + gap;
  });

  // The band is the paper coming back up, not a cinema scrim.
  const scrim = ctx.createLinearGradient(0, baseline - 82, 0, baseline + 44);
  scrim.addColorStop(0, withAlpha(ground, 0));
  scrim.addColorStop(0.45, withAlpha(ground, 0.92));
  scrim.addColorStop(1, withAlpha(ground, 1));
  ctx.fillStyle = scrim;
  ctx.fillRect(0, baseline - 82, BOARD_WIDTH, 126);

  // The whole phrase rises the last few pixels as it arrives.
  ctx.globalAlpha = alpha;
  ctx.translate(0, (1 - appear) * 18);

  const drawWords = (colour: (index: number) => string) => {
    boxes.forEach((box, index) => {
      // A word lifts a fraction as the narrator reaches it, then settles.
      const said = phrase.words[index].start;
      const lift = index === wordIndex ? pulse(clamp01((time - said) / 0.26), 0.35, 0.5) : 0;
      ctx.save();
      ctx.translate(box.x + box.width / 2, baseline - lift * 3);
      ctx.scale(1 + lift * 0.05, 1 + lift * 0.05);
      ctx.textAlign = "center";
      ctx.fillStyle = colour(index);
      ctx.fillText(box.text, 0, 0);
      ctx.restore();
    });
  };

  drawWords((index) =>
    index <= wordIndex ? captionInk : withAlpha(captionInk, 0.42),
  );

  // The marker glides from the previous word to the current one and morphs
  // width on the way. A rectangle that teleports word to word is the single
  // cheapest-looking thing a caption can do.
  const active = boxes[wordIndex];
  if (active) {
    const said = phrase.words[wordIndex].start;
    const glide = smootherstep(range(time, said - 0.05, said + 0.16));
    const from = boxes[Math.max(0, wordIndex - 1)];
    const markerX = lerp(from.x, active.x, glide) - 7;
    const markerW = lerp(from.width, active.width, glide) + 14;
    const markerBox = {
      x: markerX,
      y: baseline - size * 0.8,
      width: markerW,
      height: size * 1.02,
    };

    ctx.save();
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(markerBox.x, markerBox.y + 5);
    ctx.lineTo(markerBox.x + markerBox.width, markerBox.y);
    ctx.lineTo(markerBox.x + markerBox.width, markerBox.y + markerBox.height - 3);
    ctx.lineTo(markerBox.x, markerBox.y + markerBox.height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // The word flips colour exactly as the marker passes over it, because the
    // second pass is clipped to the marker itself.
    ctx.save();
    ctx.beginPath();
    ctx.rect(markerBox.x, markerBox.y - 6, markerBox.width, markerBox.height + 12);
    ctx.clip();
    drawWords(() => (theme.dark ? "#131519" : theme.shadow));
    ctx.restore();
  }

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
  // Short scenes mean many more handovers, so these are quick and almost
  // clean. A long dissolve between two ten-second scenes spends a tenth of the
  // film on the join.
  const inT = smootherstep(range(time, 0, 0.3));
  const outT = smootherstep(range(time, duration - 0.24, duration));
  const flavour = index % 3;

  if (flavour === 0) {
    return {
      dip: (1 - inT) * 0.55 + outT * 0.6,
      scale: lerp(1.03, 1, inT),
      shift: 0,
      blur: 0,
    };
  }
  if (flavour === 1) {
    return {
      dip: (1 - inT) * 0.35 + outT * 0.5,
      scale: 1,
      shift: (1 - inT) * 54 - outT * 40,
      blur: 0,
    };
  }
  return {
    dip: (1 - inT) * 0.45 + outT * 0.55,
    scale: lerp(1.05, 1, inT),
    shift: (1 - inT) * -34 + outT * 26,
    blur: 0,
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

/**
 * Shots whose picture belongs behind the whole frame rather than in a frame.
 * Kept to the two compositions with room for it -- a washed photograph under a
 * card layout just makes the cards look like they are floating.
 */
const WASHED: Record<SceneRole, boolean> = {
  hero: false,
  statement: true,
  split: false,
  metric: false,
  process: false,
  contrast: false,
  takeaway: true,
};

/** Ruled paper by default; dotted where the frame is mostly empty. */
const DOTTED: Record<SceneRole, boolean> = {
  hero: false,
  statement: true,
  split: false,
  metric: true,
  process: false,
  contrast: true,
  takeaway: false,
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

  // The ground is paper, always. A shot that wants its picture behind the type
  // washes it over the paper itself; the rest mount the picture in a frame.
  drawGround(ctx, theme, options.time, { dots: DOTTED[plan.role] });

  const behind = WASHED[plan.role] ? scene.image : null;
  if (behind && behind.complete && behind.naturalWidth > 0) {
    drawWashedPhoto(ctx, behind, theme, {
      time: options.time,
      duration: options.duration,
      index: scene.index,
      wash: theme.dark ? 0.86 : 0.9,
    });
  }

  SHOTS[plan.role](ctx, scene, plan, theme, options);

  if (plan.phrases.length) {
    // The band is whatever ground this shot laid down, so a full-bleed accent
    // plate does not get a strip of paper pasted across its foot.
    drawSubtitles(ctx, plan, theme, options.time, options.fontSans, {
      ground: plan.role === "takeaway" ? theme.accent : theme.ground,
      ink: plan.role === "takeaway" ? theme.shadow : theme.ink,
    });
  }

  // Deliberately no vignette, grain or letterbox. They are the house style of
  // every generated video, they fight flat printed work, and a frame that
  // needs them to look finished was not composed properly.
  ctx.restore();

  drawChapterRail(
    ctx,
    theme,
    options.globalProgress ?? (scene.index + options.time / options.duration) / scene.totalScenes,
    scene.index,
    scene.totalScenes,
  );
  // Scenes hand over through the paper, never through black.
  if (transition.dip > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(transition.dip, 0, 1);
    ctx.fillStyle = theme.ground;
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

  drawGround(ctx, theme, time);

  if (options.image?.complete && options.image.naturalWidth > 0) {
    drawWashedPhoto(ctx, options.image, theme, {
      time,
      duration: 3,
      index: 0,
      wash: theme.dark ? 0.88 : 0.92,
    });
  }

  // Shapes breaking the corners, the way a printed cover would be furnished.
  drawEdgeShape(ctx, "square", { x: -70, y: -80, width: 250, height: 250 }, theme.surface, 0.9);
  drawEdgeShape(
    ctx,
    "circle",
    { x: BOARD_WIDTH - 150, y: BOARD_HEIGHT - 190, width: 320, height: 320 },
    theme.surface,
    0.85,
  );

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

  drawRule(ctx, theme, BOARD_WIDTH / 2 - 44, centreY - title.size - 58, 88, range(p, 0.02, 0.3), 5);

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

  // Open from the paper, not from black: a fade up out of the ground keeps the
  // printed illusion intact where a dip to black would announce a video player.
  const dip = (1 - smootherstep(range(p, 0, 0.18))) * 1 + smootherstep(range(p, 0.92, 1)) * 0.9;
  if (dip > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(dip, 0, 1);
    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.restore();
  }
}

export { themeOf };
