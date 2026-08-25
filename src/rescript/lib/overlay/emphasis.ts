"use client";

/**
 * Where a punch-in earns its place.
 *
 * Every short-form tool zooms. Most of them zoom badly, because they zoom on a
 * timer: every eight seconds, whatever is being said. What that produces is a
 * video that is restless rather than emphatic, and the giveaway is a zoom
 * landing in the middle of a clause.
 *
 * So the beats are read out of the transcript the editor already has, and then
 * — more importantly — most of them are thrown away. Spacing is what makes an
 * edit read as directed: three well-placed pushes in ninety seconds is
 * emphasis, and twelve is a nervous tic. The rules at the bottom are doing more
 * work than the scoring at the top.
 *
 * Everything is in **edited-timeline seconds**, the clock the viewer sees, so a
 * beat survives an upstream cut moving where its moment sits in the source.
 */

import { getCutRanges, isWordCutOut, originalToEdited } from "../edits";
import type { ManualCut, Word } from "../types";

export interface Beat {
  /** Output-clock second the emphasis lands on. */
  at: number;
  /** Higher is a better place to punch in. */
  score: number;
  /** The word that earned it, for the log line. */
  word: string;
  /** Where in the source picture the interest is, when we can tell. 0..1. */
  focusX?: number;
}

/* --------------------------------- scoring --------------------------------- */

/** A pause this long before a word makes what follows it land. */
const MEANINGFUL_PAUSE_S = 0.42;

/** Numbers are the single most reliable thing to emphasise in spoken material. */
const NUMERIC = /\d/;

/** Words that are almost always the start of the point, not the point itself. */
const WEAK_OPENERS = new Set([
  "so", "and", "but", "or", "well", "okay", "ok", "um", "uh", "like",
  "yeah", "right", "now", "then", "just", "the", "a", "an", "i", "we",
  "it", "that", "this", "there", "you",
]);

function endsSentence(text: string): boolean {
  return /[.!?…]["')\]]?$/.test(text);
}

/**
 * Score every word as a place to push in.
 *
 * A score of zero means "never here". The scores are relative and only ever
 * compared against each other, so the absolute numbers matter less than their
 * order — but the order was chosen deliberately: a pause beats a full stop,
 * because the pause is the speaker themselves telling you the next thing
 * matters.
 */
export function findBeats(
  words: Word[],
  duration: number,
  manualCuts: ManualCut[]
): Beat[] {
  const cuts = getCutRanges(words, duration, manualCuts);
  const live = words.filter((w) => !w.deleted && !isWordCutOut(w, cuts));
  if (live.length === 0) return [];

  const beats: Beat[] = [];

  for (let i = 0; i < live.length; i += 1) {
    const word = live[i];
    const previous = live[i - 1];
    const clean = word.text.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
    if (!clean) continue;

    let score = 0;

    // The speaker paused, then said this. They are doing the emphasis; the
    // camera is only agreeing with them.
    const gap = previous ? word.start - previous.end : 0;
    if (gap >= MEANINGFUL_PAUSE_S) score += 3 + Math.min(2, gap - MEANINGFUL_PAUSE_S);

    // The first word of a new sentence is a new thought.
    if (previous && endsSentence(previous.text)) score += 2;

    // A figure is a fact, and a fact is worth landing on.
    if (NUMERIC.test(word.text)) score += 2.5;

    // A capital mid-sentence is a name or a product — usually the subject.
    if (previous && !endsSentence(previous.text) && /^[A-Z]/.test(word.text)) score += 1.5;

    // A new speaker is a new shot in every edit ever made.
    if (previous && previous.speaker !== word.speaker && word.speaker >= 0) score += 3;

    // …but not on a word that carries nothing, whatever else it scored.
    if (WEAK_OPENERS.has(clean)) score *= 0.25;

    if (score <= 0) continue;
    beats.push({
      at: originalToEdited(word.start, cuts),
      score,
      word: word.text,
    });
  }

  return beats.sort((a, b) => b.score - a.score);
}

/* -------------------------------- placement -------------------------------- */

/**
 * Never two pushes closer together than this.
 *
 * The number that matters most in this file. Below about five seconds the
 * camera stops reading as emphasis and starts reading as a fault.
 */
const MIN_GAP_S = 6;

/** A shot shorter than this cannot hold a move; the move would never arrive. */
const MIN_SHOT_S = 1.6;

/** How long a punch-in holds before the frame opens back up. */
const SHOT_S = 3.2;

export interface PlacementOptions {
  /** Roughly how many per minute. The spacing rule still wins. */
  perMinute?: number;
  /** Total runtime of the finished video, in output seconds. */
  duration: number;
}

export interface PlacedPunch {
  start: number;
  end: number;
  beat: Beat;
}

/**
 * Choose which beats actually become shots.
 *
 * Best-first, then spaced — not spaced, then best. Taking the strongest beat
 * and clearing its neighbourhood means a merely-good moment never displaces the
 * best one nearby, which is what a chronological pass does.
 */
export function placePunchIns(
  beats: Beat[],
  options: PlacementOptions
): PlacedPunch[] {
  const { duration } = options;
  if (duration <= 0 || beats.length === 0) return [];

  const perMinute = options.perMinute ?? 2.5;
  const budget = Math.max(1, Math.round((duration / 60) * perMinute));

  const taken: PlacedPunch[] = [];
  for (const beat of beats) {
    if (taken.length >= budget) break;

    const start = beat.at;
    const end = Math.min(duration, start + SHOT_S);
    if (end - start < MIN_SHOT_S) continue;

    // Spacing is measured between starts, so a long shot cannot smuggle a
    // second push in behind its own tail.
    const tooClose = taken.some((p) => Math.abs(p.start - start) < MIN_GAP_S);
    if (tooClose) continue;

    taken.push({ start, end, beat });
  }

  return taken.sort((a, b) => a.start - b.start);
}
