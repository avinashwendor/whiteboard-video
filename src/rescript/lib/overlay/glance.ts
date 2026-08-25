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
