"use client";

import { useCallback, useEffect, useRef } from "react";
import { useEditorStore } from "@/motionscript/lib/store";
import { cutRangeAt, PLAYHEAD_EPSILON_S } from "@/motionscript/lib/edits";
import { useCutRanges } from "@/motionscript/hooks/useCutRanges";
import type { TimeRange } from "@/motionscript/lib/types";
import OverlayStage from "./overlay/OverlayStage";

/**
 * Owns the media elements and the cut-skipping playback loop.
 *
 * There are two of them, and that is the whole point of this file.
 *
 * A transcript editor plays the kept ranges back to back, so every deleted word
 * is a jump the playhead has to make while the video is running. Done the
 * obvious way — `media.currentTime = cut.end` — the browser stalls: it throws
 * away the decode pipeline, seeks, and starts again, and for 100–300ms the
 * picture is frozen on the outgoing frame and the audio is silent. That stall
 * is not in the timeline, so it survives every attempt to remove it. Delete one
 * word and you hear a hole where the word was; ask the editor to close the gap
 * and it correctly reports there is no gap to close, because there isn't one —
 * the hole is the seek.
 *
 * So the seek happens somewhere nobody is listening. Two elements share the
 * source: one is live, the other is parked ahead of the next cut, already
 * decoded and already rolling by the time the boundary arrives. Crossing it is
 * then a mute and a pointer swap — no seek, no stall, no hole.
 *
 * `videoEl` in the store is whichever one is live, so the canvas that paints
 * the preview and the mixer that ducks against it both follow the swap without
 * knowing it happened.
 *
 * Everything here degrades to the old behaviour: if the standby has not
 * finished seeking, or the clip was too short to roll it in time, the boundary
 * falls back to seeking in place. A stall is the worst case, not the only case.
 */

/** Start decoding the incoming clip this long before the boundary. */
const PREROLL_S = 1.2;
/** And have it actually rolling this long before, so play() latency is spent early. */
const LEAD_S = 0.45;
/**
 * Park the standby fractionally *past* where the arithmetic says, so that when
 * `play()` costs a few frames to spin up the swap lands just inside the
 * incoming clip rather than just inside the cut. Erring the other way would
 * replay the last sliver of the words that were deleted, which is the one
 * artefact a viewer would recognise as a bug.
 */
const SAFETY_S = 0.05;
/** A jump larger than this is a scrub, not playback, and invalidates the preroll. */
const SCRUB_S = 0.5;

/** The first cut starting after `t`, if any. */
function nextCutAfter(t: number, cuts: TimeRange[]): TimeRange | null {
  let best: TimeRange | null = null;
  for (const cut of cuts) {
    if (cut.start <= t) continue;
    if (!best || cut.start < best.start) best = cut;
  }
  return best;
}

interface Preroll {
  /** The cut this standby is being prepared for. */
  cut: TimeRange;
  /** Seek issued and landed. */
  ready: boolean;
  /** `play()` called. */
  rolling: boolean;
}

export default function MediaPreview() {
  const mediaUrl = useEditorStore((s) => s.mediaUrl);
  const mediaKind = useEditorStore((s) => s.mediaKind);
  const setVideoEl = useEditorStore((s) => s.setVideoEl);
  const setDuration = useEditorStore((s) => s.setDuration);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const cuts = useCutRanges();

  const pair = useRef<[HTMLMediaElement | null, HTMLMediaElement | null]>([null, null]);
  const liveIndex = useRef<0 | 1>(0);
  const preroll = useRef<Preroll | null>(null);
  const lastTime = useRef(0);
  const isAudio = mediaKind === "audio";

  const cutsRef = useRef(cuts);
  useEffect(() => {
    cutsRef.current = cuts;
  }, [cuts]);

  // A new file gets a fresh pair of elements, so the live slot has to go back
  // to the one React attaches first — otherwise the store is handed a decoder
  // that nothing is driving.
  useEffect(() => {
    liveIndex.current = 0;
    preroll.current = null;
    lastTime.current = 0;
  }, [mediaUrl]);

  // A re-cut moves every boundary, so anything prepared for the old one is
  // parked in the wrong place.
  useEffect(() => {
    const standby = pair.current[liveIndex.current === 0 ? 1 : 0];
    standby?.pause();
    preroll.current = null;
  }, [cuts]);

  // One stable callback per slot. A factory taking the slot as an argument
  // would hand React a fresh function every render, and React answers a changed
  // ref callback by calling the old one with null and the new one with the
  // element — here that is setVideoEl(null) then setVideoEl(el): a store write
  // per render, and a render per store write.
  const attach0 = useCallback(
    (el: HTMLMediaElement | null) => {
      pair.current[0] = el;
      if (el) el.muted = liveIndex.current !== 0;
      if (liveIndex.current === 0) setVideoEl(el);
    },
    [setVideoEl]
  );
  const attach1 = useCallback(
    (el: HTMLMediaElement | null) => {
      pair.current[1] = el;
      if (el) el.muted = liveIndex.current !== 1;
      if (liveIndex.current === 1) setVideoEl(el);
    },
    [setVideoEl]
  );

  /** Playback state belongs to the live element; the standby runs silently. */
  const isLive = useCallback(
    (el: EventTarget | null) => el === pair.current[liveIndex.current],
    []
  );

  useEffect(() => {
    let raf = 0;

    const release = () => {
      const standby = pair.current[liveIndex.current === 0 ? 1 : 0];
      if (standby && !standby.paused) standby.pause();
      preroll.current = null;
    };

    /** Hand the boundary to the element that is already past it. */
    const swap = (standby: HTMLMediaElement, live: HTMLMediaElement) => {
      standby.muted = live.muted;
      live.muted = true;
      live.pause();
      liveIndex.current = liveIndex.current === 0 ? 1 : 0;
      preroll.current = null;
      setVideoEl(standby);
      return standby.currentTime;
    };

    const tick = () => {
      const live = pair.current[liveIndex.current];
      const standby = pair.current[liveIndex.current === 0 ? 1 : 0];
      if (live) {
        let t = live.currentTime;

        if (!live.paused) {
          // A scrub landed the playhead somewhere unrelated to what was
          // prepared. Cheaper to throw the preroll away than to reason about it.
          if (Math.abs(t - lastTime.current) > SCRUB_S) release();

          const list = cutsRef.current;
          const inside = cutRangeAt(t, list);

          if (inside) {
            const prepared =
              preroll.current &&
              Math.abs(preroll.current.cut.end - inside.end) < 1e-3 &&
              preroll.current.rolling;
            if (
              prepared &&
              standby &&
              !standby.paused &&
              standby.currentTime >= inside.end - 1e-3
            ) {
              t = swap(standby, live);
            } else {
              // Nothing ready: the old way, stall and all.
              const target = inside.end + PLAYHEAD_EPSILON_S;
              if (target >= live.duration - 0.05) {
                live.pause();
                live.currentTime = inside.start;
                t = inside.start;
              } else {
                live.currentTime = target;
                t = target;
              }
              release();
            }
          } else if (standby) {
            const next = nextCutAfter(t, list);
            // Nothing to prepare for a cut that runs to the end of the media —
            // there is no incoming clip, and playback stops there.
            const worth =
              next && next.start - t <= PREROLL_S && next.end < live.duration - 0.05;

            if (!worth) {
              if (preroll.current) release();
            } else {
              const current = preroll.current;
              if (!current || Math.abs(current.cut.end - next.end) > 1e-3) {
                preroll.current = { cut: next, ready: false, rolling: false };
                standby.pause();
                standby.muted = true;
                if (standby.readyState >= 1) {
                  standby.currentTime = Math.max(
                    0,
                    Math.min(next.end - LEAD_S + SAFETY_S, live.duration - 0.05)
                  );
                  preroll.current.ready = true;
                }
              } else if (!current.ready && standby.readyState >= 1) {
                standby.currentTime = Math.max(
                  0,
                  Math.min(next.end - LEAD_S + SAFETY_S, live.duration - 0.05)
                );
                current.ready = true;
              } else if (
                current.ready &&
                !current.rolling &&
                !standby.seeking &&
                standby.readyState >= 3 &&
                next.start - t <= LEAD_S
              ) {
                current.rolling = true;
                void standby.play().catch(() => {
                  // Autoplay policy, or the element was swapped out from under
                  // this frame. Either way the boundary falls back to a seek.
                  preroll.current = null;
                });
              }
            }
          }
        } else if (preroll.current) {
          // Paused: nothing should be running behind the scenes.
          release();
        }

        lastTime.current = t;
        const prev = useEditorStore.getState().currentTime;
        if (Math.abs(prev - t) > 0.005) setCurrentTime(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      release();
    };
  }, [setCurrentTime, setVideoEl]);

  const togglePlay = useCallback(() => {
    useEditorStore.getState().togglePlayback();
  }, []);

  if (!mediaUrl) return null;

  const shared = {
    src: mediaUrl,
    preload: "auto" as const,
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      setDuration(e.currentTarget.duration),
    onPlay: (e: React.SyntheticEvent<HTMLMediaElement>) => {
      if (isLive(e.currentTarget)) setPlaying(true);
    },
    onPause: (e: React.SyntheticEvent<HTMLMediaElement>) => {
      if (isLive(e.currentTarget)) setPlaying(false);
    },
  };

  if (isAudio) {
    return (
      <>
        <audio ref={attach0} {...shared} className="hidden" />
        <audio ref={attach1} {...shared} className="hidden" />
      </>
    );
  }

  // The <video> still decodes and still drives playback and audio, but it is
  // not what you look at: OverlayStage paints every frame to a canvas on top,
  // through the same renderer the exporter uses. Keeping it at opacity 0 rather
  // than hiding it matters — a display:none or visibility:hidden video is free
  // to stop producing frames, and drawImage would then paint nothing. That goes
  // for the standby too: it has to be decoding before the swap, not after.
  //
  // It is also taken out of the layout entirely. While it sat in the flow the
  // stage could only ever be the shape of the footage, because the canvas was
  // measured off this element's box; the output frame is a property of the
  // project now, so the video is pinned behind the stage and its size is
  // nobody's business but the decoder's.
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-50/70 p-3 sm:p-4 dark:bg-zinc-950/70">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <video
          ref={attach0}
          {...shared}
          playsInline
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
        <video
          ref={attach1}
          {...shared}
          playsInline
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
        <OverlayStage onBackgroundClick={togglePlay} />
      </div>
    </div>
  );
}
