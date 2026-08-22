"use client";

import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { scheduleMusic, type MusicMood } from "./music";
import { scheduleSfx, type SfxEvent } from "./sfx";

/**
 * Offline export.
 *
 * The old path was `canvas.captureStream()` into a `MediaRecorder`, which is
 * screen recording by another name: it runs in real time, it records whatever
 * the browser managed to paint, and a backgrounded tab or a slow frame lands
 * in the file as a stutter. A ninety-second video also took ninety seconds.
 *
 * This renders instead. Every frame is asked for by timestamp -- `paint(ctx,
 * t)` is a pure function of time, which is the property the whole renderer was
 * built around -- encoded with WebCodecs, and muxed into a real H.264/AAC MP4.
 * Nothing is dropped, nothing is duplicated, and the audio is placed by
 * arithmetic in an `OfflineAudioContext` rather than by hoping a playing
 * `<audio>` element stays in step.
 *
 * Where WebCodecs is missing, the caller falls back to the recorder.
 */

export interface AudioPlacement {
  /** Clip to fetch. Same-origin, so no CORS surprise mid-export. */
  url: string;
  /** Seconds into the finished video at which this clip starts. */
  at: number;
}

export interface SoundRequest {
  /** Effects, already placed on the finished timeline. */
  sfx?: SfxEvent[];
  mood?: MusicMood;
  /** Spans where narration plays, so the bed ducks beneath it. */
  duck?: Array<{ from: number; to: number }>;
  /** 0..1 master for the score, separate from the narration. */
  level?: number;
}

export interface ExportRequest {
  width: number;
  height: number;
  fps: number;
  /** Length of the finished video, in seconds. */
  duration: number;
  /** Paints the frame for `seconds`. Must not depend on wall-clock time. */
  paint: (ctx: CanvasRenderingContext2D, seconds: number) => void;
  audio: AudioPlacement[];
  /** Music and effects, mixed under the narration. */
  sound?: SoundRequest;
  /**
   * Target video bitrate.
   *
   * 4.5 Mbps is already above streaming quality for 720p30, and this content
   * -- flat paper, hard-edged strokes, large type -- compresses far better
   * than live footage. The old 12 Mbps produced a hundred-megabyte file for a
   * two-minute explainer without looking any better.
   */
  bitrate?: number;
  onProgress?: (fraction: number, stage: string) => void;
  signal?: AbortSignal;
}

/**
 * Hands control back to the browser without going through a timer.
 *
 * `setTimeout(0)` is clamped to roughly once a second in a tab that is not
 * visible, which turned an export that should beat real time into a hundred
 * minutes of yielding. A MessageChannel message is a task like any other, so
 * the encoder's callbacks still get to run, but it is not throttled.
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

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
/** Frames per AudioData packet handed to the encoder. */
const AUDIO_PACKET = 1_024;

/** True when this browser can render the file rather than record it. */
export function canExportOffline(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.VideoEncoder === "function" &&
    typeof window.AudioEncoder === "function" &&
    typeof window.VideoFrame === "function" &&
    typeof window.OfflineAudioContext === "function"
  );
}

/** The codec string is checked before use -- H.264 High is not universal. */
export async function pickVideoCodec(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
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
      /* try the next profile */
    }
  }
  return null;
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
}

/* ---------------------------------- audio --------------------------------- */

/**
 * Lays every narration clip onto one timeline.
 *
 * Each clip is placed at an exact sample offset, so the finished file cannot
 * drift no matter how the preview behaved while it was being watched.
 */
async function renderAudioBed(
  placements: AudioPlacement[],
  duration: number,
  sound: SoundRequest | undefined,
  signal?: AbortSignal,
): Promise<AudioBuffer | null> {
  const hasScore = Boolean(sound && ((sound.sfx?.length ?? 0) > 0 || sound.mood));
  if (!placements.length && !hasScore) return null;

  const decoder = new OfflineAudioContext(CHANNELS, Math.ceil(SAMPLE_RATE * 0.1), SAMPLE_RATE);
  const unique = [...new Set(placements.map((entry) => entry.url))];
  const decoded = new Map<string, AudioBuffer>();

  await Promise.all(
    unique.map(async (url) => {
      try {
        const res = await fetch(url, { signal });
        const bytes = await res.arrayBuffer();
        decoded.set(url, await decoder.decodeAudioData(bytes));
      } catch {
        // A clip that will not decode simply leaves silence in its slot.
      }
    }),
  );
  aborted(signal);
  if (!decoded.size && !hasScore) return null;

  const context = new OfflineAudioContext(
    CHANNELS,
    Math.max(1, Math.ceil(duration * SAMPLE_RATE)),
    SAMPLE_RATE,
  );

  for (const placement of placements) {
    const buffer = decoded.get(placement.url);
    if (!buffer) continue;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(Math.max(0, placement.at));
  }

  // Music and effects render into the same pass, so what is muxed is a real
  // mix rather than three tracks hoping to line up.
  if (sound) {
    const score = context.createGain();
    score.gain.value = sound.level ?? 1;
    score.connect(context.destination);

    if (sound.mood && sound.mood !== "none") {
      scheduleMusic(context, score, {
        mood: sound.mood,
        duration,
        duck: sound.duck,
      });
    }
    if (sound.sfx?.length) scheduleSfx(context, score, sound.sfx);
  }

  return context.startRendering();
}

/** Interleaves a rendered buffer into the f32 layout `AudioData` expects. */
function interleave(buffer: AudioBuffer, from: number, frames: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer(frames * CHANNELS * 4));
  for (let channel = 0; channel < CHANNELS; channel += 1) {
    // A mono source is written to both sides rather than played on one.
    const data = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
    for (let frame = 0; frame < frames; frame += 1) {
      out[frame * CHANNELS + channel] = data[from + frame] ?? 0;
    }
  }
  return out;
}

/* --------------------------------- export --------------------------------- */

export async function exportVideoFile(request: ExportRequest): Promise<Blob> {
  const { width, height, fps, duration, paint, signal } = request;
  const bitrate = request.bitrate ?? 4_500_000;
  const progress = request.onProgress ?? (() => {});

  if (!canExportOffline()) {
    throw new Error("This browser cannot encode video offline.");
  }

  const codec = await pickVideoCodec(width, height, fps, bitrate);
  if (!codec) throw new Error("This browser has no usable H.264 encoder.");

  progress(0, "Mixing narration, music and effects");
  const bed = await renderAudioBed(request.audio, duration, request.sound, signal);
  aborted(signal);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    fastStart: "in-memory",
    video: { codec: "avc", width, height, frameRate: fps },
    ...(bed
      ? { audio: { codec: "aac", sampleRate: SAMPLE_RATE, numberOfChannels: CHANNELS } }
      : {}),
  });

  let encodeError: Error | null = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encodeError = err;
    },
  });
  videoEncoder.configure({
    codec,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: "quality",
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not open a drawing surface for the export.");

  const totalFrames = Math.max(1, Math.round(duration * fps));
  const frameDuration = 1_000_000 / fps;
  // A keyframe every two seconds: seekable without bloating the file.
  const keyEvery = Math.max(1, Math.round(fps * 2));

  for (let index = 0; index < totalFrames; index += 1) {
    aborted(signal);
    if (encodeError) throw encodeError;

    paint(ctx, index / fps);

    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(index * frameDuration),
      duration: Math.round(frameDuration),
      alpha: "discard",
    });
    videoEncoder.encode(frame, { keyFrame: index % keyEvery === 0 });
    frame.close();

    // Encoding runs on its own thread; letting its queue run away costs
    // hundreds of megabytes on a long video.
    if (videoEncoder.encodeQueueSize > 12) {
      await yieldToBrowser();
      while (videoEncoder.encodeQueueSize > 6) {
        await yieldToBrowser();
        aborted(signal);
      }
    } else if (index % 8 === 0) {
      // Yield often enough that the progress readout actually paints.
      await yieldToBrowser();
    }

    progress((index + 1) / totalFrames, "Rendering frames");
  }

  await videoEncoder.flush();
  videoEncoder.close();
  if (encodeError) throw encodeError;

  if (bed) {
    progress(1, "Encoding audio");
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (err) => {
        encodeError = err;
      },
    });
    audioEncoder.configure({
      codec: "mp4a.40.2",
      sampleRate: SAMPLE_RATE,
      numberOfChannels: CHANNELS,
      bitrate: 160_000,
    });

    for (let frame = 0; frame < bed.length; frame += AUDIO_PACKET) {
      aborted(signal);
      if (encodeError) throw encodeError;

      const frames = Math.min(AUDIO_PACKET, bed.length - frame);
      const data = new AudioData({
        format: "f32",
        sampleRate: SAMPLE_RATE,
        numberOfFrames: frames,
        numberOfChannels: CHANNELS,
        timestamp: Math.round((frame / SAMPLE_RATE) * 1_000_000),
        data: interleave(bed, frame, frames),
      });
      audioEncoder.encode(data);
      data.close();

      if (audioEncoder.encodeQueueSize > 24) {
        await yieldToBrowser();
      }
    }

    await audioEncoder.flush();
    audioEncoder.close();
    if (encodeError) throw encodeError;
  }

  progress(1, "Writing the file");
  muxer.finalize();
  return new Blob([target.buffer as ArrayBuffer], { type: "video/mp4" });
}
