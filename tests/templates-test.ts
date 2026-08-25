/**
 * The text template library.
 *
 * `TEXT_STYLES` answered "how should this read" and stopped there — seven
 * looks, none of them moving — so every caption had its motion chosen
 * separately from a dropdown of eleven kinds named after mechanisms. Nobody
 * picks "wipeRight" because they wanted a lower third.
 *
 * Three things are worth pinning down. That every template actually draws —
 * a library is only as good as its worst entry, and a broken one is discovered
 * by a person mid-edit. That every template is *usable over footage* without
 * further tuning, which is the only thing that makes a preset list worth
 * having. And that the list the agent is given matches the list the executor
 * accepts: the prompt names these templates in prose, and prose drifts.
 *
 * Run with `npx tsx tests/templates-test.ts`.
 */

import { readFileSync } from "node:fs";
import {
  TEMPLATE_IDS,
  TEXT_TEMPLATES,
  templatesByCategory,
  textTemplate,
} from "../src/rescript/lib/overlay/templates";
import { paintComposition } from "../src/rescript/lib/overlay/render";
import { ANIMATION_KINDS } from "../src/rescript/lib/overlay/animation";
import { siftOps } from "../src/rescript/lib/overlay/ops-schema";
import {
  DEFAULT_FRAME,
  DEFAULT_SUBTITLE_STYLE,
  type Composition,
  type TextElement,
} from "../src/rescript/lib/overlay/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/* ------------------------------- well-formed -------------------------------- */

{
  assert(TEXT_TEMPLATES.length >= 30, `a library needs a library's worth: ${TEXT_TEMPLATES.length}`);
  assert(
    new Set(TEMPLATE_IDS).size === TEMPLATE_IDS.length,
    "template ids must be unique — the agent addresses them by name"
  );

  for (const t of TEXT_TEMPLATES) {
    assert(/^[a-zA-Z][a-zA-Z0-9]*$/.test(t.id), `${t.id} is not a usable identifier`);
    assert(t.label.length > 0 && t.label.length <= 18, `${t.id}: label too long for a card`);
    assert(t.sample.trim().length > 0, `${t.id}: needs sample text to preview`);
    assert(
      ANIMATION_KINDS.includes(t.enter.kind),
      `${t.id}: entrance "${t.enter.kind}" is not a real kind`
    );
    assert(
      ANIMATION_KINDS.includes(t.exit.kind),
      `${t.id}: exit "${t.exit.kind}" is not a real kind`
    );
    assert(textTemplate(t.id) === t, `${t.id}: not findable by its own id`);
  }

  assert(textTemplate("nope") === null, "an unknown id is not a template");
  const grouped = templatesByCategory().reduce((n, g) => n + g.templates.length, 0);
  assert(grouped === TEXT_TEMPLATES.length, "grouping must not lose or duplicate any");
}

/* -------------------------------- restraint --------------------------------- */

{
  // Every entry has to be usable over real footage with nothing else touched.
  // A library where half the entries need three properties walked back is a
  // library people stop opening.
  for (const t of TEXT_TEMPLATES) {
    assert(t.enter.duration <= 1.5, `${t.id}: entrance runs ${t.enter.duration}s — too slow to read`);
    assert(t.exit.duration <= 1, `${t.id}: exit runs ${t.exit.duration}s`);
    assert((t.style.sizeScale ?? 1) <= 1.7, `${t.id}: type is oversized`);
    assert((t.style.sizeScale ?? 1) >= 0.4, `${t.id}: type is too small to read`);

    // Legibility over a picture is not optional. Something has to separate the
    // type from whatever is behind it.
    const separated =
      t.style.shadow === true ||
      (t.style.background ?? null) !== null ||
      (t.style.strokeColor ?? null) !== null;
    assert(separated, `${t.id}: nothing separates the type from the footage`);

    // Stagger belongs on the animation, not the style — and `TextStylePatch`
    // has no such field, so the type system already refuses the other spelling.
    const stagger = t.enter.stagger;
    if (stagger !== undefined) {
      assert(stagger > 0 && stagger <= 0.4, `${t.id}: stagger ${stagger} is out of range`);
    }
  }
}

/* -------------------------------- rendering --------------------------------- */

function stubContext() {
  let stamps = 0;
  const ctx = {
    globalAlpha: 1,
    fillStyle: "#000" as unknown,
    strokeStyle: "#000" as unknown,
    lineWidth: 0,
    lineJoin: "round" as CanvasLineJoin,
    miterLimit: 2,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    textBaseline: "top" as CanvasTextBaseline,
    filter: "none",
    letterSpacing: "0px",
    save() {},
    restore() {},
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
    drawImage() {},
    fillRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    measureText: (s: string) => ({ width: s.length * 8 }),
    fillText() {
      stamps += 1;
    },
    strokeText() {},
    set font(_v: string) {},
    get font() {
      return "10px sans-serif";
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, count: () => stamps };
}

const SIZE = { width: 1280, height: 720 };

{
  // Every template, at four moments of its life: the frame it appears on,
  // part-way through the entrance, settled, and on the way out. A template that
  // throws is found here rather than by a person mid-edit.
  for (const t of TEXT_TEMPLATES) {
    const { sizeScale, ...look } = t.style;
    const element: TextElement = {
      id: t.id,
      kind: "text",
      name: t.label,
      start: 0,
      end: 6,
      rect: { x: 0.08, y: 0.35, w: 0.84, h: 0.3 },
      rotation: 0,
      opacity: 1,
      z: 1,
      locked: false,
      hidden: false,
      enter: t.enter,
      exit: t.exit,
      text: t.sample,
      fontFamily: "system-ui, sans-serif",
      fontWeight: 700,
      italic: false,
      fontSize: 0.082 * (sizeScale ?? 1),
      color: "#ffffff",
      align: "center",
      lineHeight: 1.2,
      letterSpacing: 0,
      uppercase: false,
      background: null,
      padding: 0.3,
      radius: 0.2,
      shadow: true,
      strokeColor: null,
      strokeWidth: 0,
      ...look,
    };

    const composition: Composition = {
      elements: [element],
      subtitles: {
        enabled: false,
        style: { ...DEFAULT_SUBTITLE_STYLE },
        cues: [],
        generated: false,
      },
      transitions: [],
      frame: { ...DEFAULT_FRAME },
      shots: [],
      grade: null,
    };

    let settledStamps = 0;
    for (const at of [0, Math.max(0.05, t.enter.duration * 0.6), 3, 5.9]) {
      const { ctx, count } = stubContext();
      try {
        paintComposition(ctx, composition, SIZE, at);
      } catch (err) {
        throw new Error(`${t.id} threw at ${at}s: ${(err as Error).message}`);
      }
      if (at === 3) settledStamps = count();
    }

    // Settled, it must actually be on screen. A template that draws nothing
    // once its entrance is over is the one failure a thumbnail would not show.
    assert(settledStamps > 0, `${t.id}: draws nothing once it has settled`);
  }
}

/* ----------------------------- the operation ------------------------------- */

{
  // The agent addresses templates by name, so the schema has to take them.
  const good = siftOps([
    { op: "addText", text: "Alex Rivera", template: "cleanBar" },
    { op: "captionPhrase", phrase: "three times faster", template: "wordPop" },
  ]);
  assert(good.ops.length === 2, `both should pass: ${good.rejected.join("; ")}`);

  // An invented template is not rejected by the schema — it is a free string —
  // but the executor must fall back to a plain caption rather than dropping the
  // operation. Losing the words entirely is worse than losing the styling.
  const invented = siftOps([{ op: "addText", text: "hello", template: "sparkleBlast3000" }]);
  assert(invented.ops.length === 1, "an unknown template must not lose the text");
}

/* --------------------------- the prompt's listing --------------------------- */

{
  // The prompt names every template in prose. Prose drifts: a template added
  // here and not there is invisible to the agent, and one removed here and left
  // there is an operation it will confidently plan and the executor will
  // quietly ignore.
  const prompt = readFileSync("src/lib/ai/rescript-agent.ts", "utf8");

  for (const id of TEMPLATE_IDS) {
    assert(
      new RegExp(`\\b${id}\\b`).test(prompt),
      `template "${id}" exists but the agent is never told about it`
    );
  }

  // …and the other way round. Every id-looking word in the listing block must
  // be a real template.
  const block = /PREFER "template" over[\s\S]*?Pick by what the words are doing/.exec(prompt);
  assert(block, "the template listing is missing from the prompt");
  const named = block![0].match(/\b[a-z][a-zA-Z0-9]{3,}\b/g) ?? [];
  const known = new Set<string>(TEMPLATE_IDS);
  // Only words that look like camelCase ids are candidates; ordinary prose in
  // the block is lower-case throughout.
  for (const word of named) {
    if (!/[A-Z]/.test(word)) continue;
    assert(known.has(word), `the prompt names "${word}", which is not a template`);
  }
}

console.log("ALL TEMPLATE TESTS PASSED");
