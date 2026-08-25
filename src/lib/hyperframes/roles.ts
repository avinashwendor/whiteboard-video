/**
 * The shot names, on their own.
 *
 * Split out of the renderer so a Zod schema and a server route can name a
 * composition without importing a module full of canvas code -- these run on
 * the server, where `CanvasRenderingContext2D` does not exist. One list, and
 * adding a shot updates the director's vocabulary, the storyboard schema and
 * the editor at once.
 */

export const SCENE_ROLES_TUPLE = [
  "hero",
  "statement",
  "split",
  "metric",
  "process",
  "contrast",
  "takeaway",
  "bracket",
  "deck",
  "tree",
  "collage",
] as const;

export type SceneRole = (typeof SCENE_ROLES_TUPLE)[number];

/** One line each, for the director's brief and the editor's tooltips. */
export const SHOT_BRIEFS: Record<SceneRole, string> = {
  hero: "the opening title, one card carrying the whole frame",
  statement: "one sentence held on screen, a marker under the words that matter",
  split: "media on one side, a hierarchy of type on the other",
  metric: "one number, counting up, landing on the word that says it",
  process: "a numbered rail of three or more steps",
  contrast: "two panels side by side: before and after, myth and reality",
  takeaway: "the closing line on a full plate of colour",
  bracket: "a magazine cover: the subject framed on a plate, its word ghosted enormous behind",
  deck: "a fanning stack of cards, for 'here are N of these'",
  tree: "a question at the top branching down dotted routes into numbered nodes",
  collage: "three plates at three sizes on three baselines, a spread rather than a grid",
};
