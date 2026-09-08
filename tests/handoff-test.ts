/**
 * A generated video, handed to the editor that cuts.
 *
 * The two halves of this app have been separate programs sharing a domain: one
 * writes a video from a prompt, the other cuts video somebody already has. The
 * link between them is the product — and the part of it worth testing is the
 * transcript, because it is the part that is exact and can silently stop being
 * so.
 *
 * Scenes are separate recordings laid end to end, each with word timings
 * relative to its own clip. Fold them onto the finished video's clock with the
 * wrong offset and every word is out by the length of everything before it —
 * which does not throw, does not fail a type check, and shows up as an editor
 * where clicking a word seeks to the wrong place.
 *
 * Run with `npx tsx tests/handoff-test.ts`.
 */

import { readFileSync } from "node:fs";
import { transcriptFromScenes } from "../src/rescript/lib/handoff";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function near(actual: number, expected: number, tol: number, what: string) {
  assert(
    Math.abs(actual - expected) <= tol,
    `${what}: expected ~${expected}, got ${actual.toFixed(4)}`
  );
}

/* ------------------------------ the offsetting ------------------------------ */

{
  const words = transcriptFromScenes([
    {
      at: 2.5,
      words: [
        { word: "So", start: 0, end: 0.3 },
        { word: "we", start: 0.35, end: 0.5 },
        { word: "shipped.", start: 0.55, end: 1.1 },
      ],
    },
    {
      at: 9,
      words: [
        { word: "It", start: 0, end: 0.2 },
        { word: "took", start: 0.2, end: 0.5 },
      ],
    },
  ]);

  assert(words.length === 5, `expected five words, got ${words.length}`);
  assert(
    words.map((w) => w.text).join(" ") === "So we shipped. It took",
    "the words came back in the wrong order or with the wrong text"
  );

  // Each scene's timings moved by where that scene starts, not by where the
  // previous one ended: the two are different the moment a scene has any lead
  // in front of its voice, which every one of them does.
  near(words[0].start, 2.5, 1e-9, "the first word of the first scene");
  near(words[2].end, 3.6, 1e-9, "the last word of the first scene");
  near(words[3].start, 9, 1e-9, "the first word of the second scene");
  near(words[4].end, 9.5, 1e-9, "the last word of the second scene");

  // Ids are unique and the list is in time order — the editor indexes into it
  // by both.
  assert(new Set(words.map((w) => w.id)).size === words.length, "two words share an id");
  for (let i = 1; i < words.length; i++) {
    assert(words[i].start >= words[i - 1].start, "the transcript is out of order");
  }
  for (const word of words) {
    assert(word.end > word.start, `"${word.text}" ends before it starts`);
    assert(!word.deleted, "a word arrived already deleted");
  }
  console.log("✓ every scene's timings move by where that scene starts");
}

/* ---------------------------- a scene with no timings ------------------------ */

{
  // Deepgram and Cartesia return timings; a future engine might not, and a
  // scene whose voice failed has none either. The words still have to arrive:
  // the editor can cut on a word that is a fifth of a second out, and cannot
  // cut on a word that is not there.
  const words = transcriptFromScenes([
    { at: 0, words: [{ word: "First", start: 0, end: 0.5 }] },
    { at: 4, narration: "Four words spread evenly", seconds: 2 },
    { at: 8, words: [{ word: "Last", start: 0, end: 0.4 }] },
  ]);

  assert(words.length === 6, `expected six words, got ${words.length}`);
  const middle = words.slice(1, 5);
  assert(
    middle.map((w) => w.text).join(" ") === "Four words spread evenly",
    "the untimed scene lost its words"
  );
  near(middle[0].start, 4, 1e-9, "the untimed scene starts where it was placed");
  near(middle[3].end, 6 - 0.02, 1e-9, "and ends where its clip does");
  for (let i = 1; i < middle.length; i++) {
    assert(middle[i].start >= middle[i - 1].end, "the spread words overlap");
  }
  // It must not run into the scene after it, which is the failure that would
  // make the whole rest of the transcript unusable.
  assert(middle[3].end < words[5].start, "an untimed scene ran into the next one");
  console.log("✓ a scene with no word timings still contributes its words, in its own window");
}

/* --------------------------------- the edges -------------------------------- */

{
  assert(transcriptFromScenes([]).length === 0, "an empty project produced words");
  assert(
    transcriptFromScenes([{ at: 0 }]).length === 0,
    "a scene with neither timings nor narration produced words"
  );
  assert(
    transcriptFromScenes([{ at: 0, narration: "   " }]).length === 0,
    "whitespace became a word"
  );

  // A blank word from an engine that emitted one, and a zero-length timing.
  const odd = transcriptFromScenes([
    {
      at: 0,
      words: [
        { word: "  ", start: 0, end: 0.2 },
        { word: "real", start: 0.2, end: 0.2 },
      ],
    },
  ]);
  assert(odd.length === 1 && odd[0].text === "real", "a blank word reached the transcript");
  assert(odd[0].end > odd[0].start, "a zero-length word was left with no duration");

  // No clip length known: read at a plausible pace rather than instantly.
  const guessed = transcriptFromScenes([{ at: 0, narration: "one two three four five" }]);
  assert(guessed.length === 5, "the guessed spread lost words");
  assert(
    guessed[4].end > 1 && guessed[4].end < 4,
    `five words should take a second or two, got ${guessed[4].end.toFixed(2)}s`
  );
  console.log("✓ empty, blank and unmeasured scenes are all survivable");
}

/* ------------------------------ the navigation ------------------------------ */

{
  // The one thing about this handoff that cannot be checked by calling a
  // function, and the one that breaks it completely.
  //
  // The editor needs SharedArrayBuffer to run ffmpeg, which needs the document
  // to be cross-origin isolated, which comes from COOP/COEP headers that
  // next.config.ts sets on /video-editor alone. Headers apply to a document —
  // so a client-side transition would land on the editor inside the document
  // the studio was loaded as, with no isolation, and the media engine would
  // refuse to start with a message about the page rather than the navigation.
  const player = readFileSync("src/components/whiteboard/whiteboard-player.tsx", "utf8");
  assert(
    /window\.location\.assign\(`\/video-editor/.test(player),
    "the handoff navigates without forcing a real page load, so the editor lands un-isolated"
  );
  assert(
    !/router\.push\(`\/video-editor/.test(player),
    "a soft navigation to the editor cannot carry the isolation headers"
  );

  const config = readFileSync("next.config.ts", "utf8");
  assert(
    /Cross-Origin-Embedder-Policy/.test(config) && /\/video-editor/.test(config),
    "the editor route no longer carries the isolation headers this depends on"
  );
  console.log("✓ the handoff arrives as a real page load, where the isolation headers apply");
}

console.log("\nhandoff: all checks passed");
