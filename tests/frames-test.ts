/**
 * The modern engine's shot list and palettes.
 *
 * Two things are asserted here, and both are the kind of thing that is only
 * ever noticed after a video has been watched.
 *
 * **The shot list.** A film where the same layout appears twice in three
 * scenes reads as a template no matter how good the writing is, and a layout
 * handed content it cannot carry -- a step rail with one step, a metric shot
 * with no number -- renders an empty frame. Both are silent failures: nothing
 * throws, the video just looks cheap.
 *
 * **Legibility.** Every palette pairs an ink with a ground and an accent with
 * the ink that goes on top of it. Getting one of those pairs wrong produces a
 * frame whose headline cannot be read, which no amount of art direction saves.
 * The contrast ratios are checked rather than eyeballed.
 *
 * Run with `npx tsx tests/frames-test.ts`.
 */

import { roleFor } from "../src/lib/hyperframes/modern-renderer";
import { SCENE_ROLES_TUPLE, SHOT_BRIEFS, type SceneRole } from "../src/lib/hyperframes/roles";
import { THEMES, THEME_NAMES } from "../src/lib/hyperframes/theme";
import {
  BOARD_STOCKS,
  BOARD_STOCK_NAMES,
  COLOURS,
  colourOf,
  setBoardStock,
} from "../src/lib/whiteboard/palette";
import { composeScene } from "../src/lib/whiteboard/scene";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${message}`);
}

/* ------------------------------- the shot list ------------------------------ */

interface Beat {
  bullets: number;
  stat?: string;
  heading?: string;
  image?: boolean;
  shot?: SceneRole;
}

/** Runs a synthetic film through the selector the way the player does. */
function cut(beats: Beat[]): SceneRole[] {
  const chosen: SceneRole[] = [];
  beats.forEach((beat, index) => {
    chosen.push(
      roleFor({
        index,
        totalScenes: beats.length,
        bullets: Array.from({ length: beat.bullets }, (_, i) => `point ${i}`),
        heading: beat.heading ?? "a heading",
        stat: beat.stat,
        image: beat.image ? {} : undefined,
        requested: beat.shot,
        recentRoles: chosen,
      }),
    );
  });
  return chosen;
}

{
  const film = cut([
    { bullets: 1, image: true },
    { bullets: 3 },
    { bullets: 3 },
    { bullets: 3 },
    { bullets: 2 },
    { bullets: 2 },
    { bullets: 0 },
    { bullets: 1 },
  ]);

  assert(film[0] === "hero", `the first scene is the title, got ${film[0]}`);
  assert(film[film.length - 1] === "takeaway", `the last scene closes, got ${film.at(-1)}`);

  // The property that matters: no layout twice inside any window of three.
  for (let i = 2; i < film.length; i += 1) {
    assert(
      !(film[i] === film[i - 1] || film[i] === film[i - 2]),
      `no shot repeats within three scenes (${film.slice(i - 2, i + 1).join(", ")} at ${i})`,
    );
  }

  // Three identical bullet-heavy scenes in a row must still produce three
  // different frames -- this is exactly the case that used to give three
  // process rails.
  assert(new Set(film.slice(1, 4)).size === 3, `three list scenes get three shots: ${film.slice(1, 4)}`);
}

{
  // A requested shot is honoured when the scene can carry it.
  const [, requested] = cut([{ bullets: 1 }, { bullets: 3, shot: "deck" }]);
  assert(requested === "deck", `the director's shot is used, got ${requested}`);

  // And refused when it cannot. A metric shot with no number draws an empty
  // frame, so the content's own choice wins instead.
  const [, refused] = cut([{ bullets: 1 }, { bullets: 3, shot: "metric" }]);
  assert(refused !== "metric", "a metric shot without a number is refused");
  assert(refused === "process", `and falls back to what the content supports, got ${refused}`);

  // Likewise a rail with nothing to put on it.
  const [, thin] = cut([{ bullets: 1 }, { bullets: 1, shot: "process" }]);
  assert(thin !== "process", "a step rail with one step is refused");

  // A number always beats the layout the bullets would have implied.
  const [, counted] = cut([{ bullets: 1 }, { bullets: 3, stat: "85%" }]);
  assert(counted === "metric", `a scene with a statistic is cut as one, got ${counted}`);

  // A question branches.
  const [, asked] = cut([{ bullets: 1 }, { bullets: 3, heading: "Is RAG dead?" }]);
  assert(asked === "tree", `a question becomes a branch, got ${asked}`);
}

{
  // Every shot in the vocabulary is described for the director, and every
  // described shot exists. A name in one list and not the other means either
  // an undocumented layout or a prompt promising something that will not render.
  for (const role of SCENE_ROLES_TUPLE) {
    assert(Boolean(SHOT_BRIEFS[role]), `${role} is described for the director`);
  }
  assert(
    Object.keys(SHOT_BRIEFS).length === SCENE_ROLES_TUPLE.length,
    "the brief describes exactly the shots that exist",
  );
}

/* -------------------------------- legibility ------------------------------- */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const full = hex.trim();
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

{
  assert(
    THEME_NAMES.length === Object.keys(THEMES).length,
    "the palette list and the palette table agree",
  );

  for (const name of THEME_NAMES) {
    const theme = THEMES[name];
    assert(theme != null, `${name} exists`);
    assert(theme.name === name, `${name} knows its own name`);

    // Body copy on the ground. 4.5:1 is the readable threshold, and a video
    // is read at a glance from further away than a web page.
    const body = contrast(theme.ink, theme.ground);
    assert(body >= 4.5, `${name}: ink on ground is legible (${body.toFixed(1)}:1)`);

    // Type on the accent plate. Display sizes only, so 3:1 is the bar.
    const plate = contrast(theme.accentInk, theme.accent);
    assert(plate >= 3, `${name}: ink on the accent plate is legible (${plate.toFixed(1)}:1)`);

    // Rules, dots and eyebrow labels are drawn in the mark weight, and they
    // are thin. A pale accent makes a fine plate and an invisible hairline,
    // which is precisely the mistake this role exists to prevent.
    const hairline = contrast(theme.mark, theme.ground);
    assert(
      hairline >= 3,
      `${name}: the mark reads against the ground as a hairline (${hairline.toFixed(1)}:1)`,
    );

    // Dark palettes claim to be dark.
    const groundLuminance = luminance(theme.ground);
    assert(
      theme.dark === groundLuminance < 0.25,
      `${name}: the "dark" flag matches the ground it describes`,
    );

    assert(theme.mesh.length === 3, `${name}: three light sources`);
    assert(theme.chrome.length === 4, `${name}: a four-stop metal ramp`);
    assert(
      ["print", "editorial", "glass"].includes(theme.finish),
      `${name}: a known finish`,
    );
  }

  // The engine is useless with one look. Every finish needs real choice in it.
  for (const finish of ["print", "editorial", "glass"] as const) {
    const count = THEME_NAMES.filter((name) => THEMES[name].finish === finish).length;
    assert(count >= 3, `${finish} has more than a token palette (${count})`);
  }
}

/* ------------------------------- board stocks ------------------------------ */

/**
 * The whiteboard's five surfaces.
 *
 * The failure this guards is the one the old single palette actually had: a
 * pen that is invisible on its own paper. It is silent -- the drawing is
 * there, correctly placed, and nobody can see it -- and it is exactly what
 * happens when a palette designed for white paper is dropped onto slate.
 */
{
  const marks: Array<keyof (typeof BOARD_STOCKS)["marker"]["colours"]> = [
    "blue",
    "yellow",
    "orange",
    "green",
    "red",
    "violet",
    "teal",
    "pink",
  ];

  for (const name of BOARD_STOCK_NAMES) {
    const stock = BOARD_STOCKS[name];
    const paper = stock.colours.paper;

    const ink = contrast(stock.colours.ink, paper);
    assert(ink >= 7, `${name}: ink on paper is line work, not a suggestion (${ink.toFixed(1)}:1)`);

    // Two different bars, because these colours do two different jobs. Every
    // pen is a *fill* under a near-black outline, so it only has to separate
    // from the paper enough to read as filled -- a highlighter yellow on white
    // is meant to be pale. But a set where everything is that pale has no
    // colour in it at all, so most of them have to stand on their own too.
    const ratios = marks.map((mark) => contrast(stock.colours[mark], paper));
    ratios.forEach((ratio, index) => {
      assert(
        ratio >= 1.45,
        `${name}: ${String(marks[index])} reads as a fill on its own paper (${ratio.toFixed(1)}:1)`,
      );
    });
    assert(
      ratios.filter((ratio) => ratio >= 2.5).length >= 5,
      `${name}: most of the set stands on its own without an outline`,
    );

    // A dark surface claims to be dark, and its ink is lighter than its paper.
    const inkLighter = luminance(stock.colours.ink) > luminance(paper);
    assert(stock.dark === inkLighter, `${name}: the "dark" flag matches which way round it draws`);
    assert(stock.wash.length === 3, `${name}: three lighting stops`);
  }

  // Switching the stock actually changes the pens every layout reads.
  const before = COLOURS.paper;
  setBoardStock("chalk");
  assert(COLOURS.paper === BOARD_STOCKS.chalk.colours.paper, "setting the stock swaps the pens");
  assert(colourOf("blue") === BOARD_STOCKS.chalk.colours.blue, "and colourOf follows it");
  setBoardStock("marker");
  assert(COLOURS.paper === before, "and it goes back");

  // An unknown name must not leave a video drawing on nothing.
  setBoardStock("nonsense" as never);
  assert(COLOURS.paper === BOARD_STOCKS.marker.colours.paper, "an unknown stock falls back");

  /**
   * The one that actually bites.
   *
   * A layout bakes its colours in when it is *composed*, not when it is
   * painted. Choose the stock after that and the paper turns dark while the
   * drawing keeps the ink it was built with: a board that is genuinely there
   * and completely invisible. Nothing throws, and the canvas is not blank --
   * it is a dark rectangle with dark lines on it.
   */
  const spec = {
    layout: "icons" as const,
    title: "Where it breaks",
    items: [
      { icon: "database", label: "Store" },
      { icon: "gauge", label: "Measure" },
    ],
  };

  const inksUnder = (name: Parameters<typeof setBoardStock>[0]) => {
    setBoardStock(name);
    return composeScene(spec)
      .beats.flatMap((beat) => beat.prims ?? [])
      .map((prim) => {
        const shaded = prim as { colour?: string; fill?: string };
        return `${shaded.colour ?? ""}|${shaded.fill ?? ""}`;
      })
      .join(",");
  };

  const onWhiteboard = inksUnder("marker");
  const onSlate = inksUnder("chalk");
  assert(onWhiteboard.length > 0, "a composed board has colours baked into it at all");
  assert(
    onWhiteboard !== onSlate,
    "composing under a different stock produces different ink -- if this passes trivially, the player is free to swap paper without rebuilding the board",
  );
  setBoardStock("marker");
}

if (failures) {
  console.error(`\n${failures} frame assertion(s) failed`);
  process.exit(1);
}
console.log("ALL FRAME TESTS PASSED");
