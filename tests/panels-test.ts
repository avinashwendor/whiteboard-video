/**
 * Cutting a scene into screens.
 *
 * The complaint this exists to answer was "when the video is playing I should
 * move through the screens, not just be stuck". A scene used to be one
 * composition held for as long as its narration ran -- twelve, fifteen seconds
 * of an unchanging frame. Every individual frame was fine; the film was
 * static, and static is felt as boring long before anyone can say why.
 *
 * So a scene is dealt across panels. That turns one layout decision into four,
 * and four ways to get the arithmetic wrong: panels that overlap, panels that
 * leave a gap, a panel too short to read, a bullet that lands on two screens
 * or none. None of those throw. They produce a video that flickers, or drops
 * a point, and you find out by watching.
 *
 * Run with `npx tsx tests/panels-test.ts`.
 */

import { canCarry, panelAt, planPanels, panelCountFor } from "../src/lib/hyperframes/casting";
import { SCENE_ROLES_TUPLE, type SceneRole } from "../src/lib/hyperframes/roles";
import { estimateWordTimings } from "../src/lib/video/timing";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${message}`);
}

const NARRATION =
  "Most teams assume the index is the hard part, but retrieval quality collapses long before that, at the chunk boundary, and the fix is not a bigger model at all.";

function cut(options: {
  bullets: string[];
  duration: number;
  stat?: string;
  heading?: string;
  image?: boolean;
  index?: number;
  totalScenes?: number;
  recentRoles?: SceneRole[];
}) {
  const lead = 0.5;
  return planPanels({
    bullets: options.bullets,
    heading: options.heading ?? "Where retrieval breaks",
    stat: options.stat,
    image: options.image ? {} : undefined,
    duration: options.duration,
    lead,
    words: estimateWordTimings(NARRATION, Math.max(1, options.duration - lead - 0.6)),
    index: options.index ?? 2,
    totalScenes: options.totalScenes ?? 6,
    recentRoles: options.recentRoles,
  });
}

const THREE = ["Chunk boundaries", "Stale embeddings", "No reranking pass"];
const FOUR = [...THREE, "No eval harness"];

/* ------------------------------ how many screens ----------------------------- */

{
  // Below six seconds there is no room to cut: a screen a viewer cannot read
  // is worse than a screen held a moment too long.
  assert(cut({ bullets: THREE, duration: 4.5 }).length === 1, "a short scene stays on one screen");
  assert(cut({ bullets: THREE, duration: 5.9 }).length === 1, "and right up to the threshold");

  const medium = cut({ bullets: THREE, duration: 9 });
  assert(medium.length >= 2, `a nine-second scene moves, got ${medium.length} panel(s)`);

  const long = cut({ bullets: FOUR, duration: 16, stat: "84%" });
  assert(long.length >= 3, `a sixteen-second scene moves several times, got ${long.length}`);
  assert(long.length <= 4, `but never more than four, got ${long.length}`);

  // Never more panels than there is content to put on them: two panels for a
  // scene with one bullet means one of them is empty.
  const thin = cut({ bullets: ["One point"], duration: 16 });
  assert(thin.length <= 2, `a thin scene does not fragment, got ${thin.length}`);

  assert(panelCountFor(3, 4, true) === 1, "the count helper agrees at the short end");
  assert(panelCountFor(20, 6, true) === 4, "and caps at four");
}

/* ------------------------------- the arithmetic ------------------------------ */

{
  const duration = 15;
  const panels = cut({ bullets: FOUR, duration, stat: "84%" });

  assert(panels[0].from === 0, "the first panel starts at the top of the scene");
  assert(
    Math.abs(panels[panels.length - 1].to - duration) < 0.001,
    "and the last one runs to the end",
  );

  for (let i = 1; i < panels.length; i += 1) {
    // Contiguous, not merely ordered. A gap is a frame of nothing; an overlap
    // is two screens drawn at once, and only one of them is visible.
    assert(
      Math.abs(panels[i].from - panels[i - 1].to) < 0.001,
      `panel ${i} starts exactly where ${i - 1} ended (${panels[i - 1].to} vs ${panels[i].from})`,
    );
    assert(panels[i].from > panels[i - 1].from, "and strictly after it");
  }

  // Nothing may flicker. Below about a second and a half a screen has not been
  // read before it is replaced, which reads as a glitch rather than an edit.
  for (const [i, panel] of panels.entries()) {
    assert(
      panel.to - panel.from >= 1.5,
      `panel ${i} is held long enough to read (${(panel.to - panel.from).toFixed(2)}s)`,
    );
  }

  // Every point is shown exactly once: not dropped, not repeated on two
  // screens. A dropped bullet is a point the narration makes and the picture
  // never supports.
  const shown = panels.flatMap((panel) => panel.items).sort((a, b) => a - b);
  assert(
    shown.join(",") === FOUR.map((_, i) => i).join(","),
    `every bullet lands on exactly one screen, got [${shown.join(",")}]`,
  );

  assert(
    panels.filter((panel) => panel.carriesStat).length === 1,
    "the statistic is carried by exactly one screen",
  );
  assert(panels[0].opens, "the first panel is the one that establishes the heading");
}

/* -------------------------------- the screens -------------------------------- */

{
  const panels = cut({ bullets: FOUR, duration: 16, stat: "84%" });

  // Whatever a panel is given, its screen must be able to draw it.
  for (const panel of panels) {
    const content = {
      bullets: panel.items.map((i) => FOUR[i]),
      stat: panel.carriesStat ? "84%" : undefined,
    };
    assert(
      canCarry(panel.role, content),
      `${panel.role} can carry what it was dealt (${content.bullets.length} bullets, stat ${Boolean(content.stat)})`,
    );
  }

  // And a scene must not show the same screen twice running -- the whole
  // point of cutting is that the picture changes.
  for (let i = 1; i < panels.length; i += 1) {
    assert(
      panels[i].role !== panels[i - 1].role,
      `panel ${i} is a different screen from ${i - 1} (both ${panels[i].role})`,
    );
  }
}

{
  // Across a whole film: six scenes of identical content must not produce the
  // same handful of screens over and over, which is the failure the variant
  // rotation exists to prevent.
  const seen: SceneRole[] = [];
  for (let scene = 1; scene < 6; scene += 1) {
    const panels = cut({ bullets: THREE, duration: 12, index: scene, recentRoles: seen });
    for (const panel of panels) seen.push(panel.role);
  }
  const distinct = new Set(seen).size;
  assert(
    distinct >= 6,
    `five identical scenes still use a range of screens: ${distinct} distinct of ${seen.length}`,
  );
  for (let i = 2; i < seen.length; i += 1) {
    assert(
      !(seen[i] === seen[i - 1] || seen[i] === seen[i - 2]),
      `no screen repeats within three cuts (${seen.slice(i - 2, i + 1).join(", ")})`,
    );
  }
}

/* -------------------------------- locked slots ------------------------------- */

{
  // The opening screen of the film and the closing one are positional, and
  // must survive being cut into panels.
  const first = cut({ bullets: THREE, duration: 12, index: 0, totalScenes: 6 });
  assert(first[0].role === "hero", `the film opens on the title card, got ${first[0].role}`);
  assert(first.length > 1, "and the opening scene still moves after it");

  const last = cut({ bullets: THREE, duration: 12, index: 5, totalScenes: 6 });
  assert(
    last[last.length - 1].role === "takeaway",
    `the film closes on the takeaway, got ${last[last.length - 1].role}`,
  );
}

/* ------------------------------- the lookup ---------------------------------- */

{
  const panels = cut({ bullets: FOUR, duration: 15, stat: "84%" });
  for (const panel of panels) {
    // Sampled inside each panel, and on its own boundary, which is where an
    // off-by-one shows up.
    assert(panelAt(panels, panel.from).panel === panel, `the boundary belongs to its own panel`);
    assert(
      panelAt(panels, (panel.from + panel.to) / 2).panel === panel,
      `the middle of a panel resolves to it`,
    );
  }
  assert(panelAt(panels, -5).panel === panels[0], "before the start is the first panel");
  assert(panelAt(panels, 999).panel === panels[panels.length - 1], "past the end is the last");
}

/* ------------------------------ the whole library ---------------------------- */

{
  // Every screen must be reachable. A name in the director's vocabulary that
  // the caster can never choose is a promise the engine cannot keep.
  const reachable = new Set<SceneRole>();
  for (const bullets of [0, 1, 2, 3, 4, 5]) {
    for (const stat of [undefined, "84%"]) {
      for (const image of [false, true]) {
        for (const question of [false, true]) {
          // Both a scene short enough to stay whole and one long enough to be
          // cut: some screens are only ever right for a whole scene's content.
          for (const duration of [5, 9, 14, 18]) {
            for (let scene = 0; scene < 12; scene += 1) {
              const panels = cut({
                bullets: FOUR.slice(0, bullets).concat(
                  Array.from({ length: Math.max(0, bullets - 4) }, (_, i) => `Extra ${i}`),
                ),
                duration,
                stat,
                image,
                heading: question ? "Is retrieval dead?" : "Where retrieval breaks",
                index: scene,
                totalScenes: 12,
              });
              for (const panel of panels) reachable.add(panel.role);
            }
          }
        }
      }
    }
  }
  const unreachable = SCENE_ROLES_TUPLE.filter((role) => !reachable.has(role));
  assert(
    unreachable.length === 0,
    `every screen is reachable from some content: missing ${unreachable.join(", ")}`,
  );
}

if (failures) {
  console.error(`\n${failures} panel assertion(s) failed`);
  process.exit(1);
}
console.log("ALL PANEL TESTS PASSED");
