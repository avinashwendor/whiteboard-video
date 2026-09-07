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
import { typefaceStack } from "./typefaces";
import type { TimeRange, Word } from "../types";
import type {
  SubtitleCue,
  SubtitleStyle,
  SubtitleTrack,
  SubtitleWord,
} from "./types";

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
  /** Hard ceiling on words per cue. 0 leaves it to the character budget. */
  maxWords?: number;
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
  { maxCharsPerLine, maxLines, maxWords = 0 }: CueOptions
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
  return groupIntoCues(kept, budget, maxWords);
}

/**
 * Group already-cut, already-translated words into cues.
 *
 * Split out of `buildCues` so re-wrapping for a different frame shape runs the
 * *same* break rules — sentence ends, clause ends once a cue is substantial,
 * gaps, and the length budget. A second implementation of those would drift,
 * and the drift would show up as captions that break differently in the
 * vertical cut than in the master, which is exactly what re-wrapping is
 * supposed to prevent.
 */
function groupIntoCues(
  kept: SubtitleWord[],
  budget: number,
  maxWords = 0
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let group: SubtitleWord[] = [];

  const flush = () => {
    if (!group.length) return;
    const start = group[0].start;
    const rawEnd = group[group.length - 1].end;
    // The minimum hold exists so a two-word cue is not a flash. It cannot
    // apply to a deliberately dense track: one word is spoken in about 0.3s,
    // so padding every cue to 0.6s makes each one overlap the next, and the
    // de-overlap pass below then trims them all back to nothing. A track that
    // asked for one word at a time gets the word's own length.
    const floor = maxWords > 0 && maxWords <= 2 ? 0.12 : MIN_CUE_S;
    const end = Math.max(rawEnd, start + floor);
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
        // The word ceiling, which the character budget cannot express: a
        // one-word cue is nowhere near 76 characters, so without this the
        // grouper simply keeps going and "one word at a time" silently
        // produces ordinary two-line captions.
        (maxWords > 0 && group.length >= maxWords) ||
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
    maxWords: style.maxWords,
  });
}

/**
 * Re-break existing cues for a different frame shape.
 *
 * Line length is a function of the frame — `fittedCharsPerLine` caps the taste
 * setting by the geometry — so a vertical delivery of a widescreen project
 * keeps captions cut three words too long for it, every one of them. The
 * renderer then wraps them itself and produces more lines than `maxLines`
 * allows, which it resolves by running text off both edges.
 *
 * This needs no transcript, which is the point: cues carry their own per-word
 * timings, already on the output clock and already past the cut. So a
 * deliverable in another shape can be re-broken without reaching across into
 * the store that owns the words — the coupling the two stores exist to avoid.
 *
 * Returns the track untouched when there is nothing to re-break, or when any
 * cue is missing its word timings — an imported SRT has none, and re-flowing
 * those by splitting text would move captions off the beats they were written
 * for. Slightly-too-long lines beat captions that no longer match the speech.
 */
export function rewrapCues(
  track: SubtitleTrack,
  aspect: number
): SubtitleTrack {
  if (!track.enabled || track.cues.length === 0) return track;
  if (track.cues.some((cue) => !cue.words?.length)) return track;

  const style = track.style;
  const budget = Math.max(
    8,
    fittedCharsPerLine(style, aspect) * Math.max(1, style.maxLines)
  );

  const words = track.cues.flatMap((cue) => cue.words ?? []);
  if (words.length === 0) return track;

  const cues = groupIntoCues(words, budget, style.maxWords);
  return cues.length ? { ...track, cues } : track;
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
      fontFamily: typefaceStack("sans"),
      maxWords: 0,
      activeScale: 1,
      emphasis: "off",
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
      fontFamily: typefaceStack("sans"),
      maxWords: 0,
      activeScale: 1,
      emphasis: "off",
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
      fontFamily: typefaceStack("anton"),
      maxWords: 0,
      activeScale: 1,
      emphasis: "auto",
      emphasisColor: "#ffd60a",
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
      fontFamily: typefaceStack("grotesk"),
      maxWords: 0,
      activeScale: 1.05,
      emphasis: "off",
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
      fontFamily: typefaceStack("sans"),
      color: "#f4f4f5",
      background: null,
      outline: false,
      shadow: true,
      uppercase: false,
      fontWeight: 400,
      fontSize: 0.042,
      maxWords: 0,
      activeScale: 1,
      emphasis: "off",
      animation: "fade",
    },
  },

  /* ------------------------- the loud half of the list ---------------------- */
  //
  // Everything above is a *subtitle*: something you read while watching
  // something else. Everything below is a *caption* in the short-form sense —
  // it is the thing you are watching, it changes every few hundred
  // milliseconds, and it is why a viewer's thumb does not move. They are
  // different jobs and the list needed both; it only had the first.
  {
    id: "oneWord",
    label: "One word",
    description: "A single word at a time, huge, in the middle. The short-form default.",
    style: {
      fontFamily: typefaceStack("anton"),
      color: "#ffffff",
      highlight: "#ffd60a",
      background: null,
      outline: true,
      shadow: false,
      uppercase: true,
      fontWeight: 400,
      fontSize: 0.105,
      maxCharsPerLine: 14,
      maxLines: 1,
      // The whole preset, in one number.
      maxWords: 1,
      position: "center",
      animation: "pop",
      activeScale: 1,
      emphasis: "auto",
      emphasisColor: "#ffd60a",
    },
  },
  {
    id: "punch",
    label: "Punch",
    description: "Two or three words, bouncing on the beat, figures in the accent.",
    style: {
      fontFamily: typefaceStack("archivo"),
      color: "#ffffff",
      highlight: "#ffd60a",
      background: null,
      outline: true,
      shadow: false,
      uppercase: true,
      fontWeight: 400,
      fontSize: 0.082,
      maxCharsPerLine: 20,
      maxLines: 1,
      maxWords: 3,
      position: "center",
      animation: "bounce",
      // The live word grows a little as it is spoken. Small on purpose: the
      // difference between this reading as energy and as a wobble is about
      // four percent.
      activeScale: 1.12,
      emphasis: "auto",
      emphasisColor: "#4ade80",
    },
  },
  {
    id: "neonKaraoke",
    label: "Neon karaoke",
    description: "Word-by-word highlight in a hot colour, on a dark slab.",
    style: {
      fontFamily: typefaceStack("grotesk"),
      color: "#f5f3ff",
      highlight: "#f472b6",
      background: "rgba(10,4,20,0.62)",
      outline: false,
      shadow: true,
      uppercase: false,
      fontWeight: 700,
      fontSize: 0.06,
      maxCharsPerLine: 24,
      maxLines: 2,
      maxWords: 0,
      position: "bottom",
      animation: "karaoke",
      activeScale: 1.06,
      emphasis: "off",
    },
  },
  {
    id: "documentary",
    label: "Documentary",
    description: "Serif, sparse, low in frame. For a piece that is not shouting.",
    style: {
      fontFamily: typefaceStack("instrument"),
      color: "#ffffff",
      background: null,
      outline: false,
      shadow: true,
      uppercase: false,
      fontWeight: 400,
      fontSize: 0.048,
      maxCharsPerLine: 44,
      maxLines: 2,
      maxWords: 0,
      position: "bottom",
      animation: "fade",
      activeScale: 1,
      emphasis: "off",
    },
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Monospace on a black slab. For a demo or a screen recording.",
    style: {
      fontFamily: typefaceStack("mono"),
      color: "#e5e7eb",
      highlight: "#4ade80",
      background: "rgba(6,8,10,0.82)",
      outline: false,
      shadow: false,
      uppercase: false,
      fontWeight: 500,
      fontSize: 0.042,
      maxCharsPerLine: 46,
      maxLines: 2,
      maxWords: 0,
      position: "bottom",
      animation: "none",
      activeScale: 1,
      emphasis: "auto",
      emphasisColor: "#4ade80",
    },
  },
];

export type SubtitlePresetId = (typeof SUBTITLE_PRESETS)[number]["id"];

/**
 * The preset ids, for the schema's enum.
 *
 * Derived rather than restated. `ops-schema.ts` held its own copy of this list
 * for a year, and the moment the library grew the schema went on rejecting the
 * new names — an operation the prompt taught, the executor understood, and the
 * validator threw away before either saw it.
 */
export const SUBTITLE_PRESET_IDS = SUBTITLE_PRESETS.map((p) => p.id) as [
  string,
  ...string[],
];

/** The presets as the agent is shown them, quietest first. */
export function describeSubtitlePresets(): string {
  return SUBTITLE_PRESETS.map(
    (preset) => `    ${preset.id.padEnd(13)}${preset.description.replace(/\.$/, "")}`
  ).join("\n");
}
