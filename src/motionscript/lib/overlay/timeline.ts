/**
 * Mapping between the source media's clock and the finished video's clock, and
 * where the clip boundaries land on the latter.
 *
 * The editor cuts by deleting words, so the output is the kept ranges played
 * back to back. "Output time" here is that concatenated clock — the time the
 * viewer sees, which is what overlays and subtitles are placed against.
 */

import {
  getClipSegments,
  getCutRanges,
  getKeepRanges,
  originalToEdited,
} from "../edits";
import type {
  ClipSegment,
  ManualCut,
  SceneBoundary,
  TimeRange,
  Word,
} from "../types";
import type { Transition, TransitionKind } from "./types";

export interface Boundary {
  /** Index of the clip that starts here. Always ≥ 1. */
  index: number;
  /** Where the boundary sits on the output clock. */
  outTime: number;
  /** Last instant of the outgoing clip, in source time. */
  outgoingEnd: number;
  /** First instant of the incoming clip, in source time. */
  incomingStart: number;
  /** Output seconds available before the boundary (the outgoing clip's length). */
  roomBefore: number;
  /** Output seconds available after it. */
  roomAfter: number;
}

export interface OutputTimeline {
  keepRanges: TimeRange[];
  clips: ClipSegment[];
  boundaries: Boundary[];
  /** Length of the finished video, in seconds. */
  duration: number;
}

export function buildTimeline(
  words: Word[],
  duration: number,
  manualCuts: ManualCut[],
  sceneBoundaries: SceneBoundary[]
): OutputTimeline {
  const cuts = getCutRanges(words, duration, manualCuts);
  const keepRanges = getKeepRanges(cuts, duration);
  const clips = getClipSegments(keepRanges, sceneBoundaries);

  const outStarts = clips.map((c) => originalToEdited(c.start, cuts));
  const outEnds = clips.map((c) => originalToEdited(c.end, cuts));
  const total = outEnds.length ? outEnds[outEnds.length - 1] : 0;

  const boundaries: Boundary[] = [];
  for (let i = 1; i < clips.length; i++) {
    boundaries.push({
      index: i,
      outTime: outStarts[i],
      outgoingEnd: clips[i - 1].end,
      incomingStart: clips[i].start,
      roomBefore: outEnds[i - 1] - outStarts[i - 1],
      roomAfter: outEnds[i] - outStarts[i],
    });
  }

  return { keepRanges, clips, boundaries, duration: total };
}

/** Output second → source second. Inverse of `originalToEdited`. */
export function outputToOriginal(t: number, keepRanges: TimeRange[]): number {
  let elapsed = 0;
  for (const range of keepRanges) {
    const length = range.end - range.start;
    if (t < elapsed + length) return range.start + (t - elapsed);
    elapsed += length;
  }
  const last = keepRanges[keepRanges.length - 1];
  return last ? last.end : t;
}

/**
 * Translate a span of the finished video back to the source spans it came from.
 *
 * One output range can straddle several kept ranges — cut something out of the
 * middle and the seconds either side become adjacent on the output clock while
 * staying far apart in the file. So this returns a list, not a range. Used
 * whenever a plan says "cut from 12s to 18s": the agent means the video it was
 * shown, and this is what turns that into edits on the media.
 */
export function outputRangeToSource(
  from: number,
  to: number,
  keepRanges: TimeRange[]
): TimeRange[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (end - start <= 0) return [];

  const out: TimeRange[] = [];
  let elapsed = 0;
  for (const range of keepRanges) {
    const length = range.end - range.start;
    const rangeStart = elapsed;
    const rangeEnd = elapsed + length;
    elapsed = rangeEnd;

    // Overlap of [start, end] with this kept range, on the output clock.
    const lo = Math.max(start, rangeStart);
    const hi = Math.min(end, rangeEnd);
    if (hi <= lo) continue;

    out.push({
      start: range.start + (lo - rangeStart),
      end: range.start + (hi - rangeStart),
    });
  }
  return out;
}

/**
 * The source spans *outside* the given output spans — i.e. what to cut when a
 * plan says "keep only these bits". Ranges are merged first, so overlapping or
 * unsorted input from a model still produces a sane result.
 */
export function complementToSource(
  keep: Array<{ from: number; to: number }>,
  timeline: OutputTimeline
): TimeRange[] {
  const wanted = keep
    .map((r) => ({ start: Math.min(r.from, r.to), end: Math.max(r.from, r.to) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  const merged: TimeRange[] = [];
  for (const range of wanted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  const drop: TimeRange[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) drop.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < timeline.duration) {
    drop.push({ start: cursor, end: timeline.duration });
  }

  return drop.flatMap((r) =>
    outputRangeToSource(r.start, r.end, timeline.keepRanges)
  );
}

/* ------------------------------- transitions ------------------------------- */

/**
 * Two families, and the difference is what the outgoing side is made of.
 *
 * `dip` applies an effect to whichever clip is live, symmetrically across the
 * boundary. `push` holds the outgoing clip's last frame and moves the incoming
 * one in over it, entirely after the boundary.
 *
 * Neither consumes handles and neither changes the output duration, which is
 * the constraint that matters here: this editor cuts on word boundaries, so a
 * transition that ate half a second off each side would clip speech, and one
 * that borrowed frames from across the cut would put deleted words back on
 * screen.
 */
export type TransitionFamily = "dip" | "push";

export function familyOf(kind: TransitionKind): TransitionFamily {
  switch (kind) {
    case "dissolve":
    case "slideLeft":
    case "slideRight":
    case "slideUp":
    case "slideDown":
    // A zoom-out is the outgoing frame scaling up and away, so it needs the
    // freeze too — unlike zoom-in, which is a punch through the live frame.
    case "zoomOut":
      return "push";
    default:
      return "dip";
  }
}

export interface ActiveTransition {
  boundary: Boundary;
  kind: TransitionKind;
  family: TransitionFamily;
  /** 0 → 1 across the whole transition window. */
  progress: number;
  /** Effective duration after clamping to the room available. */
  duration: number;
}

/**
 * Longest a transition may actually run, given how short its neighbours are.
 * A dip needs half its length on each side; a push needs all of it after.
 */
export function clampTransitionDuration(
  boundary: Boundary,
  kind: TransitionKind,
  requested: number
): number {
  if (kind === "none") return 0;
  const room =
    familyOf(kind) === "dip"
      ? Math.min(boundary.roomBefore, boundary.roomAfter) * 2
      : boundary.roomAfter;
  // Leave a sliver of clean frame so back-to-back transitions never collide.
  return Math.max(0, Math.min(requested, room * 0.9));
}

/** The transition covering output second `t`, if any. */
export function transitionAt(
  t: number,
  timeline: OutputTimeline,
  transitions: Transition[]
): ActiveTransition | null {
  for (const spec of transitions) {
    if (spec.kind === "none" || spec.duration <= 0) continue;
    const boundary = timeline.boundaries.find((b) => b.index === spec.index);
    if (!boundary) continue;

    const family = familyOf(spec.kind);
    const duration = clampTransitionDuration(boundary, spec.kind, spec.duration);
    if (duration <= 0) continue;

    const from =
      family === "dip" ? boundary.outTime - duration / 2 : boundary.outTime;
    if (t < from || t >= from + duration) continue;

    return {
      boundary,
      kind: spec.kind,
      family,
      progress: (t - from) / duration,
      duration,
    };
  }
  return null;
}

/** Every output-time window a transition occupies. Used to prefetch freezes. */
export function transitionWindows(
  timeline: OutputTimeline,
  transitions: Transition[]
): Array<{ boundary: Boundary; kind: TransitionKind; from: number; to: number }> {
  const out: Array<{
    boundary: Boundary;
    kind: TransitionKind;
    from: number;
    to: number;
  }> = [];
  for (const spec of transitions) {
    if (spec.kind === "none" || spec.duration <= 0) continue;
    const boundary = timeline.boundaries.find((b) => b.index === spec.index);
    if (!boundary) continue;
    const duration = clampTransitionDuration(boundary, spec.kind, spec.duration);
    if (duration <= 0) continue;
    const from =
      familyOf(spec.kind) === "dip"
        ? boundary.outTime - duration / 2
        : boundary.outTime;
    out.push({ boundary, kind: spec.kind, from, to: from + duration });
  }
  return out;
}

/** Drop transitions whose boundary no longer exists after an edit. */
export function pruneTransitions(
  transitions: Transition[],
  timeline: OutputTimeline
): Transition[] {
  const valid = new Set(timeline.boundaries.map((b) => b.index));
  return transitions.filter((t) => valid.has(t.index));
}
