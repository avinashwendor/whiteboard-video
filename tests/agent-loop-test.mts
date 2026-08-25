/**
 * The agent loop's job is to converge.
 *
 * It talks to a model that misbehaves in specific, repeatable ways — repeats a
 * question, keeps reaching for a tool after the budget is gone, answers in the
 * wrong shape — and the loop has to end anyway, with a plan where one is
 * possible and a bounded number of calls where it is not.
 *
 * Driven by a stand-in model rather than a provider: a loop is exactly the
 * thing you cannot check by calling a real one and hoping it misbehaves.
 *
 * Run with `npx tsx tests/agent-loop-test.mts`.
 */

import {
  planRescriptEdit,
  type RescriptAgentContext,
} from "../src/lib/ai/rescript-agent.js";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const context: RescriptAgentContext = {
  duration: 120,
  playhead: 0,
  boundaries: [],
  elements: [],
  subtitles: { enabled: false, cueCount: 0, position: "bottom" },
  transitions: [],
  transcript: "[0:04] We shipped it three times faster than last year.",
  analysis: {
    wordCount: 200, wordsPerMinute: 140, speakerCount: 1,
    fillerCount: 5, fillerSeconds: 1.2, silenceCount: 3, silenceSeconds: 2.4,
    longestPauses: [], clipCount: 1, runsLong: false,
  },
  aspect: 16 / 9,
  can: { generateImage: true, photoSearch: true },
};

const SAME_LOOK = JSON.stringify({
  thinking: "let me read that again",
  tool: "read_transcript",
  args: { from: 0, to: 30 },
});

const PLAN = JSON.stringify({
  thinking: "done",
  summary: "Cut the fillers.",
  ops: [{ op: "removeFillers" }],
});

/** Count the calls, so "it terminated" can be told from "it spun for a while". */
function model(replies: (n: number) => string) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    generate: async () => replies(calls++),
  };
}

/* ------------------- a model that only ever repeats itself ------------------ */

{
  const stub = model(() => SAME_LOOK);
  let threw: { message: string; userMessage?: string } | null = null;
  try {
    await planRescriptEdit({
      instruction: "make it a short",
      context,
      generate: stub.generate,
    });
  } catch (err) {
    threw = err as { message: string; userMessage?: string };
  }

  assert(threw !== null, "a model that never answers must eventually give up");
  // The bug this guards: the repeat was answered from cache and cost nothing,
  // so the loop ran to the turn limit every time. It must give up quickly now.
  assert(
    stub.calls <= 8,
    `a repeating model should be cut off quickly, took ${stub.calls} calls`
  );
  // The person sees `userMessage`; the log sees `message`. Both should name the
  // real failure rather than blaming how the request was worded.
  assert(
    /kept looking at the footage/.test(threw.userMessage ?? ""),
    `the user-facing message should say what happened, got: ${threw.userMessage}`
  );
  assert(
    /kept asking to look/.test(threw.message),
    `the log detail should say what happened, got: ${threw.message}`
  );
}

/* --------------- a model that repeats, then pulls itself together ----------- */

{
  // Three repeats — enough to close the tools — and then a plan. The loop has
  // to still deliver it rather than having already burned its turns.
  const stub = model((n) => (n < 4 ? SAME_LOOK : PLAN));
  const plan = await planRescriptEdit({
    instruction: "cut the fillers",
    context,
    generate: stub.generate,
  });
  assert(
    plan.ops.length === 1 && plan.ops[0].op === "removeFillers",
    `the plan should survive the repeats, got ${JSON.stringify(plan.ops)}`
  );
  assert(plan.summary === "Cut the fillers.", "the summary should come through");
}

/* ------------------- a model that burns its whole look budget --------------- */

{
  // Six distinct looks is the budget; the seventh is refused, and after the
  // wasted ones the tools close. A plan after that must still land.
  const stub = model((n) => {
    if (n < 9) {
      return JSON.stringify({
        thinking: "looking",
        tool: "read_transcript",
        args: { from: n, to: n + 10 },
      });
    }
    return PLAN;
  });
  const plan = await planRescriptEdit({
    instruction: "cut the fillers",
    context,
    generate: stub.generate,
  });
  assert(
    plan.ops.length === 1,
    `a plan after the budget runs out should still land, got ${JSON.stringify(plan.ops)}`
  );
  assert(
    plan.trace.length === 6,
    `only the six answered looks belong in the trace, got ${plan.trace.length}`
  );
}

/* --------------------- an empty plan has to be argued for ------------------- */

{
  // The failure seen live: "edit this end to end" on a 45-minute recording came
  // back with no steps and a blank summary, and that was reported as success.
  const stub = model(() =>
    JSON.stringify({ thinking: "hmm", summary: "", ops: [] })
  );
  let threw: { userMessage?: string } | null = null;
  try {
    await planRescriptEdit({
      instruction: "edit this for me end to end",
      context,
      generate: stub.generate,
    });
  } catch (err) {
    threw = err as { userMessage?: string };
  }
  assert(threw !== null, "an unexplained empty plan must not pass as an answer");
  assert(
    stub.calls <= 5,
    `it should give up quickly, took ${stub.calls} calls`
  );

  // But a model that says why is believed, and "nothing to do" survives.
  const explained = model((n) =>
    n === 0
      ? JSON.stringify({ thinking: "hmm", summary: "", ops: [] })
      : JSON.stringify({
          thinking: "checked",
          summary: "The cut is already tight and there is nothing worth adding.",
          ops: [],
        })
  );
  const plan = await planRescriptEdit({
    instruction: "tidy this up",
    context,
    generate: explained.generate,
  });
  assert(
    plan.ops.length === 0 && /already tight/.test(plan.summary),
    `a justified "nothing to do" should come through, got ${JSON.stringify(plan.summary)}`
  );
}

/* ------------------- a model that only ever reasons ------------------------- */

{
  // Seen live: 15,799 characters of `thinking` and no plan, because reasoning
  // and the plan share one output budget. It parses — every plan field has a
  // default — so it used to read as a considered "nothing to do".
  const stub = model(() =>
    JSON.stringify({ thinking: "let me think about this at enormous length" })
  );
  let threw = false;
  try {
    await planRescriptEdit({
      instruction: "edit this end to end",
      context,
      generate: stub.generate,
    });
  } catch {
    threw = true;
  }
  assert(threw, "a reply that is only reasoning must not pass as an answer");
  assert(stub.calls <= 6, `it should give up quickly, took ${stub.calls} calls`);

  // And it recovers when the model pulls itself together.
  const recovers = model((n) =>
    n < 2
      ? JSON.stringify({ thinking: "thinking out loud" })
      : JSON.stringify({
          thinking: "brief",
          summary: "Cut the fillers.",
          ops: [{ op: "removeFillers" }],
        })
  );
  const plan = await planRescriptEdit({
    instruction: "cut the fillers",
    context,
    generate: recovers.generate,
  });
  assert(
    plan.ops.length === 1,
    `the plan should land once it stops rambling, got ${JSON.stringify(plan.ops)}`
  );
}

/* ------------------------- a model that answers at once --------------------- */

{
  const stub = model(() => PLAN);
  const plan = await planRescriptEdit({
    instruction: "cut the fillers",
    context,
    generate: stub.generate,
  });
  assert(stub.calls === 1, `a clean answer should take one call, took ${stub.calls}`);
  assert(plan.ops.length === 1, "the plan should come straight through");
}

/* ------------------- a plan that runs but breaks the style ------------------ */

{
  // Two accent colours. Nothing here is *wrong* in the sense `verifyPlan`
  // means — every operation would execute — so before the craft rules the
  // agent had no reason not to hand this over. It is the exact failure a
  // bigger toy box produces: valid, and worse than what a person would make.
  const clashing = JSON.stringify({
    thinking: "adding some colour",
    summary: "Two captions.",
    findings: ["The delivery is clean already."],
    steps: [
      {
        title: "Caption the first claim",
        detail: "on the beat",
        ops: [{ op: "addText", text: "three times faster", color: "#ffd60a", start: 4, duration: 2 }],
      },
      {
        title: "Caption the second",
        detail: "later",
        ops: [{ op: "addText", text: "and cheaper", color: "#4ade80", start: 20, duration: 2 }],
      },
    ],
  });

  const fixed = JSON.stringify({
    thinking: "one accent",
    summary: "Two captions.",
    findings: ["The delivery is clean already."],
    steps: [
      {
        title: "Caption the first claim",
        detail: "on the beat",
        ops: [{ op: "addText", text: "three times faster", color: "#ffd60a", start: 4, duration: 2 }],
      },
      {
        title: "Caption the second",
        detail: "later",
        ops: [{ op: "addText", text: "and cheaper", color: "#ffd60a", start: 20, duration: 2 }],
      },
    ],
  });

  const repairs: string[][] = [];
  const stub = model((n) => (n === 0 ? clashing : fixed));
  const plan = await planRescriptEdit({
    instruction: "caption the two claims",
    context,
    mode: "propose",
    generate: stub.generate,
    onEvent: (event) => {
      if (event.type === "repair") repairs.push(event.problems);
    },
  });

  assert(stub.calls === 2, `a style fault should cost one repair round, took ${stub.calls}`);
  assert(repairs.length === 1, "and should announce it");
  assert(
    repairs[0].some((p) => p.toLowerCase().includes("accent")),
    `the repair should name the fault: ${JSON.stringify(repairs[0])}`
  );
  assert(plan.warnings.length === 0, "and nothing should be left over once it is fixed");
  assert(plan.steps?.length === 2, "both steps survive the repair");
}

{
  // The other half of the same rule: a *warning* must not cost a round. A
  // smell is sometimes deliberate, and making the model defend a choice it was
  // entitled to make is worse than letting it through.
  const smelly = JSON.stringify({
    thinking: "zooms",
    summary: "Punch in on the claims.",
    findings: [],
    steps: [
      {
        title: "Punch in",
        detail: "on the beats",
        ops: [
          { op: "autoPunchIns" },
          { op: "setCamera", start: 4, end: 7, camera: "punchIn" },
        ],
      },
    ],
  });

  const stub = model(() => smelly);
  const plan = await planRescriptEdit({
    instruction: "punch in on the claims",
    context,
    mode: "propose",
    generate: stub.generate,
  });

  assert(stub.calls === 1, `a warning must not trigger a repair, took ${stub.calls}`);
  assert(plan.steps?.length === 1, "and the plan comes through");
}

/* ------------------------------- reviewing --------------------------------- */

{
  // A review answers in the propose shape, so a fix goes back through the same
  // accept-or-decline surface as anything else. A review that could quietly
  // change the video would be worse than no review at all.
  const clean = JSON.stringify({
    thinking: "the caption sits clear of the subtitles and reads fine",
    summary: "This is ready.",
    findings: [],
    steps: [],
  });

  const stub = model(() => clean);
  const plan = await planRescriptEdit({
    instruction: "watch this back",
    context,
    mode: "review",
    generate: stub.generate,
  });

  // "It is fine" has to be a real answer. A reviewer that must find something
  // will invent something, and then stops being worth asking.
  assert(stub.calls === 1, `a clean review is one call, took ${stub.calls}`);
  assert(plan.summary.length > 0, "it still says something");
  assert((plan.steps?.length ?? 0) === 0, "and proposes nothing");
  assert(plan.warnings.length === 0, "with nothing left over");
}

{
  // A review that finds something proposes a fix as ordinary steps — and the
  // fix goes through `verifyPlan` like any other, so a review cannot smuggle in
  // an operation a normal plan would have been refused.
  const fault = JSON.stringify({
    thinking: "the captions are unreadable over that background",
    summary: "The subtitles are hard to read over the busy lower third.",
    findings: ["From 4s the captions sit on a bright background with no scrim."],
    steps: [
      {
        title: "Put a slab behind the captions",
        detail: "so they read over the background",
        ops: [{ op: "subtitles", action: "style", background: "rgba(0,0,0,0.6)" }],
      },
    ],
  });

  const stub = model(() => fault);
  const plan = await planRescriptEdit({
    instruction: "watch this back",
    context,
    mode: "review",
    generate: stub.generate,
  });

  assert(plan.steps?.length === 1, "a fix comes back as a step");
  assert(plan.findings.length === 1, "and says what it saw");
  assert(stub.calls === 1, `no repair round needed for a clean fix, took ${stub.calls}`);
}

console.log("ALL AGENT LOOP TESTS PASSED");
