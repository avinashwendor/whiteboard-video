import { BOARD_HEIGHT, BOARD_WIDTH } from "@/lib/whiteboard/scene";
import {
  clamp,
  clamp01,
  easeOutCubic,
  easeOutQuint,
  noise1,
  pulse,
  range,
  smootherstep,
} from "@/lib/video/easing";
import { lerp } from "@/lib/video/easing";
import { supportsFilter, withAlpha } from "@/lib/video/grade";
import {
  buildPhrases,
  phraseAt,
  planCues,
  readingTime,
  type Cue,
  type WordTiming,
} from "@/lib/video/timing";
import { themeOf, type Theme, type ThemeName } from "./theme";
import type { SceneRole } from "./roles";
import { panelAt, planPanels, type Panel } from "./casting";
import { EXTRA_SHOTS } from "./screens";
import {
  CONTENT_WIDTH,
  MARGIN,
  SAFE_BOTTOM,
  display,
  drawChromeLine,
  drawMark,
  drawRule,
  eyebrowFor,
  pictureOf,
  poster,
  staggered,
  type ModernPlan,
  type ModernRenderOptions,
  type ModernRenderScene,
  type SceneTiming,
} from "./stage";

/**
 * The shared shot vocabulary lives in `./stage`: the two type faces, the safe
 * area, the entrance timing and the one accent object. Re-exported because
 * every consumer of the renderer wants the types alongside it.
 */
export type { ModernPlan, ModernRenderOptions, ModernRenderScene, SceneTiming } from "./stage";
import {
  drawArrow,
  drawEdgeShape,
  drawFramedPhoto,
  drawMarker,
  drawOutlineNumeral,
  drawWashedPhoto,
} from "./paper";
import {
  drawBloom,
  drawBrackets,
  drawCardStack,
  drawConnector,
  drawFinishGround,
  drawFrameRule,
  drawGhostNumeral,
  drawGhostType,
  drawNode,
  drawPlate,
  drawSectionMark,
  drawSurface,
  sway,
  type Point,
} from "./surface";
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

/**
 * The shot vocabulary lives in `./roles` so the server can name a composition
 * without pulling in canvas code. Re-exported here because every consumer of
 * the renderer wants both together.
 */
export type { SceneRole } from "./roles";
export { SCENE_ROLES_TUPLE, SHOT_BRIEFS } from "./roles";

/* ---------------------------------- plan ---------------------------------- */

/**
 * Casting -- which screen a piece of content becomes, and how a scene is dealt
 * out across several of them -- lives in `./casting`. It is pure scheduling
 * with no canvas in it, which is what makes the arithmetic testable.
 */
export { canCarry, roleFor, planPanels, panelAt, panelCountFor, KIND } from "./casting";
export type { Panel } from "./casting";

export function planModernScene(
  scene: ModernRenderScene,
  words: WordTiming[],
  timing: SceneTiming,
  recentRoles?: SceneRole[],
  /** Glyphs already used in this video, so no two frames wear the same one. */
  usedGlyphs?: Set<string>,
): ModernPlan {
  const { lead, speech, tail } = timing;

  /**
   * The screens this scene becomes.
   *
   * A scene used to be one composition held for however long its narration
   * ran. Now its content is dealt across two, three or four panels that cut on
   * words the narrator actually says -- so a fifteen-second scene is four
   * seconds of a claim, four of a number, four of what follows. The single
   * biggest reason a generated film feels static is that nothing in the frame
   * ever changes; this is the fix.
   */
  const panels = planPanels({
    bullets: scene.bullets,
    heading: scene.heading,
    stat: scene.stat,
    image: scene.image,
    duration: lead + speech + tail,
    lead,
    words,
    requested: scene.shot,
    recentRoles,
    index: scene.index,
    totalScenes: scene.totalScenes,
  });
  const role = panels[0].role;

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
    panels,
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
  drawSurface(ctx, card, theme, {
    fill: theme.accent,
    radius: 34,
    offset: 12,
    shadow: theme.shadow,
    enter,
  });

  const heading = layoutDisplay(ctx, scene.heading, {
    family: display(options),
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
    drawMark(ctx, scene, plan, 0, card.x + card.width - 150, card.y + card.height * 0.42, 150, theme, {
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
    family: display(options),
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
    drawMark(ctx, scene, plan, 0, BOARD_WIDTH - MARGIN - 96, 214, 168, theme, {
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
    drawSurface(ctx, mediaBox, theme, {
      fill: theme.surface,
      offset: 10,
      shadow: theme.shadow,
      enter: smootherstep(range(time, 0.1, 0.9)),
    });
  }

  const heading = layoutDisplay(ctx, scene.heading, {
    family: display(options),
    maxWidth: textWidth,
    maxSize: 62,
    minSize: 34,
    weight: 800,
    maxLines: 3,
    lineRatio: 1.08,
    emphasis: scene.keywords,
  });

  const baseY = 214;
  drawMark(ctx, scene, plan, 0, textX + 26, baseY - heading.size - 86, 54, theme, {
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

  drawSurface(ctx, cardBox, theme, {
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
  ctx.font = `800 ${size}px ${display(options)}`;
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

  drawMark(ctx, scene, plan, 0, cardBox.x + 60, cardBox.y + 60, 52, theme, {
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
      family: display(options),
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
    family: display(options),
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

    drawSurface(ctx, { x, y: cardY, width: cardWidth, height: cardHeight }, theme, {
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
    ctx.font = `800 18px ${display(options)}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), x + 44, cardY + 47);
    ctx.restore();

    drawMark(ctx, scene, plan, index, x + cardWidth - 44, cardY + 46, 40, theme, {
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
    family: display(options),
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
    drawSurface(ctx, { x, y: cardY, width: cardWidth, height: cardHeight }, theme, {
      fill: theme.surface,
      radius: 30,
      offset: 11,
      shadow: theme.shadow,
      enter: reveal,
    });

    drawMark(ctx, scene, plan, index, x + cardWidth - 74, cardY + 78, 68, theme, {
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

  drawMark(ctx, scene, plan, 0, MARGIN * 1.1, SAFE_BOTTOM - 40, 92, theme, {
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
  drawSurface(ctx, card, theme, {
    fill: theme.card,
    radius: 44,
    offset: 12,
    shadow: theme.shadow,
    enter: smootherstep(range(time, 0.18, 0.95)),
  });

  const heading = layoutDisplay(ctx, scene.heading, {
    family: display(options),
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

  // What sits behind the caption depends entirely on the finish.
  //
  // A printed frame gets the paper coming back up: a full-width wash that
  // reads as the sheet the type is on. A frame made of light gets a pill sized
  // to the phrase instead -- a band of flat colour across a bloom would kill
  // the one thing that finish is for, and every product film worth copying
  // uses a pill here.
  if (theme.finish === "print") {
    const scrim = ctx.createLinearGradient(0, baseline - 82, 0, baseline + 44);
    scrim.addColorStop(0, withAlpha(ground, 0));
    scrim.addColorStop(0.45, withAlpha(ground, 0.92));
    scrim.addColorStop(1, withAlpha(ground, 1));
    ctx.fillStyle = scrim;
    ctx.fillRect(0, baseline - 82, BOARD_WIDTH, 126);
  } else {
    const padding = 30;
    const pill = {
      x: left - padding,
      y: baseline - size * 0.98 - 14,
      width: total + padding * 2,
      height: size * 1.62,
    };
    ctx.save();
    ctx.globalAlpha = alpha;
    if (theme.finish === "glass") {
      drawSurface(ctx, pill, theme, { radius: pill.height / 2, glow: 0.35 });
    } else {
      ctx.fillStyle = withAlpha(ground, theme.dark ? 0.72 : 0.84);
      ctx.beginPath();
      ctx.roundRect(pill.x, pill.y, pill.width, pill.height, pill.height / 2);
      ctx.fill();
    }
    ctx.restore();
  }

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
    drawWords(() => theme.accentInk);
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

/* -------------------------------- 8. bracket ------------------------------- */

/**
 * THE COVER — the subject's own word set enormous, and the subject framed on a
 * plate in front of it.
 *
 * This is the shot a magazine puts on its front. The word behind is not a
 * heading and is not meant to be read as one: it is scale, and it is what
 * makes a 300px plate in the middle of the frame feel like a photograph on a
 * page rather than a thumbnail. The line of copy is broken around the plate,
 * left and right, which is the detail that makes the layout look set rather
 * than centred.
 */
function shotBracket(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;
  const picture = pictureOf(scene);

  // One or two words, and never a sentence: past two the type has to shrink
  // to fit and stops being texture.
  const subject = (scene.keywords?.[0]?.trim() || scene.heading)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  drawGhostType(ctx, subject.join(" "), {
    lines: subject,
    family: poster(options),
    colour: theme.ghost,
    at: 0.5,
    span: subject.length > 1 ? 0.98 : 0.82,
    time,
    drift: 0.6,
    progress: smootherstep(range(time, 0, 1.2)),
  });

  const plateWidth = 302;
  const plateHeight = 384;
  const plate = {
    x: BOARD_WIDTH / 2 - plateWidth / 2,
    y: BOARD_HEIGHT * 0.47 - plateHeight / 2,
    width: plateWidth,
    height: plateHeight,
  };

  const wipe = range(time, plan.heading.at, plan.heading.at + 0.55);
  drawPlate(ctx, plate, theme.accent, wipe, "up");

  if (picture) {
    // Cover-cropped inside the plate, so the accent shows only as a border of
    // colour around the subject rather than behind a letterboxed photo.
    const scale = Math.max(
      plate.width / picture.naturalWidth,
      (plate.height * 0.94) / picture.naturalHeight,
    );
    const width = picture.naturalWidth * scale;
    const height = picture.naturalHeight * scale;
    const reveal = easeOutQuint(range(time, plan.heading.at + 0.18, plan.heading.at + 0.9));
    ctx.save();
    ctx.beginPath();
    ctx.rect(plate.x, plate.y + plate.height * (1 - reveal), plate.width, plate.height * reveal);
    ctx.clip();
    // A slow push on the picture alone: the plate is still, the subject is not.
    const push = 1 + (time / Math.max(1, options.duration)) * 0.05;
    ctx.translate(plate.x + plate.width / 2, plate.y + plate.height / 2);
    ctx.scale(push, push);
    ctx.drawImage(picture, -width / 2, -height / 2, width, height);
    ctx.restore();
  } else {
    drawMark(ctx, scene, plan, 0, plate.x + plate.width / 2, plate.y + plate.height * 0.48, 168, theme, {
      enter: smootherstep(range(time, plan.heading.at + 0.2, plan.heading.at + 1)),
      time,
      tilt: -5,
      seed: scene.index,
    });
  }

  drawBrackets(ctx, plate, theme.bracket, {
    progress: range(time, plan.heading.at + 0.35, plan.heading.at + 1.1),
    size: 42,
    gap: 18,
  });

  /* the line of copy, broken around the plate */
  const words = scene.heading.split(/\s+/).filter(Boolean);
  const half = Math.ceil(words.length / 2);
  const runs: Array<{ text: string; align: CanvasTextAlign; x: number }> = [
    { text: words.slice(0, half).join(" "), align: "right", x: plate.x - 52 },
    { text: words.slice(half).join(" "), align: "left", x: plate.x + plate.width + 52 },
  ];

  const size = 34;
  const baseline = plate.y + plate.height * 0.45;
  ctx.save();
  ctx.font = `500 ${size}px ${options.fontSans}`;
  ctx.textBaseline = "alphabetic";
  runs.forEach((run, index) => {
    if (!run.text) return;
    const cue = plan.beats[index] ?? plan.heading;
    const t = smootherstep(range(time, cue.at, cue.at + 0.5));
    if (t <= 0.001) return;
    ctx.globalAlpha = t;
    ctx.textAlign = run.align;
    ctx.fillStyle = theme.ink;
    ctx.fillText(run.text, run.x + (1 - t) * (run.align === "right" ? -26 : 26), baseline);
  });
  ctx.restore();

  drawSectionMark(ctx, theme, MARGIN * 0.7, 78, eyebrowFor(scene), {
    family: options.fontSans,
    progress: range(time, 0.1, 0.7),
    width: BOARD_WIDTH - MARGIN * 0.7,
  });
}

/* --------------------------------- 9. deck --------------------------------- */

/**
 * THE COUNT — "seven of these", said with the objects themselves.
 *
 * A number in type tells you how many. A stack of cards fanning open shows you,
 * and the front one is close enough to read. The count is set in brushed metal
 * because it is the one word in the frame that is a headline in its own right.
 */
function shotDeck(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;
  const items = scene.bullets.length ? scene.bullets : [scene.heading];
  const count = Math.max(2, Math.min(7, items.length));

  const cardWidth = 300;
  const cardHeight = 336;
  const spread = 52;
  const totalWidth = cardWidth + spread * (count - 1);
  const box = {
    x: BOARD_WIDTH / 2 - totalWidth / 2,
    y: 246,
    width: cardWidth,
    height: cardHeight,
  };

  const open = range(time, plan.heading.at + 0.2, plan.heading.at + 1.3);

  // The house shape: one oversized corner, three ordinary ones.
  const radii: [number, number, number, number] = [96, 26, 26, 26];

  drawCardStack(ctx, box, theme, count, open, { radii, spread });

  const front = smootherstep(range(time, plan.heading.at, plan.heading.at + 0.7));
  drawSurface(ctx, box, theme, { enter: front, radii, glow: 1.1 });

  drawGhostNumeral(ctx, `#${1}`, box.x + box.width - 34, box.y + 78, 92, {
    family: display(options),
    colour: withAlpha(theme.ink, 0.22),
    progress: range(time, plan.heading.at + 0.3, plan.heading.at + 1),
  });

  /* the count, in metal, above the deck */
  const label = `${count} ${(scene.keywords?.[0]?.trim() || "things").toLowerCase()}`;
  drawChromeLine(ctx, label, {
    x: BOARD_WIDTH / 2,
    y: 186,
    size: 96,
    family: display(options),
    theme,
    reveal: range(time, plan.heading.at, plan.heading.at + 0.8),
  });

  /* the front card's contents */
  const inner = box.width - 84;
  const heading = layoutDisplay(ctx, items[0], {
    family: display(options),
    maxWidth: inner,
    maxSize: 34,
    minSize: 22,
    weight: 800,
    maxLines: 3,
    lineRatio: 1.18,
  });

  drawDisplay(ctx, heading, {
    x: box.x + 42,
    y: box.y + box.height - 128,
    align: "left",
    theme,
    shadow: false,
    reveal: staggered(plan.beats[0] ?? plan.heading, heading.count, time, 0.05),
  });

  const caption = items[1];
  if (caption) {
    drawBodyLines(ctx, wrapAt(ctx, caption, options.fontSans, 20, inner, 2), {
      x: box.x + 42,
      y: box.y + box.height - 64,
      align: "left",
      theme,
      family: options.fontSans,
      size: 20,
      lineHeight: 28,
      reveal: range(
        time,
        (plan.beats[1] ?? plan.heading).at,
        (plan.beats[1] ?? plan.heading).at + 0.5,
      ),
    });
  }

  drawSectionMark(ctx, theme, MARGIN * 0.7, 82, scene.heading, {
    family: options.fontSans,
    progress: range(time, 0.05, 0.6),
    width: BOARD_WIDTH - MARGIN * 0.7,
  });
}

/* --------------------------------- 10. tree -------------------------------- */

/**
 * THE BRANCH — a question at the top, and what it opens into underneath.
 *
 * Dotted routes rather than solid arrows, because a dashed line has a
 * direction to be drawn in and a solid one only appears. The nodes carry
 * numbers so the narration can refer to them, and each caption arrives on the
 * word that names it.
 */
function shotTree(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;
  const items = scene.bullets.slice(0, 4);
  const count = Math.max(1, items.length);

  /* the question, in a pill */
  const enter = smootherstep(range(time, plan.heading.at, plan.heading.at + 0.65));
  const heading = layoutDisplay(ctx, scene.heading, {
    family: display(options),
    maxWidth: BOARD_WIDTH * 0.62,
    maxSize: 64,
    minSize: 34,
    weight: 800,
    maxLines: 2,
    lineRatio: 1.1,
  });

  const pillWidth = Math.min(BOARD_WIDTH * 0.72, heading.lines[0]?.width ?? 400) + 108;
  const pillHeight = heading.height + 58;
  const pill = {
    x: BOARD_WIDTH / 2 - pillWidth / 2,
    y: 92,
    width: pillWidth,
    height: pillHeight,
  };
  drawSurface(ctx, pill, theme, { enter, radius: pillHeight / 2, glow: 1.2 });

  drawDisplay(ctx, heading, {
    x: BOARD_WIDTH / 2,
    y: pill.y + pillHeight / 2 + heading.size * 0.34 - (heading.lines.length - 1) * heading.lineHeight * 0.5,
    align: "center",
    theme,
    shadow: false,
    reveal: staggered(plan.heading, heading.count, time, 0.07),
  });

  /* the routes */
  const busY = pill.y + pill.height + 108;
  const nodeY = busY + 96;
  const spread = Math.min(BOARD_WIDTH * 0.66, 210 * count);
  const step = count > 1 ? spread / (count - 1) : 0;
  const firstX = BOARD_WIDTH / 2 - spread / 2;

  items.forEach((item, index) => {
    const cue = plan.beats[index] ?? plan.heading;
    const draw = range(time, cue.at, cue.at + 0.7);
    const x = count > 1 ? firstX + step * index : BOARD_WIDTH / 2;

    const route: Point[] = [
      { x: BOARD_WIDTH / 2, y: pill.y + pill.height + 6 },
      { x: BOARD_WIDTH / 2, y: busY },
      { x, y: busY },
      { x, y: nodeY - 30 },
    ];
    drawConnector(ctx, route, withAlpha(theme.ink, 0.42), draw, {
      dash: 6,
      width: 2,
      joint: theme.accent,
      jointSize: 6,
    });

    drawNode(ctx, x, nodeY, String(index + 1), theme, {
      family: display(options),
      radius: 21,
      enter: range(time, cue.at + 0.35, cue.at + 0.85),
      colour: theme.accentAlt,
    });

    const lines = wrapAt(ctx, item, options.fontSans, 21, Math.max(140, step - 26), 3);
    drawBodyLines(ctx, lines, {
      x,
      y: nodeY + 58,
      align: "center",
      theme,
      family: options.fontSans,
      size: 21,
      lineHeight: 28,
      colour: theme.ink,
      reveal: range(time, cue.at + 0.45, cue.at + 0.95),
    });
  });
}

/* -------------------------------- 11. collage ------------------------------ */

/**
 * THE SPREAD — three plates at three sizes, sitting at three heights.
 *
 * The whole composition is the misalignment. Three equal tiles on one baseline
 * is a gallery widget; three unequal ones on three baselines is a spread, and
 * the eye travels across it in the order the sizes suggest. The picture takes
 * the largest plate and the supporting points take the others, so a scene with
 * one photograph still fills a frame that looks like it had three.
 */
function shotCollage(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;
  const picture = pictureOf(scene);

  const plates = [
    { x: 96, y: 190, width: 268, height: 268, lift: 0 },
    { x: 392, y: 118, width: 424, height: 420, lift: -14 },
    { x: 848, y: 236, width: 300, height: 300, lift: 10 },
  ];

  plates.forEach((plate, index) => {
    const cue = plan.beats[index] ?? plan.heading;
    const enter = smootherstep(range(time, cue.at, cue.at + 0.7));
    if (enter <= 0.001) return;

    const drift = sway(scene.index * 7 + index, time, 4);
    const box = { ...plate, y: plate.y + plate.lift + drift };

    if (index === 1 && picture) {
      drawFramedPhoto(ctx, picture, box, {
        time,
        duration: options.duration,
        index: scene.index,
        theme,
        radius: 18,
        offset: theme.finish === "print" ? 12 : 0,
        enter,
      });
      drawBrackets(ctx, box, theme.bracket, {
        progress: range(time, cue.at + 0.3, cue.at + 0.9),
        size: 30,
        gap: 12,
      });
      return;
    }

    const bullet = scene.bullets[index === 0 ? 0 : 1] ?? scene.bullets[index] ?? "";
    drawSurface(ctx, box, theme, {
      enter,
      radius: 18,
      fill: index === 2 ? theme.accent : undefined,
      glow: 0.8,
    });

    const ink = index === 2 ? theme.accentInk : theme.ink;
    drawMark(
      ctx,
      scene,
      plan,
      index,
      box.x + box.width / 2,
      box.y + box.height * 0.38,
      Math.min(96, box.width * 0.36),
      theme,
      {
        enter: smootherstep(range(time, cue.at + 0.2, cue.at + 0.9)),
        time,
        seed: index,
        colour: index === 2 ? theme.accentInk : theme.accent,
      },
    );

    if (bullet) {
      const lines = wrapAt(ctx, bullet, options.fontSans, 22, box.width - 48, 3, 600);
      drawBodyLines(ctx, lines, {
        x: box.x + box.width / 2,
        y: box.y + box.height * 0.68,
        align: "center",
        theme,
        family: options.fontSans,
        size: 22,
        lineHeight: 30,
        colour: ink,
        reveal: range(time, cue.at + 0.3, cue.at + 0.8),
      });
    }
  });

  /* the heading, sitting under the spread on one line */
  const heading = layoutDisplay(ctx, scene.heading, {
    family: display(options),
    maxWidth: CONTENT_WIDTH,
    maxSize: 46,
    minSize: 28,
    weight: 800,
    maxLines: 1,
    lineRatio: 1.05,
    emphasis: scene.keywords,
  });
  drawDisplay(ctx, heading, {
    x: BOARD_WIDTH / 2,
    y: SAFE_BOTTOM - 6,
    align: "center",
    theme,
    shadow: false,
    reveal: staggered(plan.heading, heading.count, time, 0.06),
  });

  drawSectionMark(ctx, theme, MARGIN * 0.7, 74, eyebrowFor(scene), {
    family: options.fontSans,
    progress: range(time, 0.05, 0.6),
    width: BOARD_WIDTH - MARGIN * 0.7,
  });
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
 * Four flavours, cycled by scene index so no handover repeats inside a film,
 * and each one is a transform on the finished frame rather than a second
 * render -- which is what keeps a scrub instant.
 *
 * The blur is the part that matters and the part that used to be computed and
 * then thrown away. A push without blur is a slide transition; a push with two
 * frames of blur on the front of it is a whip pan, and the difference is the
 * whole distance between motion graphics and PowerPoint. It is only ever on
 * for a fifth of a second, so the cost is a rounding error.
 */
export function transitionFor(index: number, time: number, duration: number): Transition {
  // Short scenes mean many more handovers, so these are quick and almost
  // clean. A long dissolve between two ten-second scenes spends a tenth of the
  // film on the join.
  const inT = smootherstep(range(time, 0, 0.3));
  const outT = smootherstep(range(time, duration - 0.24, duration));
  const flavour = index % 4;

  if (flavour === 0) {
    // The straight cut: a short dip and a settle out of a slight push-in.
    return {
      dip: (1 - inT) * 0.55 + outT * 0.6,
      scale: lerp(1.03, 1, inT),
      shift: 0,
      blur: 0,
    };
  }
  if (flavour === 1) {
    // The whip: the frame arrives moving and smeared, and stops dead.
    const smear = Math.max(1 - inT, outT);
    return {
      dip: (1 - inT) * 0.28 + outT * 0.45,
      scale: 1,
      shift: (1 - inT) * 78 - outT * 60,
      blur: smear * smear * 9,
    };
  }
  if (flavour === 2) {
    // The punch: in from slightly too big, with a breath of defocus.
    return {
      dip: (1 - inT) * 0.45 + outT * 0.55,
      scale: lerp(1.07, 1, inT) + outT * 0.03,
      shift: 0,
      blur: (1 - inT) * 6,
    };
  }
  // The drift: the quietest of the four, for a scene that should feel like a
  // held breath rather than an edit.
  return {
    dip: (1 - inT) * 0.4 + outT * 0.5,
    scale: lerp(1.02, 1, inT),
    shift: (1 - inT) * -30 + outT * 22,
    blur: 0,
  };
}

/* ------------------------------- public api ------------------------------- */

type Shot = (
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) => void;

/**
 * Every screen in the library, by name.
 *
 * The eleven originals live in this file; the rest are in `./screens`. The
 * `Record` is exhaustive over `SceneRole` on purpose -- adding a name to the
 * director's vocabulary without a composition behind it stops the build here,
 * rather than at three in the morning when a video renders an empty frame.
 */
const SHOTS: Record<SceneRole, Shot> = {
  ...(EXTRA_SHOTS as Record<SceneRole, Shot>),
  hero: shotHero,
  statement: shotStatement,
  split: shotSplit,
  metric: shotMetric,
  process: shotProcess,
  contrast: shotContrast,
  takeaway: shotTakeaway,
  bracket: shotBracket,
  deck: shotDeck,
  tree: shotTree,
  collage: shotCollage,
};

/**
 * Screens whose picture belongs behind the whole frame rather than in a frame.
 * Kept to the compositions with room for it -- a washed photograph under a
 * card layout just makes the cards look like they are floating.
 */
const WASHED = new Set<SceneRole>(["statement", "takeaway", "quote", "bigWord"]);

/** Ruled paper by default; dotted where the frame is mostly empty. */
const DOTTED = new Set<SceneRole>([
  "statement",
  "metric",
  "contrast",
  "deck",
  "tree",
  "gauge",
  "bigWord",
  "quote",
  "chapter",
  "venn",
  "orbit",
  "cycle",
]);

/**
 * Shots that set their own display type behind themselves. The frame must not
 * put a second word back there, or the two fight and both lose.
 */
const OWN_GHOST = new Set<SceneRole>(["bracket"]);

/**
 * The furniture an editorial or glass frame wears regardless of its shot.
 *
 * Drawn behind the composition, never in front of it: the whole value of a
 * ghosted word or a hairline border is that a viewer registers it without
 * looking at it. Anything here that competes for attention is a mistake, so
 * the contrasts are set deliberately low and are not exposed as options.
 */
function drawFurniture(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  theme: Theme,
  options: ModernRenderOptions,
) {
  const { time } = options;

  if (theme.finish === "editorial") {
    drawFrameRule(ctx, theme, 34, range(time, 0.05, 0.8));
    if (!OWN_GHOST.has(plan.role)) {
      const word = (scene.keywords?.[0]?.trim() || scene.heading.split(/\s+/)[0] || "").trim();
      if (word.length > 1) {
        drawGhostType(ctx, word, {
          family: poster(options),
          colour: theme.ghost,
          at: 0.52,
          span: 1.02,
          time,
          drift: 0.4,
          progress: smootherstep(range(time, 0, 1.4)),
        });
      }
    }
    return;
  }

  if (theme.finish === "glass") {
    // One light behind the composition, drifting. It is what makes a frosted
    // panel look lit rather than merely translucent.
    drawBloom(
      ctx,
      BOARD_WIDTH * (0.5 + noise1(time * 0.06, 13) * 0.16),
      BOARD_HEIGHT * (0.42 + noise1(time * 0.05, 29) * 0.12),
      BOARD_WIDTH * 0.44,
      theme.accentAlt,
      0.18,
    );
  }
}

/**
 * The scene, scoped to one panel.
 *
 * A screen is written as though its content is the whole scene: `bullets[0]`
 * is its first item and `beats[0]` is when that item arrives. A panel holds a
 * *slice* of the scene, so the slice is re-presented here as a scene of its
 * own, with every cue rebased to panel-relative time.
 *
 * Doing it this way is what let thirty-five screens be written without any of
 * them knowing panels exist.
 */
function viewFor(
  scene: ModernRenderScene,
  plan: ModernPlan,
  panel: Panel,
): { scene: ModernRenderScene; plan: ModernPlan } {
  const rebase = (cue: Cue): Cue => ({ ...cue, at: Math.max(0, cue.at - panel.from) });

  return {
    scene: {
      ...scene,
      bullets: panel.items.map((index) => scene.bullets[index]).filter(Boolean),
      stat: panel.carriesStat ? scene.stat : undefined,
      statCaption: panel.carriesStat ? scene.statCaption : undefined,
      glyphs: panel.items.map((index) => scene.glyphs?.[index]).filter(Boolean) as typeof scene.glyphs,
    },
    plan: {
      ...plan,
      role: panel.role,
      // The opening panel keeps the heading's own cue; a later panel has
      // already had the heading established, so its type arrives with it.
      heading: panel.opens ? rebase(plan.heading) : { at: 0, span: 0.8, anchored: false },
      beats: panel.items.map((index) => rebase(plan.beats[index] ?? plan.heading)),
      stat: panel.carriesStat && plan.stat ? rebase(plan.stat) : null,
      itemGlyphs: panel.items.map((index) => plan.itemGlyphs[index] ?? plan.glyph),
    },
  };
}

export function renderModernScene(
  ctx: CanvasRenderingContext2D,
  scene: ModernRenderScene,
  plan: ModernPlan,
  options: ModernRenderOptions,
) {
  const theme = themeOf(scene.visualTheme);
  const { panel, index: panelIndex } = panelAt(plan.panels, options.time);
  const view = viewFor(scene, plan, panel);

  // Each panel is cut like a scene of its own: its own clock, its own length,
  // its own handover. That is what makes an internal cut feel like an edit
  // rather than like content appearing.
  const panelTime = options.time - panel.from;
  const panelDuration = Math.max(0.5, panel.to - panel.from);
  const inner: ModernRenderOptions = {
    ...options,
    time: panelTime,
    duration: panelDuration,
  };
  // Scene index and panel index together, so consecutive cuts never repeat a
  // flavour even across a scene boundary.
  const transition = transitionFor(scene.index * 4 + panelIndex, panelTime, panelDuration);

  /**
   * The camera.
   *
   * A slow push across the panel, plus a few pixels of drift on noise. Two per
   * cent over four seconds is far too little to see as movement and exactly
   * enough that no two frames of the finished file are identical -- which is
   * the difference between a video and a slideshow with a soundtrack.
   */
  const through = clamp01(panelTime / panelDuration);
  const towards = (scene.index + panelIndex) % 2 === 0 ? 1 : -1;
  const push = 1 + (towards > 0 ? through * 0.022 : 0.022 - through * 0.022);
  const driftX = noise1(options.time * 0.08, scene.index * 3 + 1) * 5;
  const driftY = noise1(options.time * 0.07, scene.index * 3 + 2) * 4;

  ctx.save();
  // Applied to the whole panel rather than to a copy of it: every draw inside
  // the save is filtered, which costs nothing at blur 0 and is only ever
  // non-zero for the two hundred milliseconds either side of a cut.
  if (transition.blur > 0.2 && supportsFilter(ctx)) {
    ctx.filter = `blur(${transition.blur.toFixed(2)}px)`;
  }
  ctx.translate(BOARD_WIDTH / 2 + transition.shift, BOARD_HEIGHT / 2);
  ctx.scale(transition.scale * push, transition.scale * push);
  ctx.translate(-BOARD_WIDTH / 2 + driftX, -BOARD_HEIGHT / 2 + driftY);

  // The ground is whatever the palette's finish is made of. A screen that
  // wants its picture behind the type washes it over the ground itself; the
  // rest mount the picture in a frame.
  drawFinishGround(ctx, theme, options.time, { dots: DOTTED.has(panel.role) });

  const behind = WASHED.has(panel.role) ? scene.image : null;
  if (behind && behind.complete && behind.naturalWidth > 0) {
    drawWashedPhoto(ctx, behind, theme, {
      time: options.time,
      duration: options.duration,
      index: scene.index,
      wash: theme.dark ? 0.86 : 0.9,
    });
  }

  drawFurniture(ctx, view.scene, view.plan, theme, inner);

  SHOTS[panel.role](ctx, view.scene, view.plan, theme, inner);

  // Subtitles run on the *scene's* clock, not the panel's: the narration does
  // not restart at an internal cut, and a caption that did would be the most
  // obvious possible tell that the frame is assembled from pieces.
  if (plan.phrases.length) {
    drawSubtitles(ctx, plan, theme, options.time, options.fontSans, {
      ground: panel.role === "takeaway" ? theme.accent : theme.ground,
      ink: panel.role === "takeaway" ? theme.accentInk : theme.ink,
    });
  }

  ctx.restore();

  drawChapterRail(
    ctx,
    theme,
    options.globalProgress ?? (scene.index + options.time / options.duration) / scene.totalScenes,
    scene.index,
    scene.totalScenes,
  );
  // Scenes hand over through the ground, never through black -- a dip to black
  // announces a video player, and these frames are meant to be a film.
  if (transition.dip > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(transition.dip, 0, 1);
    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.restore();
  }
}

/**
 * The opening plate.
 *
 * Three seconds, and the only job is to make the next ninety worth watching.
 * So it is built as a title sequence rather than a title card: the ground
 * arrives first, then the furniture, then the words, each on its own beat --
 * and the whole thing is still moving when it hands over, because a cover that
 * settles into stillness before the cut has already ended.
 *
 * The type is set in metal on the two dark finishes and in ink on the rest.
 * Chrome on a light ground is illegible; ink on an editorial black is flat.
 */
export function renderModernCover(
  ctx: CanvasRenderingContext2D,
  options: {
    title: string;
    description: string;
    fontSans: string;
    fontDisplay?: string;
    fontPoster?: string;
    progress: number;
    theme?: ThemeName;
    image?: HTMLImageElement | null;
  },
) {
  const theme = themeOf(options.theme);
  const p = clamp01(options.progress);
  const time = p * 3;
  const titleFace = options.fontDisplay ?? options.fontSans;
  const posterFace = options.fontPoster ?? titleFace;

  drawFinishGround(ctx, theme, time);

  if (options.image?.complete && options.image.naturalWidth > 0) {
    drawWashedPhoto(ctx, options.image, theme, {
      time,
      duration: 3,
      index: 0,
      wash: theme.dark ? 0.88 : 0.92,
    });
  }

  // The first word of the title, set as texture behind the whole plate. On the
  // printed finishes this is replaced by shapes breaking the corners, because
  // ghosted type on ruled paper reads as a printing error.
  if (theme.finish === "print") {
    drawEdgeShape(ctx, "square", { x: -70, y: -80, width: 250, height: 250 }, theme.surface, 0.9);
    drawEdgeShape(
      ctx,
      "circle",
      { x: BOARD_WIDTH - 150, y: BOARD_HEIGHT - 190, width: 320, height: 320 },
      theme.surface,
      0.85,
    );
  } else {
    const word = options.title.split(/\s+/).filter(Boolean)[0] ?? "";
    if (word.length > 1) {
      drawGhostType(ctx, word, {
        family: posterFace,
        colour: theme.ghost,
        at: 0.5,
        span: 1.04,
        time,
        drift: 0.5,
        progress: smootherstep(range(p, 0, 0.5)),
      });
    }
    if (theme.finish === "editorial") drawFrameRule(ctx, theme, 34, range(p, 0.1, 0.55));
  }

  const title = layoutDisplay(ctx, options.title, {
    family: titleFace,
    maxWidth: CONTENT_WIDTH * 0.84,
    maxSize: 92,
    minSize: 44,
    weight: 900,
    maxLines: 3,
    lineRatio: 1.02,
  });

  const centreY = BOARD_HEIGHT * 0.52 - title.height / 2 + title.size;
  // Still settling when it cuts away: the push runs past the end of the plate.
  const push = 1 + (1 - easeOutCubic(p)) * 0.05;

  ctx.save();
  ctx.translate(BOARD_WIDTH / 2, BOARD_HEIGHT / 2);
  ctx.scale(push, push);
  ctx.translate(-BOARD_WIDTH / 2, -BOARD_HEIGHT / 2);

  drawRule(ctx, theme, BOARD_WIDTH / 2 - 44, centreY - title.size - 58, 88, range(p, 0.02, 0.3), 5);

  if (theme.finish !== "print" && theme.dark) {
    // Metal, line by line, so a two-line title still arrives as two beats.
    title.lines.forEach((line, index) => {
      const text = line.words.map((word) => word.text).join(" ");
      drawChromeLine(ctx, text, {
        x: BOARD_WIDTH / 2,
        y: centreY + index * title.lineHeight,
        size: title.size,
        family: title.family,
        theme,
        reveal: range(p, 0.08 + index * 0.12, 0.42 + index * 0.12),
      });
    });
  } else {
    drawDisplay(ctx, title, {
      x: BOARD_WIDTH / 2,
      y: centreY,
      align: "center",
      theme,
      reveal: (index) => range(p, 0.08 + index * 0.045, 0.34 + index * 0.045),
    });
  }

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

  // Open from the ground, not from black: a fade up out of the paper (or out
  // of the light) keeps the illusion intact where a dip to black would
  // announce a video player.
  const dip = (1 - smootherstep(range(p, 0, 0.18))) * 1 + smootherstep(range(p, 0.92, 1)) * 0.9;
  if (dip > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(dip, 0, 1);
    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.restore();
  }
}

/**
 * The closing plate.
 *
 * A film that spends ninety seconds building one look and then hands over to
 * a hand-drawn whiteboard card has not ended, it has stopped -- and that is
 * exactly what a modern film used to do, because there was only ever one
 * closing card and it belonged to the other engine.
 *
 * The composition is deliberately the quietest in the set: the takeaway line,
 * the title under it, and nothing else moving. Everything before this has been
 * arriving; the last four seconds should be still enough to read.
 */
export function renderModernOutro(
  ctx: CanvasRenderingContext2D,
  options: {
    title: string;
    description: string;
    fontSans: string;
    fontDisplay?: string;
    fontPoster?: string;
    progress: number;
    theme?: ThemeName;
  },
) {
  const theme = themeOf(options.theme);
  const p = clamp01(options.progress);
  const time = p * 4;
  const titleFace = options.fontDisplay ?? options.fontSans;
  const posterFace = options.fontPoster ?? titleFace;

  drawFinishGround(ctx, theme, time);

  if (theme.finish === "editorial") {
    const word = options.title.split(/\s+/).filter(Boolean)[0] ?? "";
    if (word.length > 1) {
      drawGhostType(ctx, word, {
        family: posterFace,
        colour: theme.ghost,
        at: 0.5,
        span: 1.02,
        time,
        drift: 0.3,
        progress: smootherstep(range(p, 0, 0.4)),
      });
    }
    drawFrameRule(ctx, theme, 34, range(p, 0.05, 0.5));
  } else if (theme.finish === "glass") {
    drawBloom(ctx, BOARD_WIDTH / 2, BOARD_HEIGHT * 0.44, BOARD_WIDTH * 0.4, theme.accentAlt, 0.2);
  }

  /* the takeaway */
  const line = layoutDisplay(ctx, options.description, {
    family: titleFace,
    maxWidth: CONTENT_WIDTH * 0.86,
    maxSize: 62,
    minSize: 32,
    weight: 800,
    maxLines: 4,
    lineRatio: 1.14,
  });

  const centreY = BOARD_HEIGHT * 0.47 - line.height / 2 + line.size;

  // A rule above it, the same mark the film opened on.
  drawRule(ctx, theme, BOARD_WIDTH / 2 - 44, centreY - line.size - 62, 88, range(p, 0.04, 0.3), 5);

  drawDisplay(ctx, line, {
    x: BOARD_WIDTH / 2,
    y: centreY,
    align: "center",
    theme,
    shadow: theme.finish !== "print",
    reveal: (index) => range(p, 0.1 + index * 0.05, 0.42 + index * 0.05),
  });

  /* the title, small, underneath */
  const tag = smootherstep(range(p, 0.6, 0.9));
  if (tag > 0) {
    ctx.save();
    ctx.globalAlpha = tag;
    ctx.font = `600 24px ${options.fontSans}`;
    ctx.letterSpacing = "3px";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.inkMuted;
    ctx.fillText(
      options.title.toUpperCase(),
      BOARD_WIDTH / 2,
      centreY + (line.lines.length - 1) * line.lineHeight + 86,
    );
    ctx.letterSpacing = "0px";
    ctx.restore();
  }

  // Out through the ground, the way every other handover in the film goes.
  const dip = (1 - smootherstep(range(p, 0, 0.16))) * 0.8 + smootherstep(range(p, 0.9, 1)) * 1;
  if (dip > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(dip, 0, 1);
    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.restore();
  }
}

export { themeOf };
