/**
 * What fits, and what gets left out when it does not.
 *
 * The agent loop had no idea how big its own conversation was. Input was
 * budgeted in characters on the way in, and once the loop started the message
 * array was append-only for up to sixteen turns — so the failure mode was a
 * provider 400 that read as "that request wasn't valid", killed the plan on the
 * first occurrence, and was indistinguishable from a typo.
 *
 * The packer is a pure function, so the interesting parts are cheap to pin
 * down: that it costs nothing when nothing is over budget, that it gives up the
 * least useful things first, and that it never sacrifices the system prompt or
 * the thing it was just asked.
 *
 * Run with `npx tsx tests/budget-test.ts`.
 */

import {
  conversationTokens,
  contextLimitFor,
  estimateTokens,
  inputBudget,
  messageTokens,
  packMessages,
} from "../src/lib/ai/budget";
import { looksLikeContextOverflow } from "../src/lib/utils/errors";
import type { ChatMessage } from "../src/lib/ai/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const say = (role: ChatMessage["role"], text: string): ChatMessage => ({
  role,
  content: text,
});

/* -------------------------------- estimating ------------------------------- */

{
  assert(estimateTokens("") === 0, "nothing costs nothing");
  assert(estimateTokens("hello world") > 0, "text costs something");

  // The estimate must run *over* the true count, never under: spending context
  // we could have used is a cost, and a 400 is a failure.
  const prose = "the quick brown fox jumps over the lazy dog. ".repeat(40);
  const realistic = prose.length / 4; // the usual prose rule of thumb
  assert(
    estimateTokens(prose) >= realistic,
    "the estimate must not undercount prose"
  );

  // A picture is charged for even though its length says nothing useful.
  const withImage: ChatMessage = {
    role: "user",
    content: [
      { type: "text", text: "look at this" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ],
  };
  assert(
    messageTokens(withImage) > 500,
    "an image must not be costed by its URL length"
  );
}

{
  assert(contextLimitFor("claude-opus-4-8") === 200_000, "known model");
  assert(contextLimitFor("something-new") === 128_000, "unknown model falls back");
  assert(contextLimitFor(undefined) === 128_000, "no model falls back");

  // The answer has to fit in the same window as the question.
  const budget = inputBudget("claude-opus-4-8", 12_000);
  assert(budget < 200_000 - 12_000, "the budget reserves room for the reply");
  assert(budget > 100_000, `the budget should still be generous, got ${budget}`);
  assert(
    inputBudget("claude-opus-4-8", 400_000) >= 1_000,
    "an absurd reservation must not produce a negative budget"
  );
}

/* --------------------------------- packing --------------------------------- */

const pinned = [say("system", "You are the editor of a video."), say("user", "THE BRIEF")];

{
  // Under budget: nothing is touched, and it says so.
  const body = [say("user", "make it vertical"), say("assistant", "done")];
  const packed = packMessages({ pinned, body, budget: 100_000 });

  assert(packed.dropped === 0 && packed.digested === 0, "nothing to give up");
  assert(packed.messages.length === 4, "everything survives");
  assert(packed.messages[0] === pinned[0], "the same objects come back");
  assert(!packed.overflowed, "not overflowed");
  assert(
    packed.tokens === conversationTokens([...pinned, ...body]),
    "the reported size is the real size"
  );
}

{
  // Over budget: the oldest go first, the newest are untouched, and the system
  // prompt and brief survive whatever happens.
  const body: ChatMessage[] = [];
  for (let i = 0; i < 30; i += 1) {
    body.push(say("user", `question ${i} ${"x".repeat(2_000)}`));
    body.push(say("assistant", `answer ${i} ${"y".repeat(2_000)}`));
  }
  const budget = 4_000;
  const packed = packMessages({ pinned, body, budget, keepRecent: 4 });

  assert(packed.tokens <= budget, `must fit the budget, got ${packed.tokens}`);
  assert(packed.dropped > 0, "something had to go");
  assert(packed.messages[0] === pinned[0], "the system prompt is never dropped");
  assert(packed.messages[1] === pinned[1], "the brief is never dropped");

  // The last four are what the next reply is actually about.
  const tail = packed.messages.slice(-4);
  assert(
    tail.every((m, i) => m === body[body.length - 4 + i]),
    "the most recent exchange must survive verbatim"
  );

  // The two counts describe disjoint sets, so they cannot exceed the input.
  assert(
    packed.dropped + packed.digested <= body.length,
    `dropped (${packed.dropped}) + digested (${packed.digested}) must not exceed ${body.length}`
  );
}

{
  // Shortening alone is enough: nothing needs to be dropped, and the newest
  // messages are still verbatim.
  const body = [
    say("user", "a".repeat(20_000)),
    say("assistant", "b".repeat(20_000)),
    say("user", "and now make it vertical"),
  ];
  const packed = packMessages({ pinned, body, budget: 6_000, keepRecent: 1 });

  assert(packed.digested === 2, `two shortened, got ${packed.digested}`);
  assert(packed.dropped === 0, "nothing needed dropping");
  assert(
    packed.messages[packed.messages.length - 1].content === "and now make it vertical",
    "the newest message is untouched"
  );
  assert(
    String(packed.messages[2].content).includes("trimmed to fit"),
    "a shortened message says it was shortened"
  );
}

{
  // The pinned half alone does not fit. Nothing the packer does can help, and
  // pretending otherwise would send a request that is rejected anyway.
  const huge = [say("system", "s".repeat(400_000)), say("user", "brief")];
  const packed = packMessages({ pinned: huge, body: [say("user", "hi")], budget: 1_000 });

  assert(packed.overflowed, "it must admit it could not fit");
  assert(packed.messages.length === 2, "only the pinned messages come back");
}

{
  // An empty conversation is a normal case, not an edge case: the first turn
  // has a system prompt, a brief, and nothing else.
  const packed = packMessages({ pinned, body: [], budget: 100 });
  assert(packed.messages.length === 2, "pinned only");
  assert(packed.dropped === 0 && packed.digested === 0, "nothing to give up");
}

/* ------------------------------- diagnosing -------------------------------- */

{
  // Both of these arrive as a 400 and only the body tells them apart.
  const overflow = [
    "This model's maximum context length is 128000 tokens",
    '{"error":{"code":"context_length_exceeded"}}',
    "prompt is too long: 210000 tokens > 200000 maximum",
    "Requested 300000 tokens, which exceeds the context window",
  ];
  for (const body of overflow) {
    assert(looksLikeContextOverflow(body), `should read as overflow: ${body}`);
  }

  const notOverflow = [
    '{"error":{"message":"Invalid value for temperature"}}',
    "unknown field: stream_options",
    "invalid model id",
    "",
    undefined,
  ];
  for (const body of notOverflow) {
    assert(
      !looksLikeContextOverflow(body),
      `should not read as overflow: ${String(body)}`
    );
  }
}

console.log("ALL BUDGET TESTS PASSED");
