"use client";

/** Picks the best container this browser can actually record. */
export function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export function extensionFor(mimeType: string): string {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

export interface RecorderHandle {
  stop: () => Promise<Blob>;
}

export function startRecording(stream: MediaStream, mimeType: string): RecorderHandle {
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(250);

  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
        if (recorder.state !== "inactive") recorder.stop();
        else resolve(new Blob(chunks, { type: mimeType }));
      }),
  };
}
