/**
 * The feedback loop, without the browser.
 *
 * Nothing in this app recorded prompt → output → outcome, which is the
 * expensive gap: the signal already existed and was thrown away several times a
 * session, because propose mode makes people tick plan steps on and off before
 * anything runs. Every tick is a labelled preference pair.
 *
 * The IndexedDB half needs a browser. The parts that decide whether any of it
 * is *useful* do not: how verdicts are counted, which past decisions come back
 * for a new instruction, and which standing preferences are safe to infer. That
 * last one matters most — an inferred rule that is wrong quietly steers every
 * future plan and nobody knows it is there.
 *
 * Run with `npx tsx tests/feedback-test.ts`.
 */

import { tally, toJsonl, type FeedbackEvent } from "../src/rescript/lib/feedback/store";
import {
  retrieveExemplars,
  similarity,
  standingPreferences,
} from "../src/rescript/lib/feedback/retrieve";
import type { AgentOp } from "../src/rescript/lib/overlay/ops-schema";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

let clock = 1_000;
function event(over: Partial<FeedbackEvent> = {}): FeedbackEvent {
  clock += 1_000;
  return {
    id: `e${clock}`,
    projectId: "p1",
    instruction: "cut the filler words",
    planSummary: "a tidy-up",
    stepTitle: "Remove fillers",
    stepDetail: "14 of them, 6 seconds",
    ops: [{ op: "removeFillers" }] as AgentOp[],
    verdict: "accepted",
    createdAt: clock,
    ...over,
  };
}

/* --------------------------------- counting -------------------------------- */

{
  const empty = tally([]);
  assert(empty.total === 0, "nothing in");
  assert(empty.acceptRate === null, "an accept rate over no decisions is not zero, it is unknown");

  const mixed = tally([
    event({ verdict: "accepted" }),
    event({ verdict: "accepted" }),
    event({ verdict: "declined" }),
    event({ verdict: "undone" }),
    event({ verdict: "failed" }),
  ]);
  assert(mixed.total === 5, "everything is counted");
  assert(mixed.accepted === 2 && mixed.declined === 1 && mixed.undone === 1, "by verdict");

  // A failure is not a judgement — something broke — so it must not drag the
  // accept rate down as though the person had disliked the plan.
  assert(
    mixed.acceptRate !== null && Math.abs(mixed.acceptRate - 2 / 4) < 1e-9,
    `failures must not count as opinions, got ${mixed.acceptRate}`
  );

  // An undo counts against. The person saw it and took it back, which is a
  // stronger no than declining it unseen.
  const undoneOnly = tally([event({ verdict: "accepted" }), event({ verdict: "undone" })]);
  assert(undoneOnly.acceptRate === 0.5, "an undo counts against the accept rate");
}

/* -------------------------------- similarity -------------------------------- */

{
  assert(similarity("cut the fillers", "cut the fillers") === 1, "identical is 1");
  assert(similarity("", "anything") === 0, "nothing is similar to nothing");

  // Content words carry it; the scaffolding of an instruction does not.
  const related = similarity(
    "cut the filler words please",
    "can you cut all the filler words"
  );
  const unrelated = similarity(
    "cut the filler words please",
    "add a lower third with my name"
  );
  assert(related > unrelated, `related must score higher: ${related} vs ${unrelated}`);
  assert(related > 0.5, `near-identical asks should score high, got ${related}`);

  // Symmetric: neither instruction is a query over the other, they are two
  // things a person said.
  const a = "make it vertical for tiktok";
  const b = "reframe this to 9:16";
  assert(Math.abs(similarity(a, b) - similarity(b, a)) < 1e-9, "similarity is symmetric");

  // A long instruction must not score highly against everything simply by
  // containing more words — which is what a raw overlap count would do.
  const rambling =
    "cut the fillers and the pauses and add captions and a title and music and " +
    "a lower third and some b-roll and make it vertical and grade it warm";
  assert(
    similarity(rambling, "add a lower third with my name") < 0.5,
    "length alone must not create similarity"
  );
}

/* -------------------------------- retrieval -------------------------------- */

async function retrievalTests() {
  const events = [
    event({ instruction: "cut the filler words", stepTitle: "Remove fillers", verdict: "accepted" }),
    event({ instruction: "cut all the filler words out", stepTitle: "Remove silences", verdict: "declined" }),
    event({ instruction: "make it vertical for shorts", stepTitle: "Reframe to 9:16", verdict: "accepted" }),
    event({ instruction: "grade it warm", stepTitle: "Warm film look", verdict: "accepted" }),
  ];

  const found = await retrieveExemplars("cut the filler words please", { events });
  assert(found.length > 0, "something relevant came back");
  assert(
    found.every((e) => e.instruction.includes("filler")),
    `only relevant examples: ${found.map((e) => e.instruction).join(" | ")}`
  );

  // Kept and rejected are ranked separately, so a run of accepted plans cannot
  // crowd out the one example of what to avoid — which is rarer and therefore
  // worth more than a fourth example of what to do.
  assert(found.some((e) => e.good), "a kept example");
  assert(found.some((e) => !e.good), "and a rejected one");

  // An unrelated instruction gets nothing rather than the nearest thing.
  const nothing = await retrieveExemplars("add background music", { events });
  assert(nothing.length === 0, `irrelevant history must not be offered: ${JSON.stringify(nothing)}`);

  // A failure is not taste. It says something broke, and teaching it as a bad
  // example would train the agent out of an operation that works.
  const broke = await retrieveExemplars("cut the filler words", {
    events: [event({ instruction: "cut the filler words", verdict: "failed" })],
  });
  assert(broke.length === 0, "a failed step is not an example either way");

  // The same lesson repeated across sessions is one lesson.
  const repeated = await retrieveExemplars("cut the fillers", {
    events: Array.from({ length: 8 }, () =>
      event({ instruction: "cut the fillers", stepTitle: "Remove fillers" })
    ),
  });
  assert(repeated.length === 1, `a repeated lesson is one example, got ${repeated.length}`);

  assert((await retrieveExemplars("anything", { events: [] })).length === 0, "no history, no examples");
  const bounded = await retrieveExemplars("cut the fillers", { events, good: 1, bad: 0 });
  assert(bounded.length <= 1, "the limits are honoured");
}

/* --------------------------- standing preferences --------------------------- */

{
  // One decision is not a preference. Two is not either. An inferred rule that
  // is wrong steers every future plan invisibly, so the bar is deliberately
  // higher than the evidence usually available.
  const thin = standingPreferences([
    event({ verdict: "declined", ops: [{ op: "subtitles", action: "on" }] as AgentOp[] }),
    event({ verdict: "declined", ops: [{ op: "subtitles", action: "on" }] as AgentOp[] }),
  ]);
  assert(thin.length === 0, `two decisions is a coincidence, got ${JSON.stringify(thin)}`);

  // Consistently turned down, enough times, is worth telling the agent about.
  const declinedSubs = standingPreferences(
    Array.from({ length: 5 }, () =>
      event({ verdict: "declined", ops: [{ op: "subtitles", action: "on" }] as AgentOp[] })
    )
  );
  assert(declinedSubs.length === 1, "a consistent rejection is a preference");
  assert(declinedSubs[0].note.includes("subtitles"), "and it names the operation");
  assert(declinedSubs[0].note.toLowerCase().includes("do not"), "and says what to do about it");

  // Split down the middle is not a preference in either direction.
  const split = standingPreferences([
    ...Array.from({ length: 4 }, () =>
      event({ verdict: "accepted", ops: [{ op: "removeFillers" }] as AgentOp[] })
    ),
    ...Array.from({ length: 4 }, () =>
      event({ verdict: "declined", ops: [{ op: "removeFillers" }] as AgentOp[] })
    ),
  ]);
  assert(split.length === 0, `an even split is not a preference, got ${JSON.stringify(split)}`);

  // A step using an operation twice is one decision about it, not two.
  const doubled = standingPreferences(
    Array.from({ length: 3 }, () =>
      event({
        verdict: "declined",
        ops: [
          { op: "subtitles", action: "on" },
          { op: "subtitles", action: "style", uppercase: true },
        ] as AgentOp[],
      })
    )
  );
  assert(
    doubled.length === 0 || doubled[0].support === 3,
    `support counts decisions, not operations: ${JSON.stringify(doubled)}`
  );

  // Bounded, so the prompt cannot fill up with inferences.
  const many = standingPreferences(
    ["subtitles", "removeFillers", "addText", "addImage", "setGrade", "setFrame"].flatMap(
      (op) =>
        Array.from({ length: 5 }, () =>
          event({ verdict: "declined", ops: [{ op }] as unknown as AgentOp[] })
        )
    )
  );
  assert(many.length <= 4, `at most four standing notes, got ${many.length}`);
}

/* --------------------------------- exporting -------------------------------- */

{
  // Not used by anything today — the model is a hosted API. It exists so the
  // option to tune stays open without being committed to.
  const lines = toJsonl([
    event({ verdict: "accepted" }),
    event({ verdict: "declined" }),
  ]).split("\n");
  assert(lines.length === 2, "one object per line");

  const first = JSON.parse(lines[0]);
  assert(first.label === "chosen", "an acceptance is chosen");
  assert(JSON.parse(lines[1]).label === "rejected", "anything else is rejected");
  assert(typeof first.instruction === "string" && first.step.ops, "the shape a trainer reads");
  assert(!("projectId" in first), "and it carries no identifiers it does not need");

  assert(toJsonl([]) === "", "nothing in, nothing out");
}

retrievalTests().then(
  () => console.log("ALL FEEDBACK TESTS PASSED"),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
