/**
 * The frame reader, against frames whose answer is known in advance.
 *
 * Every claim this module makes to the agent — *the subject is at x=0.3*, *the
 * lower third is too busy for type*, *this footage is dark so use white* — is
 * arithmetic over pixels, which means it is checkable without a video. So each
 * case below paints a synthetic frame where the right answer is obvious to a
 * person, and asserts the numbers agree.
 *
 * The alternative was to trust it, and a placement heuristic that is quietly
 * wrong is worse than none: the agent would stop guessing and start being
 * confidently misled.
 */

import {
  readFrame,
  describeFrame,
  describeVision,
  rankZones,
  boxFor,
  readNearest,
  toWire,
  SAMPLE_EDGE,
  type FrameRead,
} from "../src/rescript/lib/overlay/vision";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function near(actual: number, expected: number, tolerance: number, what: string) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected ~${expected}, got ${actual.toFixed(3)}`
  );
}

/* ------------------------------- a canvas ---------------------------------- */

const W = SAMPLE_EDGE;
const H = SAMPLE_EDGE;

interface Painter {
  fill(r: number, g: number, b: number): Painter;
  /** Rectangle in frame fractions. */
  rect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): Painter;
  /** Fill a rectangle with per-pixel noise around a mean — busy footage. */
  noise(x: number, y: number, w: number, h: number, mean: number, spread: number): Painter;
  done(): ImageData;
}

function paint(): Painter {
  const data = new Uint8ClampedArray(W * H * 4);
  // Deterministic pseudo-random, so a failure is reproducible.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const put = (x: number, y: number, r: number, g: number, b: number) => {
    const p = (y * W + x) * 4;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = 255;
  };

  const api: Painter = {
    fill(r, g, b) {
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) put(x, y, r, g, b);
      return api;
    },
    rect(fx, fy, fw, fh, r, g, b) {
      const x0 = Math.round(fx * W);
      const x1 = Math.round((fx + fw) * W);
      const y0 = Math.round(fy * H);
      const y1 = Math.round((fy + fh) * H);
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y += 1) {
        for (let x = Math.max(0, x0); x < Math.min(W, x1); x += 1) put(x, y, r, g, b);
      }
      return api;
    },
    noise(fx, fy, fw, fh, mean, spread) {
      const x0 = Math.round(fx * W);
      const x1 = Math.round((fx + fw) * W);
      const y0 = Math.round(fy * H);
      const y1 = Math.round((fy + fh) * H);
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y += 1) {
        for (let x = Math.max(0, x0); x < Math.min(W, x1); x += 1) {
          const v = Math.max(0, Math.min(255, (mean + (rand() - 0.5) * spread) * 255));
          put(x, y, v, v, v);
        }
      }
      return api;
    },
    done() {
      return { width: W, height: H, data, colorSpace: "srgb" } as ImageData;
    },
  };
  return api;
}

/** A believable skin tone that passes the YCbCr rule. */
const SKIN = [214, 168, 140] as const;

const read = (image: ImageData, at = 0, previous: FrameRead | null = null) =>
  readFrame(image, at, { aspect: 16 / 9, previous });

const zone = (r: FrameRead, position: string) =>
  r.zones.find((z) => z.position === position)!;

/* ------------------------------ brightness --------------------------------- */

{
  const dark = read(paint().fill(10, 10, 12).done());
  near(dark.brightness, 0.04, 0.03, "a near-black frame is dark");
  assert(dark.busy < 0.05, "a flat frame has no detail");
  assert(dark.contrast < 0.05, "a flat frame has no contrast");
  assert(
    dark.zones.every((z) => z.ink === "light"),
    "white type is the answer on a dark frame everywhere"
  );

  const bright = read(paint().fill(240, 240, 238).done());
  near(bright.brightness, 0.94, 0.03, "a near-white frame is bright");
  assert(
    bright.zones.every((z) => z.ink === "dark"),
    "dark type is the answer on a white frame everywhere"
  );
  console.log("✓ brightness and ink choice");
}

/* -------------------------------- detail ----------------------------------- */

{
  const flat = read(paint().fill(90, 95, 100).done());
  const busy = read(paint().fill(90, 95, 100).noise(0, 0, 1, 1, 0.4, 0.9).done());
  assert(
    busy.busy > flat.busy + 0.2,
    `noise reads as busier than a flat wall (${busy.busy.toFixed(2)} vs ${flat.busy.toFixed(2)})`
  );
  assert(
    flat.zones.some((z) => !z.scrim),
    "a flat background carries type without a scrim somewhere"
  );
  assert(
    busy.zones.every((z) => z.scrim),
    "busy footage needs a scrim wherever the type goes"
  );
  console.log("✓ detail drives the scrim decision");
}

/* ------------------------------ where nobody is ---------------------------- */

{
  // A talking head sitting left of frame: skin in the left third, flat wall
  // behind, and the lower third clear.
  const image = paint()
    .fill(46, 52, 64)
    .rect(0.12, 0.2, 0.3, 0.62, SKIN[0], SKIN[1], SKIN[2])
    .done();
  const r = read(image);

  assert(r.subject, "a face in shot is found");
  assert(
    r.subject!.x < 0.45,
    `the subject is left of centre, got x=${r.subject!.x.toFixed(2)}`
  );
  near(r.subject!.y, 0.5, 0.2, "the subject is vertically centred");
  assert(r.subject!.confidence > 0.5, "a skin-derived subject is confident");

  const overFace = zone(r, "left");
  const clear = zone(r, "right");
  assert(
    overFace.overSubject > clear.overSubject,
    "the left of frame reads as more over the subject than the right"
  );
  assert(
    clear.score > overFace.score,
    `the free side scores better (${clear.score.toFixed(2)} vs ${overFace.score.toFixed(2)})`
  );
  assert(
    r.zones[0].position !== "left",
    "the side the person is standing on is never the best place for type"
  );
  console.log("✓ the subject is found and not written over");
}

/* --------------------------- a busy lower third ---------------------------- */

{
  // Clean above, chaos below: exactly the case where a lower third is the
  // wrong instinct and the upper third is the right one.
  const image = paint()
    .fill(30, 34, 44)
    .noise(0, 0.6, 1, 0.4, 0.5, 1)
    .done();
  const r = read(image);

  const lower = zone(r, "lower-third");
  const upper = zone(r, "upper-third");
  assert(
    upper.score > lower.score,
    `the clean half wins (upper ${upper.score.toFixed(2)} vs lower ${lower.score.toFixed(2)})`
  );
  assert(lower.scrim, "the busy half is flagged as needing a scrim");
  assert(!upper.scrim, "the clean half is not");
  assert(
    r.zones[0].position === "top" ||
      r.zones[0].position === "upper-third" ||
      r.zones[0].position.startsWith("top"),
    `the best position is up top, got ${r.zones[0].position}`
  );
  console.log("✓ a busy band is ranked below a clean one");
}

/* ------------------------------ the subtitle band -------------------------- */

{
  const image = paint().fill(30, 34, 44).done();
  const free = readFrame(image, 0, { aspect: 16 / 9 });
  const taken = readFrame(image, 0, {
    aspect: 16 / 9,
    subtitleBand: { from: 0.78, to: 0.95 },
  });

  const before = free.zones.find((z) => z.position === "bottom")!;
  const after = taken.zones.find((z) => z.position === "bottom")!;
  assert(
    after.score < before.score - 0.4,
    "a position the subtitles already own is heavily penalised"
  );
  assert(after.note.includes("subtitles"), "and says why");
  assert(
    taken.zones[0].position !== "bottom",
    "so it is never the recommendation while subtitles are on"
  );
  console.log("✓ burned-in subtitles take their band out of play");
}

/* -------------------------------- palette ---------------------------------- */

{
  // Overwhelmingly blue footage. The accent must not be the blue.
  const r = read(paint().fill(28, 74, 190).done());
  assert(r.colors.length > 0, "a palette comes back");
  assert(r.accent !== "#60a5fa", "the accent is not the colour already filling the frame");
  assert(
    ["#ffd60a", "#fb923c", "#f472b6"].includes(r.accent),
    `a warm accent against blue footage, got ${r.accent}`
  );

  const warm = read(paint().fill(200, 120, 40).done());
  assert(
    ["#60a5fa", "#4ade80"].includes(warm.accent),
    `a cool accent against orange footage, got ${warm.accent}`
  );
  console.log("✓ the accent is chosen against the footage, not for itself");
}

/* --------------------------------- change ---------------------------------- */

{
  const a = read(paint().fill(20, 20, 20).done(), 1);
  const same = read(paint().fill(20, 20, 20).done(), 2, a);
  const different = read(paint().fill(230, 230, 230).done(), 3, a);

  assert(a.change === null, "the first frame has nothing to compare against");
  near(same.change!, 0, 0.02, "an identical frame has not changed");
  assert(different.change! > 0.7, "a cut to white is a large change");
  console.log("✓ change between frames tracks a cut");
}

/* -------------------------------- geometry --------------------------------- */

{
  const wide = boxFor("lower-third");
  const corner = boxFor("top-right");
  assert(wide.w > corner.w, "a lower third spans more width than a corner");
  assert(wide.y > 0.5 && wide.y < 0.8, "a lower third sits in the lower third");
  assert(corner.x + corner.w <= 1.001, "a corner box stays inside the frame");

  // A vertical frame penalises the corners, because in 9:16 they are not
  // corners — a half-width box is most of the picture.
  const image = paint().fill(40, 40, 40).done();
  const landscape = readFrame(image, 0, { aspect: 16 / 9 });
  const vertical = readFrame(image, 0, { aspect: 9 / 16 });
  const cornerL = landscape.zones.find((z) => z.position === "top-right")!;
  const cornerV = vertical.zones.find((z) => z.position === "top-right")!;
  assert(cornerV.score < cornerL.score, "corners are worth less in a vertical frame");
  console.log("✓ named boxes and the vertical penalty");
}

/* ------------------------------- description ------------------------------- */

{
  const frames: FrameRead[] = [];
  let previous: FrameRead | null = null;
  for (let i = 0; i < 4; i += 1) {
    // The person walks from left to right across the four frames, which is the
    // case a single "best position" would get wrong.
    const image = paint()
      .fill(40, 44, 56)
      .rect(0.08 + i * 0.2, 0.22, 0.26, 0.6, SKIN[0], SKIN[1], SKIN[2])
      .done();
    const r = read(image, i * 3, previous);
    previous = r;
    frames.push(r);
  }

  const one = describeFrame(frames[0]);
  assert(one.includes("subject at"), "a frame description names where the subject is");
  assert(
    one.includes("TYPE GOES HERE") || one.includes("NOWHERE IS CLEAN"),
    "and always answers where type can go"
  );

  const all = describeVision(frames.map(toWire), 16 / 9);
  assert(all.includes("ACROSS THE WHOLE CUT"), "the survey has a summary");
  assert(
    all.includes("Positions that stay safe"),
    "which names the positions that hold up across every frame"
  );
  assert(
    /0\.0s —/.test(all) && /9\.0s —/.test(all),
    "and lists every sampled moment"
  );
  // The whole point of judging on the worst frame: nowhere the person walks
  // through may be recommended as safe throughout.
  const walked = all.split("Positions that stay safe all the way through:")[1] ?? "";
  assert(walked.length > 0, "the reliable-position line is present");
  console.log("✓ descriptions say the things the prompt promises");
}

/* --------------------------------- lookups --------------------------------- */

{
  const reads = [0, 5, 10, 15].map((at) =>
    read(paint().fill(50, 50, 50).done(), at)
  );
  assert(readNearest(reads, 11)!.at === 10, "the nearest read is found");
  assert(readNearest(reads, 100)!.at === 15, "past the end returns the last");
  assert(readNearest([], 3) === null, "an empty survey has no nearest");

  const wire = toWire(reads[0]);
  assert(!("luma" in wire), "the per-cell grids do not cross the wire");
  assert(wire.zones.length > 0, "but the derived zones do");
  console.log("✓ lookups and the wire format");
}

/* ------------------------------ pure ranking -------------------------------- */

{
  // rankZones on its own, so a caller can score a hypothetical frame.
  const flat = new Array(36).fill(0.5);
  const clean = rankZones(
    { luma: flat, detail: new Array(36).fill(0), skin: new Array(36).fill(0) },
    16 / 9,
    null
  );
  const chaotic = rankZones(
    { luma: flat, detail: new Array(36).fill(0.9), skin: new Array(36).fill(0) },
    16 / 9,
    null
  );
  assert(clean[0].score > chaotic[0].score, "detail lowers every score");
  assert(clean.length === chaotic.length, "the same positions are always ranked");
  console.log("✓ rankZones stands alone");
}

console.log("\nvision: all checks passed");
