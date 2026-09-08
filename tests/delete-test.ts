/**
 * Deleting a thing, and playing across the hole it leaves.
 *
 * Two behaviours that live in components, so they are checked at the source
 * rather than by driving a browser. Both were reported the same way — "I could
 * not delete the items in the video" and "there is a gap where the word was" —
 * and neither is visible in a type check or a unit test of the maths.
 *
 * Run with `npx tsx tests/delete-test.ts`.
 */

import { readFileSync } from "node:fs";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const editor = readFileSync("src/motionscript/components/Editor.tsx", "utf8");
const preview = readFileSync("src/motionscript/components/MediaPreview.tsx", "utf8");
const cutStore = readFileSync("src/motionscript/lib/store.ts", "utf8");
const overlayStore = readFileSync("src/motionscript/lib/overlay/store.ts", "utf8");

/* ------------------------------- the delete key ------------------------------ */

{
  // For a long time the only way to remove a caption was the bin icon in the
  // Layers list, which is only rendered once the row is already selected. The
  // key everybody reaches for first did nothing at all.
  const handler = editor.slice(editor.indexOf('e.key === "Delete"'));
  const body = handler.slice(0, handler.indexOf("document.addEventListener"));
  assert(
    /removeElement\(/.test(body),
    "Delete does not remove the selected overlay element"
  );
  assert(
    body.indexOf("selectedId") < body.indexOf("selectedCutIndex != null"),
    "an overlay selection has to be answered before the transcript's, or Delete " +
      "deletes words while you are looking at a caption"
  );
  console.log("✓ Delete removes the thing that is selected on the video");
}

/* ------------------------------ one selection -------------------------------- */

{
  // Two stores, one Delete key. If both can hold a selection at once then what
  // the key means depends on what you clicked three panels ago.
  assert(
    /select: \(id\) => \{[\s\S]{0,900}useEditorStore\.setState\(/.test(overlayStore),
    "selecting an overlay leaves the transcript selection standing"
  );
  for (const setter of [
    "setSelectedClipIndex",
    "setSelectedCutIndex",
    "setSelectedWords",
  ]) {
    // lastIndexOf, not indexOf: the first hit is the interface declaration.
    const at = cutStore.lastIndexOf(`  ${setter}: (`);
    assert(at > 0, `${setter} not found`);
    const body = cutStore.slice(at, at + 900);
    assert(
      /useOverlayStore\.getState\(\)\.select\(null\)/.test(body),
      `${setter} leaves the overlay selection standing`
    );
  }
  console.log("✓ the two selections are mutually exclusive");
}

/* --------------------------- playing across a cut ---------------------------- */

{
  // Setting currentTime on a playing <video> tears down the decode pipeline:
  // the picture holds and the audio stops for as long as the seek takes. On a
  // transcript editor that happens once per deleted word, which reads exactly
  // like a gap the edit failed to close — and no edit can close it, because it
  // is not in the timeline.
  assert(
    /<video[\s\S]{0,400}<video/.test(preview),
    "there is only one video element, so every cut is a seek the viewer waits for"
  );
  assert(
    /attach0/.test(preview) && /attach1/.test(preview),
    "both elements have to be registered for the swap to have anything to swap to"
  );
  assert(
    /standby\.play\(\)/.test(preview),
    "the incoming clip is never rolled before the boundary"
  );
  assert(
    /setVideoEl\(standby\)/.test(preview),
    "the swap never hands the store the element that is actually playing — the " +
      "canvas would keep painting the paused one"
  );

  // The fallback matters as much as the fast path: a standby that has not
  // finished seeking must not stop playback at the boundary.
  assert(
    /live\.currentTime = target/.test(preview),
    "there is no fallback to seeking in place when the preroll is not ready"
  );

  // Only the live element may report playback state, or the muted one starting
  // up behind the scenes shows the video as playing while it is paused.
  assert(
    /isLive\(e\.currentTarget\)/.test(preview),
    "the standby's play/pause events are reported as the editor's own"
  );
  console.log("✓ a cut is crossed by a swap, with a seek as the fallback");
}

console.log("\ndelete + playback: all checks passed");
