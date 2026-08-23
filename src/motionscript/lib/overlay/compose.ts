"use client";

import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { getFFmpeg } from "../ffmpeg";
import { paintFrame } from "./frame";
import { preloadComposition } from "./render";
import {
  transitionAt,
  transitionWindows,
  type OutputTimeline,
} from "./timeline";
import { isEmptyComposition, type Composition } from "./types";

/**
 * Burns the composition into the cut.
 *
 * This runs *after* ffmpeg has produced the cut — so the file handed in already
 * has the right frames and the right audio, and its clock is the output clock.
 * That is what makes this tractable: the compositor asks the video for the
 * frame at second `t`, paints the same `paintFrame` the preview paints, and
 * encodes the result. No time mapping, no cut logic, no second definition of
 * what the composition looks like.
 *
 * The audio is never decoded or re-encoded. The composited video is muxed on
 * its own and then ffmpeg grafts the original audio track back with `-c copy`,
 * so the speech is bit-identical to what the cut produced. In a transcript
 * editor that matters more than anywhere else: re-encoding audio to draw a
 * caption on top of it would be a strange trade.
 */

export interface ComposeOptions {
  /** The cut video: already trimmed, with its audio. */
  source: Blob;
  composition: Composition;
  timeline: OutputTimeline;
  /** Output height. The width follows the source's aspect, rounded to even. */
  targetHeight?: number;
  fps?: number;
  /** True when the source has an audio track to graft back. */
  withAudio: boolean;
  onProgress?: (fraction: number, stage: string) => void;
  signal?: AbortSignal;
}

/** True when this browser can burn a composition in at all. */
export function canCompose(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.VideoEncoder === "function" &&
    typeof window.VideoFrame === "function"
  );
}

/** Nothing to burn in — the caller should ship ffmpeg's output untouched. */
export function needsCompositing(composition: Composition): boolean {
  return !isEmptyComposition(composition);
}

/** H.264 profile that this machine will actually accept, best first. */
async function pickCodec(
  width: number,
  height: number,
  fps: number,
  bitrate: number
): Promise<string | null> {
  for (const codec of ["avc1.640028", "avc1.4D0028", "avc1.42E01E"]) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
      });
      if (support.supported) return codec;
    } catch {
      // Unsupported strings throw rather than answering false.
    }
  }
  return null;
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.onloadeddata = () => resolve(video);
    video.onerror = () =>
      reject(new Error("The rendered video could not be opened for compositing."));
  });
}

/**
 * Park a video on the frame covering `t` and wait for it to be painted.
 *
 * `requestVideoFrameCallback` fires once the new frame is actually presented,
 * which `seeked` does not guarantee — seeking and drawing on `seeked` alone
 * reliably yields the *previous* frame on some builds, which shows up as
 * overlays landing one frame early. The `seeked` path is the fallback for
 * engines without rVFC, with a timeout so a refused seek cannot hang the export.
 */
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 2_000);

    // Checked at runtime, not by `in`: the DOM lib declares rVFC, so a type
    // narrowing here would compile away the fallback that older engines need.
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => done());
    } else {
      video.addEventListener("seeked", done, { once: true });
    }
    video.currentTime = t;
  });
}

/**
 * Yield without a timer. `setTimeout(0)` is clamped to about a second in a
 * background tab, which would turn a two-minute composite into an hour of
 * waiting; a MessageChannel task is not throttled.
 */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === "undefined") {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * Capture the outgoing clip's last frame for every push transition.
 *
 * Done up front, in one pass, because seeking backwards mid-render is what
 * makes a seek-driven export crawl — and because a held frame is by definition
 * the same for the whole transition.
 */
async function captureFreezeFrames(
  video: HTMLVideoElement,
  composition: Composition,
  timeline: OutputTimeline,
  width: number,
  height: number,
  fps: number
): Promise<Map<number, HTMLCanvasElement>> {
  const frames = new Map<number, HTMLCanvasElement>();
  const windows = transitionWindows(timeline, composition.transitions);

  for (const window of windows) {
    // Only the push family holds a frame; a dip needs nothing.
    const active = transitionAt(
      window.from + (window.to - window.from) / 2,
      timeline,
      composition.transitions
    );
    if (!active || active.family !== "push") continue;

    // One frame back from the boundary is the outgoing clip's last frame.
    const at = Math.max(0, window.boundary.outTime - 1 / fps);
    await seekTo(video, at);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(video, 0, 0, width, height);
    frames.set(window.boundary.index, canvas);
  }
  return frames;
}

export interface ComposeResult {
  blob: Blob;
  /** Frames actually encoded, for the caller's log. */
  frames: number;
}

export async function composeOverlays({
  source,
  composition,
  timeline,
  targetHeight,
  fps = 30,
  withAudio,
  onProgress,
  signal,
}: ComposeOptions): Promise<ComposeResult> {
  if (!canCompose()) {
    throw new Error(
      "This browser can't burn in overlays — it has no video encoder. Export without them, or try Chrome or Safari."
    );
  }

  const sourceUrl = URL.createObjectURL(source);
  let video: HTMLVideoElement | null = null;

  try {
    onProgress?.(0, "Opening the render");
    video = await loadVideo(sourceUrl);

    const nativeWidth = video.videoWidth;
    const nativeHeight = video.videoHeight;
    if (!nativeWidth || !nativeHeight) {
      throw new Error("The rendered video has no picture to composite onto.");
    }

    const height = even(targetHeight ?? nativeHeight);
    const width = even((nativeWidth / nativeHeight) * height);
    const duration = Number.isFinite(video.duration)
      ? video.duration
      : timeline.duration;
    const frameCount = Math.max(1, Math.round(duration * fps));

    // 0.11 bits per pixel per frame lands around 6 Mbps at 1080p30 — enough
    // that re-encoding footage to add a caption is not visibly a second
    // generation, without producing a file nobody can upload.
    const bitrate = Math.round(width * height * fps * 0.11);
    const codec = await pickCodec(width, height, fps, bitrate);
    if (!codec) {
      throw new Error("This browser has no usable H.264 encoder for that size.");
    }

    onProgress?.(0.02, "Loading pictures");
    await preloadComposition(composition);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not open a drawing surface.");

    onProgress?.(0.04, "Reading clip edges");
    const freezes = await captureFreezeFrames(
      video,
      composition,
      timeline,
      width,
      height,
      fps
    );

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: "avc", width, height, frameRate: fps },
      fastStart: "in-memory",
    });

    let encoderError: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (err) => {
        encoderError = err instanceof Error ? err : new Error(String(err));
      },
    });
    encoder.configure({
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      latencyMode: "quality",
    });

    const size = { width, height };
    // Two seconds between keyframes: standard for delivery, and it keeps the
    // file seekable without paying for an I-frame every second.
    const keyframeEvery = Math.max(1, Math.round(fps * 2));

    for (let i = 0; i < frameCount; i++) {
      if (signal?.aborted) throw new Error("Export cancelled.");
      if (encoderError) throw encoderError;

      const t = i / fps;
      await seekTo(video, Math.min(t, Math.max(0, duration - 1e-3)));

      const active = transitionAt(t, timeline, composition.transitions);
      const freeze =
        active && active.family === "push"
          ? freezes.get(active.boundary.index) ?? null
          : null;

      paintFrame(ctx, size, { live: video, freeze }, active, composition, t);

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(t * 1_000_000),
        duration: Math.round(1_000_000 / fps),
      });
      encoder.encode(frame, { keyFrame: i % keyframeEvery === 0 });
      frame.close();

      // Draining matters: without it the encoder queue grows to the whole
      // video and the tab runs out of memory on anything long.
      if (encoder.encodeQueueSize > 8) {
        while (encoder.encodeQueueSize > 4) await yieldToBrowser();
      } else if (i % 8 === 0) {
        await yieldToBrowser();
      }

      // The composite is the bulk of the work; leave room at both ends for the
      // setup above and the audio graft below.
      onProgress?.(0.06 + 0.82 * ((i + 1) / frameCount), "Compositing");
    }

    await encoder.flush();
    encoder.close();
    if (encoderError) throw encoderError;
    muxer.finalize();

    const silent = new Blob([target.buffer as ArrayBuffer], { type: "video/mp4" });
    if (!withAudio) {
      onProgress?.(1, "Done");
      return { blob: silent, frames: frameCount };
    }

    onProgress?.(0.9, "Adding the audio back");
    const blob = await graftAudio(silent, source);
    onProgress?.(1, "Done");
    return { blob, frames: frameCount };
  } finally {
    if (video) {
      video.removeAttribute("src");
      video.load();
    }
    URL.revokeObjectURL(sourceUrl);
  }
}

/**
 * Put the cut's audio track back on the composited picture.
 *
 * Stream copy on both sides: the video was just encoded and the audio came out
 * of the cut untouched, so there is nothing to gain from decoding either.
 */
async function graftAudio(silent: Blob, withSound: Blob): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  const { fetchFile } = await import("@ffmpeg/util");

  const videoName = "composited.mp4";
  const audioName = "cut_for_audio.mp4";
  const outName = "composited_out.mp4";

  await ffmpeg.writeFile(videoName, await fetchFile(silent));
  await ffmpeg.writeFile(audioName, await fetchFile(withSound));

  try {
    const code = await ffmpeg.exec([
      "-i", videoName,
      "-i", audioName,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c", "copy",
      // The composited track is quantised to whole frames, so it can end a few
      // milliseconds short of the audio. Without -shortest the file carries a
      // sliver of audio over a frozen last frame.
      "-shortest",
      "-movflags", "+faststart",
      "-y", outName,
    ]);
    if (code !== 0) {
      // A source without a usable audio stream is not worth failing the whole
      // export over — the picture is the part that was just rendered.
      return silent;
    }
    const data = (await ffmpeg.readFile(outName)) as Uint8Array;
    const buf = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    );
    return new Blob([buf as ArrayBuffer], { type: "video/mp4" });
  } finally {
    for (const name of [videoName, audioName, outName]) {
      await ffmpeg.deleteFile(name).catch(() => {});
    }
  }
}
