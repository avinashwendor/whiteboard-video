/**
 * The hole a deleted word leaves behind.
 *
 * Word timings bound the *sound* of a word, so every word sits between two
 * silences. Cut only the sound and both silences survive, end to end: the word
 * is gone and the gap where it stood is longer than the word was. Delete a
 * filler and you have swapped "um" for a pause, which is the opposite of the
 * edit that was asked for — and nothing downstream can see it, because from the
 * timeline's point of view the cut did exactly what it was told.
 *
 * Everything here is arithmetic on numbers nobody looks at, and every way it
 * goes wrong is silent, so it is checked rather than listened to.
 *
 * Run with `npx tsx tests/gaps-test.ts`.
 */

import {
  getCutRanges,
  getKeepRanges,
  getWordCutRanges,
  addManualCut,
} from "../src/motionscript/lib/edits";
import { findSilenceRanges } from "../src/motionscript/lib/silences";
import { findPauses } from "../src/motionscript/lib/pauses";
import type { ManualCut, TimeRange, Word } from "../src/motionscript/lib/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function near(actual: number, expected: number, tol: number, what: string) {
  assert(
    Math.abs(actual - expected) <= tol,
    `${what}: expected ~${expected}, got ${actual.toFixed(4)}`
  );
}

const word = (
  id: number,
  start: number,
  end: number,
  deleted = false
): Word => ({ id, text: `w${id}`, start, end, speaker: 0, deleted });

/** Silence the viewer still hears between `a` and `b` after the cuts. */
function heard(cuts: TimeRange[], from: number, to: number): number {
  let left = to - from;
  for (const cut of cuts) {
    const lo = Math.max(from, cut.start);
    const hi = Math.min(to, cut.end);
    if (hi > lo) left -= hi - lo;
  }
  return left;
}

/* ------------------------------- the filler -------------------------------- */

{
  // The case that started this: a word lifted out of the middle of a sentence.
  const words = [word(1, 0, 1.0), word(2, 1.3, 1.6, true), word(3, 1.9, 2.6)];
  const cuts = getWordCutRanges(words, 4);
  assert(cuts.length === 1, "one cut");

  // 0.3s either side. Cutting the word alone would leave 0.6s — twice the pause
  // that was there before the edit, in place of a word.
  near(heard(cuts, 1.0, 1.9), 0.3, 1e-6, "the pause after the edit");
  console.log("✓ deleting a word leaves one pause, not two");
}

/* ------------------------------ the long beat ------------------------------ */

{
  // A whole sentence removed between two others. The beat around it is real
  // punctuation and has to survive, or the two remaining sentences run together.
  const words = [
    word(1, 0, 1.0),
    word(2, 1.6, 2.0, true),
    word(3, 2.0, 2.4, true),
    word(4, 3.0, 4.0),
  ];
  const cuts = getWordCutRanges(words, 5);
  assert(cuts.length === 1, "a run of deleted words is one cut");
  near(heard(cuts, 1.0, 3.0), 0.6, 1e-6, "the longer beat is the one kept");
  console.log("✓ a sentence boundary keeps its beat");
}

/* ------------------------------ tight timings ------------------------------ */

{
  // Contiguous timings — nothing to absorb, so nothing changes. This is the
  // common case for segment-level ASR and it must not move.
  const words = [word(1, 0, 1.0), word(2, 1.0, 1.4, true), word(3, 1.4, 2.0)];
  const cuts = getWordCutRanges(words, 3);
  near(cuts[0].start, 1.0, 1e-6, "start");
  near(cuts[0].end, 1.4, 1e-6, "end");
  console.log("✓ tight timings are left exactly alone");
}

/* ------------------------------- the edges --------------------------------- */

{
  // Deleting the first word must not eat the lead-in — there is often a title
  // or an establishing beat in it, and nobody asked for that to go.
  const head = [word(1, 1.0, 1.4, true), word(2, 2.0, 3.0)];
  const headCuts = getWordCutRanges(head, 4);
  near(headCuts[0].start, 1.0, 1e-6, "the head keeps its lead-in");
  near(headCuts[0].end, 2.0, 1e-6, "and the dead air in front of the next word goes");

  // Same at the tail: the run before it joins up, the trailing silence stays.
  const tail = [word(1, 0, 1.0), word(2, 1.5, 2.0, true)];
  const tailCuts = getWordCutRanges(tail, 5);
  near(tailCuts[0].start, 1.0, 1e-6, "the tail joins the word before it");
  near(tailCuts[0].end, 2.0, 1e-6, "and leaves the trailing silence alone");
  console.log("✓ the first and last words are their own cases");
}

/* ------------------------------- overlapping -------------------------------- */

{
  // ASR bleed: the words overlap, so both gaps are negative. A raw subtraction
  // would push the cut into speech on either side.
  const words = [word(1, 0, 1.2), word(2, 1.0, 1.5, true), word(3, 1.3, 2.0)];
  const cuts = getWordCutRanges(words, 3);
  assert(cuts[0].start <= 1.0 + 1e-6, "the cut still covers the word");
  assert(cuts[0].end >= 1.5 - 1e-6, "both ends of it");
  assert(cuts[0].start >= 1.0 - 1e-6, "and does not reach back into the word before");
  console.log("✓ overlapping timings do not push the cut into speech");
}

/* --------------------------- never swallow a word --------------------------- */

{
  // Two fillers around a very short word. The merge tolerance is 0.35s and the
  // space between the two cuts is smaller than that, so without the guard the
  // word between them is cut out of the video while staying in the transcript —
  // which nothing downstream can detect, and which the transcript, the only
  // place anyone would look, insists did not happen.
  const words = [
    word(1, 0, 0.5),
    word(2, 0.55, 0.75, true),
    word(3, 0.8, 0.92),
    word(4, 0.97, 1.2, true),
    word(5, 1.3, 2.0),
  ];
  const cuts = getCutRanges(words, 3, []);
  assert(cuts.length === 2, `expected the short word to survive, got ${cuts.length} cut(s)`);
  assert(
    heard(cuts, 0.8, 0.92) > 0.11,
    "the word between the two cuts is still in the video"
  );

  // And the same guard on the manual side: two blade cuts either side of a word.
  const manual: ManualCut[] = [{ id: 1, start: 0.5, end: 0.78 }];
  const { cuts: added } = addManualCut(manual, 0.95, 1.4, 2, words);
  assert(added.length === 2, "a blade cut does not merge across speech either");
  console.log("✓ the merge tolerance cannot eat a short word");
}

/* ----------------------------- clearing the gaps ---------------------------- */

{
  // What the editor is asked to do after a few deletions: close what is left.
  const words = [word(1, 0, 1.0), word(2, 1.4, 1.7, true), word(3, 2.1, 3.0)];
  const cuts = getCutRanges(words, 4, []);
  const before = heard(cuts, 1.0, 2.1);
  assert(before > 0.3, "there is a pause worth removing");

  const silences = findSilenceRanges(words, 4, [], 0.3);
  assert(silences.length > 0, "the pause is offered for removal");

  // The bug this covers: the deletion splits the gap into two pieces, each
  // shorter than the threshold. Judging the pieces instead of the gap made
  // "remove the silences" a no-op — the gap qualified, none of its parts did,
  // and the answer to asking again was always the same.
  const manual: ManualCut[] = silences.map((r, i) => ({ id: i + 1, ...r }));
  const after = getCutRanges(words, 4, manual);
  near(heard(after, 1.0, 2.1), 0, 0.11, "the dead air after clearing");
  console.log("✓ asking to clear the gaps clears the gaps");
}

/* ------------------------------- what is shown ------------------------------ */

{
  // The chip has to say what the viewer will hear, not what the raw timings
  // say — otherwise deleting a word makes the number on screen go *up*.
  const words = [word(1, 0, 1.0), word(2, 1.3, 1.6, true), word(3, 1.9, 2.6)];
  const cuts = getCutRanges(words, 4, []);
  const kept = words.filter((w) => !w.deleted);

  const blind = findPauses(kept, { minDuration: 0.1 });
  near(blind[0].duration, 0.9, 1e-6, "without the cuts the whole span reads as a pause");

  const honest = findPauses(kept, { minDuration: 0.1, cuts });
  near(honest[0].duration, 0.3, 1e-6, "with them it reads as what is left");
  assert(
    findPauses(kept, { minDuration: 0.5, cuts }).length === 0,
    "and a gap that is now under the threshold stops being offered at all"
  );
  console.log("✓ a pause is reported at the length it will actually play");
}

/* -------------------------------- the whole ---------------------------------- */

{
  // The invariant that matters more than any single rule: a deletion only ever
  // removes time. Whatever the timings, the edited video is never longer than
  // the same edit made the naive way.
  const rand = (seed: number) => {
    let s = seed;
    return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  };
  const next = rand(7);
  for (let trial = 0; trial < 200; trial++) {
    const words: Word[] = [];
    let t = next() * 0.5;
    for (let i = 0; i < 12; i++) {
      const start = t;
      const end = start + 0.1 + next() * 0.4;
      words.push(word(i + 1, start, end, next() < 0.35));
      t = end + next() * 0.6;
    }
    const duration = t + 1;
    const cuts = getWordCutRanges(words, duration);
    for (const w of words) {
      if (!w.deleted) continue;
      assert(
        cuts.some((c) => c.start <= w.start + 1e-6 && c.end >= w.end - 1e-6),
        `a deleted word survived the cut (trial ${trial})`
      );
    }
    for (const w of words) {
      if (w.deleted) continue;
      // Kept speech is never cut away. A word may be shortened by a cut that
      // reaches to its edge, but its middle has to survive.
      const mid = (w.start + w.end) / 2;
      assert(
        !cuts.some((c) => c.start < mid && c.end > mid),
        `a kept word was cut out (trial ${trial})`
      );
    }
    const keeps = getKeepRanges(cuts, duration);
    for (let i = 1; i < keeps.length; i++) {
      assert(keeps[i].start > keeps[i - 1].end, `keep ranges out of order (trial ${trial})`);
    }
  }
  console.log("✓ 200 random transcripts: every deletion lands, no kept word does");
}

console.log("\ngaps: all checks passed");
