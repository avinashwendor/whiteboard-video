/**
 * The screen library.
 *
 * Thirty-five compositions, grouped by the job they do rather than by how they
 * look. The grouping is load-bearing: when a screen cannot carry the content
 * it was asked for, the fallback stays inside its own family, so a sequence
 * becomes a different sequence rather than becoming a pie chart.
 *
 * Kept in its own module, free of canvas code, because a Zod schema, a server
 * route and the director's prompt all need to name a composition and none of
 * them can import a module that touches `CanvasRenderingContext2D`.
 *
 * Adding a screen means: a name here, a brief here, a fitting rule in
 * `casting.ts`, and a draw function in `modern-renderer.ts`. The render sweep
 * in `tests/render-test.ts` fails until all four exist, which is deliberate --
 * a name in the director's vocabulary with nothing behind it is a prompt that
 * promises something the engine cannot draw.
 */

export const SCENE_ROLES_TUPLE = [
  /* titles and held type */
  "hero",
  "takeaway",
  "statement",
  "quote",
  "bigWord",
  "chapter",
  "bracket",

  /* numbers */
  "metric",
  "metricTrio",
  "gauge",
  "progress",
  "bars",
  "donut",

  /* sequences */
  "process",
  "timeline",
  "cycle",
  "funnel",
  "pyramid",
  "roadmap",

  /* comparisons */
  "contrast",
  "versus",
  "matrix",
  "venn",
  "prosCons",

  /* structure */
  "tree",
  "stack",
  "orbit",
  "flow",
  "list",

  /* media */
  "split",
  "collage",
  "fullBleed",
  "deck",
  "grid",
] as const;

export type SceneRole = (typeof SCENE_ROLES_TUPLE)[number];

/**
 * One line each, written for the director rather than for a developer.
 *
 * Every brief says what the screen is *for*, not what it looks like, because
 * the model is choosing a way to explain something and "two panels side by
 * side" does not tell it when to reach for one.
 */
export const SHOT_BRIEFS: Record<SceneRole, string> = {
  hero: "the opening title, one card carrying the whole frame",
  takeaway: "the closing line, on a full plate of colour",
  statement: "one sentence held on screen, a marker under the words that matter",
  quote: "someone's own words, set large between marks",
  bigWord: "a single word filling the frame — for a term the whole scene turns on",
  chapter: "a section marker: a number, a label, and a rule",
  bracket: "a magazine cover — the subject framed on a plate, its word ghosted enormous behind",

  metric: "one number, counting up, landing on the word that says it",
  metricTrio: "three numbers across the frame, for figures that belong together",
  gauge: "a dial filling to a value — for a share, a score, a level",
  progress: "a bar filling with a label at each end — for how far along something is",
  bars: "bars compared side by side, for quantities you want ranked",
  donut: "a ring split into shares, for a part of a whole",

  process: "a numbered rail of steps, in order",
  timeline: "points along a line, for anything that happens over time",
  cycle: "a closed loop of stages, for something that repeats",
  funnel: "narrowing stages, for a filter that loses people or things at each step",
  pyramid: "ranked layers, widest at the base, for a hierarchy of importance",
  roadmap: "a phased track running left to right, for a plan",

  contrast: "two panels side by side: before and after, myth and reality",
  versus: "two options facing off across a divider, for a real choice",
  matrix: "a two-by-two grid, for two variables crossed",
  venn: "two overlapping circles, for what two things share",
  prosCons: "a ticked column and a crossed one, for what is gained and given up",

  tree: "a question at the top branching down dotted routes into numbered nodes",
  stack: "layers sitting on each other, for a system built in tiers",
  orbit: "one thing at the centre with satellites around it",
  flow: "boxes joined by arrows, for how something moves through a system",
  list: "lines called out one at a time between brackets, for a plain enumeration",

  split: "media on one side, a hierarchy of type on the other",
  collage: "three plates at three sizes on three baselines — a spread, not a grid",
  fullBleed: "a photograph filling the frame with type over it",
  deck: "a fanning stack of cards, for 'here are N of these'",
  grid: "a tile per idea, each with its own icon",
};
