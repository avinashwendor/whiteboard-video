/**
 * The look.
 *
 * Two properties matter more than the numbers. First, **a grade treats the
 * footage and never the overlays** — text gone muddy under a look someone
 * applied to the picture is an hour lost in the wrong panel. Second, a grade
 * must *compose* with whatever filter is already on the context, because a dip
 * transition has a blur there at the moment the footage is drawn, and a grade
 * that silently replaced it would turn a blur-through into a hard cut: a bug
 * visible on one frame in the middle of a transition and never reproducible on
 * demand.
 *
 * The rest is restraint. The failure mode of a grading panel is a video that
 * has been *processed* rather than graded, and the way you get there is a
 * saturation control that reaches neon.
 *
 * Run with `npx tsx tests/grade-test.ts`.
 */

import {
  GRADE_PRESETS,
  gradeFilter,
  gradePreset,
  isNeutralGrade,
  NEUTRAL_GRADE,
  withGrade,
  withGradeDefaults,

} from "../src/rescript/lib/overlay/grade";
import {
  DEFAULT_FRAME,
  DEFAULT_SUBTITLE_STYLE,
  emptyComposition,
  isEmptyComposition,
  primaryPlate,
  type Composition,
  type Shot,
} from "../src/rescript/lib/overlay/types";
import { paintFrame } from "../src/rescript/lib/overlay/frame";
import { verifyPlan, type PlanWorld } from "../src/rescript/lib/overlay/verify";
import { siftOps } from "../src/rescript/lib/overlay/ops-schema";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/* --------------------------------- filters --------------------------------- */

{
  assert(gradeFilter(null) === "", "no grade, no filter");
  assert(gradeFilter(NEUTRAL_GRADE) === "", "a neutral grade costs nothing");
  assert(isNeutralGrade(null) && isNeutralGrade(undefined), "absent is neutral");
  assert(isNeutralGrade(NEUTRAL_GRADE), "neutral is neutral");

  // The three tonal controls, and only those, become a filter chain. Warmth,
  // vignette and grain are painted instead — a hue rotation would send skin
  // green on the way to making a frame cooler.
  const warm = gradeFilter({ ...NEUTRAL_GRADE, temperature: 1, vignette: 1, grain: 1 });
  assert(warm === "", `warmth and lens work are painted, not filtered — got "${warm}"`);

  const tonal = gradeFilter({ ...NEUTRAL_GRADE, exposure: 0.5, contrast: 0.5, saturation: 0.5 });
  assert(tonal.includes("brightness("), "exposure is brightness");
  assert(tonal.includes("contrast("), "contrast is contrast");
  assert(tonal.includes("saturate("), "saturation is saturate");

  // Only what is set appears, so a grade with one adjustment is one function.
  const one = gradeFilter({ ...NEUTRAL_GRADE, contrast: 0.2 });
  assert(!one.includes("brightness"), "an unset field must not appear");
  assert(one.split(" ").length === 1, `one adjustment, one function — got "${one}"`);
}

{
  // Restraint, asserted rather than hoped for. These bounds are what stops the
  // panel producing something that has been processed rather than graded.
  const extreme = { exposure: 1, contrast: 1, saturation: 1 };
  const filter = gradeFilter({ ...NEUTRAL_GRADE, ...extreme });
  const value = (fn: string) =>
    Number(new RegExp(`${fn}\\(([\\d.]+)\\)`).exec(filter)?.[1] ?? "1");

  assert(value("brightness") <= 1.5, `brightness tops out too high: ${value("brightness")}`);
  assert(value("contrast") <= 1.45, `contrast tops out too high: ${value("contrast")}`);
  assert(value("saturate") <= 1.65, `saturation reaches neon: ${value("saturate")}`);

  // The other end: full desaturation is reachable, because mono is a real look.
  const grey = gradeFilter({ ...NEUTRAL_GRADE, saturation: -1 });
  assert(grey.includes("saturate(0"), `mono must be reachable — got "${grey}"`);

  // Out-of-range input is clamped, never passed through into a CSS string.
  const silly = gradeFilter({ ...NEUTRAL_GRADE, contrast: 99 });
  assert(value("contrast") <= 1.45 || Number(/contrast\(([\d.]+)\)/.exec(silly)?.[1]) <= 1.45,
    "out-of-range values must be clamped");
}

{
  // Every preset must be usable on a talking head with nothing else touched.
  // That is the only thing that makes a preset list worth having.
  for (const preset of GRADE_PRESETS) {
    const g = preset.grade;
    assert(Math.abs(g.exposure) <= 0.25, `${preset.id} moves exposure too far`);
    assert(g.contrast <= 0.5, `${preset.id} is too contrasty`);
    assert(g.vignette <= 0.6, `${preset.id} vignettes too hard`);
    assert(g.grain <= 0.5, `${preset.id} is too grainy`);
    // And none of them can throw a filter the browser would reject.
    assert(!gradeFilter(g).includes("NaN"), `${preset.id} produced NaN`);
  }

  assert(isNeutralGrade(gradePreset("none")), "'none' is neutral");
  assert(gradePreset("nonsense") === null, "an unknown preset is not a grade");
  assert(gradePreset("mono")!.saturation === -1, "mono is fully desaturated");
}

{
  // A partial grade out of an older save fills in rather than throwing.
  const partial = withGradeDefaults({ contrast: 0.3 });
  assert(partial.contrast === 0.3 && partial.grain === 0, "missing fields default");
  assert(isNeutralGrade(withGradeDefaults(null)) , "nothing in, neutral out");
}

/* ------------------------------- composition -------------------------------- */

{
  // A look is work: export must not take the fast path past it.
  const graded: Composition = { ...emptyComposition(), grade: { ...NEUTRAL_GRADE, contrast: 0.3 } };
  assert(!isEmptyComposition(graded, 16 / 9), "a graded composition needs compositing");
  assert(isEmptyComposition(emptyComposition(), 16 / 9), "a neutral one still does not");
  assert(
    isEmptyComposition({ ...emptyComposition(), grade: { ...NEUTRAL_GRADE } }, 16 / 9),
    "an explicitly neutral grade is still no work"
  );
}

/* -------------------------------- rendering -------------------------------- */

interface Painted {
  kind: "image" | "fill" | "text";
  filter: string;
  composite: string;
}

function stubContext() {
  const painted: Painted[] = [];
  const stack: { filter: string; composite: string; alpha: number }[] = [];

  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000" as unknown,
    filter: "none",
    save() {
      stack.push({
        filter: this.filter,
        composite: this.globalCompositeOperation,
        alpha: this.globalAlpha,
      });
    },
    restore() {
      const previous = stack.pop();
      if (previous) {
        this.filter = previous.filter;
        this.globalCompositeOperation = previous.composite;
        this.globalAlpha = previous.alpha;
      }
    },
    drawImage() {
      painted.push({
        kind: "image",
        filter: this.filter,
        composite: this.globalCompositeOperation,
      });
    },
    fillRect() {
      painted.push({
        kind: "fill",
        filter: this.filter,
        composite: this.globalCompositeOperation,
      });
    },
    fillText() {
      painted.push({
        kind: "text",
        filter: this.filter,
        composite: this.globalCompositeOperation,
      });
    },
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    beginPath() {},
    rect() {},
    roundRect() {},
    ellipse() {},
    moveTo() {},
    lineTo() {},
    clip() {},
    fill() {},
    stroke() {},
    translate() {},
    rotate() {},
    scale() {},
    measureText: () => ({ width: 10 }),
    strokeText() {},
    set font(_v: string) {},
    get font() {
      return "10px sans-serif";
    },
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, painted };
}

class FakeCanvas {
  width = 1920;
  height = 1080;
}
(globalThis as unknown as { HTMLCanvasElement: unknown }).HTMLCanvasElement = FakeCanvas;
const FOOTAGE = new FakeCanvas() as unknown as CanvasImageSource;
const SIZE = { width: 1280, height: 720 };

function composition(over: Partial<Composition> = {}): Composition {
  return {
    elements: [],
    subtitles: { enabled: false, style: { ...DEFAULT_SUBTITLE_STYLE }, cues: [], generated: false },
    transitions: [],
    frame: { ...DEFAULT_FRAME },
    shots: [],
    grade: null,
    ...over,
  };
}

{
  // Neutral changes nothing about how the footage is drawn.
  const clean = stubContext();
  paintFrame(clean.ctx, SIZE, { live: FOOTAGE, freeze: null }, null, composition(), 1);
  const image = clean.painted.find((p) => p.kind === "image");
  assert(image, "the footage was drawn");
  assert(image!.filter === "none", `neutral must not set a filter, got "${image!.filter}"`);
}

{
  // Graded: the picture carries the filter.
  const graded = stubContext();
  paintFrame(
    graded.ctx,
    SIZE,
    { live: FOOTAGE, freeze: null },
    null,
    composition({ grade: { ...NEUTRAL_GRADE, contrast: 0.3, saturation: -0.2 } }),
    1
  );
  const image = graded.painted.find((p) => p.kind === "image");
  assert(image, "the footage was drawn");
  assert(image!.filter.includes("contrast("), `the picture is graded, got "${image!.filter}"`);
}

{
  // …and the captions are not. This is the property worth having a test for.
  const withText = stubContext();
  paintFrame(
    withText.ctx,
    SIZE,
    { live: FOOTAGE, freeze: null },
    null,
    composition({
      grade: { ...NEUTRAL_GRADE, contrast: 0.4, saturation: -0.6 },
      elements: [
        {
          id: "t1",
          kind: "text",
          name: "title",
          start: 0,
          end: 10,
          rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.1 },
          rotation: 0,
          opacity: 1,
          z: 1,
          locked: false,
          hidden: false,
          enter: { kind: "none", duration: 0, easing: "linear" },
          exit: { kind: "none", duration: 0, easing: "linear" },
          text: "HELLO",
          fontFamily: "sans-serif",
          fontWeight: 700,
          italic: false,
          fontSize: 0.06,
          color: "#fff",
          align: "left",
          lineHeight: 1.2,
          letterSpacing: 0,
          uppercase: false,
          background: null,
          padding: 0,
          radius: 0,
          shadow: false,
          strokeColor: null,
          strokeWidth: 0,
        },
      ],
    }),
    1
  );

  const text = withText.painted.filter((p) => p.kind === "text");
  assert(text.length > 0, "the caption was drawn");
  for (const t of text) {
    assert(
      !t.filter.includes("contrast(") && !t.filter.includes("saturate("),
      `a caption must never be graded — got "${t.filter}"`
    );
  }
}

{
  // Composed, not replaced: a grade must survive alongside a transition's blur.
  const ctx = { filter: "blur(4px)" } as unknown as CanvasRenderingContext2D;
  let seen = "";
  withGrade(ctx, { ...NEUTRAL_GRADE, contrast: 0.3 }, () => {
    seen = ctx.filter;
  });
  assert(seen.includes("blur(4px)"), `the blur must survive — got "${seen}"`);
  assert(seen.includes("contrast("), `the grade must apply — got "${seen}"`);
  assert(ctx.filter === "blur(4px)", "and the context is put back the way it was");

  // A neutral grade leaves the context strictly alone.
  const plain = { filter: "blur(4px)" } as unknown as CanvasRenderingContext2D;
  let untouched = "";
  withGrade(plain, NEUTRAL_GRADE, () => {
    untouched = plain.filter;
  });
  assert(untouched === "blur(4px)", "a neutral grade must not touch the filter");
}

{
  // A shot's own look wins, and `null` on a shot means neutral rather than
  // inherit — a cutaway that has to be left alone needs to be able to say so.
  const shot: Shot = {
    id: "s1",
    start: 0,
    end: 5,
    layout: "full",
    plates: [primaryPlate()],
    grade: null,
  };
  const scoped = stubContext();
  paintFrame(
    scoped.ctx,
    SIZE,
    { live: FOOTAGE, freeze: null },
    null,
    composition({ grade: { ...NEUTRAL_GRADE, saturation: -1 }, shots: [shot] }),
    1
  );
  const image = scoped.painted.find((p) => p.kind === "image");
  assert(image, "the footage was drawn");
  assert(
    image!.filter === "none",
    `an explicitly null shot grade means neutral, got "${image!.filter}"`
  );
}

/* ------------------------------ the operation ------------------------------- */

const world: PlanWorld = {
  duration: 60,
  boundaryCount: 1,
  elementCount: 0,
  subtitlesOn: false,
  subtitlePosition: "bottom",
  transcript: "[00:00] something was said",
  can: { generateImage: true, photoSearch: true },
};

{
  assert(siftOps([{ op: "setGrade", preset: "warmFilm" }]).ops.length === 1, "a real preset");
  assert(siftOps([{ op: "setGrade", preset: "instagram" }]).ops.length === 0, "an invented one");
  assert(
    siftOps([{ op: "setGrade", preset: "clean", contrast: 7 }]).ops.length === 0,
    "an out-of-range nudge is rejected rather than clamped at the schema"
  );

  assert(verifyPlan([{ op: "setGrade", preset: "moody" }], world).length === 0, "one look is fine");
  assert(
    verifyPlan(
      [{ op: "setGrade", preset: "moody" }, { op: "setGrade", preset: "vivid" }],
      world
    ).length > 0,
    "two whole-video looks must be caught — only the last would survive"
  );
  assert(
    verifyPlan([{ op: "setGrade", preset: "mono", at: 500 }], world).length > 0,
    "a look past the end of the cut must be caught"
  );
  assert(
    verifyPlan(
      [{ op: "setGrade", preset: "clean" }, { op: "setGrade", preset: "mono", at: 12 }],
      world
    ).length === 0,
    "a whole-video look plus one shot's own is the correct way to fix a mismatched cutaway"
  );
}

console.log("ALL GRADE TESTS PASSED");
