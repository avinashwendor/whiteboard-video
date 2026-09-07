/**
 * Moving b-roll: where a clip is in its own source at a given output second.
 *
 * `clipTimeAt` is the whole feature in one function, and every way it goes
 * wrong is silent. Off by the trim and the insert starts on the wrong shot. Not
 * looping and a three-second insert of a two-second clip freezes on its last
 * frame for a third of its life, which reads as a stall rather than a bug. Rate
 * applied to the wrong side and slow motion runs fast.
 *
 * None of that throws, none of it shows up in a typecheck, and all of it is
 * arithmetic — so it is checked here rather than discovered in an export.
 *
 * The other half is the contract between the two callers: the exporter awaits
 * every seek because a frame from the wrong moment is in the file forever, and
 * the preview must NOT, because awaiting a seek per frame pegs the preview to
 * the decoder's seek rate. That is asserted against the source, since a
 * headless test has no decoder to drive.
 *
 * Run with `npx tsx tests/broll-test.ts`.
 */

import { readFileSync } from "node:fs";
import { clipTimeAt } from "../src/rescript/lib/overlay/render";
import { addBrollOp } from "../src/rescript/lib/overlay/ops-schema";
import { verifyPlan, type PlanWorld } from "../src/rescript/lib/overlay/verify";
import { checkCraft } from "../src/rescript/lib/overlay/craft";
import { pexels } from "../src/lib/media/pexels";
import { SYSTEM } from "../src/lib/ai/rescript-agent";
import type { VideoElement } from "../src/rescript/lib/overlay/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function near(actual: number, expected: number, tol: number, what: string) {
  assert(
    Math.abs(actual - expected) <= tol,
    `${what}: expected ~${expected}, got ${actual.toFixed(3)}`
  );
}

function clip(partial: Partial<VideoElement> = {}): VideoElement {
  return {
    id: "v1",
    kind: "video",
    name: "Clip",
    start: 10,
    end: 14,
    rect: { x: 0.5, y: 0.1, w: 0.4, h: 0.22 },
    rotation: 0,
    opacity: 1,
    z: 0,
    locked: false,
    hidden: false,
    enter: { kind: "fade", duration: 0.35, easing: "easeOut" },
    exit: { kind: "fade", duration: 0.3, easing: "easeIn" },
    src: "/api/asset/abc",
    trimIn: 0,
    sourceDuration: 12,
    fit: "cover",
    radius: 0.03,
    shadow: true,
    rate: 1,
    loop: true,
    muted: true,
    ...partial,
  };
}

/* -------------------------------- the clock --------------------------------- */

{
  const el = clip();
  near(clipTimeAt(el, 10), 0, 1e-6, "an insert starts at the head of its source");
  near(clipTimeAt(el, 12), 2, 1e-6, "and runs in step with the output clock");
  near(clipTimeAt(el, 14), 4, 1e-6, "right to its out point");

  // Before the element exists, the clock is clamped rather than negative: a
  // negative currentTime is refused by the decoder and the clip holds frame 0,
  // which is the same result by a worse route.
  near(clipTimeAt(el, 0), 0, 1e-6, "nothing before the in point runs backwards");

  const trimmed = clip({ trimIn: 3 });
  near(clipTimeAt(trimmed, 10), 3, 1e-6, "a trim moves where it starts");
  near(clipTimeAt(trimmed, 12), 5, 1e-6, "and carries through");
  console.log("✓ a clip runs in step with the output clock");
}

/* --------------------------------- the rate --------------------------------- */

{
  const slow = clip({ rate: 0.5 });
  near(clipTimeAt(slow, 12), 1, 1e-6, "half rate covers half the source in the same time");
  const fast = clip({ rate: 2 });
  near(clipTimeAt(fast, 12), 4, 1e-6, "double rate covers twice as much");

  // The trick worth having: three seconds of a clip slowed slightly.
  const nudged = clip({ rate: 0.8, end: 13 });
  near(clipTimeAt(nudged, 13), 2.4, 1e-6, "0.8 over three seconds shows 2.4s of source");
  console.log("✓ rate slows the source, not the element");
}

/* -------------------------------- the loop ---------------------------------- */

{
  // The common case: a two-second clip under a four-second insert.
  const short = clip({ sourceDuration: 2, loop: true });
  near(clipTimeAt(short, 10), 0, 1e-6, "starts at the head");
  near(clipTimeAt(short, 11), 1, 1e-6, "runs");
  near(clipTimeAt(short, 12), 0, 1e-6, "and wraps rather than freezing");
  near(clipTimeAt(short, 13.5), 1.5, 1e-6, "through the second pass");
  for (let t = 10; t <= 14; t += 0.1) {
    const at = clipTimeAt(short, t);
    assert(at >= 0 && at < 2 + 1e-6, `looped time ${at} fell outside the source at ${t}`);
  }

  // Looping respects the trim: the wrap goes back to the trim point, not to
  // zero, or a clip trimmed past a slate jumps back onto the slate.
  const trimmedLoop = clip({ sourceDuration: 5, trimIn: 2, loop: true });
  for (let t = 10; t <= 14; t += 0.1) {
    const at = clipTimeAt(trimmedLoop, t);
    assert(at >= 2 - 1e-6, `a looped trim went back past its own in point (${at} at ${t})`);
  }

  const held = clip({ sourceDuration: 2, loop: false });
  assert(
    clipTimeAt(held, 13) > 2,
    "with looping off the time runs past the end, and the decoder holds the last frame"
  );

  // A source whose length is not known yet must not loop on a span of zero.
  const unknown = clip({ sourceDuration: 0, loop: true });
  near(clipTimeAt(unknown, 12), 2, 1e-6, "an unmeasured clip plays straight through");
  console.log("✓ a short clip loops instead of freezing");
}

/* ------------------------------ the two callers ------------------------------ */

{
  // The contract that cannot be checked without a decoder, checked at source.
  const compose = readFileSync("src/rescript/lib/overlay/compose.ts", "utf8");
  assert(
    /await seekClips\(/.test(compose),
    "the exporter must AWAIT every clip seek — a frame from the wrong moment is in the file forever"
  );

  const stage = readFileSync("src/rescript/components/overlay/OverlayStage.tsx", "utf8");
  assert(
    /nudgeClips\(/.test(stage),
    "the preview must position clips each frame"
  );
  assert(
    !/await seekClips\(/.test(stage),
    "the preview must NOT await a seek — it would run at the decoder's seek rate"
  );

  const render = readFileSync("src/rescript/lib/overlay/render.ts", "utf8");
  assert(
    /preloadComposition[\s\S]{0,600}loadClip/.test(render),
    "preloading a composition has to warm the clips too, or the first exported frames are placeholders"
  );
  console.log("✓ the exporter awaits its seeks and the preview does not");
}

/* --------------------------------- the schema -------------------------------- */

{
  assert(
    addBrollOp.safeParse({ op: "addBroll", query: "city traffic", start: 5, duration: 3 }).success,
    "a plain b-roll op parses"
  );
  assert(
    addBrollOp.safeParse({ op: "addBroll", query: "rain", rate: 0.8 }).success,
    "with a rate"
  );
  assert(
    !addBrollOp.safeParse({ op: "addBroll", query: "rain", rate: 8 }).success,
    "a rate that would be a mistake is refused"
  );
  assert(
    !addBrollOp.safeParse({ op: "addBroll" }).success,
    "a clip with nothing to search for is refused"
  );
  console.log("✓ the schema accepts exactly what exists");
}

/* ------------------------------ the capability -------------------------------- */

{
  const world = (video: boolean): PlanWorld => ({
    duration: 60,
    boundaryCount: 2,
    elementCount: 0,
    subtitlesOn: false,
    subtitlePosition: "bottom",
    transcript: "",
    can: { generateImage: true, photoSearch: true, music: true, sfx: true, video },
  });

  const refused = verifyPlan([{ op: "addBroll", query: "rain", start: 5 }], world(false));
  assert(refused.length === 1, "a clip is refused when no catalogue is configured");
  assert(
    /addImage/.test(refused[0]),
    "and the refusal names the thing to do instead, or the model just drops the idea"
  );
  assert(
    verifyPlan([{ op: "addBroll", query: "rain", start: 5 }], world(true)).length === 0,
    "and allowed when it is"
  );
  assert(
    verifyPlan([{ op: "addBroll", query: "rain", start: 900 }], world(true)).length === 1,
    "a clip past the end of the video is still caught"
  );

  // Without a key the provider takes itself out of the running rather than
  // failing at fetch time.
  const key = process.env.PEXELS_API_KEY;
  delete process.env.PEXELS_API_KEY;
  assert(!pexels.isConfigured(), "no key means not configured");
  void pexels
    .search({ query: "rain", kind: "video" })
    .then((results) => {
      assert(results.length === 0, "searching with no key returns nothing rather than throwing");
      if (key) process.env.PEXELS_API_KEY = key;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
  console.log("✓ b-roll is dark without a key, and says what to do instead");
}

/* -------------------------------- restraint ---------------------------------- */

{
  const ops = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      op: "addBroll" as const,
      query: `thing ${i}`,
      start: i * 10,
      duration: 3,
    }));

  const rules = (fs: { rule: string }[]) => fs.map((f) => f.rule);
  assert(
    !rules(checkCraft(ops(2), { duration: 120 })).includes("broll"),
    "two clips in two minutes is a produced video"
  );
  assert(
    rules(checkCraft(ops(6), { duration: 300 })).includes("broll"),
    "six is a montage, whatever the length"
  );
  assert(
    rules(checkCraft(ops(3), { duration: 40 })).includes("broll"),
    "three in forty seconds is flagged — they run into each other"
  );
  console.log("✓ clips are rationed, because each one is a download and a seek per frame");
}

/* --------------------------------- the prompt --------------------------------- */

{
  assert(SYSTEM.includes("addBroll"), "the agent is never told the operation exists");
  assert(
    /whether the thing being talked about MOVES/.test(SYSTEM),
    "nor how to choose between a clip and a still, which is the only decision that matters"
  );
  assert(/"rate"/.test(SYSTEM), "nor that a short insert wants slowing slightly");
  console.log("✓ the whole decision reaches the model");
}

console.log("\nb-roll: all checks passed");
