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
import { preloadComposition } from "./render";
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
 * How many frames go up.
 *
 * Three. Enough to show the shot, whether it changes, and how it ends; few
 * enough that the cost is a rounding error against a transcript. Each one is
 * charged at roughly 800 tokens, so this is ~2.4k on a request that routinely
 * carries 10k of brief.
 */
const FRAMES = 3;

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

/**
 * Grab a few frames of the *cut*, as data URLs.
 *
 * Times are on the output clock and mapped back to source, so a glance never
 * lands on material the person has deleted — showing the agent a moment that is
 * not in the video any more is worse than showing it nothing.
 *
 * Never throws. Every failure path returns fewer frames, or none.
 */
export async function takeGlances(
  mediaUrl: string,
  timeline: OutputTimeline,
  count = FRAMES
): Promise<Glance[]> {
  if (typeof document === "undefined" || !mediaUrl) return [];
  const times = glanceTimes(timeline.duration, count);
  if (times.length === 0) return [];

  const video = document.createElement("video");
  video.src = mediaUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const glances: Glance[] = [];

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

    if (!video.videoWidth) return [];

    const scale = Math.min(1, EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];

    for (const at of times) {
      // Mapped back through the cut, so a glance never lands on material the
      // person deleted. Showing the agent a moment that is not in the video
      // any more is worse than showing it nothing.
      const source = outputToOriginal(at, timeline.keepRanges);
      if (!Number.isFinite(source)) continue;
      await seek(video, source);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      glances.push({ at, dataUrl: canvas.toDataURL("image/jpeg", QUALITY) });
    }
  } catch {
    // Fewer frames, or none. The agent is then exactly as blind as it was
    // before this existed, which is a worse plan and not a broken one.
  } finally {
    video.src = "";
    video.removeAttribute("src");
    video.load();
  }

  return glances;
}

/* --------------------------------- review ---------------------------------- */

/**
 * The same frames, with the composition burned into them.
 *
 * For the review pass. The agent has to be looking at **what ships** — the
 * captions where they actually land, the framing as it is actually cropped, the
 * look as it is actually graded — because every problem worth catching at this
 * stage is one that only exists once those are on. A review of the raw footage
 * would be a review of a video nobody is going to watch.
 *
 * `paintFrame` is the renderer the exporter uses, so this is not an
 * approximation of the output; it is the output, smaller.
 */
export async function takeReviewGlances(
  mediaUrl: string,
  timeline: OutputTimeline,
  composition: Composition,
  at: number[]
): Promise<Glance[]> {
  if (typeof document === "undefined" || !mediaUrl) return [];
  const times = at.filter((t) => t >= 0 && t < timeline.duration);
  if (times.length === 0) return [];

  const video = document.createElement("video");
  video.src = mediaUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const glances: Glance[] = [];

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
    if (!video.videoWidth) return [];

    // The output's shape, not the footage's — a vertical deliverable reviewed
    // as widescreen would be reviewed with the crop that matters left out.
    const sourceAspect = video.videoWidth / video.videoHeight;
    const ratio = frameRatio(composition.frame ?? DEFAULT_FRAME, sourceAspect);
    const size = outputSize(ratio, video.videoWidth, video.videoHeight, REVIEW_HEIGHT);

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];

    // Images have to be decoded before they can be composited, or an element
    // that is on screen at the reviewed moment silently renders as its
    // placeholder — and the agent reports a missing picture that is not missing.
    await preloadComposition(composition);

    for (const t of times) {
      const source = outputToOriginal(t, timeline.keepRanges);
      if (!Number.isFinite(source)) continue;
      await seek(video, source);
      ctx.clearRect(0, 0, size.width, size.height);
      try {
        paintFrame(ctx, size, { live: video, freeze: null }, null, composition, t);
      } catch {
        // Canvas2D throws on non-finite geometry. One frame that will not
        // composite is not worth losing the whole review over.
        continue;
      }
      glances.push({ at: t, dataUrl: canvas.toDataURL("image/jpeg", REVIEW_QUALITY) });
    }
  } catch {
    // Fewer frames, or none — in which case the review is skipped rather than
    // run against nothing.
  } finally {
    video.src = "";
    video.removeAttribute("src");
    video.load();
  }

  return glances;
}

/**
 * Bigger and better than a planning glance, because this is the pass that has
 * to judge whether type is *legible* — and legibility is exactly the thing a
 * 384px thumbnail destroys.
 */
const REVIEW_HEIGHT = 540;
const REVIEW_QUALITY = 0.72;

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
