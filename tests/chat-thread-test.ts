/**
 * The conversation that has to survive a refresh.
 *
 * The AI panel's turns used to live in a `useRef` and its log in `useState`, so
 * a reload brought the cut, the captions and the overlays back and left the
 * conversation about them behind. Now it is a third store written into the same
 * project record — which means it has the same failure mode the overlay store
 * had for two years: state that is project-scoped but only cleared in one of
 * the places a project changes.
 *
 * These are the parts of that worth pinning down without a browser: the reducer
 * behaviour of the store, and the tolerance of `parseThread`, which is what
 * stands between an older or newer save and a crash on open.
 *
 * Run with `npx tsx tests/chat-thread-test.ts`.
 */

import {
  parseThread,
  useChatStore,
  type ChatThread,
} from "../src/rescript/lib/chat/store";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/* ------------------------------- parseThread ------------------------------- */

{
  // A project saved before the chat existed. This is the common case on first
  // run after the upgrade, and it must not throw.
  const empty = parseThread(undefined);
  assert(empty.turns.length === 0, "undefined should parse to no turns");
  assert(empty.log.length === 0, "undefined should parse to no log");
  assert(empty.proposal === null, "undefined should parse to no proposal");

  assert(parseThread(null).turns.length === 0, "null should parse to empty");
  assert(parseThread("nonsense").turns.length === 0, "a string should parse to empty");
  assert(parseThread(42).turns.length === 0, "a number should parse to empty");
}

{
  // Half-written rows are dropped rather than carried through to the model,
  // where a turn with no instruction would read as an empty user message.
  const thread = parseThread({
    turns: [
      { instruction: "make it vertical", summary: "reframed to 9:16" },
      { instruction: "no summary here" },
      { summary: "no instruction here" },
      null,
    ],
    log: [
      { id: 1, kind: "you", text: "make it vertical" },
      { id: 2, kind: "ok", text: "" },
      { id: 3, text: "no kind" },
    ],
  });

  assert(thread.turns.length === 1, `one complete turn, got ${thread.turns.length}`);
  assert(thread.turns[0].instruction === "make it vertical", "the complete turn survives");
  assert(thread.log.length === 2, `two well-formed log lines, got ${thread.log.length}`);
}

{
  // A proposal round-trips, and `declined` is an array on the way out even if a
  // save somehow wrote something else there.
  const thread = parseThread({
    turns: [],
    log: [],
    proposal: {
      summary: "Three changes",
      steps: [{ title: "Trim the intro", detail: "0:00–0:04 is dead air", ops: [] }],
      declined: [0],
    },
  });
  assert(thread.proposal !== null, "a well-formed proposal survives");
  assert(thread.proposal?.declined[0] === 0, "declined indices survive");

  const noDeclined = parseThread({
    proposal: { summary: "s", steps: [], declined: "not an array" },
  });
  assert(
    Array.isArray(noDeclined.proposal?.declined),
    "declined must always come back as an array"
  );

  const badProposal = parseThread({ proposal: { summary: "s" } });
  assert(badProposal.proposal === null, "a proposal with no steps is not a proposal");
}

{
  // Caps are enforced on the way in, so a record written by a build with a
  // bigger cap cannot bloat this one.
  const many = Array.from({ length: 400 }, (_, i) => ({
    id: i,
    kind: "note" as const,
    text: `line ${i}`,
  }));
  const thread = parseThread({ turns: [], log: many, proposal: null });
  assert(thread.log.length <= 60, `log should be capped, got ${thread.log.length}`);
  // The cap keeps the *end* of the conversation, which is the part still being
  // referred to. Dropping the tail instead would be worse than dropping nothing.
  assert(
    thread.log[thread.log.length - 1].text === "line 399",
    "the cap must keep the newest lines"
  );
}

/* --------------------------------- the store -------------------------------- */

{
  const store = useChatStore.getState();
  store.reset();

  store.append("you", "make it vertical");
  store.append("summary", "reframed to 9:16");
  const log = useChatStore.getState().log;
  assert(log.length === 2, `two lines appended, got ${log.length}`);
  assert(log[0].id !== log[1].id, "log ids must be unique — they are React keys");

  store.pushTurn({ instruction: "make it vertical", summary: "reframed" });
  store.setLastOutcome("1 of 1 operations landed");
  const turns = useChatStore.getState().turns;
  assert(turns.length === 1, "one turn");
  assert(
    turns[0].outcome === "1 of 1 operations landed",
    "the outcome attaches to the turn that earned it"
  );

  // An outcome with nothing to attach to is a no-op, not a crash: a repair
  // round can report before any turn has been recorded.
  store.reset();
  useChatStore.getState().setLastOutcome("orphan");
  assert(useChatStore.getState().turns.length === 0, "an orphan outcome adds no turn");
}

{
  // reset() must cancel whatever is in flight. This is the property that lets
  // the editor store call it when media changes: a plan for the previous video
  // must never land on the next one.
  let aborted = false;
  const store = useChatStore.getState();
  store.setAbort(() => {
    aborted = true;
  });
  store.append("you", "something");
  useChatStore.getState().reset();

  assert(aborted, "reset must abort work in flight");
  assert(useChatStore.getState().log.length === 0, "reset clears the log");
  assert(useChatStore.getState().abort === null, "reset drops the stale abort");
}

{
  // Restoring picks the id counter back up. Two log lines sharing an id makes
  // React drop one of them from the list without saying so.
  const stored: ChatThread = {
    turns: [],
    log: [
      { id: 7, kind: "you", text: "earlier" },
      { id: 8, kind: "ok", text: "done" },
    ],
    proposal: null,
  };
  useChatStore.getState().reset();
  useChatStore.getState().hydrate(stored);
  useChatStore.getState().append("note", "after the refresh");

  const log = useChatStore.getState().log;
  const ids = new Set(log.map((l) => l.id));
  assert(ids.size === log.length, "ids must stay unique across a restore");
  assert(log[log.length - 1].id === 9, `expected id 9 after 8, got ${log[log.length - 1].id}`);
}

{
  // snapshot() is what autosave writes, so it must carry the conversation and
  // nothing transient: an abort callback cannot be structured-cloned into
  // IndexedDB, and a write that throws would take the whole project save with it.
  useChatStore.getState().reset();
  useChatStore.getState().setAbort(() => {});
  useChatStore.getState().append("you", "hello");
  const snapshot = useChatStore.getState().snapshot() as unknown as Record<
    string,
    unknown
  >;

  assert(!("abort" in snapshot), "the snapshot must not carry the abort callback");
  assert(!("sequence" in snapshot), "the snapshot must not carry the id counter");
  assert(Object.keys(snapshot).sort().join(",") === "log,proposal,turns", "snapshot shape");
  assert(
    JSON.parse(JSON.stringify(snapshot)).log.length === 1,
    "the snapshot must survive serialisation"
  );
}

console.log("ALL CHAT THREAD TESTS PASSED");
