/**
 * Does every frame actually draw?
 *
 * A renderer fails in two ways that no type checker sees. It throws -- a shot
 * reaches for a helper that is not there, and the canvas goes blank mid-video.
 * Or it draws nonsense: one `NaN` anywhere in a chain of layout arithmetic
 * silently produces an invisible element rather than an error, which is why a
 * "missing" caption is so hard to find by reading the code.
 *
 * So every shot is rendered in every palette at several points through its
 * runtime, against a recording context that refuses any non-finite coordinate
 * and any colour it cannot parse. It is a smoke test, not a look test: it
 * cannot tell you a frame is ugly, only that it is really there.
 *
 * Run with `npx tsx tests/render-test.ts`.
 */

import {
  planModernScene,
  renderModernCover,
  renderModernOutro,
  renderModernScene,
  type ModernRenderScene,
} from "../src/lib/hyperframes/modern-renderer";
import { SCENE_ROLES_TUPLE, type SceneRole } from "../src/lib/hyperframes/roles";
import { THEME_NAMES } from "../src/lib/hyperframes/theme";
import { estimateWordTimings } from "../src/lib/video/timing";

// `Path2D` exists in every browser and in none of Node. The line-icon work
// is real code on a real path, so it is given a stand-in here rather than
// being skipped -- otherwise this sweep would report covering a drawing
// routine it never entered.
if (typeof (globalThis as { Path2D?: unknown }).Path2D === "undefined") {
  (globalThis as { Path2D?: unknown }).Path2D = class {
    constructor(public readonly d?: string) {}
  };
}

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${message}`);
}

/* ----------------------------- the canvas stub ----------------------------- */

interface Recording {
  ctx: CanvasRenderingContext2D;
  /** Every complaint raised while drawing, with the call that caused it. */
  problems: string[];
  /** How many marks were actually made. A frame that draws nothing is a bug. */
  marks: number;
}

function recordingCanvas(): Recording {
  const problems: string[] = [];
  let marks = 0;
  let font = "16px sans-serif";

  const check = (label: string, values: unknown[]) => {
    for (const value of values) {
      if (typeof value !== "number") continue;
      if (!Number.isFinite(value)) {
        problems.push(`${label} received ${value}`);
        return;
      }
    }
  };

  /** Catches a colour that came out as "undefined" or "rgba(NaN, ...)". */
  const checkPaint = (value: unknown, label: string) => {
    if (typeof value !== "string") return;
    if (value.includes("NaN") || value.includes("undefined")) {
      problems.push(`${label} set to "${value}"`);
    }
  };

  const gradient = {
    addColorStop: (stop: number, colour: string) => {
      check("addColorStop", [stop]);
      checkPaint(colour, "gradient stop");
    },
  };

  const target: Record<string, unknown> = {
    canvas: { width: 1280, height: 720 },
    filter: "none",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    lineWidth: 1,
    letterSpacing: "0px",
    textAlign: "left",
    textBaseline: "alphabetic",
    shadowBlur: 0,
    shadowOffsetY: 0,

    save: () => {},
    restore: () => {},
    translate: (...a: number[]) => check("translate", a),
    scale: (...a: number[]) => check("scale", a),
    rotate: (...a: number[]) => check("rotate", a),
    beginPath: () => {},
    closePath: () => {},
    moveTo: (...a: number[]) => check("moveTo", a),
    lineTo: (...a: number[]) => check("lineTo", a),
    quadraticCurveTo: (...a: number[]) => check("quadraticCurveTo", a),
    bezierCurveTo: (...a: number[]) => check("bezierCurveTo", a),
    arc: (...a: number[]) => check("arc", a),
    arcTo: (...a: number[]) => check("arcTo", a),
    ellipse: (...a: number[]) => check("ellipse", a),
    rect: (...a: number[]) => check("rect", a),
    roundRect: (...a: unknown[]) => check("roundRect", a),
    clip: () => {},
    fill: () => {
      marks += 1;
    },
    stroke: () => {
      marks += 1;
    },
    fillRect: (...a: number[]) => {
      check("fillRect", a);
      marks += 1;
    },
    strokeRect: (...a: number[]) => {
      check("strokeRect", a);
      marks += 1;
    },
    setLineDash: () => {},
    fillText: (text: string, ...a: number[]) => {
      check(`fillText(${JSON.stringify(text).slice(0, 24)})`, a);
      if (typeof text !== "string") problems.push("fillText got a non-string");
      marks += 1;
    },
    strokeText: (text: string, ...a: number[]) => {
      check("strokeText", a);
      marks += 1;
    },
    measureText: (text: string) => {
      // Proportional to the font size actually set, so the auto-fit loops in
      // `layoutDisplay` do real work rather than always succeeding first try.
      const size = Number.parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "16");
      return { width: String(text).length * size * 0.55 };
    },
    createLinearGradient: (...a: number[]) => {
      check("createLinearGradient", a);
      return gradient;
    },
    createRadialGradient: (...a: number[]) => {
      check("createRadialGradient", a);
      return gradient;
    },
    createPattern: () => null,
    drawImage: (_source: unknown, ...a: number[]) => {
      check("drawImage", a);
      marks += 1;
    },
  };

  // `font`, `fillStyle` and `strokeStyle` are watched rather than stored: a
  // font string containing "NaNpx" is the classic way a heading disappears.
  const ctx = new Proxy(target, {
    get: (obj, key) => (key === "font" ? font : obj[key as string]),
    set: (obj, key, value) => {
      if (key === "font") {
        if (typeof value === "string" && (value.includes("NaN") || value.includes("undefined"))) {
          problems.push(`font set to "${value}"`);
        }
        font = String(value);
        return true;
      }
      if (key === "fillStyle" || key === "strokeStyle") checkPaint(value, String(key));
      obj[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return { ctx, problems, marks: 0, get marksSeen() { return marks; } } as unknown as Recording & {
    marksSeen: number;
  };
}

/* -------------------------------- the fixture ------------------------------- */

const NARRATION =
  "Most teams assume the index is the hard part, but retrieval quality collapses long before that, and the fix is not a bigger model.";

/** A stand-in photograph, so the picture branches are exercised too. */
const PHOTO = {
  complete: true,
  naturalWidth: 1600,
  naturalHeight: 900,
} as unknown as HTMLImageElement;

/**
 * Content shaped to what each shot needs.
 *
 * Deliberately exact: handing every layout the same three bullets means the
 * ones that require two or four are quietly refused by `canCarry` and never
 * render at all, which would leave this sweep testing eight shots while
 * reporting eleven.
 */
const BULLETS: Record<SceneRole, number> = {
  hero: 1,
  statement: 0,
  split: 2,
  metric: 1,
  process: 3,
  contrast: 2,
  takeaway: 1,
  bracket: 1,
  deck: 4,
  tree: 3,
  collage: 2,
};

/** Shots that compose around a photograph. */
const NEEDS_PHOTO = new Set<SceneRole>(["bracket", "collage", "split", "hero"]);

function sceneFor(role: SceneRole, index: number): ModernRenderScene {
  const pool = ["Chunking strategy", "Reranking pass", "Freshness window", "Eval harness"];
  return {
    heading: role === "tree" ? "Is retrieval dead?" : "Where retrieval breaks",
    bullets: pool.slice(0, BULLETS[role]),
    narration: NARRATION,
    index,
    totalScenes: 6,
    keywords: ["retrieval", "quality"],
    stat: role === "metric" ? "84%" : undefined,
    statCaption: role === "metric" ? "of failures" : undefined,
    shot: role,
    image: NEEDS_PHOTO.has(role) ? PHOTO : null,
    // Real Lucide geometry, so the icon path is exercised rather than skipped.
    glyphs: [
      { name: "brain-circuit", paths: ["M12 5a3 3 0 1 0-5.997.125", "M9 13a4.5 4.5 0 0 0 3-4"] },
      { name: "trending-up", paths: ["M16 7h6v6", "m22 7-8.5 8.5-5-5L2 17"] },
      { name: "database", paths: ["M 5 6 A 7 3 0 1 0 19 6 A 7 3 0 1 0 5 6 Z", "M3 5v14a9 3 0 0 0 18 0V5"] },
      { name: "gauge", paths: ["m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0"] },
    ],
  };
}

const TIMES = [0, 0.35, 1.2, 3.4, 6.8, 9.4];
const DURATION = 10;

/* --------------------------------- the sweep -------------------------------- */

let rendered = 0;
const covered = new Set<SceneRole>();

for (const themeName of THEME_NAMES) {
  for (const role of SCENE_ROLES_TUPLE) {
    // `hero` and `takeaway` are position-locked; give them their positions.
    const index = role === "hero" ? 0 : role === "takeaway" ? 5 : 2;
    const scene = { ...sceneFor(role, index), visualTheme: themeName };
    const words = estimateWordTimings(NARRATION, 8);
    const plan = planModernScene(scene, words, { lead: 0.5, speech: 8, tail: 0.6 });

    // The fixture is shaped for this shot, so the renderer must actually pick
    // it. If it does not, this sweep is silently testing something else.
    assert(plan.role === role, `${themeName}: a scene shaped for ${role} is cut as ${plan.role}`);
    covered.add(plan.role);

    for (const time of TIMES) {
      const recording = recordingCanvas();
      try {
        renderModernScene(recording.ctx, scene, plan, {
          time,
          duration: DURATION,
          fontSans: "TestSans",
          fontDisplay: "TestDisplay",
          fontPoster: "TestPoster",
          globalProgress: time / DURATION,
        });
      } catch (error) {
        failures += 1;
        console.error(`FAIL: ${themeName}/${plan.role} at ${time}s threw: ${error}`);
        continue;
      }

      rendered += 1;
      if (recording.problems.length) {
        failures += 1;
        console.error(
          `FAIL: ${themeName}/${plan.role} at ${time}s — ${[...new Set(recording.problems)]
            .slice(0, 3)
            .join("; ")}`,
        );
      }

      const marks = (recording as unknown as { marksSeen: number }).marksSeen;
      // A settled frame that made fewer than a handful of marks has lost its
      // composition somewhere, which no exception would have told us about.
      if (time > 3 && marks < 8) {
        failures += 1;
        console.error(`FAIL: ${themeName}/${plan.role} at ${time}s drew only ${marks} marks`);
      }
    }
  }
}

/* --------------------------------- the cover -------------------------------- */

for (const themeName of THEME_NAMES) {
  for (const progress of [0, 0.2, 0.6, 1]) {
    const recording = recordingCanvas();
    try {
      renderModernCover(recording.ctx, {
        title: "Why retrieval quietly breaks",
        description: "The failure everyone blames on the model.",
        fontSans: "TestSans",
        fontDisplay: "TestDisplay",
        fontPoster: "TestPoster",
        progress,
        theme: themeName,
      });
    } catch (error) {
      failures += 1;
      console.error(`FAIL: cover/${themeName} at ${progress} threw: ${error}`);
      continue;
    }
    rendered += 1;
    if (recording.problems.length) {
      failures += 1;
      console.error(
        `FAIL: cover/${themeName} at ${progress} — ${[...new Set(recording.problems)].slice(0, 3).join("; ")}`,
      );
    }
  }
}

/* --------------------------------- the outro -------------------------------- */

for (const themeName of THEME_NAMES) {
  for (const progress of [0, 0.3, 0.7, 1]) {
    const recording = recordingCanvas();
    try {
      renderModernOutro(recording.ctx, {
        title: "Why retrieval quietly breaks",
        description: "Retrieval fails at the chunk boundary, not at the model.",
        fontSans: "TestSans",
        fontDisplay: "TestDisplay",
        fontPoster: "TestPoster",
        progress,
        theme: themeName,
      });
    } catch (error) {
      failures += 1;
      console.error(`FAIL: outro/${themeName} at ${progress} threw: ${error}`);
      continue;
    }
    rendered += 1;
    if (recording.problems.length) {
      failures += 1;
      console.error(
        `FAIL: outro/${themeName} at ${progress} — ${[...new Set(recording.problems)].slice(0, 3).join("; ")}`,
      );
    }
  }
}

assert(rendered > 700, `the sweep actually rendered something: ${rendered} frames`);
assert(
  covered.size === SCENE_ROLES_TUPLE.length,
  `every shot was rendered: ${covered.size}/${SCENE_ROLES_TUPLE.length} (missing ${SCENE_ROLES_TUPLE.filter((role) => !covered.has(role)).join(", ")})`,
);

if (failures) {
  console.error(`\n${failures} render assertion(s) failed across ${rendered} frames`);
  process.exit(1);
}
console.log(`ALL RENDER TESTS PASSED (${rendered} frames)`);
