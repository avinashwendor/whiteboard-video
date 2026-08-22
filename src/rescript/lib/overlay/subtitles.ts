/**
 * Subtitle cues built from the transcript the editor already has.
 *
 * The words carry per-word timings, so nothing needs to be re-aligned or
 * re-transcribed: cut words are dropped, the survivors are mapped onto the
 * output clock, and they are grouped into cues that read well. The per-word
 * timings ride along on each cue, which is what makes the karaoke style
 * possible without a second pass.
 */

import { isWordCutOut, originalToEdited } from "../edits";
import type { TimeRange, Word } from "../types";
import type { SubtitleCue, SubtitleStyle, SubtitleWord } from "./types";

/** A pause at least this long starts a new cue, whatever the line length. */
const GAP_BREAK_S = 0.7;
/** Never leave a cue on screen longer than this. */
const MAX_CUE_S = 6;
/** Nor shorter than this — a flash of two words is unreadable. */
const MIN_CUE_S = 0.6;

function endsSentence(text: string): boolean {
  return /[.!?…]["')\]]?$/.test(text);
}

function endsClause(text: string): boolean {
  return /[,;:—-]$/.test(text);
}

/**
 * Cue ids are derived from the cue itself, not from a counter.
 *
 * A module-level counter looks fine until the module is re-evaluated — a hot
 * reload, a second entry point — at which point it restarts and a fresh batch
 * collides with cues already on screen. React then renders two children with
 * the same key and quietly drops one. Deriving the id from the start time and
 * the position in the batch is unique by construction and stable across a
 * regeneration that produces the same cues.
 */
function cueId(start: number, index: number): string {
  return `cue-${index}-${Math.round(start * 1000)}`;
}

export interface CueOptions {
  maxCharsPerLine: number;
  maxLines: number;
}

/**
 * Build cues for the current cut.
 *
 * `cuts` are the ranges removed from the source; words inside them are skipped
 * and every surviving timestamp is translated to the output clock, so a cue's
 * times are directly comparable to an overlay element's.
 */
export function buildCues(
  words: Word[],
  cuts: TimeRange[],
  { maxCharsPerLine, maxLines }: CueOptions
): SubtitleCue[] {
  const budget = Math.max(8, maxCharsPerLine * Math.max(1, maxLines));

  const kept: SubtitleWord[] = [];
  for (const word of words) {
    if (word.deleted) continue;
    if (isWordCutOut(word, cuts)) continue;
    const text = word.text.trim();
    if (!text) continue;
    const start = originalToEdited(word.start, cuts);
    const end = originalToEdited(word.end, cuts);
    // A word straddling a cut collapses to zero length on the output clock;
    // it contributes its text but must not produce a backwards cue.
    kept.push({ text, start, end: Math.max(end, start) });
  }
  if (!kept.length) return [];

  const cues: SubtitleCue[] = [];
  let group: SubtitleWord[] = [];

  const flush = () => {
    if (!group.length) return;
    const start = group[0].start;
    const rawEnd = group[group.length - 1].end;
    const end = Math.max(rawEnd, start + MIN_CUE_S);
    cues.push({
      id: cueId(start, cues.length),
      start,
      end,
      text: group.map((w) => w.text).join(" "),
      words: group,
    });
    group = [];
  };

  for (let i = 0; i < kept.length; i++) {
    const word = kept[i];
    const previous = group[group.length - 1];

    if (previous) {
      const gap = word.start - previous.end;
      const span = word.end - group[0].start;
      const length = group.reduce((n, w) => n + w.text.length + 1, 0);
      if (
        gap >= GAP_BREAK_S ||
        span >= MAX_CUE_S ||
        length + word.text.length > budget ||
        endsSentence(previous.text) ||
        // Break on a clause only once the cue is already substantial, or every
        // comma would produce a two-word flash.
        (endsClause(previous.text) && length > budget * 0.55)
      ) {
        flush();
      }
    }
    group.push(word);
  }
  flush();

  // Stop a cue when the next one begins, so nothing overlaps on screen.
  for (let i = 0; i < cues.length - 1; i++) {
    if (cues[i].end > cues[i + 1].start) cues[i].end = cues[i + 1].start;
  }
  return cues.filter((c) => c.end > c.start);
}

/**
 * How many characters actually fit on one line of this frame.
 *
 * `maxCharsPerLine` is a taste setting — "break these captions short" — and it
 * was tuned against a widescreen frame. On a vertical one the same number is a
 * line half again as wide as the phone, and the renderer's own width wrap then
 * produces more lines than `maxLines` allows, which it resolves by joining the
 * overflow into a single line that runs off both edges.
 *
 * So the taste setting is capped by the geometry. The renderer wraps at 86% of
 * the frame width and average glyph width is about 0.52em for the weights these
 * presets use; the type unit is the same one `render.ts` applies.
 */
export function fittedCharsPerLine(
  style: SubtitleStyle,
  aspect: number
): number {
  const safeAspect = aspect > 0 ? aspect : 16 / 9;
  const unitPerWidth = style.fontSize * Math.min(1 / safeAspect, 4 / 3);
  if (!(unitPerWidth > 0)) return style.maxCharsPerLine;
  const fits = Math.floor(0.86 / (0.52 * unitPerWidth));
  return Math.max(8, Math.min(style.maxCharsPerLine, fits));
}

export function cuesFromStyle(
  words: Word[],
  cuts: TimeRange[],
  style: SubtitleStyle,
  aspect = 16 / 9
): SubtitleCue[] {
  return buildCues(words, cuts, {
    maxCharsPerLine: fittedCharsPerLine(style, aspect),
    maxLines: style.maxLines,
  });
}

/* ------------------------------ style presets ------------------------------ */

export interface SubtitlePreset {
  id: string;
  label: string;
  description: string;
  style: Partial<SubtitleStyle>;
}

export const SUBTITLE_PRESETS: SubtitlePreset[] = [
  {
    id: "clean",
    label: "Clean",
    description: "White type on a soft slab. Reads anywhere.",
    style: {
      color: "#ffffff",
      background: "rgba(0,0,0,0.55)",
      outline: false,
      shadow: true,
      uppercase: false,
      fontWeight: 600,
      fontSize: 0.05,
      animation: "fade",
    },
  },
  {
    id: "broadcast",
    label: "Broadcast",
    description: "Outlined, no box — the television default.",
    style: {
      color: "#ffffff",
      background: null,
      outline: true,
      shadow: true,
      uppercase: false,
      fontWeight: 600,
      fontSize: 0.052,
      animation: "fade",
    },
  },
  {
    id: "shorts",
    label: "Shorts",
    description: "Big, capitalised, one line at a time.",
    style: {
      color: "#ffffff",
      background: null,
      outline: true,
      shadow: true,
      uppercase: true,
      fontWeight: 800,
      fontSize: 0.072,
      maxCharsPerLine: 18,
      maxLines: 1,
      position: "center",
      animation: "pop",
    },
  },
  {
    id: "karaoke",
    label: "Word pop",
    description: "The spoken word lights up as it is said.",
    style: {
      color: "#ffffff",
      highlight: "#ffd60a",
      background: null,
      outline: true,
      shadow: true,
      uppercase: true,
      fontWeight: 800,
      fontSize: 0.064,
      maxCharsPerLine: 22,
      maxLines: 2,
      animation: "karaoke",
    },
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Light weight, low contrast, sits back.",
    style: {
      color: "#f4f4f5",
      background: null,
      outline: false,
      shadow: true,
      uppercase: false,
      fontWeight: 400,
      fontSize: 0.042,
      animation: "fade",
    },
  },
];
