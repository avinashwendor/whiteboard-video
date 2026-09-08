"use client";

/**
 * What the editor already knows about the footage, measured rather than guessed.
 *
 * The agent plans much better when it is told "there are 14 fillers and 22
 * seconds of dead air across 9 pauses" than when it has to infer that from a
 * transcript. Every number here comes from the same functions the UI's own
 * tools use — the filler finder, the silence detector, the cut model — so a
 * proposal that says "this will take about 30 seconds off" is quoting the
 * result of the operation it is about to run, not an estimate.
 */

import { findFillerWordIds } from "../fillers";
import { findSilenceRanges, MIN_SILENCE_DURATION } from "../silences";
import { getCutRanges, isWordCutOut, originalToEdited } from "../edits";
import type { ManualCut, SceneBoundary, Word } from "../types";
import { buildTimeline } from "./timeline";

export interface Pause {
  /** Output-clock second the gap begins. */
  at: number;
  seconds: number;
}

export interface FootageAnalysis {
  /** Length of the current cut. */
  duration: number;
  /** Words still in the video. */
  wordCount: number;
  /** Speaking pace over the kept material. */
  wordsPerMinute: number;
  /** Distinct speakers heard. */
  speakerCount: number;
  fillerCount: number;
  /** What cutting the fillers would remove, in seconds. */
  fillerSeconds: number;
  silenceCount: number;
  silenceSeconds: number;
  /** The longest gaps, worst first — the ones worth naming in a proposal. */
  longestPauses: Pause[];
  clipCount: number;
  /** True when the material is long enough that trimming is the real work. */
  runsLong: boolean;
}

const LONG_ENOUGH_TO_TRIM_S = 90;

export function analyseFootage(
  words: Word[],
  duration: number,
  manualCuts: ManualCut[],
  sceneBoundaries: SceneBoundary[]
): FootageAnalysis {
  const cuts = getCutRanges(words, duration, manualCuts);
  const timeline = buildTimeline(words, duration, manualCuts, sceneBoundaries);
  const live = words.filter((w) => !w.deleted && !isWordCutOut(w, cuts));

  const fillerIds = findFillerWordIds(words);
  const fillerSeconds = words
    .filter((w) => fillerIds.includes(w.id))
    .reduce((n, w) => n + Math.max(0, w.end - w.start), 0);

  const silences = findSilenceRanges(
    words,
    duration,
    manualCuts,
    MIN_SILENCE_DURATION
  );
  const silenceSeconds = silences.reduce(
    (n, r) => n + Math.max(0, r.end - r.start),
    0
  );

  const longestPauses: Pause[] = [...silences]
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, 6)
    .map((r) => ({
      at: originalToEdited(r.start, cuts),
      seconds: r.end - r.start,
    }))
    .sort((a, b) => a.at - b.at);

  const speakers = new Set(live.map((w) => w.speaker).filter((s) => s >= 0));
  const minutes = timeline.duration / 60;

  return {
    duration: timeline.duration,
    wordCount: live.length,
    wordsPerMinute: minutes > 0 ? Math.round(live.length / minutes) : 0,
    speakerCount: Math.max(1, speakers.size),
    fillerCount: fillerIds.length,
    fillerSeconds,
    silenceCount: silences.length,
    silenceSeconds,
    longestPauses,
    clipCount: timeline.clips.length,
    runsLong: timeline.duration > LONG_ENOUGH_TO_TRIM_S,
  };
}

/** One line per finding, for the model and for the person to read. */
export function describeAnalysis(a: FootageAnalysis): string[] {
  const lines: string[] = [
    `${a.duration.toFixed(1)}s in ${a.clipCount} clip${a.clipCount === 1 ? "" : "s"}, ${a.wordCount} words at ${a.wordsPerMinute} wpm${a.speakerCount > 1 ? `, ${a.speakerCount} speakers` : ""}.`,
  ];
  if (a.fillerCount) {
    lines.push(
      `${a.fillerCount} filler word${a.fillerCount === 1 ? "" : "s"} — about ${a.fillerSeconds.toFixed(1)}s.`
    );
  } else {
    lines.push("No filler words.");
  }
  if (a.silenceCount) {
    lines.push(
      `${a.silenceCount} pause${a.silenceCount === 1 ? "" : "s"} over ${MIN_SILENCE_DURATION}s — ${a.silenceSeconds.toFixed(1)}s of dead air in total.`
    );
    if (a.longestPauses.length) {
      lines.push(
        `Longest: ${a.longestPauses
          .map((p) => `${p.seconds.toFixed(1)}s at ${p.at.toFixed(1)}s`)
          .join(", ")}.`
      );
    }
  } else {
    lines.push("No pauses worth cutting.");
  }
  if (a.wordsPerMinute && a.wordsPerMinute < 110) {
    lines.push("Delivery is slow — tightening the pauses will help most.");
  } else if (a.wordsPerMinute > 190) {
    lines.push("Delivery is fast — leave the pauses that are there.");
  }
  if (a.runsLong) {
    lines.push("Long enough that choosing what to keep matters more than trimming.");
  }
  return lines;
}
