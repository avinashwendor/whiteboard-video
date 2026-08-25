/**
 * The house style, as rules.
 *
 * The prompt has always carried a style guide, written as prose — which means
 * it is advice the model may or may not have taken, and nobody could tell
 * without watching the output. That was survivable when the agent could place
 * captions and transitions. It stopped being survivable the moment it was given
 * a template library, 1,776 icons, seven grades and four new transitions: a
 * bigger toy box makes worse videos by default.
 *
 * These rules are what scales against that. Which means the thing worth testing
 * is not that they fire — it is that they **do not fire on good plans**. A rule
 * that flags the correct answer is worse than no rule at all, because the first
 * person to hit it stops believing the rest of them.
 *
 * Run with `npx tsx tests/craft-test.ts`.
 */

import { checkCraft, craftScore } from "../src/rescript/lib/overlay/craft";
import type { AgentOp } from "../src/rescript/lib/overlay/ops-schema";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const ctx = { duration: 120 };
const ops = (list: unknown[]) => list as AgentOp[];
const rules = (found: ReturnType<typeof checkCraft>) => found.map((f) => f.rule);

/* ------------------------------ the good cases ------------------------------ */

{
  // Nothing at all is nothing to complain about.
  assert(checkCraft([], ctx).length === 0, "an empty plan is not a style violation");

  // A real, well-made two-minute edit: cuts first, one accent, one transition
  // family, a handful of things on screen. This is the plan the rules exist to
  // let through, so it is asserted first and hardest.
  const good = ops([
    { op: "removeFillers" },
    { op: "removeSilences" },
    { op: "setAllTransitions", kind: "morphCut", duration: 0.25 },
    { op: "addText", text: "How we rebuilt it", template: "kineticMask", start: 0, duration: 3 },
    { op: "captionPhrase", phrase: "forty percent", text: "40%", color: "#ffd60a" },
    { op: "addShape", shape: "path", mark: "circleThis", strokeColor: "#ffd60a", start: 40 },
    { op: "setGrade", preset: "clean" },
    { op: "autoPunchIns" },
    { op: "subtitles", action: "on", preset: "clean" },
  ]);
  const found = checkCraft(good, ctx);
  assert(
    found.length === 0,
    `a well-made edit must pass cleanly, got: ${found.map((f) => f.message).join(" | ")}`
  );
  assert(craftScore(found) === 1, "and score a full mark");
}

{
  // White, black and translucent scrims are structure, not accent. Counting
  // them would make almost every plan look like it had three accents, and the
  // rule would be ignored within a day.
  const neutral = ops([
    { op: "addText", text: "hello", color: "#ffffff", background: "rgba(0,0,0,0.55)" },
    { op: "addShape", shape: "rect", fill: "rgba(0,0,0,0.6)" },
    { op: "addText", text: "again", color: "#fff", strokeColor: "#0a0b0d" },
  ]);
  assert(
    !rules(checkCraft(neutral, ctx)).includes("accent"),
    "neutrals are not accents"
  );

  // …but two actual hues are.
  const clashing = ops([
    { op: "addText", text: "one", color: "#ffd60a" },
    { op: "addText", text: "two", color: "#4ade80" },
  ]);
  assert(rules(checkCraft(clashing, ctx)).includes("accent"), "two hues is two accents");

  // One hue used everywhere is the rule being followed, not broken.
  const consistent = ops([
    { op: "addText", text: "one", color: "#ffd60a" },
    { op: "addText", text: "two", color: "#ffd60a", background: "rgba(0,0,0,0.5)" },
    { op: "addShape", shape: "path", mark: "arrow", strokeColor: "#FFD60A" },
  ]);
  assert(
    !rules(checkCraft(consistent, ctx)).includes("accent"),
    "one accent, however it is spelled"
  );
}

/* ------------------------------ the bad cases ------------------------------- */

{
  // Density: straight out of the prompt's own words — "one title, three or four
  // kinetic captions, two or three pictures" across two minutes.
  const slideshow = ops(
    Array.from({ length: 20 }, (_, i) => ({
      op: "addText",
      text: `caption ${i}`,
      start: i * 5,
      duration: 3,
    }))
  );
  assert(rules(checkCraft(slideshow, ctx)).includes("density"), "twenty captions is a slideshow");

  // A short clip is all beginning; the density rule must not fire on one.
  const short = checkCraft(
    ops([
      { op: "addText", text: "a" },
      { op: "addText", text: "b" },
      { op: "addText", text: "c" },
    ]),
    { duration: 8 }
  );
  assert(!rules(short).includes("density"), "a short clip is not judged on density");
}

{
  const mixed = ops([
    { op: "setTransition", between: 1, kind: "dissolve" },
    { op: "setTransition", between: 2, kind: "iris" },
    { op: "setTransition", between: 3, kind: "whipPan" },
  ]);
  assert(rules(checkCraft(mixed, ctx)).includes("transitions"), "three kinds is a jumble");

  // Two is tolerated — a video with one workhorse cut and one deliberate
  // punctuation is a normal, good edit, and a rule that forbade it would be
  // wrong about how editing works.
  const two = ops([
    { op: "setAllTransitions", kind: "morphCut" },
    { op: "setTransition", between: 3, kind: "fadeBlack" },
  ]);
  assert(
    !rules(checkCraft(two, ctx)).includes("transitions"),
    "one workhorse plus one accent cut is fine"
  );
}

{
  // Cuts change the clock, so anything timed against it has to follow them.
  const wrongOrder = ops([
    { op: "addText", text: "title", start: 90, duration: 3 },
    { op: "keepOnly", ranges: [{ from: 10, to: 40 }] },
  ]);
  assert(rules(checkCraft(wrongOrder, ctx)).includes("order"), "a timed op before a cut");

  const rightOrder = ops([
    { op: "keepOnly", ranges: [{ from: 10, to: 40 }] },
    { op: "addText", text: "title", start: 2, duration: 3 },
  ]);
  assert(
    !rules(checkCraft(rightOrder, ctx)).includes("order"),
    "cuts first is the whole rule"
  );
}

{
  // Two whole-video grades: only the last survives, so the plan describes work
  // it will not do.
  const twice = ops([
    { op: "setGrade", preset: "moody" },
    { op: "setGrade", preset: "vivid" },
  ]);
  assert(rules(checkCraft(twice, ctx)).includes("grade"), "graded twice");

  // A project grade plus one shot's own is the correct way to fix a cutaway
  // that was filmed on a different camera.
  const scoped = ops([
    { op: "setGrade", preset: "clean" },
    { op: "setGrade", preset: "mono", at: 30 },
  ]);
  assert(!rules(checkCraft(scoped, ctx)).includes("grade"), "one look plus one exception");
}

{
  // autoPunchIns spaces its own shots; hand-placed ones alongside it land on
  // top of them. A warning rather than an error — someone who knows exactly
  // what they want should be able to do it.
  const both = ops([
    { op: "autoPunchIns" },
    { op: "setCamera", start: 10, end: 13, camera: "punchIn" },
  ]);
  const found = checkCraft(both, ctx);
  assert(rules(found).includes("camera"), "mixing automatic and manual zooms");
  assert(
    found.every((f) => f.rule !== "camera" || f.severity === "warning"),
    "…but it is a warning, not a rule"
  );
}

/* --------------------------------- scoring ---------------------------------- */

{
  assert(craftScore([]) === 1, "nothing wrong is a full mark");

  const oneError = checkCraft(
    ops([
      { op: "addText", text: "a", color: "#ffd60a" },
      { op: "addText", text: "b", color: "#4ade80" },
    ]),
    ctx
  );
  const score = craftScore(oneError);
  assert(score < 1 && score > 0.5, `one error is a dent, not a write-off: ${score}`);

  // An error costs more than a warning — one is the style guide stated
  // outright, the other is a smell that is sometimes deliberate.
  const errorOnly = craftScore([{ rule: "x", message: "", severity: "error" }]);
  const warningOnly = craftScore([{ rule: "x", message: "", severity: "warning" }]);
  assert(errorOnly < warningOnly, "an error costs more than a warning");

  // And it floors rather than going negative, so a bad plan is comparable to
  // another bad plan instead of both being "very negative".
  const awful = craftScore(
    Array.from({ length: 40 }, () => ({ rule: "x", message: "", severity: "error" as const }))
  );
  assert(awful === 0, `the score floors at zero, got ${awful}`);
}

console.log("ALL CRAFT TESTS PASSED");
