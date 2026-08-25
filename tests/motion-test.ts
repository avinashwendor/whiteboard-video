/**
 * Per-word and per-character reveals.
 *
 * Animation here was enter-and-exit on a whole element, which is why every
 * caption this editor made *appeared* rather than being delivered. Tokens are
 * the difference, and the delicate part is that the words must land in exactly
 * the same places they would have without an animation — a reveal that also
 * moves the layout is a reveal nobody can use over footage.
 *
 * So the first assertion is the boring one: **text with no stagger draws
 * identically to before.** Everything else is allowed to be wrong in ways
 * someone would notice.
 *
 * Run with `npx tsx tests/motion-test.ts`.
 */

import {
  drawStateAt,
  tokenProgress,
  ANIMATION_KINDS,
} from "../src/rescript/lib/overlay/animation";
import { paintComposition } from "../src/rescript/lib/overlay/render";
import {
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_FRAME,
  type AnimationSpec,
  type Composition,
  type TextElement,
} from "../src/rescript/lib/overlay/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/* ------------------------------ token spread ------------------------------- */

{
  // One token is the whole animation; no stagger is the whole animation.
  assert(tokenProgress(0.5, 0, 1, 0.2) === 0.5, "a single token is not staggered");
  assert(tokenProgress(0.5, 3, 8, 0) === 0.5, "no stagger means everything together");

  // The first token leads and the last trails, always.
  const first = tokenProgress(0.4, 0, 5, 0.16);
  const last = tokenProgress(0.4, 4, 5, 0.16);
  assert(first > last, `the first word must lead: ${first} vs ${last}`);

  // Everything is finished when the animation is. A reveal still arriving after
  // its own animation has ended is the bug the fractional stagger exists to
  // prevent — in seconds, a twelve-word title would outlast a three-word one.
  for (const count of [2, 5, 12, 40]) {
    for (let i = 0; i < count; i += 1) {
      assert(
        tokenProgress(1, i, count, 0.16) === 1,
        `token ${i} of ${count} unfinished at the end of the animation`
      );
      assert(
        tokenProgress(0, i, count, 0.16) === 0,
        `token ${i} of ${count} already started at the beginning`
      );
    }
  }

  // Monotonic in time, for every token — a word that goes backwards mid-reveal
  // reads as a dropped frame.
  for (const i of [0, 3, 7]) {
    let previous = 0;
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const now = tokenProgress(p, i, 8, 0.16);
      assert(now >= previous - 1e-9, `token ${i} went backwards at p=${p.toFixed(2)}`);
      previous = now;
    }
  }

  // A very long caption compresses the stagger rather than snapping: every
  // token still gets a window worth animating in.
  const many = 60;
  const mid = tokenProgress(0.5, 30, many, 0.16);
  assert(mid > 0 && mid < 1, `a 60-word caption must still animate, got ${mid}`);
}

/* -------------------------------- draw state -------------------------------- */

function text(over: Partial<TextElement> = {}): TextElement {
  return {
    id: "t1",
    kind: "text",
    name: "caption",
    start: 0,
    end: 10,
    rect: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 },
    rotation: 0,
    opacity: 1,
    z: 1,
    locked: false,
    hidden: false,
    enter: { kind: "fade", duration: 0.5, easing: "easeOut" },
    exit: { kind: "none", duration: 0, easing: "linear" },
    text: "one two three four",
    fontFamily: "sans-serif",
    fontWeight: 700,
    italic: false,
    fontSize: 0.06,
    color: "#ffffff",
    align: "left",
    lineHeight: 1.2,
    letterSpacing: 0,
    uppercase: false,
    background: null,
    padding: 0,
    radius: 0,
    shadow: false,
    strokeColor: null,
    strokeWidth: 0,
    ...over,
  };
}

{
  // No unit means no tokens: the original behaviour, untouched.
  const plain = drawStateAt(text(), 0.2);
  assert(plain, "on screen");
  assert(plain!.tokens === null, "a plain fade has no tokens");

  // Asking for words gives tokens — but only while something is animating. A
  // settled element is one element, whatever revealed it.
  const staggered = text({
    enter: { kind: "fade", duration: 0.5, easing: "easeOut", unit: "word" },
  });
  assert(drawStateAt(staggered, 0.2)!.tokens?.unit === "word", "mid-reveal, tokens");
  assert(drawStateAt(staggered, 5)!.tokens === null, "settled, no tokens");

  // `mask` is per-word without being asked, because per-element it is a dull
  // wipe rather than the reveal it was ported for.
  const masked = text({ enter: { kind: "mask", duration: 0.5, easing: "easeOut" } });
  assert(drawStateAt(masked, 0.2)!.tokens?.unit === "word", "mask defaults to per word");
  // …and can still be overridden.
  const wholeMask = text({
    enter: { kind: "mask", duration: 0.5, easing: "easeOut", unit: "element" },
  });
  assert(drawStateAt(wholeMask, 0.2)!.tokens === null, "an explicit element unit wins");

  // Only text has tokens to stagger.
  const shape = {
    ...text(),
    kind: "shape" as const,
    shape: "rect" as const,
    fill: "#fff",
    strokeColor: null,
    strokeWidth: 0,
    radius: 0,
    enter: { kind: "fade", duration: 0.5, easing: "easeOut", unit: "word" } as AnimationSpec,
  };
  assert(
    drawStateAt(shape as never, 0.2)!.tokens === null,
    "a rectangle has no words in it"
  );
}

{
  // The mask clips rather than fades. Fading as well turns the hard
  // typographic edge it exists for back into a soft appearance.
  const masked = text({
    enter: { kind: "mask", duration: 0.5, easing: "linear", unit: "element" },
  });
  const mid = drawStateAt(masked, 0.25)!;
  assert(mid.rise > 0 && mid.rise < 1, `mid-reveal is partly clipped, got ${mid.rise}`);
  assert(mid.opacity === 1, `the mask must not fade, got ${mid.opacity}`);

  const done = drawStateAt(masked, 5)!;
  assert(done.rise === 1, "settled is unclipped");

  // Every kind still produces a usable state — a new field must not have made
  // any of them undrawable.
  for (const kind of ANIMATION_KINDS) {
    const el = text({ enter: { kind, duration: 0.5, easing: "easeOut" } });
    const state = drawStateAt(el, 0.25);
    assert(state, `${kind} produced no state`);
    for (const [field, value] of Object.entries(state!)) {
      if (field === "tokens") continue;
      assert(Number.isFinite(value as number), `${kind}.${field} is not finite`);
    }
    assert(state!.rise >= 0 && state!.rise <= 1, `${kind}.rise out of range`);
  }
}

/* -------------------------------- rendering --------------------------------- */

interface Stamp {
  run: string;
  x: number;
  y: number;
  alpha: number;
  clipped: boolean;
}

/**
 * A context that records what text was stamped, where, and whether a clip was
 * in force at the time. Widths are one unit per character, which makes the
 * expected cursor positions arithmetic rather than guesswork.
 */
function stubContext() {
  const stamps: Stamp[] = [];
  const stack: { alpha: number; clipped: boolean }[] = [];
  let clipped = false;

  const ctx = {
    globalAlpha: 1,
    fillStyle: "#000" as unknown,
    strokeStyle: "#000" as unknown,
    lineWidth: 0,
    lineJoin: "round" as CanvasLineJoin,
    miterLimit: 2,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    textBaseline: "top" as CanvasTextBaseline,
    filter: "none",
    letterSpacing: "0px",
    save() {
      stack.push({ alpha: this.globalAlpha, clipped });
    },
    restore() {
      const previous = stack.pop();
      if (previous) {
        this.globalAlpha = previous.alpha;
        clipped = previous.clipped;
      }
    },
    beginPath() {},
    rect() {
      // Only `clip()` makes a path meaningful here.
    },
    roundRect() {},
    ellipse() {},
    moveTo() {},
    lineTo() {},
    clip() {
      clipped = true;
    },
    fill() {},
    stroke() {},
    translate() {},
    rotate() {},
    scale() {},
    drawImage() {},
    fillRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    measureText: (s: string) => ({ width: s.length }),
    fillText(run: string, x: number, y: number) {
      stamps.push({ run, x, y, alpha: this.globalAlpha, clipped });
    },
    strokeText() {},
    set font(_v: string) {},
    get font() {
      return "10px sans-serif";
    },
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, stamps };
}

const SIZE = { width: 1000, height: 1000 };

function composition(elements: TextElement[]): Composition {
  return {
    elements,
    subtitles: { enabled: false, style: { ...DEFAULT_SUBTITLE_STYLE }, cues: [], generated: false },
    transitions: [],
    frame: { ...DEFAULT_FRAME },
    shots: [],
    grade: null,
  };
}

function render(el: TextElement, t: number) {
  const { ctx, stamps } = stubContext();
  paintComposition(ctx, composition([el]), SIZE, t);
  return stamps;
}

{
  // The promise: no stagger, one stamp per line, exactly as before.
  const plain = render(text(), 5);
  assert(plain.length === 1, `an unstaggered line is one stamp, got ${plain.length}`);
  assert(plain[0].run === "one two three four", "the whole line at once");
  assert(!plain[0].clipped, "and nothing is clipped");
}

{
  // Staggered: one stamp per word, mid-reveal.
  const el = text({
    enter: { kind: "fade", duration: 1, easing: "linear", unit: "word", stagger: 0.2 },
  });
  const stamps = render(el, 0.9);
  assert(stamps.length > 1, `words are stamped separately, got ${stamps.length}`);

  // Laid out from the undivided line: the cursor advances by each token's own
  // measured width, so the words sit where they would have without animation.
  // With one unit per character, "one " is 4 wide, "two " is 4, "three " is 6.
  const xs = stamps.map((s) => s.x);
  const expected = [0, 4, 8, 14];
  stamps.forEach((s, i) => {
    assert(
      Math.abs(s.x - (100 + expected[i])) < 1e-6,
      `word ${i} ("${s.run.trim()}") is at ${s.x}, expected ${100 + expected[i]}`
    );
  });
  assert(xs.every((x, i) => i === 0 || x > xs[i - 1]), "words run left to right");

  // The earlier words are further along than the later ones.
  assert(
    stamps[0].alpha >= stamps[stamps.length - 1].alpha,
    "the first word must lead the last"
  );

  // Once it has settled, it is one stamp again.
  assert(render(el, 5).length === 1, "a settled caption is one stamp");
}

{
  // Per character, and the letters still spell the word.
  const el = text({
    text: "abc",
    enter: { kind: "fade", duration: 1, easing: "linear", unit: "char", stagger: 0.3 },
  });
  // Late enough that the last character has started: with three tokens and a
  // 0.3 stagger it begins at p=0.6, and a test sitting exactly on that boundary
  // is asserting a rounding mode rather than a behaviour.
  const stamps = render(el, 0.8);
  assert(stamps.length === 3, `three characters, got ${stamps.length}`);
  assert(stamps.map((s) => s.run).join("") === "abc", "in order and complete");
  assert(
    stamps.every((s, i) => i === 0 || s.x > stamps[i - 1].x),
    "and they advance left to right"
  );
}

{
  // A masked word is clipped while it rises, and unclipped once it is up.
  const el = text({
    text: "rise up",
    enter: { kind: "mask", duration: 1, easing: "linear", stagger: 0.4 },
  });
  const mid = render(el, 0.4);
  assert(mid.some((s) => s.clipped), "a rising word is clipped by its baseline");

  const settled = render(el, 5);
  assert(settled.length === 1, "settled is one stamp");
  assert(!settled[0].clipped, "and no longer clipped");
}

{
  // A word that has not started yet is not drawn at all, rather than drawn at
  // zero alpha — an invisible stamp still pays for a stroke pass.
  const el = text({
    text: "one two three four five six",
    enter: { kind: "fade", duration: 1, easing: "linear", unit: "word", stagger: 0.15 },
  });
  const early = render(el, 0.05);
  const late = render(el, 0.95);
  assert(
    early.length < late.length,
    `fewer words drawn early (${early.length}) than late (${late.length})`
  );
}

console.log("ALL MOTION TESTS PASSED");
