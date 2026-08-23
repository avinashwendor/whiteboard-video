"use client";

import { useEffect, useRef } from "react";
import type { OutputTimeline } from "@/rescript/lib/overlay/timeline";
import { familyOf } from "@/rescript/lib/overlay/timeline";
import type { Transition } from "@/rescript/lib/overlay/types";

/**
 * The held frames the push transitions are made of.
 *
 * A dissolve, a slide or a zoom-out shows the outgoing clip's last frame moving
 * away over the incoming one. The preview's `<video>` is already past that frame
 * by the time the transition plays — it jumped the cut — so the frame has to
 * have been captured beforehand.
 *
 * It is captured *deterministically*, by seeking a second, hidden video to the
 * out point and grabbing it. The obvious cheaper trick is to snapshot the main
 * video opportunistically whenever the playhead happens to pass through the last
 * fraction of a clip, but that only works if you play through the boundary at
 * least once: set a dissolve and scrub straight into it, or set one on a cut you
 * have not reached yet, and there is no frame — so the transition silently plays
 * as a hard cut, which is exactly the bug it looks like.
 *
 * The cache is keyed by the source time it was taken at, not by the boundary
 * index, so an edit that moves a cut invalidates the frame instead of showing
 * yesterday's footage under today's dissolve.
 */

export interface FreezeFrame {
  canvas: HTMLCanvasElement;
  /** Source-media second this was grabbed at. The cache key. */
  at: number;
}

/** How far before the out point to sample, so we land inside the clip. */
const BACK_OFF_S = 1 / 50;

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    // A seek that never lands must not wedge the capture loop for the rest of
    // the session; a missing freeze degrades to a hard cut, which is survivable.
    const timer = setTimeout(done, 2_000);

    // rVFC fires once the frame is actually presented. `seeked` can resolve
    // while the previous frame is still what `drawImage` would copy, which puts
    // the wrong picture under the dissolve.
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => done());
    } else {
      video.addEventListener("seeked", done, { once: true });
    }
    video.currentTime = t;
  });
}

export function useFreezeFrames(
  mediaUrl: string | null,
  timeline: OutputTimeline,
  transitions: Transition[]
) {
  const frames = useRef<Map<number, FreezeFrame>>(new Map());
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // One hidden decoder for the whole session, torn down with the media.
  useEffect(() => {
    frames.current.clear();
    if (!mediaUrl) {
      videoRef.current = null;
      return;
    }

    const video = document.createElement("video");
    video.src = mediaUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    videoRef.current = video;

    // Captured now rather than read through the ref at cleanup time: the ref
    // could point at a different map by then, and the one this effect filled is
    // the one that has to be emptied.
    const captured = frames.current;
    return () => {
      videoRef.current = null;
      video.removeAttribute("src");
      video.load();
      captured.clear();
    };
  }, [mediaUrl]);

  // Capture whatever the current set of push transitions needs. Re-runs when
  // the cut changes, which is also when a held frame can go stale.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const wanted = transitions
      .filter((t) => t.kind !== "none" && t.duration > 0 && familyOf(t.kind) === "push")
      .map((t) => timeline.boundaries.find((b) => b.index === t.index))
      .filter((b): b is NonNullable<typeof b> => Boolean(b));

    // Drop frames for boundaries that no longer take one, so the map cannot
    // grow for the life of the session.
    const keep = new Set(wanted.map((b) => b.index));
    for (const index of [...frames.current.keys()]) {
      if (!keep.has(index)) frames.current.delete(index);
    }

    const missing = wanted.filter((b) => {
      const held = frames.current.get(b.index);
      return !held || Math.abs(held.at - b.outgoingEnd) > 1e-3;
    });
    if (!missing.length) return;

    let cancelled = false;

    (async () => {
      // Metadata first: videoWidth is 0 until it lands, and a canvas sized from
      // zero captures nothing.
      if (!video.videoWidth) {
        await new Promise<void>((resolve) => {
          if (video.readyState >= 1) return resolve();
          const done = () => resolve();
          video.addEventListener("loadedmetadata", done, { once: true });
          setTimeout(done, 3_000);
        });
      }
      if (cancelled || !video.videoWidth) return;

      for (const boundary of missing) {
        if (cancelled) return;
        const at = Math.max(0, boundary.outgoingEnd - BACK_OFF_S);
        await seek(video, at);
        if (cancelled) return;

        const canvas =
          frames.current.get(boundary.index)?.canvas ??
          document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) continue;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Keyed on the out point, so this entry is self-invalidating.
        frames.current.set(boundary.index, { canvas, at: boundary.outgoingEnd });
      }
    })().catch(() => {
      // A capture that fails leaves the entry missing, and a missing entry is
      // already handled: the transition plays as a hard cut.
    });

    return () => {
      cancelled = true;
    };
  }, [timeline, transitions]);

  return frames;
}
