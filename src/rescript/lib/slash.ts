/**
 * The `/` menu: the whole editor, reachable from the place you are reading.
 *
 * A transcript editor's one real advantage over a timeline is that the words
 * are where your attention already is. You notice the stumble while reading the
 * sentence, not while scrubbing — so the fix has to be available *there*, at
 * the caret, without moving the mouse to a panel and then working out which
 * second of the finished video the sentence you were reading corresponds to.
 *
 * That translation is the point. The caret sits at a moment in the *source*
 * media; every overlay is placed against the *finished* video's clock, and the
 * two diverge the instant anything is cut. Every command below is handed both,
 * already worked out, so none of them has to think about it.
 *
 * Commands are data, not handlers. They say what they need typed, when they
 * apply, and what operations they become — and the operations are the same ones
 * the AI agent writes, run through the same executor. So the menu cannot drift
 * from the agent: an operation the agent can perform is one this menu can
 * offer, and neither can do something the other cannot see.
 *
 * Pure on purpose. Which commands are offered for a given caret, and what they
 * turn into, is decided here and tested without a DOM.
 */

import type { AgentOp } from "./overlay/ops-schema";
import { SOUND_EFFECTS } from "./overlay/sfx";
import type { Word } from "./types";


/* --------------------------------- context --------------------------------- */

/** A stretch of the finished video, and the words in it. */
export interface SlashSpan {
  ids: number[];
  text: string;
  /** Output-clock seconds. */
  from: number;
  to: number;
}

export interface SlashCapabilities {
  image: boolean;
  video: boolean;
  sfx: boolean;
  music: boolean;
}

export interface SlashContext {
  /** Source second the caret sits at — what a split is measured in. */
  at: number;
  /** The same instant on the finished video's clock — what overlays are placed on. */
  outAt: number;
  /** Length of the finished video. */
  outDuration: number;
  /** The sentence the caret is inside, if it is inside one. */
  sentence: SlashSpan | null;
  /** Silence sitting at the caret, on the output clock. */
  pause: { from: number; to: number; seconds: number } | null;
  /** Whether a scene boundary is allowed at `at`. */
  canSplit: boolean;
  can: SlashCapabilities;
}

/* --------------------------------- commands -------------------------------- */

export type SlashGroup = "cut" | "say" | "show" | "hear" | "ask";

export const SLASH_GROUP_LABELS: Record<SlashGroup, string> = {
  cut: "Cut",
  say: "Words on screen",
  show: "Pictures",
  hear: "Sound",
  ask: "Ask",
};

export interface SlashOption {
  id: string;
  label: string;
  hint?: string;
}

/** What a command needs before it can run. */
export type SlashArg =
  | { kind: "none" }
  | { kind: "text"; label: string; placeholder: string; prefill?: (c: SlashContext) => string }
  | { kind: "pick"; label: string; options: SlashOption[] };

/** What running a command produces. */
export type SlashResult =
  | { kind: "ops"; ops: AgentOp[]; note: string }
  /** Hand the whole thing to the agent instead — for anything not expressible. */
  | { kind: "ask"; prompt: string };

export interface SlashCommand {
  id: string;
  group: SlashGroup;
  title: string;
  /** One line under the title. Says what will happen, not what the thing is. */
  hint: string | ((c: SlashContext) => string);
  /** Lucide icon name; the menu maps it. Kept as a string so this file has no JSX. */
  icon: string;
  /** Extra words that should find this command. The title is already searched. */
  keywords: string[];
  /** Whether it makes sense at this caret at all. */
  when?: (c: SlashContext) => boolean;
  arg?: SlashArg;
  /** Marks a command that removes footage, so the menu can colour it. */
  destructive?: boolean;
  run: (c: SlashContext, value: string) => SlashResult;
}

/** Seconds a thing put on screen from the caret should last, by default. */
const HOLD_S = 3;

/** Clamp a span to the finished video, so nothing is placed past the end. */
function span(c: SlashContext, seconds = HOLD_S): { start: number; end: number } {
  const start = Math.max(0, Math.min(c.outAt, Math.max(0, c.outDuration - 0.3)));
  return { start, end: Math.min(c.outDuration, start + seconds) };
}

function firstWords(text: string, count: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, count).join(" ");
}

const SFX_OPTIONS: SlashOption[] = SOUND_EFFECTS.map((e) => ({
  id: e.id,
  label: e.label,
  hint: e.use,
}));

export const SLASH_COMMANDS: SlashCommand[] = [
  /* ---------------------------------- cut ---------------------------------- */
  {
    id: "split",
    group: "cut",
    title: "Split here",
    hint: "Cuts the clip in two at this word, so a transition has somewhere to sit.",
    icon: "scissors",
    keywords: ["blade", "divide", "boundary", "transition", "clip"],
    when: (c) => c.canSplit,
    run: (c) => ({
      kind: "ops",
      ops: [{ op: "splitAt", at: c.outAt }],
      note: "Split",
    }),
  },
  {
    id: "cut-sentence",
    group: "cut",
    title: "Cut this sentence",
    hint: (c) =>
      c.sentence
        ? `Removes “${firstWords(c.sentence.text, 6)}…” — ${(c.sentence.to - c.sentence.from).toFixed(1)}s.`
        : "Removes the sentence the caret is in.",
    icon: "scissors",
    keywords: ["delete", "remove", "line", "phrase"],
    destructive: true,
    when: (c) => c.sentence !== null,
    run: (c) => ({
      kind: "ops",
      ops: [{ op: "deleteRange", from: c.sentence!.from, to: c.sentence!.to }],
      note: "Cut the sentence",
    }),
  },
  {
    id: "cut-before",
    group: "cut",
    title: "Cut everything before this",
    hint: (c) => `Drops the first ${c.outAt.toFixed(1)}s and starts the video here.`,
    icon: "chevrons-left",
    keywords: ["trim", "top", "start", "intro", "head"],
    destructive: true,
    when: (c) => c.outAt > 0.3,
    run: (c) => ({
      kind: "ops",
      ops: [{ op: "deleteRange", from: 0, to: c.outAt }],
      note: "Trim the head",
    }),
  },
  {
    id: "cut-after",
    group: "cut",
    title: "Cut everything after this",
    hint: (c) =>
      `Ends the video here and drops the last ${(c.outDuration - c.outAt).toFixed(1)}s.`,
    icon: "chevrons-right",
    keywords: ["trim", "tail", "end", "outro", "stop"],
    destructive: true,
    when: (c) => c.outDuration - c.outAt > 0.3,
    run: (c) => ({
      kind: "ops",
      ops: [{ op: "deleteRange", from: c.outAt, to: c.outDuration }],
      note: "Trim the tail",
    }),
  },
  {
    id: "remove-pause",
    group: "cut",
    title: "Remove this pause",
    hint: (c) =>
      c.pause ? `Closes the ${c.pause.seconds.toFixed(1)}s of silence here.` : "Closes the silence here.",
    icon: "audio-lines",
    keywords: ["silence", "gap", "dead air", "breath", "tighten"],
    when: (c) => c.pause !== null,
    run: (c) => ({
      kind: "ops",
      ops: [{ op: "deleteRange", from: c.pause!.from, to: c.pause!.to }],
      note: "Close the pause",
    }),
  },
  {
    id: "remove-fillers",
    group: "cut",
    title: "Cut every filler",
    hint: "Every “um”, “uh” and “you know”, across the whole transcript.",
    icon: "eraser",
    keywords: ["um", "uh", "disfluency", "clean", "tidy"],
    run: () => ({
      kind: "ops",
      ops: [{ op: "removeFillers" }],
      note: "Cut the fillers",
    }),
  },
  {
    id: "tighten",
    group: "cut",
    title: "Close every gap",
    hint: "Takes out the dead air across the whole video, not just this one.",
    icon: "align-vertical-space-around",
    keywords: ["silence", "pauses", "tighten", "pace", "dead air"],
    run: () => ({
      kind: "ops",
      ops: [{ op: "removeSilences", minDuration: 0.3 }],
      note: "Close the gaps",
    }),
  },

  /* ------------------------------ words on screen --------------------------- */
  {
    id: "title",
    group: "say",
    title: "Put a title here",
    hint: "Big type over the picture, from this word.",
    icon: "type",
    keywords: ["text", "heading", "card", "headline", "supers"],
    arg: {
      kind: "text",
      label: "Title",
      placeholder: "What should it say?",
      prefill: (c) => (c.sentence ? firstWords(c.sentence.text, 4) : ""),
    },
    run: (c, value) => ({
      kind: "ops",
      ops: [
        {
          op: "addText",
          text: value,
          template: "boldSlam",
          position: "center",
          ...span(c, 2.5),
        },
      ],
      note: "Title",
    }),
  },
  {
    id: "lower-third",
    group: "say",
    title: "Put a name on screen",
    hint: "A lower third — a name and a role, bottom left.",
    icon: "credit-card",
    keywords: ["lower third", "name", "chyron", "credit", "who"],
    arg: { kind: "text", label: "Name", placeholder: "Ada Lovelace · Engineer" },
    run: (c, value) => ({
      kind: "ops",
      ops: [
        {
          op: "addText",
          text: value,
          template: "cleanBar",
          position: "bottom-left",
          ...span(c, 4),
        },
      ],
      note: "Lower third",
    }),
  },
  {
    id: "caption-phrase",
    group: "say",
    title: "Caption these words",
    hint: (c) =>
      c.sentence
        ? `Puts “${firstWords(c.sentence.text, 5)}…” on screen exactly as it is said.`
        : "Puts the words on screen exactly as they are said.",
    icon: "captions",
    keywords: ["kinetic", "on the beat", "word", "pop", "sync"],
    when: (c) => c.sentence !== null,
    run: (c) => ({
      kind: "ops",
      ops: [
        {
          op: "captionPhrase",
          phrase: firstWords(c.sentence!.text, 8),
          position: "bottom",
        },
      ],
      note: "Caption",
    }),
  },
  {
    id: "callout",
    group: "say",
    title: "Add a note here",
    hint: "A hand-written aside in the corner, the way a good explainer marks something up.",
    icon: "sticky-note",
    keywords: ["annotation", "aside", "sticky", "comment", "handwritten"],
    arg: { kind: "text", label: "Note", placeholder: "What are you pointing out?" },
    run: (c, value) => ({
      kind: "ops",
      ops: [
        {
          op: "addText",
          text: value,
          template: "handNote",
          position: "top-right",
          ...span(c, 3),
        },
      ],
      note: "Note",
    }),
  },
  {
    id: "subtitles",
    group: "say",
    title: "Turn on subtitles",
    hint: "Burnt-in captions for the whole video, timed off the transcript.",
    icon: "captions",
    keywords: ["cc", "captions", "burn", "accessibility", "karaoke"],
    run: () => ({
      kind: "ops",
      ops: [{ op: "subtitles", action: "on", preset: "punch" }],
      note: "Subtitles",
    }),
  },

  /* --------------------------------- pictures ------------------------------- */
  {
    id: "picture",
    group: "show",
    title: "Put a picture here",
    hint: "Finds a photograph and cuts it in over the footage, with a slow move on it.",
    icon: "image",
    keywords: ["photo", "still", "image", "b-roll", "cutaway"],
    when: (c) => c.can.image,
    arg: {
      kind: "text",
      label: "Picture",
      placeholder: "A photograph of…",
      prefill: (c) => (c.sentence ? firstWords(c.sentence.text, 5) : ""),
    },
    run: (c, value) => ({
      kind: "ops",
      ops: [{ op: "addImage", query: value, motion: "auto", ...span(c, 3) }],
      note: "Picture",
    }),
  },
  {
    id: "broll",
    group: "show",
    title: "Put a clip here",
    hint: "Stock footage that moves — for anything a still would make look like a slide.",
    icon: "film",
    keywords: ["b-roll", "stock", "video", "footage", "cutaway"],
    when: (c) => c.can.video,
    arg: {
      kind: "text",
      label: "Clip",
      placeholder: "Traffic at night, rain on a window…",
    },
    run: (c, value) => ({
      kind: "ops",
      ops: [{ op: "addBroll", query: value, rate: 0.9, ...span(c, 3) }],
      note: "B-roll",
    }),
  },
  {
    id: "highlight",
    group: "show",
    title: "Point at something",
    hint: "An arrow drawn onto the frame here.",
    icon: "move-up-right",
    keywords: ["arrow", "circle", "mark", "annotate", "underline", "shape"],
    arg: {
      kind: "pick",
      label: "Mark",
      options: [
        { id: "arrow", label: "Arrow", hint: "Points at it" },
        { id: "circleThis", label: "Circle", hint: "Rings it" },
        { id: "underline", label: "Underline", hint: "Sits beneath it" },
        { id: "check", label: "Tick", hint: "Marks it done" },
        { id: "cross", label: "Cross", hint: "Marks it wrong" },
      ],
    },
    run: (c, value) => ({
      kind: "ops",
      ops: [
        {
          op: "addShape",
          shape: "path",
          mark: value || "arrow",
          position: "center",
          ...span(c, 2.5),
        },
      ],
      note: "Mark",
    }),
  },
  {
    id: "punch-in",
    group: "show",
    title: "Push in here",
    hint: "Tightens the frame on this line and releases after it.",
    icon: "zoom-in",
    keywords: ["zoom", "camera", "punch", "closer", "emphasis"],
    run: (c) => {
      const { start, end } = span(c, 2.5);
      return {
        kind: "ops",
        ops: [{ op: "setCamera", start, end, camera: "punchIn", amount: 1 }],
        note: "Push in",
      };
    },
  },

  /* ---------------------------------- sound --------------------------------- */
  {
    id: "sfx",
    group: "hear",
    title: "Land a sound here",
    hint: "One effect, on this exact frame.",
    icon: "volume-2",
    keywords: ["whoosh", "impact", "riser", "boom", "effect", "sfx", "swish"],
    when: (c) => c.can.sfx,
    arg: { kind: "pick", label: "Effect", options: SFX_OPTIONS },
    run: (c, value) => ({
      kind: "ops",
      ops: [{ op: "addSfx", effect: value || "whoosh", at: c.outAt }],
      note: "Sound effect",
    }),
  },
  {
    id: "music",
    group: "hear",
    title: "Start music here",
    hint: "A bed from this point to the end, ducked under the voice.",
    icon: "music",
    keywords: ["soundtrack", "bed", "score", "background", "track"],
    when: (c) => c.can.music,
    arg: {
      kind: "text",
      label: "Music",
      placeholder: "Calm piano, driving drums…",
    },
    run: (c, value) => ({
      kind: "ops",
      ops: [
        { op: "addMusic", query: value, kind: "music", start: c.outAt, end: c.outDuration },
      ],
      note: "Music",
    }),
  },

  /* ----------------------------------- ask ---------------------------------- */
  {
    id: "ask",
    group: "ask",
    title: "Ask for something else",
    hint: "Anything the menu does not cover, described from this moment.",
    icon: "sparkles",
    keywords: ["ai", "agent", "chat", "prompt", "help", "edit"],
    arg: {
      kind: "text",
      label: "Ask",
      placeholder: "Make this bit punchier…",
    },
    run: (c, value) => ({
      kind: "ask",
      prompt: `At ${c.outAt.toFixed(1)}s${
        c.sentence ? ` (“${firstWords(c.sentence.text, 8)}”)` : ""
      }: ${value}`,
    }),
  },
];

/* -------------------------------- searching -------------------------------- */

/** How well a command answers what has been typed. Higher is better; 0 is out. */
export function scoreCommand(command: SlashCommand, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const title = command.title.toLowerCase();
  if (title.startsWith(q)) return 100;
  const words = title.split(/\s+/);
  if (words.some((w) => w.startsWith(q))) return 80;
  if (title.includes(q)) return 60;
  for (const keyword of command.keywords) {
    const k = keyword.toLowerCase();
    if (k.startsWith(q)) return 50;
    if (k.includes(q)) return 30;
  }
  return 0;
}

/**
 * The commands on offer, in menu order.
 *
 * Filtered by context first and by the query second, and never reordered into
 * relevance order when nothing has been typed: a menu whose first item moves
 * about between openings cannot be learned, and the whole point of a slash menu
 * is that you stop reading it.
 */
export function slashCommandsFor(
  context: SlashContext,
  query = "",
  commands: SlashCommand[] = SLASH_COMMANDS
): SlashCommand[] {
  const usable = commands.filter((c) => !c.when || c.when(context));
  if (!query.trim()) return usable;
  return usable
    .map((c) => ({ c, score: scoreCommand(c, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

/** Resolve a hint that may depend on where the caret is. */
export function hintFor(command: SlashCommand, context: SlashContext): string {
  return typeof command.hint === "function" ? command.hint(context) : command.hint;
}

/* ------------------------------ reading the text --------------------------- */

/** Punctuation that ends a sentence, in every script this editor transcribes. */
const SENTENCE_END = /[.!?。！？|॥]$/;

/**
 * The sentence a word belongs to.
 *
 * Whisper punctuates, so this is usually exact. When it does not — and it does
 * not, for Telugu and for Hindi, and for anything transcribed as one long
 * breath — the fallback is a run of at most `MAX_SENTENCE_WORDS`, which is
 * wrong in a way you can see and correct rather than wrong in a way that cuts
 * two minutes of video.
 */
const MAX_SENTENCE_WORDS = 40;

export function sentenceAround(words: Word[], index: number): Word[] {
  if (index < 0 || index >= words.length) return [];
  let from = index;
  while (
    from > 0 &&
    !SENTENCE_END.test(words[from - 1].text.trim()) &&
    index - from < MAX_SENTENCE_WORDS
  ) {
    from--;
  }
  let to = index;
  while (
    to < words.length - 1 &&
    !SENTENCE_END.test(words[to].text.trim()) &&
    to - index < MAX_SENTENCE_WORDS
  ) {
    to++;
  }
  return words.slice(from, to + 1);
}
