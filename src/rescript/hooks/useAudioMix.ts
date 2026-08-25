"use client";

/**
 * Hearing the music while you edit.
 *
 * The export mixes with ffmpeg. That is the file, and it is correct, and it is
 * also useless for editing — nobody places a music cue by rendering the video.
 * So the preview mixes the same clips a second time, live, with Web Audio.
 *
 * Two implementations of one thing is normally a smell, and it would be here
 * too if they disagreed. They cannot disagree about *what* is played, because
 * both read the same `AudioClip[]` and the same `gainAt`. They differ only in
 * how the sound is produced, which is the one part that genuinely has to differ:
 * ffmpeg builds a filter graph offline, and a preview has to start playing from
 * the middle of a track a hundred milliseconds after someone drags the playhead.
 *
 * ## The clock
 *
 * The `<video>` element is the clock, for the same reason it is everywhere else
 * in this editor: it owns the audio you are cutting, it is what the transcript
 * is timed against, and anything that keeps its own time drifts from it. So
 * every clip is scheduled against `video.currentTime` and re-synced whenever
 * that jumps.
 */

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/rescript/lib/store";
import { useOverlayStore } from "@/rescript/lib/overlay/store";
import { audibleClips, gainAt, DUCK_DEPTH, type AudioClip } from "@/rescript/lib/overlay/audio";
import type { OutputTimeline } from "@/rescript/lib/overlay/timeline";
import { originalToEdited } from "@/rescript/lib/edits";
import { getCutRanges } from "@/rescript/lib/edits";

/** Past this, the playhead has been moved rather than having advanced. */
const RESYNC_S = 0.35;

/** How often the gains are re-evaluated. 20Hz is inaudible and cheap. */
const TICK_MS = 50;

interface Voice {
  clip: AudioClip;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
}

/**
 * Decoded audio, kept across playhead moves.
 *
 * Decoding a three-minute MP3 takes a noticeable moment, and a scrub must not
 * pay for it — so buffers are cached by URL and only the source nodes, which
 * are single-use by design, are rebuilt.
 */
const buffers = new Map<string, AudioBuffer>();

async function decode(ctx: AudioContext, src: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(src);
  if (cached) return cached;
  try {
    const res = await fetch(src);
    const bytes = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    buffers.set(src, buffer);
    return buffer;
  } catch {
    // A clip that will not decode is silent in the preview and still exported;
    // ffmpeg reads formats the browser will not. Failing the whole mix over one
    // of them would be worse than the gap.
    return null;
  }
}

export function useAudioMix(timeline: OutputTimeline) {
  const clips = useOverlayStore((s) => s.audio);
  const mediaUrl = useEditorStore((s) => s.mediaUrl);
  const ctxRef = useRef<AudioContext | null>(null);
  const voicesRef = useRef<Map<string, Voice>>(new Map());
  const lastTimeRef = useRef(0);

  useEffect(() => {
    const audible = audibleClips(clips);
    if (audible.length === 0 || !mediaUrl) {
      // Nothing to play: tear the graph down rather than leaving a context
      // running. An AudioContext holds a hardware audio unit open, and a
      // suspended-but-alive one is a battery cost with no sound to show for it.
      for (const voice of voicesRef.current.values()) {
        try {
          voice.source?.stop();
        } catch {
          /* already stopped */
        }
      }
      voicesRef.current.clear();
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      return;
    }

    // Created lazily and on the first effect after a clip exists, which is
    // itself downstream of a click — browsers refuse to start one otherwise,
    // and a context created at mount is a context that starts suspended and
    // never plays anything.
    const ctx =
      ctxRef.current ??
      new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();
    ctxRef.current = ctx;

    let alive = true;
    const voices = voicesRef.current;

    /** Stop and forget a voice. Sources cannot be restarted. */
    const stop = (id: string) => {
      const voice = voices.get(id);
      if (!voice) return;
      try {
        voice.source?.stop();
      } catch {
        /* already stopped */
      }
      voice.source?.disconnect();
      voice.gain.disconnect();
      voices.delete(id);
    };

    /**
     * Start `clip` from wherever the playhead currently is inside it.
     *
     * The offset is the whole point: dropping the playhead into the middle of a
     * bed has to continue the bed, not restart it.
     */
    const start = async (clip: AudioClip, outputTime: number) => {
      const buffer = await decode(ctx, clip.src);
      if (!alive || !buffer) return;
      if (voices.has(clip.id)) return;

      const into = outputTime - clip.start;
      if (into < 0 || outputTime >= clip.end) return;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = clip.loop;
      if (clip.loop) {
        source.loopStart = clip.trimIn;
        source.loopEnd = Math.min(buffer.duration, clip.trimIn + (clip.end - clip.start));
      }
      source.connect(gain);

      const offset = clip.trimIn + into;
      // A clip trimmed past the end of its own file has nothing to play. Better
      // silent than a source that throws and takes the tick with it.
      if (offset >= buffer.duration && !clip.loop) return;
      try {
        source.start(0, clip.loop ? clip.trimIn + (into % Math.max(0.01, buffer.duration - clip.trimIn)) : offset);
      } catch {
        return;
      }
      voices.set(clip.id, { clip, source, gain });
    };

    /**
     * Ducking, in the preview.
     *
     * The export uses a sidechain compressor keyed off the voice, which is what
     * a mixer does and cannot be reproduced here without routing the `<video>`
     * through the graph — which would mean taking over playback of the audio
     * being edited, and that is not worth the risk of desyncing it.
     *
     * So the preview approximates: it ducks when a word is being spoken *now*,
     * read from the transcript. That is a worse rule than listening — it is
     * deaf to anything the transcript missed — and it is the right trade for a
     * preview, whose job is to tell you whether the bed is roughly the right
     * level, not to be the master.
     */
    const speakingAt = (outputTime: number): boolean => {
      const editor = useEditorStore.getState();
      const cuts = getCutRanges(editor.words, editor.duration, editor.manualCuts);
      return editor.words.some((word) => {
        if (word.deleted) return false;
        const start = originalToEdited(word.start, cuts);
        const end = originalToEdited(word.end, cuts);
        return outputTime >= start - 0.15 && outputTime <= end + 0.35;
      });
    };

    const tick = () => {
      if (!alive) return;
      const video = useEditorStore.getState().videoEl;
      const cuts = getCutRanges(
        useEditorStore.getState().words,
        useEditorStore.getState().duration,
        useEditorStore.getState().manualCuts
      );
      const outputTime = originalToEdited(
        video?.currentTime ?? useEditorStore.getState().currentTime,
        cuts
      );
      const playing = Boolean(video && !video.paused && !video.ended);

      // A jump means the playhead was moved, so anything running is now playing
      // from the wrong place and has to be restarted at the new offset.
      const jumped = Math.abs(outputTime - lastTimeRef.current) > RESYNC_S;
      lastTimeRef.current = outputTime;
      if (jumped) {
        for (const id of [...voices.keys()]) stop(id);
      }

      const ducking = speakingAt(outputTime) ? DUCK_DEPTH : 1;

      for (const clip of audible) {
        const inside = outputTime >= clip.start && outputTime < clip.end;
        if (!inside || !playing) {
          stop(clip.id);
          continue;
        }
        if (!voices.has(clip.id)) {
          void start(clip, outputTime);
          continue;
        }
        const voice = voices.get(clip.id);
        if (!voice) continue;
        const target = gainAt(clip, outputTime) * (clip.duck ? ducking : 1);
        // Ramped rather than set: an instant gain change is a click, and a
        // click on every duck is worse than no ducking at all.
        voice.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
      }
    };

    const timer = setInterval(tick, TICK_MS);
    tick();

    return () => {
      alive = false;
      clearInterval(timer);
      for (const id of [...voices.keys()]) stop(id);
    };
  }, [clips, mediaUrl, timeline]);

  // Close the context for good when the editor goes away, rather than leaving
  // a hardware audio unit open behind a closed project.
  useEffect(
    () => () => {
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    },
    []
  );
}
