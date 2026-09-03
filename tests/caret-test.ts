import {
  caretFromClick,
  caretFromIndex,
  caretTime,
  caretToIndex,
  moveCaret,
  wordAfterCaret,
  type CaretPos,
} from "../src/rescript/lib/caret";
import type { Word } from "../src/rescript/lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const w = (id: number, text: string, start: number, end: number): Word => ({
  id,
  text,
  start,
  end,
  speaker: 0,
  deleted: false,
});

const visible: Word[] = [
  w(1, "hello", 0.0, 0.5),
  w(2, "there", 0.5, 1.0),
  w(3, "friend", 1.0, 1.8),
];
const DURATION = 5;

/* ------------------------------ index mapping ----------------------------- */
{
  assert(caretToIndex({ kind: "before", wordId: 1 }, visible) === 0, "before w1 -> 0");
  assert(caretToIndex({ kind: "before", wordId: 3 }, visible) === 2, "before w3 -> 2");
  assert(caretToIndex({ kind: "end" }, visible) === 3, "end -> 3");

  // A caret on a word that is no longer visible degrades to the end.
  assert(
    caretToIndex({ kind: "before", wordId: 99 }, visible) === 3,
    "missing word -> end"
  );

  assert(caretFromIndex(0, visible).kind === "before", "index 0 is a before-caret");
  assert(caretFromIndex(3, visible).kind === "end", "index 3 is end");
  assert(caretFromIndex(99, visible).kind === "end", "overflow clamps to end");
  const first = caretFromIndex(-5, visible);
  assert(
    first.kind === "before" && first.wordId === 1,
    "underflow clamps to first word"
  );
}

/* -------------------------------- movement -------------------------------- */
{
  let c: CaretPos = { kind: "before", wordId: 1 };
  c = moveCaret(c, visible, 1);
  assert(c.kind === "before" && c.wordId === 2, "right moves to w2");
  c = moveCaret(c, visible, 1);
  assert(c.kind === "before" && c.wordId === 3, "right moves to w3");
  c = moveCaret(c, visible, 1);
  assert(c.kind === "end", "right from last word reaches end");
  c = moveCaret(c, visible, 1);
  assert(c.kind === "end", "right at end is a no-op");
  c = moveCaret(c, visible, -1);
  assert(c.kind === "before" && c.wordId === 3, "left from end returns to w3");

  let l: CaretPos = { kind: "before", wordId: 1 };
  l = moveCaret(l, visible, -1);
  assert(l.kind === "before" && l.wordId === 1, "left at start is a no-op");
}

/* ------------------------------ click placement --------------------------- */
{
  const left = caretFromClick(visible[1], 0.2, visible);
  assert(left.kind === "before" && left.wordId === 2, "left half -> before word");
  const right = caretFromClick(visible[1], 0.8, visible);
  assert(right.kind === "before" && right.wordId === 3, "right half -> after word");
  const lastRight = caretFromClick(visible[2], 0.9, visible);
  assert(lastRight.kind === "end", "right half of last word -> end");
}

/* --------------------------------- timing --------------------------------- */
{
  assert(
    caretTime({ kind: "before", wordId: 2 }, visible, DURATION) === 0.5,
    "caret time is the following word's start"
  );
  assert(
    caretTime({ kind: "before", wordId: 1 }, visible, DURATION) === 0.0,
    "caret before first word is 0"
  );
  assert(
    caretTime({ kind: "end" }, visible, DURATION) === DURATION,
    "caret at end is the duration"
  );
}

/* ------------------------------ word after -------------------------------- */
{
  const after = wordAfterCaret({ kind: "before", wordId: 2 }, visible);
  assert(after?.id === 2, "word after caret is the one it sits before");
  assert(wordAfterCaret({ kind: "end" }, visible) === null, "no word after end");
}

console.log("ALL CARET TESTS PASSED");
