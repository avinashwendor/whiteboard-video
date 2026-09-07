/**
 * The `/` menu in the transcript.
 *
 * Two things are worth checking and neither is visible in the UI.
 *
 * The first is that every command produces operations the executor will
 * actually accept. The menu and the AI agent write into the same op schema, so
 * a command that emits a field that does not exist fails at the point somebody
 * clicks it — silently, since a rejected op reports as a failed step rather
 * than as a bug. Parsing every command's output against the real schema is the
 * only way that stays true as the schema moves.
 *
 * The second is the clock. The caret sits at a moment in the *source* media;
 * every overlay is placed on the *finished* video's clock, and the two diverge
 * the moment anything is cut. Everything a command emits has to land inside the
 * finished video.
 *
 * Run with `npx tsx tests/slash-test.ts`.
 */

import {
  SLASH_COMMANDS,
  hintFor,
  scoreCommand,
  sentenceAround,
  slashCommandsFor,
  type SlashContext,
} from "../src/rescript/lib/slash";
import { agentOpSchema } from "../src/rescript/lib/overlay/ops-schema";
import type { Word } from "../src/rescript/lib/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const word = (id: number, text: string, start: number, end: number): Word => ({
  id,
  text,
  start,
  end,
  speaker: 0,
  deleted: false,
});

function context(patch: Partial<SlashContext> = {}): SlashContext {
  return {
    at: 12,
    outAt: 10,
    outDuration: 60,
    sentence: {
      ids: [1, 2, 3],
      text: "So we shipped it on a Friday.",
      from: 9,
      to: 12.5,
    },
    pause: { from: 12.5, to: 13.1, seconds: 0.6 },
    canSplit: true,
    can: { image: true, video: true, sfx: true, music: true },
    ...patch,
  };
}

/* ------------------------- every op the menu can emit ------------------------ */

{
  const ctx = context();
  // A value that is plausible for whichever kind of argument each takes.
  const argFor = (id: string) => {
    const command = SLASH_COMMANDS.find((c) => c.id === id)!;
    if (!command.arg || command.arg.kind === "none") return "";
    if (command.arg.kind === "pick") return command.arg.options[0].id;
    return "Shipped on a Friday";
  };

  let checked = 0;
  for (const command of SLASH_COMMANDS) {
    const result = command.run(ctx, argFor(command.id));
    if (result.kind === "ask") {
      assert(result.prompt.length > 0, `${command.id} asked for nothing`);
      continue;
    }
    assert(result.ops.length > 0, `${command.id} produced no operations`);
    for (const op of result.ops) {
      const parsed = agentOpSchema.safeParse(op);
      assert(
        parsed.success,
        `${command.id} emits an operation the executor would refuse: ${
          parsed.success ? "" : JSON.stringify(parsed.error.issues[0])
        }`
      );
      checked += 1;
    }
  }
  assert(checked > 15, `only ${checked} operations checked — commands went missing`);
  console.log(`✓ all ${checked} operations the menu can emit parse against the real schema`);
}

/* ------------------------------ inside the video ----------------------------- */

{
  // A caret near the end of a short video: nothing may be placed past the end,
  // and nothing may start before the beginning.
  const ctx = context({ outAt: 9.8, outDuration: 10, sentence: null, pause: null });
  for (const command of slashCommandsFor(ctx)) {
    const result = command.run(ctx, command.arg?.kind === "pick" ? command.arg.options[0].id : "x");
    if (result.kind !== "ops") continue;
    for (const op of result.ops) {
      const row = op as unknown as Record<string, number | undefined>;
      for (const field of ["start", "end", "at", "from", "to"]) {
        const value = row[field];
        if (typeof value !== "number") continue;
        assert(
          value >= 0 && value <= ctx.outDuration + 1e-6,
          `${command.id} placed ${field} at ${value}, outside a ${ctx.outDuration}s video`
        );
      }
      if (typeof row.start === "number" && typeof row.end === "number") {
        assert(row.end > row.start, `${command.id} has an element that ends before it starts`);
      }
    }
  }
  console.log("✓ nothing is placed outside the finished video");
}

/* -------------------------------- what applies ------------------------------- */

{
  const ids = (c: SlashContext) => slashCommandsFor(c).map((x) => x.id);

  assert(!ids(context({ pause: null })).includes("remove-pause"), "offered to remove a pause that is not there");
  assert(ids(context()).includes("remove-pause"), "did not offer to remove the pause that is there");

  assert(!ids(context({ canSplit: false })).includes("split"), "offered a split where one is refused");
  assert(!ids(context({ sentence: null })).includes("cut-sentence"), "offered to cut a sentence it cannot see");

  const bare = context({ can: { image: false, video: false, sfx: false, music: false } });
  for (const id of ["picture", "broll", "sfx", "music"]) {
    assert(!ids(bare).includes(id), `offered "${id}" with nothing configured to do it`);
  }
  // ...but the things that need no server at all are still there.
  for (const id of ["split", "cut-sentence", "title", "highlight", "punch-in", "ask"]) {
    assert(ids(bare).includes(id), `"${id}" needs no key and should always be offered`);
  }

  // At the very start there is nothing in front of the caret to trim.
  assert(
    !ids(context({ outAt: 0 })).includes("cut-before"),
    "offered to cut everything before the beginning"
  );
  console.log("✓ a command is only offered where it would do something");
}

/* --------------------------------- searching --------------------------------- */

{
  const ctx = context();
  const find = (q: string) => slashCommandsFor(ctx, q).map((c) => c.id);

  assert(find("cut")[0] === "cut-sentence" || find("cut").includes("cut-sentence"), "cut finds the cuts");
  assert(find("whoosh").includes("sfx"), "an effect name finds the sound command");
  assert(find("zoom").includes("punch-in"), "zoom finds the camera move");
  assert(find("cc").includes("subtitles"), "cc finds subtitles");
  assert(find("arrow").includes("highlight"), "arrow finds the annotation");
  assert(find("qqqq").length === 0, "nonsense matches nothing");

  // Typing the start of a title has to beat a keyword match elsewhere, or the
  // thing you are looking at is never the thing Enter runs.
  assert(
    scoreCommand(SLASH_COMMANDS.find((c) => c.id === "split")!, "split") >
      scoreCommand(SLASH_COMMANDS.find((c) => c.id === "highlight")!, "split"),
    "a title match must outrank a keyword match"
  );

  // With nothing typed the order is the declared one, so the menu can be learnt.
  const order = slashCommandsFor(ctx).map((c) => c.id);
  const declared = SLASH_COMMANDS.filter((c) => !c.when || c.when(ctx)).map((c) => c.id);
  assert(order.join() === declared.join(), "the resting order is not the declared order");
  console.log("✓ search finds commands by what they are called and what they do");
}

/* ------------------------------- the sentence -------------------------------- */

{
  const words = [
    word(1, "So", 0, 0.3),
    word(2, "we", 0.3, 0.5),
    word(3, "shipped.", 0.5, 1.0),
    word(4, "It", 1.2, 1.4),
    word(5, "took", 1.4, 1.7),
    word(6, "ages!", 1.7, 2.2),
    word(7, "Really", 2.4, 2.8),
  ];

  const middle = sentenceAround(words, 4).map((w) => w.id);
  assert(middle.join() === "4,5,6", `expected the middle sentence, got ${middle}`);

  const first = sentenceAround(words, 1).map((w) => w.id);
  assert(first.join() === "1,2,3", `expected the first sentence, got ${first}`);

  // The last sentence has no full stop; it runs to the end rather than nowhere.
  const last = sentenceAround(words, 6).map((w) => w.id);
  assert(last.join() === "7", `expected the trailing run, got ${last}`);

  // Unpunctuated speech — which is what Telugu and Hindi come back as — must
  // not select the entire transcript.
  const flat = Array.from({ length: 200 }, (_, i) => word(i + 1, `w${i}`, i, i + 0.5));
  assert(
    sentenceAround(flat, 100).length <= 81,
    "an unpunctuated transcript selected more than a sentence's worth of words"
  );
  assert(sentenceAround(words, -1).length === 0, "an index off the end selects nothing");
  console.log("✓ the sentence under the caret is the sentence, punctuated or not");
}

/* ---------------------------------- the copy ---------------------------------- */

{
  const ctx = context();
  for (const command of SLASH_COMMANDS) {
    const hint = hintFor(command, ctx);
    assert(hint.length > 0, `${command.id} has no hint`);
    assert(hint.length < 120, `${command.id}'s hint is a paragraph`);
    assert(command.title.length < 32, `${command.id}'s title is too long to scan`);
  }
  const seen = new Set(SLASH_COMMANDS.map((c) => c.id));
  assert(seen.size === SLASH_COMMANDS.length, "two commands share an id");
  console.log("✓ every command says what it will do, in one line");
}

console.log("\nslash menu: all checks passed");
