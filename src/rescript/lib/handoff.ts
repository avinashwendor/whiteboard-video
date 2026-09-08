"use client";

import { putProject } from "./projects";
import type { SpeakerInfo, Word } from "./types";

/**
 * A generated video, handed to the editor that cuts.
 *
 * The two halves of this app have been separate programs sharing a domain: one
 * writes a video from a prompt, the other cuts video somebody already has. The
 * missing link between them is the whole product — generate the thing, then
 * *edit* it: trim the bit that runs long, reframe it to 9:16, put a picture in
 * the gap, land a sound on the cut, score it.
 *
 * What makes the handoff worth doing properly rather than as a download and a
 * re-upload is the transcript. A generated video's narration was spoken by an
 * engine that returned word timings, so the editor can be given a transcript
 * that is exact — no ASR pass, no model download, no alignment, and every word
 * boundary correct to the millisecond rather than to the nearest tenth. That is
 * a better transcript than the editor can produce for any footage it is handed
 * from outside, and it arrives in under a second.
 *
 * Written into the same IndexedDB store the editor's own projects live in, so
 * what lands is an ordinary project: openable from the recent list, autosaved,
 * undoable, and indistinguishable from one that came from a file.
 */

/** One scene's narration, as the studio holds it. */
export interface NarratedScene {
  /** Seconds into the finished video at which this scene's voice begins. */
  at: number;
  /** Word timings relative to the start of that scene's own audio clip. */
  words?: Array<{ word: string; start: number; end: number }>;
  /** The line, for a scene whose engine returned no timings. */
  narration?: string;
  /** Length of the scene's audio, used to spread an untimed line across it. */
  seconds?: number;
}

/**
 * Fold per-scene narration into one transcript on the finished video's clock.
 *
 * Scenes are separate recordings laid end to end, so every timing has to be
 * moved by where its scene starts. A scene whose engine returned no word
 * timings still contributes its words — spread evenly across its own audio —
 * because a transcript missing a scene is worse than one whose middle scene is
 * timed approximately: the editor can cut on a word that is a fifth of a second
 * out, and cannot cut on a word that is not there.
 */
export function transcriptFromScenes(scenes: NarratedScene[]): Word[] {
  const words: Word[] = [];
  let id = 1;

  scenes.forEach((scene, index) => {
    if (scene.words?.length) {
      for (const word of scene.words) {
        const text = word.word.trim();
        if (!text) continue;
        words.push({
          id: id++,
          text,
          start: scene.at + word.start,
          end: scene.at + Math.max(word.start + 0.02, word.end),
          // One speaker per scene: the studio casts a voice per project today,
          // but a scene is the right unit for it if that ever changes, and
          // labelling them now costs nothing.
          speaker: 0,
          deleted: false,
        });
      }
      return;
    }

    const spoken = (scene.narration ?? "").trim().split(/\s+/).filter(Boolean);
    if (!spoken.length) return;
    // Nothing to be exact about, so the spread is honest rather than precise:
    // each word gets an equal share of whatever the clip is known to run for,
    // and a clip of unknown length is assumed to be read at about 165 wpm.
    const seconds = scene.seconds ?? spoken.length * (60 / 165);
    const each = seconds / spoken.length;
    spoken.forEach((text, i) => {
      words.push({
        id: id++,
        text,
        start: scene.at + i * each,
        end: scene.at + (i + 1) * each - 0.02,
        speaker: index === 0 ? 0 : 0,
        deleted: false,
      });
    });
  });

  return words.sort((a, b) => a.start - b.start);
}

export interface HandoffInput {
  /** The exported video. */
  blob: Blob;
  /** What to call the project. The video's title, usually. */
  name: string;
  duration: number;
  scenes: NarratedScene[];
  speakers?: SpeakerInfo[];
}

/**
 * Write the project and return the id to open it with.
 *
 * The caller navigates to `/video-editor?open=<id>`. Two steps rather than one
 * because the write is the part that can fail — a browser with no IndexedDB, a
 * storage quota — and failing before the navigation leaves the person where
 * they were rather than on an editor with nothing in it.
 */
export async function handOffToEditor(input: HandoffInput): Promise<string> {
  const words = transcriptFromScenes(input.scenes);
  const file = new File([input.blob], `${input.name || "video"}.mp4`, {
    type: input.blob.type || "video/mp4",
  });

  return putProject({
    name: file.name,
    mediaKind: "video",
    duration: input.duration,
    // "import" is exactly what this is: a transcript that arrived with the
    // media rather than one this editor produced. It is also what stops the
    // editor reaching for a speech model on open.
    source: "import",
    transcriptLanguage: "auto",
    words,
    showDeleted: false,
    manualCuts: [],
    sceneBoundaries: [],
    speakers: input.speakers ?? [],
    media: file,
    mediaType: file.type,
  });
}
