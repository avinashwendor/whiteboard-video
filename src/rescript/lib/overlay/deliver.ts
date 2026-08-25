/**
 * Delivering one edit in several shapes.
 *
 * A widescreen master, a vertical Short and a square post are the same edit
 * three times, and until now getting all three meant exporting, changing the
 * frame, exporting again, changing it back — with the caption line-breaks
 * re-wrapped by hand somewhere in the middle.
 *
 * The thing that makes this cheap is that **the cut is aspect-independent**.
 * ffmpeg trims the media once; only the composite pass — which draws the
 * picture into the frame and burns the overlays on — knows what shape the
 * output is. So N deliverables cost one trim and N composites, not N of both,
 * and the composite is the fast half.
 */

import { rewrapCues } from "./subtitles";
import {
  FRAME_ASPECTS,
  frameRatio,
  outputSize,
  type Composition,
  type FrameAspectId,
} from "./types";

export interface Target {
  aspect: FrameAspectId;
  label: string;
  /** Pixel size of the file this target will produce. */
  width: number;
  height: number;
}

/**
 * The aspects worth offering beside the one already chosen.
 *
 * The current frame is never in the list: it is what the main export already
 * produces, and offering it again as an extra is how you end up with two copies
 * of the same file and a support question about which is which.
 */
export function extraTargets(
  current: FrameAspectId,
  sourceAspect: number,
  targetHeight?: number
): Target[] {
  const currentRatio = ratioFor(current, sourceAspect);

  return FRAME_ASPECTS.filter((option) => {
    if (option.id === current) return false;
    // Compared by *shape*, not by name. "Source" on a 16:9 project is 16:9, and
    // 4:3 on a 4:3 recording is the file you already have — offering either as
    // an extra produces two identical exports and a support question about
    // which is which. Ids alone cannot see that; ratios can.
    const ratio = option.ratio ?? (sourceAspect > 0 ? sourceAspect : 16 / 9);
    return Math.abs(ratio - currentRatio) > 0.01;
  }).map((option) => {
    const ratio = option.ratio ?? (sourceAspect > 0 ? sourceAspect : 16 / 9);
    const size = sizeFor(ratio, sourceAspect, targetHeight);
    return { aspect: option.id, label: option.label, ...size };
  });
}

/**
 * Pixel size for a target, given the media's own shape.
 *
 * The source's dimensions are not known here — only its aspect — so a nominal
 * height stands in. The exporter recomputes the real size from the decoded
 * video; this exists so the picker can say "1080×1920" beside a chip rather
 * than making someone export to find out.
 */
function sizeFor(
  ratio: number,
  sourceAspect: number,
  targetHeight?: number
): { width: number; height: number } {
  const nominalHeight = targetHeight ?? 1080;
  const nominalWidth = Math.round(nominalHeight * (sourceAspect > 0 ? sourceAspect : 16 / 9));
  return outputSize(ratio, nominalWidth, nominalHeight, targetHeight);
}

/**
 * The composition to composite a given target with.
 *
 * Only the frame's aspect changes, and the captions are re-broken to fit it.
 * Everything else — the elements, the shots, the look, the caption *style* — is
 * the edit, and the edit is the same edit in every shape.
 *
 * The re-break matters more than it sounds. Line length is a function of the
 * frame, so a vertical delivery of a widescreen project would otherwise carry
 * captions cut three words too long for it, every one of them, and the renderer
 * resolves the overflow by running text off both edges.
 *
 * It needs no transcript: cues carry their own per-word timings, already on the
 * output clock and already past the cut. So this can be done here without
 * reaching across into the store that owns the words.
 */
export function compositionFor(
  composition: Composition,
  aspect: FrameAspectId,
  sourceAspect: number
): Composition {
  const frame = { ...composition.frame, aspect };
  return {
    ...composition,
    frame,
    subtitles: rewrapCues(composition.subtitles, ratioFor(aspect, sourceAspect)),
  };
}

/** A filename that says which shape it is, so three downloads are tellable apart. */
export function nameFor(base: string, aspect: FrameAspectId, extension: string): string {
  const stem = base.replace(/\.[^.]+$/, "") || "export";
  if (aspect === "source") return `${stem}.${extension}`;
  // Colons are not filename characters on any platform worth supporting.
  return `${stem}-${aspect.replace(":", "x")}.${extension}`;
}

/** Width ÷ height a target will actually produce. Exported for the preview. */
export function ratioFor(aspect: FrameAspectId, sourceAspect: number): number {
  return frameRatio(
    { aspect, fit: "cover", zoom: 1, focusX: 0.5, focusY: 0.5, background: "blur" },
    sourceAspect
  );
}
