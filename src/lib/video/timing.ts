import { clamp } from "./easing";

/**
 * Voice-driven timing.
 *
 * The narration is the clock. Cartesia returns the start and end of every word
 * it spoke, so a visual beat no longer has to guess where it belongs in a
 * scene: it is pinned to the moment its own words are said, and the whole
 * composition breathes with the voice instead of sliding past it on a linear
 * ramp.
 *
 * When timings are unavailable -- an older cached clip, or the mp3 fallback --
 * `estimateWordTimings` produces a plausible stand-in from the transcript so
 * every consumer downstream can assume timings always exist.
 */

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

/* ------------------------------- estimation ------------------------------- */

/** Syllable-ish weight: long words genuinely take longer to say. */
function weightOf(word: string): number {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, "");
  const vowels = letters.match(/[aeiouyAEIOUYऀ-ॿ஀-௿]+/g)?.length ?? 0;
  return Math.max(1, vowels || Math.ceil(letters.length / 3));
}

/** Trailing punctuation buys a pause, the way a speaker takes one. */
function pauseAfter(word: string): number {
  if (/[.!?]["')\]]?$/.test(word)) return 0.34;
  if (/[,;:—]["')\]]?$/.test(word)) return 0.18;
  return 0;
}

/**
 * Spreads `duration` across the transcript's words, weighted by length and
 * punctuation. Used only when the provider gave us no real timings.
 */
export function estimateWordTimings(transcript: string, duration: number): WordTiming[] {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  if (!words.length || !(duration > 0)) return [];

  const weights = words.map(weightOf);
  const pauses = words.map(pauseAfter);
  const totalPause = pauses.reduce((sum, value) => sum + value, 0);
  const speech = Math.max(0.2, duration - totalPause);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;

  const timings: WordTiming[] = [];
  let cursor = 0;
  words.forEach((word, index) => {
    const span = (weights[index] / totalWeight) * speech;
    timings.push({ word, start: cursor, end: cursor + span });
    cursor += span + pauses[index];
  });
  return timings;
}

/** Real timings when we have them, a stand-in when we don't. */
export function resolveWordTimings(
  transcript: string,
  duration: number | undefined,
  provided?: WordTiming[],
): WordTiming[] {
  if (provided?.length) return provided;
  return estimateWordTimings(transcript, duration ?? 0);
}

/* --------------------------------- matching -------------------------------- */

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are",
  "was", "were", "be", "been", "it", "its", "this", "that", "these", "those", "as", "at",
  "by", "from", "into", "than", "then", "so", "we", "you", "your", "our", "their", "they",
  "not", "no", "can", "will", "just", "how", "why", "what", "when", "which", "who",
]);

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Trims a phrase down to the words worth searching the narration for. */
function tokensOf(phrase: string): string[] {
  return phrase
    .split(/\s+/)
    .map(normalise)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

/** Matches "processing" against "process" without dragging in a stemmer. */
function similar(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 4) return false;
  return longer.startsWith(shorter.slice(0, Math.max(4, shorter.length - 2)));
}

/* ----------------------------------- cues ---------------------------------- */

export interface CueRequest {
  /** Text this beat is about; used to find the moment it is spoken. */
  text?: string;
  /** Shortest this beat may run once it starts. */
  minSpan?: number;
  /** Longest it should run before the next beat takes over. */
  maxSpan?: number;
  /** Relative share of any spare time. Larger beats get more room. */
  weight?: number;
}

export interface Cue {
  /** Seconds into the scene at which this beat begins. */
  at: number;
  /** Seconds this beat has to complete its entrance. */
  span: number;
  /** True when the beat was pinned to a word actually spoken. */
  anchored: boolean;
}

export interface CuePlanOptions {
  /** Silence before the narration starts, in seconds. */
  lead: number;
  /** Length of the narration itself. */
  speech: number;
  /** Hold after the narration ends. */
  tail: number;
  /** How far ahead of its word a beat starts drawing. */
  preroll?: number;
  /** Minimum gap between two beats starting. */
  minGap?: number;
  /**
   * How far a beat may be pulled from its evenly-spaced position to meet the
   * word that names it, as a multiple of the spacing between beats.
   *
   * Pure anchoring is not the goal. A script often names every item on the
   * board inside its closing sentence, and obeying that literally leaves ten
   * seconds of empty frame followed by everything at once. Anchoring inside a
   * bounded window keeps the sync where the script allows it and the pacing
   * where it does not.
   */
  drift?: number;
}

/**
 * Places each requested beat on the scene's timeline.
 *
 * A beat whose words appear in the narration is pinned just before they are
 * spoken -- the drawing lands as the sentence does. Anything unmatched is
 * spaced evenly through whatever room its neighbours leave, so a scene never
 * stalls and never races.
 */
export function planCues(
  requests: CueRequest[],
  words: WordTiming[],
  options: CuePlanOptions,
): Cue[] {
  const count = requests.length;
  if (!count) return [];

  const { lead, speech, tail } = options;
  const preroll = options.preroll ?? 0.42;
  const minGap = options.minGap ?? 0.34;
  const total = lead + speech + tail;

  const normalised = words.map((entry) => normalise(entry.word));

  // Evenly-spaced positions, the pacing anchoring is allowed to bend.
  const usable = lead + speech * 0.82;
  const spacing = count > 1 ? usable / count : usable;
  const tolerance = spacing * (options.drift ?? 0.75);
  const evenly = (index: number) => index * spacing;

  // Pass 1 -- pin what we can to the moment it is spoken.
  const anchors: Array<number | null> = new Array(count).fill(null);
  let searchFrom = 0;

  requests.forEach((request, index) => {
    const tokens = request.text ? tokensOf(request.text) : [];
    if (!tokens.length || !words.length) return;

    for (let w = searchFrom; w < words.length; w += 1) {
      if (!tokens.some((token) => similar(token, normalised[w]))) continue;
      const spoken = lead + Math.max(0, words[w].start - preroll);
      anchors[index] = clamp(spoken, evenly(index) - tolerance, evenly(index) + tolerance);
      searchFrom = w + 1;
      return;
    }
  });

  // The opening beat belongs at the top of the scene, not wherever its
  // heading happens to be repeated mid-sentence.
  if (anchors[0] !== null && anchors[0] > lead + speech * 0.25) anchors[0] = 0;
  if (anchors[0] === null) anchors[0] = 0;

  // Pass 2 -- fill the gaps by spreading unmatched beats between their anchors.
  const at: number[] = new Array(count).fill(0);
  let index = 0;
  while (index < count) {
    if (anchors[index] !== null) {
      at[index] = anchors[index] as number;
      index += 1;
      continue;
    }

    // Find the next pinned beat and share the run-up evenly.
    let next = index;
    while (next < count && anchors[next] === null) next += 1;

    const from = index === 0 ? 0 : at[index - 1];
    const to = next < count ? (anchors[next] as number) : usable;
    const slots = next - index + 1;
    for (let k = index; k < next; k += 1) {
      at[k] = from + ((to - from) * (k - index + 1)) / slots;
    }
    index = next;
  }

  // Pass 3 -- monotonic, spaced, and inside the scene.
  const lastStart = Math.max(0, total - tail * 0.5 - 0.25);
  for (let i = 0; i < count; i += 1) {
    const floor = i === 0 ? 0 : at[i - 1] + minGap;
    at[i] = clamp(Math.max(at[i], floor), 0, lastStart);
  }
  // If clamping stacked the tail, walk backwards to reopen the gaps.
  for (let i = count - 2; i >= 0; i -= 1) {
    if (at[i + 1] - at[i] < minGap) at[i] = Math.max(0, at[i + 1] - minGap);
  }

  return at.map((start, i) => {
    const request = requests[i];
    const until = i + 1 < count ? at[i + 1] : lead + speech + tail * 0.6;
    const available = Math.max(0.2, until - start);
    const span = clamp(available * 1.12, request.minSpan ?? 0.45, request.maxSpan ?? 2.4);
    return { at: start, span, anchored: anchors[i] !== null };
  });
}

/* -------------------------------- subtitles -------------------------------- */

export interface SubtitlePhrase {
  words: WordTiming[];
  start: number;
  end: number;
}

/**
 * Groups words into the short phrases a subtitle actually shows.
 *
 * Breaks follow the speech, not a fixed word count: sentence punctuation ends a
 * phrase, an audible gap ends a phrase, and a phrase that has grown too wide to
 * read ends itself.
 */
export function buildPhrases(
  words: WordTiming[],
  options: { maxWords?: number; maxChars?: number; maxSeconds?: number; gap?: number } = {},
): SubtitlePhrase[] {
  const maxWords = options.maxWords ?? 4;
  const maxChars = options.maxChars ?? 30;
  const maxSeconds = options.maxSeconds ?? 2.4;
  const gap = options.gap ?? 0.42;

  const phrases: SubtitlePhrase[] = [];
  let current: WordTiming[] = [];
  let chars = 0;

  const flush = () => {
    if (!current.length) return;
    phrases.push({
      words: current,
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    current = [];
    chars = 0;
  };

  words.forEach((entry, index) => {
    const previous = words[index - 1];
    if (current.length && previous && entry.start - previous.end > gap) flush();

    current.push(entry);
    chars += entry.word.length + 1;

    const spanTooLong = entry.end - current[0].start > maxSeconds;
    const sentenceEnd = /[.!?…]["')\]]?$/.test(entry.word);
    const clauseEnd = /[,;:—]["')\]]?$/.test(entry.word);

    if (sentenceEnd) flush();
    else if (current.length >= maxWords || chars >= maxChars || spanTooLong) flush();
    else if (clauseEnd && current.length >= 3) flush();
  });
  flush();

  return phrases;
}

/**
 * The shortest a line of text may hold before the next one arrives.
 *
 * Roughly four words a second of silent reading, floored so nothing ever
 * flashes past. A beat that lands before the last one has been read is not a
 * beat, it is a distraction -- and this is the single most common reason a
 * dense explainer leaves a viewer behind.
 */
export function readingTime(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return clamp(0.55 + words * 0.26, 0.9, 3.4);
}

/** The phrase on screen at `time`, and the word inside it being spoken. */
export function phraseAt(
  phrases: SubtitlePhrase[],
  time: number,
): { phrase: SubtitlePhrase; index: number; wordIndex: number } | null {
  if (!phrases.length) return null;

  for (let i = 0; i < phrases.length; i += 1) {
    const phrase = phrases[i];
    const next = phrases[i + 1];
    // A phrase holds until the next one starts, so the card never blinks out
    // during the breath between two sentences.
    const until = next ? next.start : phrase.end + 0.6;
    if (time < phrase.start - 0.12 || time >= until) continue;

    let wordIndex = 0;
    for (let w = 0; w < phrase.words.length; w += 1) {
      if (time >= phrase.words[w].start) wordIndex = w;
    }
    return { phrase, index: i, wordIndex };
  }
  return null;
}

/** Loudness stand-in: how much speech energy sits around `time`. */
export function speechEnergy(words: WordTiming[], time: number, window = 0.22): number {
  if (!words.length) return 0;
  let energy = 0;
  for (const entry of words) {
    if (entry.end < time - window || entry.start > time + window) continue;
    const overlap =
      Math.min(entry.end, time + window) - Math.max(entry.start, time - window);
    if (overlap > 0) energy += overlap / (window * 2);
  }
  return clamp(energy, 0, 1);
}
