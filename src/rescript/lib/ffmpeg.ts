"use client";

import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { en } from "@/rescript/lib/i18n/messages/en";
import type { TimeRange } from "./types";

const CORE_BASE = "/vendor/ffmpeg";
const INPUT_NAME = "input_video";

let ffmpegPromise: Promise<FFmpeg> | null = null;
let writtenFor: File | null = null;

const ESTIMATED_WASM_SIZE = 32_718_323;

async function loadWithProgress(
  url: string,
  mimeType: string,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load media engine asset from ${url}: ${res.statusText}`);
  const headerTotal = Number(res.headers.get("content-length"));
  const total =
    Number.isFinite(headerTotal) && headerTotal > 0
      ? headerTotal
      : url.endsWith(".wasm")
        ? ESTIMATED_WASM_SIZE
        : 150_000;

  if (!res.body || !onProgress) {
    const buf = await res.arrayBuffer();
    if (onProgress) onProgress(1);
    return URL.createObjectURL(new Blob([buf], { type: mimeType }));
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress(Math.min(0.98, received / total));
    }
  }
  onProgress(1);
  const blob = new Blob(chunks as BlobPart[], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * How long `ffmpeg.load()` may sit before we call it dead.
 *
 * Everything it needs is already in memory by this point, so this only covers
 * instantiation and the pthread pool coming up. It exists because a pthread
 * that fails to start never rejects — the core just waits for a worker that
 * will never report ready, and the UI sits on "Loading media engine… 100%"
 * forever. A timeout turns that into something the person can read and act on.
 */
const LOAD_TIMEOUT_MS = 90_000;

/**
 * Lazily load a singleton multi-threaded ffmpeg.wasm instance, reporting
 * download progress for the 32 MB core.
 *
 * Two rules decide the URLs below, and getting either wrong produces a load
 * that never settles rather than an error:
 *
 *  - **The core, its wasm and its pthread worker are blob URLs.** A worker
 *    created from a blob inherits the creating context's policy container, so
 *    the pthread pool starts under cross-origin isolation. Handed plain
 *    same-origin URLs instead, the pool silently never comes up.
 *  - **The class worker is a real URL.** It is an ES module that imports
 *    ./const.js and ./errors.js from beside itself; from a blob those
 *    specifiers resolve against the blob and fail. It is served out of
 *    public/vendor (copied on postinstall) because the bundled worker contains
 *    a dynamic import() that Next's bundler cannot process. Its response needs
 *    COEP of its own — see the headers in next.config.ts.
 */
export async function getFFmpeg(onProgress?: (ratio: number) => void): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");

      // Multi-threaded ffmpeg.wasm needs SharedArrayBuffer, i.e. a
      // cross-origin-isolated page (COOP/COEP from next.config.ts).
      if (!self.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
        throw new Error(
          "This page isn't cross-origin isolated, so the media engine can't start. Reload /rescript and try again."
        );
      }

      const origin = window.location.origin;

      // The wasm is the only payload worth a progress bar; the other two are a
      // few hundred kilobytes and would only make the bar jump.
      const [coreURL, workerURL, wasmURL] = await Promise.all([
        loadWithProgress(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        loadWithProgress(`${CORE_BASE}/ffmpeg-core.worker.js`, "text/javascript"),
        loadWithProgress(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm", onProgress),
      ]);

      const ffmpeg = new FFmpeg();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          ffmpeg.load({
            coreURL,
            wasmURL,
            workerURL,
            classWorkerURL: `${origin}/vendor/ffmpeg-class/worker.js`,
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "The media engine didn't finish starting. Reload the page and try again — if it keeps happening, re-run `npm install` to restore the engine files in public/vendor."
                  )
                ),
              LOAD_TIMEOUT_MS
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
        // The core holds what it needs; these only pinned memory.
        for (const url of [coreURL, workerURL, wasmURL]) URL.revokeObjectURL(url);
      }

      return ffmpeg;
    })();
    ffmpegPromise.catch(() => {
      // Clear the singleton so the next attempt builds a fresh instance rather
      // than re-awaiting a promise that already failed.
      ffmpegPromise = null;
    });
  }
  return ffmpegPromise;
}

/**
 * Terminate the ffmpeg worker and hand its heap back to the browser.
 *
 * ffmpeg-core is built with INITIAL_MEMORY === MAXIMUM_MEMORY === 1 GiB on a
 * shared WebAssembly.Memory, so the full gigabyte is committed the moment the
 * core instantiates and never shrinks — deleting MEMFS files frees nothing.
 * Held across transcription it sits alongside onnxruntime's heap, the model
 * weights and the decoded PCM, and WebKit kills the tab for it ("This webpage
 * was reloaded because it was using significant memory"). Nothing needs ffmpeg
 * between audio extraction and export, so drop it there and pay one re-init.
 */
export async function releaseFFmpeg(): Promise<void> {
  const pending = ffmpegPromise;
  if (!pending) return;
  // Clear first so a concurrent getFFmpeg() builds a fresh instance rather than
  // handing out the one we are about to terminate.
  ffmpegPromise = null;
  writtenFor = null;
  try {
    (await pending).terminate();
  } catch {
    // Load failed or the worker is already gone — the heap went with it.
  }
}

async function ensureInput(ffmpeg: FFmpeg, file: File): Promise<string> {
  if (writtenFor !== file) {
    const { fetchFile } = await import("@ffmpeg/util");
    await ffmpeg.writeFile(INPUT_NAME, await fetchFile(file));
    writtenFor = file;
  }
  return INPUT_NAME;
}

/**
 * Extract the audio track as mono 16 kHz float PCM — the exact format
 * Whisper expects, and what we render the timeline waveform from.
 * Works for both video and audio-only files. Resolves to null when the file
 * has no audio track — those still open for editing with an empty transcript.
 */
export async function extractAudio(file: File): Promise<Float32Array | null> {
  const ffmpeg = await getFFmpeg();
  const input = await ensureInput(ffmpeg, file);
  const out = "audio.pcm";
  let sawAudioStream = false;
  const logHandler = ({ message }: { type: string; message: string }) => {
    if (/Stream #\d+:\d+.*: Audio:/.test(message)) sawAudioStream = true;
  };
  ffmpeg.on("log", logHandler);
  let code: number;
  try {
    code = await ffmpeg.exec([
      "-i", input,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-f", "f32le",
      "-y", out,
    ]);
  } finally {
    ffmpeg.off("log", logHandler);
  }
  if (code !== 0) {
    if (!sawAudioStream) return null;
    throw new Error(en["error.extractAudio"]);
  }
  const data = (await ffmpeg.readFile(out)) as Uint8Array;
  await ffmpeg.deleteFile(out);
  if (data.byteLength < 4) return null;
  // Copy into a fresh buffer so byteOffset/alignment is clean.
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return new Float32Array(buf as ArrayBuffer);
}

/** Container / codec presets for video export. */
export type VideoExportFormat = "mp4" | "webm";

/** Target output height. `"original"` keeps the source resolution. */
export type VideoExportResolution = "original" | "720" | "1080" | "2160";

/** Container / codec presets for audio-only export. */
export type AudioExportFormat = "m4a" | "mp3" | "wav";

export interface VideoExportOptions {
  /** When false, render a silent video (source has no audio track). */
  withAudio?: boolean;
  format?: VideoExportFormat;
  resolution?: VideoExportResolution;
}

export interface AudioExportOptions {
  format?: AudioExportFormat;
}

const VIDEO_HEIGHT: Record<Exclude<VideoExportResolution, "original">, number> = {
  "720": 720,
  "1080": 1080,
  "2160": 2160,
};

/**
 * Scale filter that fits inside the target height without upscaling, keeping
 * even dimensions (required by libx264 / libvpx).
 */
function scaleFilter(resolution: VideoExportResolution): string | null {
  if (resolution === "original") return null;
  const h = VIDEO_HEIGHT[resolution];
  // Never upscale: cap height at source ih. force_original_aspect_ratio keeps
  // width proportional; the second scale snaps to even sizes.
  return `scale=-2:'min(ih,${h})',scale=trunc(iw/2)*2:trunc(ih/2)*2`;
}

/**
 * Render the edited video: keep only `keepRanges` of the original media and
 * concatenate them. Re-encodes so cuts land exactly on word boundaries
 * rather than keyframes. `withAudio: false` renders a silent source, whose
 * missing [0:a] would otherwise fail the whole filtergraph.
 */
export async function exportVideo(
  file: File,
  keepRanges: TimeRange[],
  editedDuration: number,
  onProgress: (ratio: number) => void,
  {
    withAudio = true,
    format = "mp4",
    resolution = "original",
  }: VideoExportOptions = {}
): Promise<Blob> {
  if (keepRanges.length === 0) {
    throw new Error(en["error.nothingToExport"]);
  }
  const ffmpeg = await getFFmpeg();
  const input = await ensureInput(ffmpeg, file);
  const out = format === "webm" ? "output.webm" : "output.mp4";
  const scale = scaleFilter(resolution);

  const parts: string[] = [];
  const labels: string[] = [];
  keepRanges.forEach((r, i) => {
    const s = r.start.toFixed(3);
    const e = r.end.toFixed(3);
    parts.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`);
    labels.push(`[v${i}]`);
    if (withAudio) {
      parts.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`);
      labels[labels.length - 1] += `[a${i}]`;
    }
  });
  let filter =
    parts.join(";") +
    `;${labels.join("")}concat=n=${keepRanges.length}:v=1:a=${
      withAudio ? 1 : 0
    }[outv]${withAudio ? "[outa]" : ""}`;
  const videoMap = scale ? "[vout]" : "[outv]";
  if (scale) {
    filter += `;[outv]${scale}[vout]`;
  }

  const progressHandler = ({ time }: { progress: number; time: number }) => {
    // `time` is the output timestamp in microseconds.
    const ratio = Math.min(1, time / 1e6 / Math.max(0.001, editedDuration));
    onProgress(Math.max(0, ratio));
  };
  ffmpeg.on("progress", progressHandler);
  try {
    const codecArgs =
      format === "webm"
        ? [
            "-c:v", "libvpx-vp9",
            "-crf", "35",
            "-b:v", "0",
            "-row-mt", "1",
            "-cpu-used", "8",
            ...(withAudio ? ["-c:a", "libopus", "-b:a", "128k"] : []),
          ]
        : [
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "22",
            ...(withAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
            "-movflags", "+faststart",
          ];

    const code = await ffmpeg.exec([
      "-i", input,
      "-filter_complex", filter,
      "-map", videoMap,
      ...(withAudio ? ["-map", "[outa]"] : ["-an"]),
      ...codecArgs,
      "-y", out,
    ]);
    if (code !== 0) throw new Error(en["error.videoExport"]);
    const data = (await ffmpeg.readFile(out)) as Uint8Array;
    await ffmpeg.deleteFile(out);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return new Blob([buf as ArrayBuffer], {
      type: format === "webm" ? "video/webm" : "video/mp4",
    });
  } finally {
    ffmpeg.off("progress", progressHandler);
  }
}

/**
 * Render an edited audio-only file: keep only `keepRanges` and concatenate
 * them. Works for both audio projects and the audio track of a video file.
 */
export async function exportAudio(
  file: File,
  keepRanges: TimeRange[],
  editedDuration: number,
  onProgress: (ratio: number) => void,
  { format = "m4a" }: AudioExportOptions = {}
): Promise<Blob> {
  if (keepRanges.length === 0) {
    throw new Error(en["error.nothingToExport"]);
  }
  const ffmpeg = await getFFmpeg();
  const input = await ensureInput(ffmpeg, file);
  const out =
    format === "mp3" ? "output.mp3" : format === "wav" ? "output.wav" : "output.m4a";

  const parts: string[] = [];
  const labels: string[] = [];
  keepRanges.forEach((r, i) => {
    const s = r.start.toFixed(3);
    const e = r.end.toFixed(3);
    parts.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(`[a${i}]`);
  });
  const filter =
    parts.join(";") +
    `;${labels.join("")}concat=n=${keepRanges.length}:v=0:a=1[outa]`;

  const progressHandler = ({ time }: { progress: number; time: number }) => {
    const ratio = Math.min(1, time / 1e6 / Math.max(0.001, editedDuration));
    onProgress(Math.max(0, ratio));
  };
  ffmpeg.on("progress", progressHandler);
  try {
    const codecArgs =
      format === "mp3"
        ? ["-c:a", "libmp3lame", "-b:a", "192k"]
        : format === "wav"
          ? ["-c:a", "pcm_s16le"]
          : ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];

    const code = await ffmpeg.exec([
      "-i", input,
      "-filter_complex", filter,
      "-map", "[outa]",
      ...codecArgs,
      "-y", out,
    ]);
    if (code !== 0) throw new Error(en["error.audioExport"]);
    const data = (await ffmpeg.readFile(out)) as Uint8Array;
    await ffmpeg.deleteFile(out);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const mime =
      format === "mp3"
        ? "audio/mpeg"
        : format === "wav"
          ? "audio/wav"
          : "audio/mp4";
    return new Blob([buf as ArrayBuffer], { type: mime });
  } finally {
    ffmpeg.off("progress", progressHandler);
  }
}
