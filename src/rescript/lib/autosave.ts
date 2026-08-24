/**
 * Debounced autosave of the current editor project into IndexedDB.
 *
 * Three stores are written as one record. The transcript store owns the cut;
 * the overlay store owns the captions, the overlays, the transitions and the
 * output frame; the chat store owns the conversation about all of it. They are
 * deliberately separate in memory — see `overlay/store.ts` — but they are one
 * *project*, and saving only part of it is what let a composition outlive the
 * video it was made for.
 */

import { useEditorStore } from "./store";
import { useOverlayStore } from "./overlay/store";
import { useChatStore } from "./chat/store";
import { isEmptyComposition } from "./overlay/types";
import { putProject, saveLastProjectId } from "./projects";

const DEBOUNCE_MS = 500;

let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
let queued = false;

export function scheduleProjectAutosave() {
  if (typeof window === "undefined") return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushProjectAutosave();
  }, DEBOUNCE_MS);
}

/** Flush any pending debounce and wait for the write to finish. */
export async function flushProjectAutosave(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (inflight) {
    queued = true;
    await inflight;
    if (queued) await flushProjectAutosave();
    return;
  }

  inflight = writeSnapshot();
  try {
    await inflight;
  } finally {
    inflight = null;
  }
  if (queued) {
    queued = false;
    await flushProjectAutosave();
  }
}

/**
 * Pull the bytes back out of every `blob:` overlay image.
 *
 * Those URLs die with the page, so the composition alone would restore an
 * uploaded picture as a placeholder. A fetch of a live blob URL is a memory
 * read, not a network call.
 */
async function collectAssets(
  elements: ReturnType<typeof useOverlayStore.getState>["elements"]
): Promise<Record<string, Blob> | undefined> {
  const wanted = elements.filter(
    (e) => e.kind === "image" && e.src.startsWith("blob:")
  );
  if (!wanted.length) return undefined;

  const assets: Record<string, Blob> = {};
  await Promise.all(
    wanted.map(async (element) => {
      if (element.kind !== "image") return;
      try {
        const res = await fetch(element.src);
        assets[element.id] = await res.blob();
      } catch {
        // A revoked URL is not worth failing the save over; the element comes
        // back as a placeholder, exactly as it would have before.
      }
    })
  );
  return Object.keys(assets).length ? assets : undefined;
}

async function writeSnapshot() {
  const s = useEditorStore.getState();
  if (s.status !== "ready") return;
  if (!s.videoFile || !s.mediaKind) return;

  const overlay = useOverlayStore.getState();
  const composition = {
    elements: overlay.elements,
    subtitles: overlay.subtitles,
    transitions: overlay.transitions,
    frame: overlay.frame,
    shots: overlay.shots,
    grade: overlay.grade,
  };
  // The composition counts as work: a project whose only edit is "make it
  // vertical and burn in captions" has an untouched transcript and still has to
  // be saved.
  const hasComposition = !isEmptyComposition(composition, overlay.sourceAspect);

  // A conversation counts as work too. Someone who asked for a plan, read it
  // and has not accepted it yet has done nothing to the composition and would
  // lose the plan on a refresh without this.
  const chat = useChatStore.getState().snapshot();
  const hasChat = chat.turns.length > 0 || chat.log.length > 0;

  if (
    !hasComposition &&
    !hasChat &&
    s.words.length === 0 &&
    s.manualCuts.length === 0 &&
    s.sceneBoundaries.length === 0
  ) {
    return;
  }

  try {
    const assets = await collectAssets(overlay.elements);

    // The project can be closed while the blobs are being read back. Writing
    // then would stamp this composition onto whatever is open now, which is the
    // same class of bug as never resetting it in the first place.
    const now = useEditorStore.getState();
    if (now.videoFile !== s.videoFile || now.status !== "ready") return;

    // putProject preserves createdAt for an existing id within its own
    // transaction, so no separate read pass here.
    const id = await putProject({
      id: s.projectId ?? undefined,
      name: s.videoFile.name,
      mediaKind: s.mediaKind,
      duration: s.duration,
      source: s.source,
      transcriptLanguage: s.transcriptLanguage,
      words: s.words,
      showDeleted: s.showDeleted,
      manualCuts: s.manualCuts,
      sceneBoundaries: s.sceneBoundaries,
      speakers: s.speakers,
      composition,
      assets,
      chat,
      media: s.videoFile,
      mediaType: s.videoFile.type,
    });
    if (useEditorStore.getState().projectId !== id) {
      useEditorStore.setState({ projectId: id });
    }
    // A freshly dropped file only becomes a project here, on its first save.
    // Recording it now is what makes a brand-new upload resumable too, rather
    // than only projects that were opened from the recent list.
    saveLastProjectId(id);
  } catch (err) {
    console.warn("Failed to autosave project.", err);
  }
}

/**
 * Save when the composition changes, not only when the cut does.
 *
 * The transcript store calls `scheduleProjectAutosave` from inside its own
 * actions; the overlay store is ported-adjacent code with a different shape, so
 * it is watched from outside instead. Undo/redo and gestures all land here,
 * which is what we want — the debounce collapses a drag into one write.
 */
if (typeof window !== "undefined") {
  useOverlayStore.subscribe((state, previous) => {
    if (
      state.elements === previous.elements &&
      state.subtitles === previous.subtitles &&
      state.transitions === previous.transitions &&
      state.frame === previous.frame &&
      state.shots === previous.shots &&
      state.grade === previous.grade
    ) {
      return;
    }
    if (useEditorStore.getState().status !== "ready") return;
    scheduleProjectAutosave();
  });

  // Same reasoning for the conversation: it is changed by the panel, not by an
  // action on the transcript store, so it is watched from outside. `abort` and
  // `sequence` are deliberately not triggers — neither is persisted state.
  useChatStore.subscribe((state, previous) => {
    if (
      state.turns === previous.turns &&
      state.log === previous.log &&
      state.proposal === previous.proposal
    ) {
      return;
    }
    if (useEditorStore.getState().status !== "ready") return;
    scheduleProjectAutosave();
  });
}
