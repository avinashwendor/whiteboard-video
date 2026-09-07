"use client";

/**
 * Letting the agent see the footage.
 *
 * Every tool it has reads *text* — the transcript, the element list, the
 * analysis numbers. It has never seen a frame of the video it is editing. So it
 * cannot know that the speaker is off to the left of frame, that the background
 * is busy where a caption is about to go, that the shot is already tight, or
 * that there is a whiteboard behind them worth pointing at. It has been editing
 * by description, which is why its plans read as competent and generic.
 *
 * The obvious design — a `look(t)` tool the agent calls when it wants one —
 * does not work here, and the reason is structural rather than incidental: the
 * loop runs on the server and the footage is in the browser, so a tool call
 * would have to suspend the loop, round-trip to the client, and resume. Every
 * other tool answers from the request payload precisely so that it cannot.
 *
 * So the frames are attached up front instead. A few, small, sampled across the
 * cut. It is less clever than a tool and it costs tokens on every request, but
 * it turns "has never seen the video" into "has seen the video", which is the
 * whole of the difference.
 */

import type { OutputTimeline } from "./timeline";
import { outputToOriginal } from "./timeline";
import { paintFrame } from "./frame";
import { subtitleBand } from "./layout";
import { preloadComposition } from "./render";
import { ensureTypefaces } from "./fonts";
import {
  readFrame,
  SAMPLE_EDGE,
  toWire,
  type FrameRead,
  type WireFrameRead,
} from "./vision";
import {
  DEFAULT_FRAME,
  frameRatio,
  outputSize,
  type Composition,
} from "./types";

/** One frame, as the model will receive it. */
export interface Glance {
  /** Output-clock second it was taken at. */
  at: number;
  /** JPEG data URL. */
  dataUrl: string;
}

/**
 * What one pass over the footage produces.
 *
 * Two things, from one decode. `glances` are the pictures — a few, small, for
 * the model's eyes. `vision` is the measurement of many more frames than that:
 * where the subject is, how busy the background is, and which named positions
 * will actually carry type. Seeking is by far the expensive part of this, so
 * measuring during the same pass costs a `drawImage` and a `getImageData` per
 * frame and nothing else.
 *
 * The split matters because the two answer different questions. A picture tells
 * the model *what this video is*; the numbers tell it *where the caption goes*,
 * and only one of those can be got right by looking at a 384px thumbnail.
 */
export interface Survey {
  glances: Glance[];
  vision: WireFrameRead[];
}

/**
 * How many frames go up.
 *
 * Three. Enough to show the shot, whether it changes, and how it ends; few
 * enough that the cost is a rounding error against a transcript. Each one is
 * charged at roughly 800 tokens, so this is ~2.4k on a request that routinely
 * carries 10k of brief.
 */
const FRAMES = 3;

/**
 * How many frames get *measured*.
 *
 * Far more than are shown, because a measurement is a hundred bytes of JSON
 * rather than 800 tokens of image. Twelve is enough to catch a shot that
 * changes halfway — which is the case where a single caption position is right
 * for the first half of a video and lands on someone's face in the second.
 */
const MEASURED = 12;

/**
 * Longest edge, in pixels.
 *
 * Small on purpose. What the model needs from these is the composition — where
 * the person is, how tight the shot is, what the background is doing — and none
 * of that needs resolution. A larger frame costs more and answers the same
 * questions.
 */
const EDGE = 384;

/** JPEG quality. Low enough to be cheap, high enough to read a room. */
const QUALITY = 0.6;

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    // A seek that never lands must not wedge a request. A missing frame
    // degrades to the agent being as blind as it was before, which is
    // survivable; a plan that never arrives is not.
    const timer = setTimeout(done, 2_000);

    // rVFC fires once the frame is actually presented. `seeked` can resolve
    // while the previous frame is still what `drawImage` would copy — the same
    // trap `useFreezeFrames` documents, and the same fix.
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => done());
    } else {
      video.addEventListener("seeked", done, { once: true });
    }
    video.currentTime = t;
  });
}

/**
 * Where to sample.
 *
 * Inside the kept material, spread across it, and never at the very edges: the
 * first and last frames of a cut are disproportionately likely to be a blink, a
 * hand reaching for the keyboard, or black.
 */
export function glanceTimes(duration: number, count = FRAMES): number[] {
  if (duration <= 0) return [];
  if (duration < 2) return [duration / 2];
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(((i + 1) * duration) / (count + 1));
  }
  return out;
}


/* --------------------------------- decoding -------------------------------- */

/**
 * Decoded source frames, kept between requests.
 *
 * Seeking is essentially the entire cost of looking at the footage — a dozen
 * seeks on a long recording is a second or two before the request has even been
 * sent — and the painting on top of them is milliseconds. So the seeks are what
 * gets cached.
 *
 * This is keyed on the **source** time, which is what makes it worth having.
 * Most turns in a conversation with the agent do not move a cut: "make that
 * bigger", "try it in yellow", "put it at the top" all leave the cut exactly
 * where it was, so every output time maps to the same source time and every
 * frame is already here. The composition is re-painted over them each time, so
 * a cached frame never shows a stale caption — only stale *footage*, and the
 * footage does not change.
 *
 * Bounded, because these are decoded bitmaps and a long session would otherwise
 * accumulate them until the tab is killed for it.
 */
const MAX_CACHED_FRAMES = 40;
const decoded = new Map<string, ImageBitmap>();

function cacheKey(mediaUrl: string, sourceTime: number): string {
  // Two decimal places: a seek lands on the nearest keyframe-ish position
  // anyway, and asking for 12.001s twice should not decode twice.
  return `${mediaUrl}@${sourceTime.toFixed(2)}`;
}

function remember(key: string, bitmap: ImageBitmap) {
  decoded.set(key, bitmap);
  while (decoded.size > MAX_CACHED_FRAMES) {
    const oldest = decoded.keys().next().value;
    if (oldest === undefined) break;
    decoded.get(oldest)?.close();
    decoded.delete(oldest);
  }
}

/**
 * The source frame at that second, seeking only if it is not already here.
 *
 * Returns the `<video>` itself when the browser has no `createImageBitmap` —
 * every caller draws whatever comes back through `paintFrame`, and a video
 * element positioned at the right time is as drawable as a bitmap. It is just
 * not cacheable, so that path is exactly the old behaviour.
 */
async function frameAt(
  video: HTMLVideoElement,
  mediaUrl: string,
  sourceTime: number
): Promise<CanvasImageSource> {
  const key = cacheKey(mediaUrl, sourceTime);
  const cached = decoded.get(key);
  if (cached) {
    // Re-insert so the bound above evicts least-recently-used rather than
    // oldest-decoded; during a conversation the same frames are wanted again
    // and again, and evicting those first would defeat the whole thing.
    decoded.delete(key);
    decoded.set(key, cached);
    return cached;
  }

  await seek(video, sourceTime);
  if (typeof createImageBitmap !== "function") return video;
  try {
    const bitmap = await createImageBitmap(video);
    remember(key, bitmap);
    return bitmap;
  } catch {
    // A frame that will not decode into a bitmap still draws from the element.
    return video;
  }
}

/**
 * Throw away the decoded frames.
 *
 * Called when the media changes, because the key includes the URL but a blob
 * URL can be reused for different bytes across a project switch — and a stale
 * frame there would be a picture of somebody else's video.
 */
export function forgetFrames() {
  for (const bitmap of decoded.values()) bitmap.close();
  decoded.clear();
}

/* --------------------------------- survey ---------------------------------- */

/**
 * Look at the cut, and measure it, in one pass.
 *
 * One seek, two answers. The same frame that becomes a JPEG for the model's
 * eyes is also painted into a 96×96 buffer and reduced to numbers, and four
 * times as many frames get the second treatment as get the first — seeking is
 * the expensive part, and a measurement costs a `drawImage` on top of a seek
 * that has already happened.
 *
 * Painting through `paintFrame` rather than drawing the video straight is the
 * part that makes the numbers usable: it applies the crop, the zoom, the focus
 * point, the shots and the grade, so a position is scored against the frame the
 * person will watch. A vertical cut of a landscape recording measured on the
 * landscape would answer for pixels that are not in the video.
 *
 * The composition's own elements are painted too — deliberately. Type that is
 * already on screen is part of what the next caption has to avoid, and the
 * detail map sees a caption exactly as it sees a bookshelf.
 *
 * Never throws. Every failure path returns fewer frames, or none, and an agent
 * with no survey is as well informed as it was before this existed.
 */
export async function surveyFootage(
  mediaUrl: string,
  timeline: OutputTimeline,
  composition: Composition,
  options: {
    shown?: number;
    measured?: number;
    /**
     * Measure and photograph exactly these output seconds, instead of an even
     * spread. The review pass uses it to look at the moments the edit touched.
     */
    at?: number[];
    /**
     * Burn the composition into the pictures.
     *
     * Off for planning — the model is being asked where to put something, and
     * a picture of the frame it is about to change is the wrong reference. On
     * for review, where the whole question is what the finished thing looks
     * like.
     *
     * The measurement is taken on the CLEAN frame either way, which is the
     * point of separating them: at review time the useful number is not "how
     * busy is the finished frame" — the caption is what made it busy — it is
     * "what was behind that caption", which is the thing that decides whether
     * anybody can read it.
     */
    composited?: boolean;
    /** Longest edge for the pictures. Review wants more than planning does. */
    edge?: number;
    quality?: number;
  } = {}
): Promise<Survey> {
  const empty: Survey = { glances: [], vision: [] };
  if (typeof document === "undefined" || !mediaUrl) return empty;

  const shown = options.shown ?? FRAMES;
  const measured = Math.max(shown, options.measured ?? MEASURED);
  const times = options.at?.length
    ? options.at.filter((t) => t >= 0 && t < timeline.duration).sort((a, b) => a - b)
    : glanceTimes(timeline.duration, measured);
  if (times.length === 0) return empty;

  // With explicit times, every one of them is worth a picture: they were
  // chosen because something happens there.
  const showEvery = !!options.at?.length;

  // Which of the measured times also get photographed: spread across the run,
  // never the first few, so the pictures still show the arc of the video.
  const showAt = new Set<number>();
  if (showEvery) {
    for (let i = 0; i < times.length; i += 1) showAt.add(i);
  } else {
    for (let i = 0; i < Math.min(shown, times.length); i += 1) {
      showAt.add(Math.floor(((i + 0.5) * times.length) / Math.min(shown, times.length)));
    }
  }

  const video = document.createElement("video");
  video.src = mediaUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const glances: Glance[] = [];
  const vision: WireFrameRead[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("metadata timeout")), 5_000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("could not open the media"));
      };
    });
    if (!video.videoWidth) return empty;

    const frame = composition.frame ?? DEFAULT_FRAME;
    const sourceAspect = video.videoWidth / video.videoHeight;
    const ratio = frameRatio(frame, sourceAspect);

    // The picture the model is shown, at the output's shape.
    const shot = outputSize(
      ratio,
      video.videoWidth,
      video.videoHeight,
      options.edge ?? EDGE
    );
    const shotCanvas = document.createElement("canvas");
    shotCanvas.width = shot.width;
    shotCanvas.height = shot.height;
    const shotCtx = shotCanvas.getContext("2d");

    // The buffer the numbers come from. Square whatever the aspect, because
    // the statistics are per-region fractions and do not care about pixel
    // shape; `readFrame` is told the real ratio separately.
    const gridCanvas = document.createElement("canvas");
    gridCanvas.width = SAMPLE_EDGE;
    gridCanvas.height = SAMPLE_EDGE;
    const gridCtx = gridCanvas.getContext("2d", { willReadFrequently: true });
    if (!shotCtx || !gridCtx) return empty;

    // An element that has not decoded paints as nothing, and the detail map
    // would then report clear frame where a picture is about to sit.
    // Images and type both: a face the canvas has not been asked to load
    // draws in the fallback, silently, and the file ships that way.
    await Promise.all([preloadComposition(composition), ensureTypefaces()]);

    const band = composition.subtitles?.enabled
      ? subtitleBand(composition.subtitles.style, ratio)
      : null;

    /**
     * The composition, emptied of everything that sits on top of the picture.
     *
     * Used for the measurement pass. The crop, the shots and the grade stay —
     * they are the frame — while the elements and the captions come off, so
     * what is measured is what is *behind* the type rather than the type
     * itself. Without this the busiest region of a captioned frame is the
     * caption, and the survey would confidently report that the one place a
     * caption already works is the one place type cannot go.
     */
    const clean: Composition = {
      ...composition,
      elements: [],
      subtitles: { ...composition.subtitles, enabled: false },
    };

    let previous: FrameRead | null = null;

    for (let i = 0; i < times.length; i += 1) {
      const at = times[i];
      // Mapped back through the cut, so nothing is measured on material the
      // person has deleted.
      const source = outputToOriginal(at, timeline.keepRanges);
      if (!Number.isFinite(source)) continue;

      const sources = { live: await frameAt(video, mediaUrl, source), freeze: null };
      try {
        gridCtx.clearRect(0, 0, SAMPLE_EDGE, SAMPLE_EDGE);
        paintFrame(
          gridCtx,
          { width: SAMPLE_EDGE, height: SAMPLE_EDGE },
          sources,
          null,
          clean,
          at
        );
        const read = readFrame(
          gridCtx.getImageData(0, 0, SAMPLE_EDGE, SAMPLE_EDGE),
          at,
          { aspect: ratio, subtitleBand: band ? { from: band.y, to: band.y + band.h } : null, previous }
        );
        previous = read;
        vision.push(toWire(read));
      } catch {
        // Canvas2D throws on non-finite geometry. One frame that will not
        // composite costs one measurement, not the survey.
      }

      if (!showAt.has(i)) continue;
      try {
        shotCtx.clearRect(0, 0, shot.width, shot.height);
        paintFrame(shotCtx, shot, sources, null, options.composited ? composition : clean, at);
        glances.push({
          at,
          dataUrl: shotCanvas.toDataURL("image/jpeg", options.quality ?? QUALITY),
        });
      } catch {
        // As above: no picture at this moment, and the numbers still stand.
      }
    }
  } catch {
    // Fewer frames, or none.
  } finally {
    video.src = "";
    video.removeAttribute("src");
    video.load();
  }

  return { glances, vision };
}

/* --------------------------------- review ---------------------------------- */

/**
 * Review, which is the same pass asked a different question.
 *
 * Two things change and only two. The pictures carry the composition burned in,
 * because the whole point is to look at what ships. And they are bigger —
 * legibility is exactly the property a 384px thumbnail destroys, so judging it
 * from one would be judging a different video.
 *
 * The measurement stays on the clean frame, which is the part worth spelling
 * out: at review time the useful number is not how busy the finished frame is,
 * since the caption is what made it busy. It is what was *behind* the caption,
 * which is what decides whether anyone can read it.
 */
const REVIEW_HEIGHT = 540;
const REVIEW_QUALITY = 0.72;

export function surveyForReview(
  mediaUrl: string,
  timeline: OutputTimeline,
  composition: Composition,
  at: number[]
): Promise<Survey> {
  return surveyFootage(mediaUrl, timeline, composition, {
    at,
    composited: true,
    edge: REVIEW_HEIGHT,
    quality: REVIEW_QUALITY,
  });
}

/**
 * When to look.
 *
 * At the moments the edit actually touched, not spread evenly: a review exists
 * to check the work that was just done, and a frame from a stretch nothing
 * happened to is a frame spent on nothing. Falls back to an even spread when
 * the plan carried no times — a whole-video grade, for instance, changes every
 * frame and names none of them.
 */
export function reviewTimes(ops: { start?: number; at?: number }[], duration: number, limit = 3): number[] {
  const named = ops
    .map((op) => (typeof op.start === "number" ? op.start : op.at))
    .filter((t): t is number => typeof t === "number" && t >= 0 && t < duration)
    // Half a second in, so a caption's own entrance has finished and it is
    // judged settled rather than mid-animation.
    .map((t) => Math.min(duration - 0.05, t + 0.5))
    .sort((a, b) => a - b);

  if (named.length === 0) return glanceTimes(duration, limit);

  // Spread across what was touched rather than taking the first few, which
  // would review the opening of the video three times.
  const out: number[] = [];
  for (let i = 0; i < Math.min(limit, named.length); i += 1) {
    out.push(named[Math.floor((i * named.length) / Math.min(limit, named.length))]);
  }
  return [...new Set(out)];
}
