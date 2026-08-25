/**
 * The whole pipeline, minus the network.
 *
 * A video is not one program. A storyboard crosses a Zod boundary, becomes
 * project state, is written to localStorage as JSON, is read back into a text
 * box and parsed again, is handed to a planner, a scorer and an exporter, and
 * can be rewritten by an agent at any point. Every one of those is a place a
 * field can quietly stop existing.
 *
 * And it fails silently. A dropped `shot` does not throw -- the renderer picks
 * a layout from the content and the film simply is not the film that was
 * directed. A dropped `boardStock` gives you a whiteboard where a chalkboard
 * was asked for. Nobody finds those by reading the diff; you find them three
 * days later wondering why the palette never sticks.
 *
 * So this walks a realistic storyboard the whole way through and asserts, at
 * every boundary, that what went in came out. No LLM, no fetch, no canvas:
 * deterministic, and cheap enough to run on every change.
 *
 * Run with `npx tsx tests/pipeline-test.ts`.
 */

import { storyboardSchema } from "../src/lib/validation/schemas";
import { formatProjectJson, parseProjectJson } from "../src/lib/studio/project-schema";
import { checkSet } from "../src/lib/studio/edit-plan";
import { planModernScene } from "../src/lib/hyperframes/modern-renderer";
import { buildScore } from "../src/lib/video/score";
import { estimateWordTimings } from "../src/lib/video/timing";
import type { ProjectAsset } from "../src/lib/studio/types";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${message}`);
}

/* ------------------------- 1. what the director returns ------------------------ */

/** Shaped exactly as the create route's JSON contract describes it. */
const RAW = {
  title: "Why retrieval quietly breaks",
  description: "The failure everyone blames on the model happens before it.",
  image_prompt: "A server room at night, one rack lit, shallow depth of field, 35mm.",
  narration:
    "Most teams assume the index is the hard part. Retrieval quality collapses long before that. The fix is not a bigger model.",
  visual_style: "cold blue night interiors, single practical light source, 35mm",
  visual_theme: "obsidian",
  board_stock: "blueprint",
  music_mood: "serious",
  voice_brief: { gender: "any", qualities: ["calm", "clear"] },
  scenes: [
    {
      heading: "The index is not the problem",
      bullets: ["Chunk boundaries", "Stale embeddings"],
      shot: "bracket",
      narration: "Most teams assume the index is the hard part, and spend months tuning it.",
      keywords: ["index", "hard"],
      image_prompt: "A single lit server rack in a dark room.",
      photo_query: "server rack dark room single light",
      support_visual: "photo",
    },
    {
      heading: "Where quality actually collapses",
      bullets: ["Chunking", "Reranking", "Freshness"],
      shot: "tree",
      narration: "Retrieval quality collapses long before that, at the chunk boundary.",
      keywords: ["quality", "collapses"],
      image_prompt: "Torn paper edges under raking light.",
      photo_query: "torn paper edge raking light macro",
      support_visual: "generated",
      stat: "84%",
      stat_caption: "of failures",
    },
  ],
};

const parsed = storyboardSchema.safeParse(RAW);
assert(parsed.success, `the director's JSON validates: ${parsed.success ? "" : parsed.error.issues[0]?.message}`);

if (!parsed.success) {
  console.error("\ncannot continue without a valid storyboard");
  process.exit(1);
}

const storyboard = parsed.data;

// The art direction is the part most likely to be silently dropped, because
// nothing downstream fails without it.
assert(storyboard.visual_theme === "obsidian", "the palette survives validation");
assert(storyboard.board_stock === "blueprint", "the board surface survives validation");
assert(storyboard.scenes[0].shot === "bracket", "the requested shot survives validation");
assert(storyboard.scenes[1].shot === "tree", "and on every scene, not just the first");

// A shot the renderer has never heard of must be refused at the boundary
// rather than reaching the player and resolving to something arbitrary.
const nonsense = storyboardSchema.safeParse({
  ...RAW,
  scenes: [{ ...RAW.scenes[0], shot: "kaleidoscope" }],
});
assert(!nonsense.success, "an invented shot name is rejected at the boundary");

/* ---------------------------- 2. the project state ---------------------------- */

/** The shape `use-studio` builds, with the fields that carry art direction. */
const project: ProjectAsset = {
  ...storyboard,
  videoStyle: "hyperframes",
  introDuration: 3,
  voiceDelay: 0.6,
  musicMood: "serious",
  boardStock: "blueprint",
  scenes: storyboard.scenes.map((scene) => ({
    heading: scene.heading,
    bullets: scene.bullets,
    narration: scene.narration,
    imagePrompt: scene.image_prompt,
    photoQuery: scene.photo_query,
    supportVisual: scene.support_visual,
    status: "done" as const,
    keywords: scene.keywords,
    stat: scene.stat,
    statCaption: scene.stat_caption,
    visualTheme: storyboard.visual_theme,
    shot: scene.shot,
    glyphs: [
      { name: "database", query: "chunk boundaries", paths: ["M3 5v14a9 3 0 0 0 18 0V5"] },
      { name: "gauge", query: "stale embeddings", paths: ["m12 14 4-4"] },
    ],
  })),
} as unknown as ProjectAsset;

/* ------------------- 3. localStorage, and back after a reload ------------------ */

/**
 * History is `JSON.stringify` of the whole record, so this is really a check
 * that nothing in the project is JSON-hostile -- a Set, a Map, a function, an
 * `undefined` standing in for a real value.
 */
const reloaded = JSON.parse(JSON.stringify(project)) as ProjectAsset;
assert(reloaded.boardStock === "blueprint", "the surface survives a reload");
assert(reloaded.scenes[0].shot === "bracket", "the shot survives a reload");
assert(reloaded.scenes[0].visualTheme === "obsidian", "the palette survives a reload");
assert(reloaded.scenes[0].glyphs?.[0]?.paths.length === 1, "the icon geometry survives a reload");

/* ---------------------- 4. the JSON panel, edited by hand --------------------- */

/**
 * The text box someone pastes into.
 *
 * This schema is deliberately loose -- unknown keys pass straight through, so
 * a field added later is never deleted by a round trip. That makes "the field
 * survived" true by construction and worth very little as an assertion.
 *
 * What is *not* free is rejection. A loose schema still validates the keys it
 * knows about, and that is the only thing standing between a typo'd shot name
 * and a renderer quietly resolving it to something else. So the round trip is
 * checked, and then the far more valuable half: that a value outside the
 * vocabulary is refused here, with a message naming the field.
 */
const text = formatProjectJson(project);
const round = parseProjectJson(text);
assert(!("error" in round), `a project the app wrote parses back: ${"error" in round ? round.error : ""}`);

if (!("error" in round)) {
  const back = round.project;
  assert(back.boardStock === "blueprint", "the surface survives the JSON panel");
  assert(back.scenes[0].shot === "bracket", "the shot survives the JSON panel");
  assert(back.scenes[1].shot === "tree", "on every scene");
  assert(back.scenes[0].visualTheme === "obsidian", "the palette survives the JSON panel");
  assert(back.scenes[0].glyphs?.length === 2, "the icons survive the JSON panel");
  assert(back.scenes[1].stat === "84%", "and so does the statistic");
}

/** Pastes one bad value into an otherwise valid project. */
function pasteInvalid(mutate: (draft: Record<string, unknown>) => void): string | null {
  const draft = JSON.parse(text) as Record<string, unknown>;
  mutate(draft);
  const result = parseProjectJson(JSON.stringify(draft));
  return "error" in result ? result.error : null;
}

const badShot = pasteInvalid((draft) => {
  (draft.scenes as Array<Record<string, unknown>>)[0].shot = "kaleidoscope";
});
assert(badShot !== null, "a shot outside the vocabulary is refused, not passed through");
assert(badShot?.includes("shot") ?? false, `and the message names the field: ${badShot}`);

const badStock = pasteInvalid((draft) => {
  draft.boardStock = "papyrus";
});
assert(badStock !== null, "so is a surface that does not exist");

const badTheme = pasteInvalid((draft) => {
  (draft.scenes as Array<Record<string, unknown>>)[0].visualTheme = "beige";
});
assert(badTheme !== null, "so is a palette that does not exist");

const badGlyph = pasteInvalid((draft) => {
  (draft.scenes as Array<Record<string, unknown>>)[0].glyphs = [{ paths: ["M0 0"] }];
});
assert(badGlyph !== null, "and an icon with no name is refused rather than drawn as nothing");

/* --------------------------- 5. what the agent may set ------------------------- */

assert(checkSet("shot", "deck", true) === null, "an agent may set a scene's shot");
assert(checkSet("boardStock", "chalk", false) === null, "and the video's surface");
assert(checkSet("visualTheme", "cobalt", true) === null, "and a scene's palette");
assert(checkSet("shot", "kaleidoscope", true) !== null, "but not an invented shot");
assert(checkSet("boardStock", "papyrus", false) !== null, "nor an invented surface");
assert(checkSet("visualTheme", "beige", true) !== null, "nor an invented palette");
// A scene field set on the video, or the reverse, is a real mistake an agent
// makes and must be told about rather than silently applied to nothing.
assert(checkSet("shot", "deck", false) !== null, "a scene field is refused at video level");

/* ----------------------- 6. the plan, and the score from it -------------------- */

const scenes = project.scenes;
const plans = scenes.map((scene, index) =>
  planModernScene(
    {
      heading: scene.heading,
      bullets: scene.bullets,
      narration: scene.narration,
      index,
      totalScenes: scenes.length,
      keywords: scene.keywords,
      stat: scene.stat,
      statCaption: scene.statCaption,
      visualTheme: scene.visualTheme,
      shot: scene.shot,
      glyphs: scene.glyphs,
      image: null,
    },
    estimateWordTimings(scene.narration, 7),
    { lead: 0.6, speech: 7, tail: 0.62 },
  ),
);

// Scene 0 is the opening, so the renderer owns it whatever was asked for.
assert(plans[0].role === "hero", `the first scene is the title, got ${plans[0].role}`);
// Scene 1 asked for a branch and can carry one, so it gets one.
assert(plans[1].role === "tree", `a requested, carryable shot is honoured, got ${plans[1].role}`);
assert(plans[1].stat != null, "the statistic is scheduled against the narration");

let cursor = 3;
const score = buildScore({
  coverDuration: 3,
  style: "hyperframes",
  mood: project.musicMood,
  scenes: plans.map((plan) => {
    const start = cursor;
    const duration = 0.6 + 7 + 0.62;
    cursor += duration;
    return {
      start,
      duration,
      lead: 0.6,
      speech: 7,
      cues: plan.beats,
      statAt: plan.stat?.at ?? null,
      hasNarration: true,
      role: plan.role,
    };
  }),
});

assert(score.sfx.length > 0, "the film gets a score");
assert(score.duck.length === scenes.length, "every narrated scene ducks the bed");
// The score is written in the bed's key, and "serious" is a different key from
// the default -- so a mood that failed to reach the scorer would show up here.
assert(Math.abs(score.key - 123.47) < 0.01, `the score is in the bed's key, got ${score.key}`);
assert(
  score.sfx.every((event) => event.at >= 0 && event.at <= cursor + 1),
  "and every effect lands inside the film",
);

if (failures) {
  console.error(`\n${failures} pipeline assertion(s) failed`);
  process.exit(1);
}
console.log("ALL PIPELINE TESTS PASSED");
