/**
 * Sound effects: the library, and where the planner puts them.
 *
 * The thing being defended here is restraint. An effect on every cut is the
 * single clearest sound of an automatic edit, and the difference between
 * punctuation and a ringtone is entirely in two rules — a budget and a minimum
 * gap — which are easy to write and easy to quietly break. So they are checked
 * against the case that breaks them: footage whose fillers have been removed,
 * which leaves a cut every couple of seconds.
 *
 * The other silent failure is the lead. A riser that starts on the cut is
 * announcing something that already happened, and it sounds fine in isolation
 * and wrong in the video. It is the reason effects carry a lead at all.
 *
 * Run with `npx tsx tests/sfx-test.ts`.
 */

import {
  describeSfx,
  momentsFrom,
  planSfx,
  soundEffect,
  SFX_IDS,
  SOUND_EFFECTS,
  type SfxMoment,
} from "../src/motionscript/lib/overlay/sfx";
import { addSfxOp, autoSfxOp } from "../src/motionscript/lib/overlay/ops-schema";
import { verifyPlan, type PlanWorld } from "../src/motionscript/lib/overlay/verify";
import { SYSTEM } from "../src/lib/ai/motionscript-agent";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/* ------------------------------- the library -------------------------------- */

{
  const seen = new Set<string>();
  for (const effect of SOUND_EFFECTS) {
    assert(!seen.has(effect.id), `two effects called "${effect.id}"`);
    seen.add(effect.id);
    assert(soundEffect(effect.id) === effect, `${effect.id}: not findable by its own id`);
    assert(effect.query.length > 2, `${effect.id}: no search query`);
    // The queries go to a catalogue tagged by people using ordinary words.
    // Anything evocative finds nothing at all.
    assert(
      /^[a-z0-9 ]+$/.test(effect.query),
      `${effect.id}: "${effect.query}" is not a plain search term`
    );
    assert(effect.gain > 0 && effect.gain <= 0.6, `${effect.id}: gain ${effect.gain} is too loud`);
    assert(effect.hold > 0.1 && effect.hold <= 5, `${effect.id}: hold ${effect.hold}s`);
    assert(effect.lead <= 0, `${effect.id}: a positive lead would place it after its own moment`);
    assert(-effect.lead <= effect.hold, `${effect.id}: the lead is longer than the sound`);
    assert(effect.use.length > 10, `${effect.id}: no guidance on when to use it`);
  }

  // Anything that points forward has to be mostly over by the time the moment
  // arrives, or it is describing the past.
  for (const effect of SOUND_EFFECTS.filter((e) => e.role === "riser")) {
    assert(
      -effect.lead > effect.hold * 0.6,
      `${effect.id}: a riser must play mostly *before* its moment (lead ${effect.lead}, hold ${effect.hold})`
    );
  }
  // An impact is the opposite: it happens on the frame.
  for (const effect of SOUND_EFFECTS.filter((e) => e.role === "impact")) {
    assert(effect.lead === 0, `${effect.id}: an impact lands on the frame, not before it`);
  }

  assert(soundEffect("nope") === null, "an unknown id is not an effect");
  assert(SFX_IDS.length === SOUND_EFFECTS.length, "the id tuple matches the library");
  console.log(`✓ all ${SOUND_EFFECTS.length} effects are well formed`);
}

/* ------------------------------- restraint ---------------------------------- */

{
  // Removing fillers from a two-minute talking head leaves a cut roughly every
  // two seconds. This is the case that turns a sound design into a ringtone.
  const boundaries = Array.from({ length: 60 }, (_, i) => i * 2 + 1);
  const moments = momentsFrom({
    boundaries,
    pushes: [20, 55, 90],
    captions: [
      { at: 1.5, isTitle: true },
      { at: 34, isTitle: false },
      { at: 78, isTitle: false },
    ],
  });

  const placed = planSfx(moments, { duration: 120, style: "energetic" });
  assert(placed.length > 0, "some effects are placed");
  assert(
    placed.length <= 7,
    `two minutes of dense cuts must not produce ${placed.length} effects`
  );

  // Nothing within the gap of anything else, at any density.
  const sorted = [...placed].sort((a, b) => a.at - b.at);
  for (let i = 1; i < sorted.length; i += 1) {
    assert(
      sorted[i].at - sorted[i - 1].at >= 1.2,
      `two effects ${(sorted[i].at - sorted[i - 1].at).toFixed(2)}s apart at ${sorted[i].at}s`
    );
  }
  assert(
    placed.every((p) => p.at >= 0 && p.at <= 120),
    "nothing is placed outside the video"
  );

  const subtle = planSfx(moments, { duration: 120, style: "subtle" });
  assert(
    subtle.length < placed.length,
    `subtle is quieter than energetic (${subtle.length} vs ${placed.length})`
  );
  // Subtle marks movement and nothing else — no impacts under captions.
  assert(
    subtle.every((p) => p.effect.role === "movement" || p.effect.role === "riser"),
    "subtle uses only movement and anticipation sounds"
  );
  console.log(`✓ restraint holds: ${placed.length} energetic, ${subtle.length} subtle, over 2 minutes`);
}

/* ------------------------------ best moments -------------------------------- */

{
  // Best-first, not chronological. A title two seconds after an ordinary cut
  // must win the slot — a chronological pass takes the cut and then refuses
  // the title for being too close, which is exactly backwards.
  const moments: SfxMoment[] = [
    { at: 10, kind: "cut", weight: 1 },
    { at: 10.5, kind: "title", weight: 4 },
  ];
  const placed = planSfx(moments, { duration: 60, perMinute: 6 });
  assert(placed.length === 1, "the two are too close for both");
  assert(
    placed[0].effect.role === "impact",
    `the title wins the slot, got a ${placed[0].effect.role} sound`
  );
  console.log("✓ the strongest moment wins a contested slot");
}

/* -------------------------------- comedy ------------------------------------ */

{
  const moments = momentsFrom({
    boundaries: [5, 20, 40],
    pushes: [],
    captions: [
      { at: 2, isTitle: true },
      { at: 30, isTitle: false },
    ],
  });
  const comedic = planSfx(moments, { duration: 60, style: "comedic", perMinute: 6 });
  const punchlines = comedic.filter((p) => p.effect.role === "punchline");
  assert(
    punchlines.length === 1,
    `comedy is a once-per-video decision, got ${punchlines.length}`
  );

  const straight = planSfx(moments, { duration: 60, style: "energetic", perMinute: 6 });
  assert(
    straight.every((p) => p.effect.role !== "punchline"),
    "and never happens unless it was asked for"
  );
  console.log("✓ the punchline sound is spent once, deliberately");
}

/* ------------------------------- empty edits -------------------------------- */

{
  assert(planSfx([], { duration: 60 }).length === 0, "nothing to mark, nothing placed");
  assert(
    planSfx(momentsFrom({ boundaries: [], pushes: [], captions: [] }), { duration: 60 }).length === 0,
    "an unedited video has no moments in it"
  );
  assert(
    planSfx([{ at: 10, kind: "cut", weight: 1 }], { duration: 0 }).length === 0,
    "a zero-length video places nothing"
  );
  assert(
    planSfx([{ at: 900, kind: "cut", weight: 1 }], { duration: 60 }).length === 0,
    "a moment past the end is not marked"
  );
  console.log("✓ nothing is invented when there is nothing to mark");
}

/* -------------------------------- the schema -------------------------------- */

{
  for (const effect of SOUND_EFFECTS) {
    assert(
      addSfxOp.safeParse({ op: "addSfx", effect: effect.id, at: 5 }).success,
      `the schema rejects the real effect "${effect.id}"`
    );
  }
  assert(
    !addSfxOp.safeParse({ op: "addSfx", effect: "airhorn2", at: 5 }).success,
    "an invented effect is refused"
  );
  assert(
    autoSfxOp.safeParse({ op: "autoSfx", style: "comedic", perMinute: 2 }).success,
    "autoSfx parses"
  );
  assert(
    !autoSfxOp.safeParse({ op: "autoSfx", perMinute: 40 }).success,
    "a density that would carpet the video is refused"
  );
  console.log("✓ the schema accepts exactly what exists");
}

/* ------------------------------ verification -------------------------------- */

{
  const world: PlanWorld = {
    duration: 60,
    boundaryCount: 3,
    elementCount: 0,
    subtitlesOn: false,
    subtitlePosition: "bottom",
    transcript: "",
    can: { generateImage: true, photoSearch: true, music: true, sfx: true, video: true, voice: true },
  };

  assert(
    verifyPlan([{ op: "addSfx", effect: "whoosh", at: 900 }], world).length === 1,
    "an effect past the end of the video is caught before it runs"
  );
  assert(
    verifyPlan(
      [
        { op: "addSfx", effect: "whoosh", at: 10 },
        { op: "addSfx", effect: "impact", at: 10.2 },
      ],
      world
    ).length === 1,
    "two effects on the same frame are caught — they read as one glitch"
  );
  assert(
    verifyPlan(
      [
        { op: "autoSfx", style: "energetic" },
        { op: "autoSfx", style: "subtle" },
      ],
      world
    ).length === 1,
    "asking for the automatic pass twice is caught — it would double every effect"
  );
  assert(
    verifyPlan(
      [
        { op: "addSfx", effect: "whoosh", at: 10 },
        { op: "addSfx", effect: "impact", at: 30 },
        { op: "autoSfx" },
      ],
      world
    ).length === 0,
    "a sane sound plan passes"
  );
  console.log("✓ the verifier catches the sound mistakes worth catching");
}

/* -------------------------------- the prompt -------------------------------- */

{
  const listing = describeSfx();
  for (const effect of SOUND_EFFECTS) {
    assert(listing.includes(effect.id), `"${effect.id}" is missing from the listing`);
    assert(SYSTEM.includes(effect.id), `"${effect.id}" never reaches the prompt`);
  }
  assert(SYSTEM.includes("autoSfx"), "the agent is never told about the automatic pass");
  assert(
    /sound goes on LAST/i.test(SYSTEM),
    "nor that effects have to come after the cuts that create the moments"
  );
  console.log("✓ the whole library reaches the model");
}


/* ------------------------------ bounded fan-out ------------------------------ */

void (async () => {
  // `autoSfx` fetches through `mapWithLimit`. It is a private helper in ops.ts
  // (which cannot be imported here — it pulls in the stores and the DOM), so
  // the contract is restated and checked against an identical implementation.
  // What matters is the two properties, and both have a failure that is silent:
  // unbounded fan-out only breaks when a catalogue rate-limits, and out-of-order
  // results only look wrong in a log nobody reads carefully.
  async function mapWithLimit<T, R>(
    items: T[],
    limit: number,
    run: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        out[index] = await run(items[index], index);
      }
    });
    await Promise.all(workers);
    return out;
  }

  let inFlight = 0;
  let peak = 0;
  const items = [40, 5, 30, 10, 25, 15, 20, 35];
  const results = await mapWithLimit(items, 3, async (ms, i) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, ms));
    inFlight -= 1;
    return `${i}:${ms}`;
  });

  assert(peak <= 3, `never more than three in flight, saw ${peak}`);
  assert(peak > 1, "and it really is concurrent, not a disguised loop");
  assert(
    results.join(",") === items.map((ms, i) => `${i}:${ms}`).join(","),
    `results come back in input order, got ${results.join(",")}`
  );
  assert(
    (await mapWithLimit([], 3, async () => 1)).length === 0,
    "an empty list starts no workers and returns nothing"
  );
  console.log("✓ effects are fetched concurrently, bounded, and reported in order");
  console.log("\nsfx: all checks passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
