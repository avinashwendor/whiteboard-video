import { clamp } from "@/lib/video/easing";
import { planCues, readingTime, type Cue, type WordTiming } from "@/lib/video/timing";
import { SCENE_ROLES_TUPLE, type SceneRole } from "./roles";

/**
 * Casting a scene: which screens it becomes, and when it cuts between them.
 *
 * The engine used to give a scene one composition and hold it for however long
 * the narration ran -- twelve, fifteen seconds of the same frame while a voice
 * talked over it. Every individual frame was fine. The film was static, and
 * "static" is the thing a viewer feels as boring long before they could tell
 * you why.
 *
 * So a scene is now a *sequence* of screens. Its content is dealt out across
 * two, three or four panels; each panel gets its own composition; and the cuts
 * land on words the narrator actually says, because the cue planner already
 * knows when every phrase happens. A fifteen-second scene stops being one held
 * frame and becomes four seconds of a claim, four of a number, four of the
 * three things that follow from it.
 *
 * Nothing here draws. It is pure scheduling, which is why it can be tested
 * without a canvas -- and the arithmetic is exactly the part that goes wrong.
 */

/**
 * A cheap integer hash.
 *
 * Deterministic -- the same scene always casts the same way, so a re-render is
 * the same film -- but with no linear relationship between input and output,
 * which is the whole point. See `pick` below.
 */
function mix(value: number): number {
  let x = Math.imul(value | 0, 0x9e3779b1) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
}

/* --------------------------------- fitting -------------------------------- */

/**
 * What a screen needs before it can be asked to carry content.
 *
 * Consulted for the director's request, for the automatic choice and for the
 * variety fallback, so none of them can put three bullets into a layout that
 * draws one, or ask for a spread of photographs when there are none.
 */
export function canCarry(
  role: SceneRole,
  content: { bullets: string[]; stat?: string; image?: unknown },
): boolean {
  const n = content.bullets.length;
  switch (role) {
    /* numbers */
    case "metric":
    case "gauge":
    case "progress":
      return Boolean(content.stat?.trim());
    case "metricTrio":
      return Boolean(content.stat?.trim()) && n >= 2;
    case "bars":
    case "donut":
      return n >= 2;

    /* sequences */
    case "process":
    case "timeline":
    case "cycle":
    case "funnel":
    case "pyramid":
    case "roadmap":
      return n >= 3;

    /* comparisons */
    case "contrast":
    case "versus":
    case "venn":
      return n === 2;
    case "prosCons":
      return n >= 2;
    case "matrix":
      return n >= 3;

    /* structure */
    case "tree":
    case "orbit":
    case "flow":
      return n >= 2 && n <= 4;
    case "stack":
      return n >= 2;

    /* media and type */
    case "deck":
      return n >= 2;
    case "grid":
      return n >= 3;
    case "list":
      return n >= 2;
    case "split":
    case "collage":
      return n >= 1;
    case "bracket":
      return n <= 2;
    case "fullBleed":
      return Boolean(content.image);
    case "bigWord":
    case "quote":
    case "chapter":
    case "statement":
    case "hero":
    case "takeaway":
      return true;
    default:
      return true;
  }
}

/**
 * The screen a piece of content asks for, on its own merits.
 *
 * Read strictly off what is in front of it -- a number is a number, three
 * things in order are a sequence -- with the tie broken by `variant`, which is
 * how the same shape of content gets a different screen the second time a film
 * meets it.
 *
 * Every rotation is deliberately wide. The first version listed three or four
 * options per shape, which meant two thirds of the library could only ever be
 * reached by the fallback path -- so a thirty-five screen engine drew about a
 * dozen of them and no amount of art direction would have shown the rest. If a
 * screen is not in a rotation here it is, in practice, not in the engine.
 */
function naturalRole(
  content: { bullets: string[]; stat?: string; image?: unknown; heading?: string },
  variant: number,
): SceneRole {
  const n = content.bullets.length;
  /**
   * Choose from a rotation.
   *
   * The variant is hashed rather than used directly, and that is not fussiness.
   * A variant that steps linearly -- scene number times some constant -- lands
   * on the same index of any rotation whose length shares a factor with that
   * constant. Twice now that produced a film where one panel position picked
   * the identical screen in every single scene, which looks exactly like a
   * template and gives no hint that the cause is arithmetic. Hashing first
   * decorrelates the choice from how many options happen to be listed.
   */
  const pick = (...options: SceneRole[]) => options[mix(variant) % options.length];

  if (content.stat?.trim()) {
    return n >= 2
      ? pick("metric", "metricTrio", "gauge", "bars", "donut")
      : pick("metric", "gauge", "progress");
  }
  // A question is a branch; nothing else with the same shape is.
  if (/\?\s*$/.test(content.heading ?? "") && n >= 2 && n <= 4) return "tree";

  if (n === 0) {
    return content.image
      ? pick("fullBleed", "bracket")
      : pick("statement", "bigWord", "quote", "chapter");
  }
  if (n === 1) {
    return content.image
      ? pick("split", "collage", "bracket", "fullBleed")
      : pick("statement", "quote", "bigWord", "bracket");
  }
  if (n === 2) {
    return pick("contrast", "versus", "venn", "tree", "prosCons", "flow", "orbit", "bars", "donut");
  }
  if (n === 3) {
    return pick(
      "process",
      "timeline",
      "grid",
      "stack",
      "funnel",
      "matrix",
      "pyramid",
      "flow",
      "orbit",
      "donut",
      "bars",
      "list",
    );
  }
  if (n === 4) {
    return pick("deck", "roadmap", "cycle", "grid", "pyramid", "matrix", "timeline", "orbit", "flow");
  }
  return pick("deck", "list", "grid", "bars", "timeline", "stack");
}

/**
 * Picks a screen, honouring a request, then content, then variety.
 *
 * `recent` is the screens already used in this film, most recent last. Nothing
 * may repeat inside a window of three: two of the same layout close together
 * is the one repetition a viewer consciously notices, and an A-B-A-B
 * alternation reads as a template just as clearly as a straight repeat.
 */
export function roleFor(input: {
  bullets: string[];
  heading?: string;
  stat?: string;
  image?: unknown;
  /** Locked position in the film, which overrides everything. */
  index?: number;
  totalScenes?: number;
  requested?: SceneRole;
  recentRoles?: SceneRole[];
  /** Rotates the natural choice so identical content varies. */
  variant?: number;
}): SceneRole {
  const content = {
    bullets: input.bullets,
    stat: input.stat,
    image: input.image,
    heading: input.heading,
  };
  const recent = (input.recentRoles ?? []).slice(-2);

  if (input.index === 0) return "hero";
  if (
    input.totalScenes != null &&
    input.totalScenes > 2 &&
    input.index === input.totalScenes - 1
  ) {
    return "takeaway";
  }
  if (input.requested && canCarry(input.requested, content)) return input.requested;

  const natural = naturalRole(content, input.variant ?? 0);
  if (canCarry(natural, content) && !recent.includes(natural)) return natural;

  // Anything else this content can carry, preferring screens of the same kind.
  const ordered = [
    ...SCENE_ROLES_TUPLE.filter((role) => KIND[role] === KIND[natural]),
    ...SCENE_ROLES_TUPLE,
  ];
  const offset = mix(input.variant ?? 0) % Math.max(1, ordered.length);
  for (let i = 0; i < ordered.length; i += 1) {
    const role = ordered[(i + offset) % ordered.length];
    if (role === "hero" || role === "takeaway") continue;
    if (recent.includes(role)) continue;
    if (!canCarry(role, content)) continue;
    return role;
  }
  return canCarry(natural, content) ? natural : "statement";
}

/** Screens grouped by what they are for, so a fallback stays in family. */
export const KIND: Record<SceneRole, "title" | "number" | "sequence" | "compare" | "structure" | "media"> = {
  hero: "title",
  takeaway: "title",
  statement: "title",
  quote: "title",
  bigWord: "title",
  chapter: "title",
  bracket: "title",

  metric: "number",
  metricTrio: "number",
  gauge: "number",
  progress: "number",
  bars: "number",
  donut: "number",

  process: "sequence",
  timeline: "sequence",
  cycle: "sequence",
  funnel: "sequence",
  pyramid: "sequence",
  roadmap: "sequence",

  contrast: "compare",
  versus: "compare",
  matrix: "compare",
  venn: "compare",
  prosCons: "compare",

  tree: "structure",
  stack: "structure",
  orbit: "structure",
  flow: "structure",
  list: "structure",

  split: "media",
  collage: "media",
  fullBleed: "media",
  deck: "media",
  grid: "media",
};

/* --------------------------------- panels --------------------------------- */

export interface Panel {
  role: SceneRole;
  /** Scene-relative window this panel owns. */
  from: number;
  to: number;
  /** Indices into the scene's bullets that this panel shows. */
  items: number[];
  /** True when this panel is the one carrying the scene's statistic. */
  carriesStat: boolean;
  /** True for the panel that establishes the scene's heading. */
  opens: boolean;
}

/** How many screens a scene of this length should become. */
export function panelCountFor(duration: number, bullets: number, hasStat: boolean): number {
  // Below six seconds there is no room to cut: a screen a viewer cannot read
  // is worse than a screen they look at for a moment too long.
  if (duration < 6) return 1;
  const byTime = duration < 10 ? 2 : duration < 15 ? 3 : 4;
  // And never more panels than there is content to put on them.
  const byContent = Math.max(1, Math.ceil(bullets / 1.5) + (hasStat ? 1 : 0));
  return clamp(Math.min(byTime, byContent), 1, 4);
}

/**
 * Deals a scene's content across its panels, and finds the cuts.
 *
 * Two rules decide where a cut goes. It must land on a beat -- the moment a
 * phrase is actually spoken, which the cue planner already knows -- so the
 * picture changes with the voice rather than against it. And every panel must
 * hold long enough to be read, which is what `readingTime` is for: a panel
 * carrying six words needs longer than one carrying two, and a cut that
 * arrives before its screen has been read is not a cut, it is a flicker.
 */
export function planPanels(input: {
  bullets: string[];
  heading?: string;
  stat?: string;
  image?: unknown;
  duration: number;
  /** Silence before the voice starts. */
  lead: number;
  words: WordTiming[];
  requested?: SceneRole;
  /** Screens already used in the film, most recent last. */
  recentRoles?: SceneRole[];
  /** Position in the film, for the locked opening and closing screens. */
  index?: number;
  totalScenes?: number;
}): Panel[] {
  const bullets = input.bullets ?? [];
  const hasStat = Boolean(input.stat?.trim());
  const count = panelCountFor(input.duration, bullets.length, hasStat);

  /**
   * Which points each panel shows.
   *
   * Not an even spread, which was the first thing I tried and the thing that
   * broke it: four points across three panels gives every panel one or two,
   * and a screen holding one item can never be a sequence. Every step rail,
   * timeline, funnel and grid in the library became unreachable -- the engine
   * had thirty-five screens and could only ever draw the dozen that work with
   * a single item.
   *
   * So the deal is shaped like an edit instead. One panel opens with the
   * claim, the statistic takes a panel of its own where there is room, and one
   * panel -- the body -- carries everything that is left. That is also simply
   * how these films are cut: state it, show the number, then walk the list.
   */
  const groups: number[][] = Array.from({ length: count }, () => []);
  // Where there is room, the number gets a panel of its own so it is never a
  // footnote under a list. Where there is not -- a scene too short to cut --
  // it belongs to the only panel there is. Writing this as `count > 1 ? 1 : -1`
  // silently dropped the statistic from every short scene: the panel existed,
  // the number did not, and no layout that needs one could ever be chosen.
  const statPanel = hasStat ? (count > 1 ? 1 : 0) : -1;
  const forBullets = Array.from({ length: count }, (_, i) => i).filter((i) => i !== statPanel);
  // The last panel that is not the statistic's is the one that carries the set.
  const bodyPanel = forBullets[forBullets.length - 1] ?? 0;

  bullets.forEach((_, index) => {
    // One point each to the opening panels, in order; the remainder to the
    // body. With three points and two slots that is one and two, not one and
    // one with a point dropped.
    const opener = forBullets[index];
    const target =
      opener !== undefined && opener !== bodyPanel && index < forBullets.length - 1
        ? opener
        : bodyPanel;
    groups[target].push(index);
  });

  /* where the cuts land */
  const cues = planCues(
    Array.from({ length: count }, (_, i) => ({
      text: i === statPanel && hasStat ? input.stat : bullets[groups[i][0] ?? 0],
      minSpan: 0.4,
      maxSpan: 1.4,
    })),
    input.words,
    {
      lead: input.lead,
      speech: Math.max(0.1, input.duration - input.lead),
      tail: 0,
      preroll: 0.2,
      minGap: 1.6,
    },
  );

  const recent = [...(input.recentRoles ?? [])];
  const panels: Panel[] = [];

  for (let i = 0; i < count; i += 1) {
    const items = groups[i];
    const carriesStat = hasStat && i === statPanel;
    const from = i === 0 ? 0 : (cues[i]?.at ?? (input.duration / count) * i);
    const to = i === count - 1 ? input.duration : (cues[i + 1]?.at ?? (input.duration / count) * (i + 1));

    const content = {
      bullets: items.map((index) => bullets[index]),
      stat: carriesStat ? input.stat : undefined,
      image: i === 0 ? input.image : undefined,
      heading: i === 0 ? input.heading : undefined,
    };

    // Only the first panel of the first scene is the title, and only the last
    // panel of the last scene closes the film. Both need the index *and* the
    // total to fire -- passing one without the other was why a film's closing
    // screen silently became an ordinary statement.
    const opensFilm = i === 0 && input.index === 0;
    const closesFilm = i === count - 1 && input.index === (input.totalScenes ?? 0) - 1;

    const role = roleFor({
      ...content,
      index: opensFilm ? 0 : closesFilm ? input.index : undefined,
      totalScenes: opensFilm || closesFilm ? input.totalScenes : undefined,
      requested: i === 0 ? input.requested : undefined,
      recentRoles: recent,
      // Mixed rather than sequential. `index * 3 + i` looks like it varies and
      // does not: for a fixed panel position it steps by three, so `% 3` in
      // the rotations below is constant and that panel picks the same option
      // in every scene of the film. Coprime multipliers keep both axes moving.
      variant: (input.index ?? 0) * 5 + i * 7,
    });
    recent.push(role);

    panels.push({ role, from, to, items, carriesStat, opens: i === 0 });
  }

  /* nothing may flicker */
  for (let i = 0; i < panels.length; i += 1) {
    const panel = panels[i];
    const needs = Math.max(
      1.6,
      panel.items.reduce((most, index) => Math.max(most, readingTime(bullets[index] ?? "")), 1.2),
    );
    if (panel.to - panel.from >= needs) continue;
    // Steal from the next panel first; if there is nothing to steal, merge.
    const next = panels[i + 1];
    if (next && next.to - (panel.from + needs) >= 1.6) {
      panel.to = panel.from + needs;
      next.from = panel.to;
      continue;
    }
    if (next) {
      next.from = panel.from;
      next.items = [...panel.items, ...next.items];
      next.carriesStat = next.carriesStat || panel.carriesStat;
      next.opens = next.opens || panel.opens;
      panels.splice(i, 1);
      i -= 1;
    } else if (i > 0) {
      const previous = panels[i - 1];
      previous.to = panel.to;
      previous.items = [...previous.items, ...panel.items];
      previous.carriesStat = previous.carriesStat || panel.carriesStat;
      panels.splice(i, 1);
      i -= 1;
    }
  }

  // Monotonic and inside the scene, whatever the arithmetic above did.
  panels[0].from = 0;
  panels[panels.length - 1].to = input.duration;
  for (let i = 1; i < panels.length; i += 1) {
    panels[i].from = clamp(panels[i].from, panels[i - 1].from + 0.5, input.duration - 0.5);
    panels[i - 1].to = panels[i].from;
  }

  return panels;
}

/** The panel showing at a given moment in the scene. */
export function panelAt(panels: Panel[], time: number): { panel: Panel; index: number } {
  for (let i = panels.length - 1; i >= 0; i -= 1) {
    if (time >= panels[i].from) return { panel: panels[i], index: i };
  }
  return { panel: panels[0], index: 0 };
}

export type { Cue };
