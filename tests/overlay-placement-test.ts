/**
 * Placement enforcement, driven through the real store.
 *
 * The rules in lib/overlay/layout.ts are covered by overlay-test.ts as pure
 * functions. What this checks is that they are actually *applied* — that adding
 * an element and choosing a placement preset both go through them, and that
 * dragging deliberately does not. That distinction is the whole design, and it
 * is the kind of thing a refactor silently drops.
 */

import { useOverlayStore } from "../src/rescript/lib/overlay/store";
import { subtitleBand, overlaps, nudgeClear } from "../src/rescript/lib/overlay/layout";
import { SUBTITLE_PRESETS } from "../src/rescript/lib/overlay/subtitles";
import { DEFAULT_SUBTITLE_STYLE } from "../src/rescript/lib/overlay/types";
import { rectAt } from "../src/rescript/lib/overlay/presets";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const store = () => useOverlayStore.getState();

function reset() {
  store().reset();
}

/** Turn on the Shorts look, whose subtitles sit in the middle of the frame. */
function enableShortsSubtitles() {
  const shorts = SUBTITLE_PRESETS.find((p) => p.id === "shorts")!;
  store().setSubtitleStyle(shorts.style);
  store().setCues([
    { id: "c1", start: 0, end: 30, text: "a cue that is on screen throughout" },
  ]);
  store().setSubtitleEnabled(true);
}

function band() {
  return subtitleBand(useOverlayStore.getState().subtitles.style);
}

/* ------------------- a new element avoids the subtitles -------------------- */

{
  reset();
  enableShortsSubtitles();

  // Ask for dead centre — exactly where the Shorts subtitles live.
  const id = store().addText({
    text: "Title",
    start: 0,
    end: 4,
    rect: rectAt("center", 0.8, 0.16),
  });

  const element = store().elements.find((e) => e.id === id)!;
  assert(element, "the element was added");
  assert(
    !overlaps(element.rect, band(), 0.02),
    `a new caption must not land on the subtitles — got y=${element.rect.y}, band y=${band().y}`
  );
}

/* --------------- a new element avoids one already on screen ---------------- */

{
  reset();
  const first = store().addText({
    text: "First",
    start: 0,
    end: 4,
    rect: rectAt("lower-third", 0.8, 0.16),
  });
  const second = store().addText({
    text: "Second",
    start: 1,
    end: 3,
    rect: rectAt("lower-third", 0.8, 0.16),
  });

  const a = store().elements.find((e) => e.id === first)!;
  const b = store().elements.find((e) => e.id === second)!;
  assert(
    !overlaps(a.rect, b.rect, 0.02),
    `two captions sharing a moment must not share pixels — ${JSON.stringify(a.rect)} vs ${JSON.stringify(b.rect)}`
  );
}

/* ---------------- but not one that is on screen at another time ------------ */

{
  reset();
  const first = store().addText({
    text: "First",
    start: 0,
    end: 2,
    rect: rectAt("lower-third", 0.8, 0.16),
  });
  const later = store().addText({
    text: "Later",
    start: 5,
    end: 7,
    rect: rectAt("lower-third", 0.8, 0.16),
  });

  const a = store().elements.find((e) => e.id === first)!;
  const b = store().elements.find((e) => e.id === later)!;
  assert(
    Math.abs(a.rect.y - b.rect.y) < 1e-6,
    "captions at different times may share the same position"
  );
}

/* --------------------- presets are tidied, drags are not ------------------- */

{
  reset();
  enableShortsSubtitles();
  const id = store().addText({ text: "T", start: 0, end: 4 });

  // A preset asks to be tidy: it must clear the band.
  store().placeElement(id, rectAt("center", 0.8, 0.16));
  const placed = store().elements.find((e) => e.id === id)!;
  assert(
    !overlaps(placed.rect, band(), 0.02),
    "a placement preset clears the subtitle band"
  );

  // A drag says exactly here, and is obeyed to the pixel.
  const exact = { x: 0.1, y: band().y, w: 0.8, h: 0.16 };
  store().updateElement(id, { rect: exact });
  const dragged = store().elements.find((e) => e.id === id)!;
  assert(
    Math.abs(dragged.rect.y - exact.y) < 1e-9,
    "a drag is never overridden — the person put it there on purpose"
  );
}

/* ------------- turning subtitles on lifts what is now underneath ----------- */

{
  reset();
  const id = store().addText({
    text: "Lower third",
    start: 0,
    end: 10,
    rect: { x: 0.1, y: 0.66, w: 0.8, h: 0.16 },
  });
  const before = store().elements.find((e) => e.id === id)!.rect.y;

  // Bottom subtitles land right on a lower third.
  store().setSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, position: "bottom" });
  store().setCues([{ id: "c1", start: 0, end: 10, text: "cue" }]);
  store().setSubtitleEnabled(true);

  const after = store().elements.find((e) => e.id === id)!;
  assert(
    !overlaps(after.rect, band(), 0.02),
    `switching subtitles on lifts the caption clear — was y=${before}, now y=${after.rect.y}`
  );
  assert(after.rect.y < before, "and it moved up rather than down");
}

/* ------------------------- hidden elements do not block -------------------- */

{
  reset();
  const hidden = store().addText({
    text: "Hidden",
    start: 0,
    end: 4,
    rect: rectAt("lower-third", 0.8, 0.16),
  });
  store().updateElement(hidden, { hidden: true });

  const visible = store().addText({
    text: "Visible",
    start: 0,
    end: 4,
    rect: rectAt("lower-third", 0.8, 0.16),
  });
  const a = store().elements.find((e) => e.id === hidden)!;
  const b = store().elements.find((e) => e.id === visible)!;
  assert(
    Math.abs(a.rect.y - b.rect.y) < 1e-6,
    "something hidden is not in the way"
  );
}

/* --------------------------- reframing moves things ------------------------- */

{
  // The subtitle band is a different *fraction of the frame* in 9:16 than in
  // 16:9, and the direction is the opposite of the obvious guess. Type is
  // measured against a corrected unit (`typeScale`) so that 0.055 of height is
  // not enormous on a phone; rects are not corrected. So the band occupies less
  // of a tall frame and more of a wide one — and the reframe that breaks a
  // layout is vertical → widescreen, not the other way round.
  //
  // Rects being fractions of the frame means an element *survives* a reframe.
  // It does not mean it still works.
  const style = { ...DEFAULT_SUBTITLE_STYLE, position: "bottom" as const };
  const wide = subtitleBand(style, 16 / 9);
  const tall = subtitleBand(style, 9 / 16);

  assert(
    wide.h > tall.h,
    `the caption band takes more of a wide frame (${wide.h.toFixed(3)}) than a tall one (${tall.h.toFixed(3)})`
  );

  // Both bands end at the same margin from the bottom; the wide one simply
  // starts higher. So the element to catch this is one tucked *just* above
  // where the vertical band begins — derived rather than guessed, so it stays
  // the right element if the default caption style ever changes.
  const h = 0.05;
  const pad = 0.02;
  const lowerThird = { x: 0.1, y: tall.y - pad - h - 0.001, w: 0.5, h };
  assert(!overlaps(lowerThird, tall, 0.02), "it clears the band in vertical");
  assert(overlaps(lowerThird, wide, 0.02), "and collides in widescreen — this is the bug");

  // …which is what the reframe pass is for.
  const lifted = nudgeClear(lowerThird, [wide]);
  assert(!overlaps(lifted, wide, 0.02), "after reflowing it clears again");
  assert(lifted.y < lowerThird.y, "and it lifted rather than dropping behind the captions");
  assert(
    Math.abs(lifted.x - lowerThird.x) < 1e-9,
    "horizontally untouched — a caption belongs to its side of the frame"
  );
  assert(
    Math.abs(lifted.w - lowerThird.w) < 1e-9 && Math.abs(lifted.h - lowerThird.h) < 1e-9,
    "and it is moved, never resized"
  );
}

{
  // Something already clear must not be nudged for no reason. A reframe that
  // shuffles a composition nobody had a problem with is worse than one that
  // leaves it alone.
  const band = subtitleBand(DEFAULT_SUBTITLE_STYLE, 16 / 9);
  const title = { x: 0.1, y: 0.08, w: 0.8, h: 0.12 };
  const placed = nudgeClear(title, [band]);
  assert(
    Math.abs(placed.y - title.y) < 1e-9 && Math.abs(placed.x - title.x) < 1e-9,
    "an element that already clears everything is left exactly where it is"
  );
}

console.log("ALL PLACEMENT TESTS PASSED");
