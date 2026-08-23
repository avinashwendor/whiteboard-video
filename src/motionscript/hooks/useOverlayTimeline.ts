"use client";

import { useEffect, useMemo } from "react";
import { getCutRanges, originalToEdited } from "@/motionscript/lib/edits";
import { useEditorStore } from "@/motionscript/lib/store";
import {
  buildTimeline,
  pruneTransitions,
  type OutputTimeline,
} from "@/motionscript/lib/overlay/timeline";
import { useOverlayStore } from "@/motionscript/lib/overlay/store";

/**
 * The finished video's clock, derived from the current cut.
 *
 * Everything on the composition side is placed against this rather than against
 * the source media, so an overlay stays where it was put when an earlier word
 * is deleted.
 */
export function useOutputTimeline(): OutputTimeline {
  const words = useEditorStore((s) => s.words);
  const duration = useEditorStore((s) => s.duration);
  const manualCuts = useEditorStore((s) => s.manualCuts);
  const sceneBoundaries = useEditorStore((s) => s.sceneBoundaries);

  const timeline = useMemo(
    () => buildTimeline(words, duration, manualCuts, sceneBoundaries),
    [words, duration, manualCuts, sceneBoundaries]
  );

  // A cut can merge two clips, taking a boundary — and its transition — with
  // it. Dropping the orphan here keeps the store honest without every panel
  // having to check.
  useEffect(() => {
    const { transitions, replaceTransitions } = useOverlayStore.getState();
    if (!transitions.length) return;
    const pruned = pruneTransitions(transitions, timeline);
    if (pruned.length !== transitions.length) replaceTransitions(pruned);
  }, [timeline]);

  return timeline;
}

/** Where the playhead sits on the output clock. */
export function useOutputTime(): number {
  const currentTime = useEditorStore((s) => s.currentTime);
  const words = useEditorStore((s) => s.words);
  const duration = useEditorStore((s) => s.duration);
  const manualCuts = useEditorStore((s) => s.manualCuts);

  const cuts = useMemo(
    () => getCutRanges(words, duration, manualCuts),
    [words, duration, manualCuts]
  );

  return useMemo(() => originalToEdited(currentTime, cuts), [currentTime, cuts]);
}
