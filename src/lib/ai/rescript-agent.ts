import { omega } from "./omega";
import type { ChatMessage, TextGenerationInput } from "./types";
import { AppError } from "@/lib/utils/errors";
import { inputBudget, packMessages } from "./budget";
import {
  agentPlanSchema,
  siftOps,
  type AgentOp,
} from "@/rescript/lib/overlay/ops-schema";
import { verifyPlan, type PlanWorld } from "@/rescript/lib/overlay/verify";

/**
 * Turns "put a title card on the first clip and burn in subtitles" into work.
 *
 * The model plans; the browser executes. It never writes an asset — an
 * `addImage` is a *request* for a picture, fulfilled by the browser calling the
 * image route — and it never emits anything that is not in the schema.
 *
 * Between those two things sits a harness, and the harness is most of what makes
 * the answers good:
 *
 *  - It can **read** before it writes. A long recording no longer has to be
 *    stuffed into one prompt and hoped over; the model asks for the parts of the
 *    transcript it needs, checks that a phrase it wants to caption is really
 *    said, and looks at what is already on screen. Short videos still take the
 *    one-shot path, because a round trip to fetch something already in front of
 *    you is just latency.
 *  - Its plan is **verified against the project** before anything runs, by the
 *    same simulation the browser would otherwise discover one failure at a time.
 *    Problems go back to the model in its own vocabulary and it gets one attempt
 *    to fix them, which is where most of the difference between a plan that
 *    half-lands and one that lands shows up.
 *  - It remembers **the conversation**, so "make it bigger" and "actually, put
 *    that at the top instead" mean something.
 */

const SYSTEM = `You are the editor of a video. The person tells you what they want; you answer with the operations that make it happen.

TIME
All times are seconds on the FINISHED video's clock — after cuts, which is what the person sees in the player. 0 is the first frame.

NUMBERING
Elements are numbered from 1, exactly as they are listed to you. "The first caption" is element 1. Never subtract one from anything.
Transition boundaries are numbered from 1: boundary 1 is between clip 1 and clip 2.

OPERATIONS

{"op":"addText","text":"...","start":0,"duration":3,"position":"lower-third","size":"l","style":"title","color":"#ffffff","background":"rgba(0,0,0,0.55)","align":"center","uppercase":false,"enter":"slideUp","exit":"fade"}
  Puts words on screen. Only "text" is required; everything else has a sensible default.
  position: top-left top top-right left center right bottom-left bottom bottom-right lower-third upper-third
            or an exact {"x":0.1,"y":0.7} in fractions of the frame, origin top-left.
  size: xs s m l xl        style: plain title subtitle caption badge quote handwritten
  Give "duration" OR "end", not both. Keep text short — this is a caption, not a paragraph.

  PREFER "template" over style+enter+exit. A template is a look AND a motion that has already been made to
  work over footage; the three fields separately are three chances to produce something nobody has looked at.
  Anything you set alongside it still wins, so a template can be nudged without being rebuilt.
    Titles: kineticMask boldSlam editorialSerif splitReveal typewriter stamp neon handwritten
    Lower thirds: cleanBar underlineGrow boxedName bracketed minimalFade cornerTag
    Captions: wordPop highlightSweep boldBounce scalePunch oneWord softCaption
    Callouts: speechBubble stickyNote codeCard quoteCard warning aside
    Data: statBig statWithCaption listReveal comparison unitLabel
    Call to action: subscribeBump followPill linkBar chapterCard endCard

  Pick by what the words are doing, not by how they should look: a name is a lower third, a spoken phrase is
  a caption, a figure is a stat. If you are unsure, the first one listed in the right group is the safe one.

{"op":"addImage","prompt":"a hand-drawn rocket, marker on white","start":2,"duration":4,"position":"top-right","size":"m","enter":"pop"}
{"op":"addImage","query":"golden gate bridge fog","start":2,"duration":4,"position":"right"}
  A picture on top of the video. Use "prompt" to GENERATE artwork (things that cannot be photographed,
  illustrations, diagrams, anything they say to draw or generate). Use "query" to SEARCH for a real
  photograph of something that exists. Exactly one of the two. The browser fetches it; you do not.

{"op":"addShape","shape":"rect","position":"bottom","size":"l","fill":"rgba(0,0,0,0.6)"}
  A plain block — usually a scrim so text over busy footage stays readable. shape: rect ellipse line

{"op":"addShape","shape":"path","mark":"circleThis","start":18,"duration":2.5,"position":"center","strokeColor":"#ffd60a"}
  Draws a mark on the frame. Marks: arrow arrowCurved circleThis underline doubleUnderline strike box
  bracketLeft bracketRight scribble check cross divider chevron plus star — plus any Lucide icon name
  (rocket, server, clock, trending-up, …). It draws itself on when "enter" is "wipeRight", which is the
  point of them. Use a mark to point at something already on screen; do not use one as decoration.

{"op":"updateElement","element":2,"text":"New words","color":"#ffd60a","size":"xl","uppercase":true}
  Changes an existing element in place. Only include the fields you are changing.

{"op":"moveElement","element":2,"position":"top"}
{"op":"resizeElement","element":2,"size":"xl"}
{"op":"timeElement","element":2,"start":4,"duration":3}
{"op":"animateElement","element":2,"enter":"pop","exit":"fade","duration":0.4}
{"op":"removeElement","element":2}          — or {"op":"removeElement","element":"all"} to clear them all.

{"op":"setTransition","between":1,"kind":"dissolve","duration":0.5}
{"op":"setAllTransitions","kind":"fadeBlack","duration":0.4}
  Animation over a cut. kinds: none fadeBlack fadeWhite dissolve slideLeft slideRight slideUp slideDown
  zoomIn zoomOut blur. Transitions never shorten the video and never touch the audio, so they are always
  safe to add. Keep them 0.2–0.8s unless asked otherwise.

{"op":"subtitles","action":"on","preset":"shorts"}
{"op":"subtitles","action":"style","color":"#ffffff","highlight":"#ffd60a","size":"l","position":"bottom","uppercase":true}
{"op":"subtitles","action":"regenerate"}     — rebuild the cues from the current cut
{"op":"subtitles","action":"off"}
  Burned-in captions, built from the transcript that already exists. presets: clean broadcast shorts karaoke minimal
  "karaoke" lights up each word as it is spoken. Turning subtitles on generates the cues if there are none.

{"op":"setFrame","aspect":"9:16","fit":"cover","zoom":1,"focusX":0.5,"focusY":0.4,"background":"blur"}
  The SHAPE of the finished video. aspect: source 16:9 9:16 1:1 4:5 4:3 2.39:1
  "cover" crops the footage to fill the frame — this is what you want for a vertical cut of a landscape
  recording. "contain" fits the whole picture in and fills the rest with a blurred blow-up of it.
  focusX/focusY choose which part of the source stays in shot, 0..1 from the top-left; a talking head
  usually wants focusY around 0.35-0.45 so the face is not cropped at the chin.
  A request for a Short, a Reel, a TikTok or "vertical" means setFrame to 9:16 BEFORE anything else —
  captions styled for a Short in a widescreen frame are not a Short.

{"op":"removeFillers"}                       — cut every "um", "uh" and similar
{"op":"removeSilences","minDuration":0.4}    — cut pauses at least this long
{"op":"deletePhrase","text":"you know what I mean","occurrence":2}
  Cuts spoken words out of the video by deleting them from the transcript. Omit "occurrence" to cut every one.
  Only use text that actually appears in the transcript you were shown.

{"op":"deleteRange","from":42,"to":55}
  Cuts a span of the finished video. Use this for a tangent, a stumble, or dead air that the transcript shows
  you. The times are the ones stamped in the transcript.

{"op":"keepOnly","ranges":[{"from":12,"to":28},{"from":61,"to":74}]}
  Keeps only these spans and cuts everything else — one operation for a highlight reel, a trailer, or a
  short. Choose the spans from the transcript: complete thoughts, starting on the first word of a sentence
  and ending on the last. Never cut mid-sentence.

{"op":"captionPhrase","phrase":"three times faster","text":"3× FASTER","style":"badge","position":"upper-third","enter":"pop","hold":0.8}
  Puts words on screen exactly as they are spoken. The browser finds the phrase in the transcript and takes
  the timing from the word timings, so it lands on the beat — use this for every kinetic caption instead of
  guessing a time with addText. "phrase" must appear in the transcript VERBATIM; "text" is what is shown and
  can be shorter or capitalised. Check with the find_phrase tool if you are not certain. This is the
  operation that makes an edit feel produced.

{"op":"splitAt","at":30}
  Puts a clip boundary at that second without removing anything. Transitions sit between clips, so if the
  video has no cuts yet, split before asking for one.

{"op":"autoPunchIns","perMinute":2.5}
  Pushes the camera in on the moments the delivery itself emphasises — after a pause, on a figure, at the
  start of a new thought, on a change of speaker. It reads the word timings and places its own zooms, spaced
  so they never become a tic. THIS IS HOW YOU ADD ZOOMS. Do not place them one at a time; you cannot see the
  delivery and this can. One call, once, for the whole video.

{"op":"setCamera","start":42,"end":46,"camera":"punchIn"}
  Moves the camera over one stretch, when the person named a moment. Kinds: punchIn (tighter, lands in half
  a second — emphasis), punchOut (opens up), push (a slow creep that should never be noticed as movement),
  driftLeft / driftRight, kenBurns, snap (hard cut to tighter, no travel — the energetic short-form look),
  hold (no move). Add "amount" (0-2, 1 is the house amount) only if asked for more or less.

{"op":"addShot","start":10,"end":18,"layout":"splitLeft","plates":[{"slot":0},{"slot":1,"source":"selfCrop","camera":"snap","focusX":0.6}]}
  Divides the frame for a stretch. Layouts: full, splitLeft, splitRight, splitTop, splitBottom, stack (a face
  above, the demonstration below — the vertical tutorial shape), pip (a bubble in the corner), card (a flat
  colour to put text on), grid. Every layout except full, card and grid needs TWO plates: say what is in each.
  Sources: "primary" is the footage; "selfCrop" is the footage again framed tighter, which is the cutaway
  that always works and needs nothing fetched; "solid" with a "color" is a card to put type on.

{"op":"removeShot","at":12}
  Drops whatever framing covers that second, back to the footage as shot.

{"op":"setGrade","preset":"warmFilm"}
  The look, over the whole video. Presets: none, clean (a touch of contrast — safe on anything), warmFilm,
  tealOrange, bleach, mono, vivid, moody. Add "at" with a second inside a shot to grade only that shot, which
  is worth doing when a cutaway was filmed on a different camera and does not match. You can nudge a preset
  with exposure / contrast / saturation / temperature / vignette / grain (-1 to 1), but do not build a look
  out of those from scratch: pick the preset that is closest and leave it alone.

RULES ABOUT ORDER
Cuts change the clock. Put every cutting operation (removeFillers, removeSilences, deletePhrase,
deleteRange, keepOnly, splitAt) FIRST, and write every later time — caption starts, boundary numbers — as
they will be AFTER those cuts. Removing fillers and silences typically takes 5-15% off the length; if you
cannot work out the new time exactly, prefer captionPhrase (which is timed from the words themselves and is
immune to this) or place captions relative to the start of the video, which does not move.

DOING A WHOLE EDIT AT ONCE
When asked for something broad — "edit this for me", "make it a short", "tighten it up", "make it
publishable" — do the entire job in one plan, in this order:
  1. setFrame, if the format they asked for is not the shape the footage already is.
  2. removeFillers, then removeSilences (0.35-0.5s is a natural threshold for talking-head footage).
  3. keepOnly or deleteRange to drop tangents and dead ends, if a target length was named or the material
     obviously runs long. Respect a requested length: a "30 second short" means the kept spans add up to
     roughly 30 seconds.
  4. setAllTransitions — a dissolve or a fade of 0.3-0.5s reads well over the jump cuts that step 2 leaves.
  5. subtitles on, with a preset that matches the format ("shorts" or "karaoke" for vertical/social,
     "clean" or "broadcast" otherwise).
  6. One addText title card over the opening two or three seconds, taken from what they actually talk
     about in the transcript. Not a generic word like "Intro".
  7. B-roll (addImage) and kinetic text (captionPhrase) where the transcript earns them.

HOW TO MAKE IT LOOK EDITED, NOT GENERATED
These are the rules a working editor applies without thinking. Follow them.

  Space. Two things never share the same part of the frame at the same time. If subtitles are on they own
  their band — a lower third with subtitles underneath goes to "upper-third" or "top", never "bottom" or
  "center". A picture goes to a side or a corner, never over the middle where the speaker is. The app will
  move anything that collides, but a plan that needs moving was a worse plan.

  Restraint. One idea on screen at a time. A title card OR a kinetic caption, not both. If a caption is
  already up, wait for it to leave before the next one. Across a two-minute video: one title, three or four
  kinetic captions, two or three pictures. More than that is a slideshow, and it will be rejected.

  Colour. Pick ONE accent and use it for everything that needs to pop — the karaoke highlight, a badge, the
  one word you emphasise. Everything else is white with a dark scrim. Never more than two colours plus
  white. Good accents: #ffd60a (warm, confident), #4ade80 (fresh), #60a5fa (calm, technical), #f472b6
  (playful), #fb923c (energetic). Match it to the subject, then stay with it for the whole video.

  Contrast. Text over footage is unreadable without help. Either a background scrim of rgba(0,0,0,0.55) or
  heavier, or the "badge" style which brings its own. Never coloured text on unknown footage without one.

  Timing. Captions hold long enough to read: two seconds minimum, plus half a second per extra word beyond
  three. Entrances are quick — 0.3-0.4s. "pop" for something arriving on a beat, "slideUp" for a lower
  third, "typewriter" only for a single short line and never for more than a few words. Exits are always
  faster than entrances.

  Cuts. One transition style for the whole video, not a different one each time — that is the single
  clearest sign of an amateur edit. Jump cuts from removing fillers want a short "dissolve" (0.25-0.35s) or
  nothing at all; leaving them hard is a legitimate, modern choice. "fadeBlack" is for a real change of
  subject, not for every cut. Slides and zooms are punctuation: at most once or twice, on a genuine
  transition of topic.

  Hierarchy. The title is the biggest thing on screen and appears once. Kinetic captions are smaller than
  the title. Subtitles are smaller than both, and never compete for attention — they are read, not looked
  at.

  Vertical. A 9:16 frame is not a widescreen edit made narrow. There is a third as much width, so captions
  are shorter and stacked, pictures go full width across the top or the bottom rather than into a corner,
  and the middle of the frame belongs to the speaker. Subtitles sit centre or low-centre where a thumb is
  not covering them.

LOOK
One grade for the whole video, chosen once. A look is the thing that makes separate clips read as one piece,
and grading shots individually is how you lose that — the exception is genuinely mismatched footage. If the
person has not asked for a look, "clean" is the only one to reach for unprompted; anything stronger is a
decision they did not make.

CAMERA
A zoom is punctuation. It means "this bit", and a video where every eighth second means "this bit" means
nothing at all. Reach for autoPunchIns once and let it space them; place one by hand only when the person
named the moment. Never put a move on a stretch shorter than about two seconds — it cannot arrive, and what
plays is a creep that stops at the cut. Do not mix push and punchIn in one video: one is atmosphere, the
other is emphasis, and together they read as an accident.

A split screen is for two things that are genuinely both worth looking at. If the second half would only
hold a bigger version of the first, that is a punch-in, not a split. "stack" is for vertical; "pip" is for a
screen recording with a person in the corner; "card" is for when the words are the point and the picture is
not.

B-ROLL
When the speaker names something concrete and visual — a place, an object, a company, a chart, a person —
put a picture over it for the seconds they are talking about it. Use "query" for things that exist and can
be photographed and "prompt" for things that cannot. Two or three across a couple of minutes is a produced
video; one every ten seconds is a slideshow. Never cover the speaker's face: use a corner or a side, size
"s" or "m", and let it come and go with a pop or a fade. Hold a picture for as long as they are talking
about the thing — two to four seconds — and take it away when they move on. A photograph of something real
beats generated art whenever the thing exists; generate only what cannot be photographed.

RULES
- Answer only with operations that do what was asked. On a narrow request ("add a caption", "cut the ums")
  do exactly that and nothing more. A broad request is the exception — see above; there, doing the whole
  job is what was asked.
- If they ask for something this deployment cannot do, say so in "summary" and return an empty "ops".
- Prefer updating an existing element over adding a second one on top of it.
- If no time is given for a new element, start it at the current playhead and run it for 3 seconds.
- Never invent an element number that is not in the list.`;

/**
 * The reply protocol.
 *
 * Deliberately a JSON discriminated union rather than the provider's own
 * function-calling: this endpoint is OpenAI-shaped but the deployment behind it
 * varies, and a protocol that only needs `response_format: json_object` works on
 * all of them. The cost is one line of parsing; the benefit is that the harness
 * does not break when the model behind the id changes.
 */
const PROTOCOL = `HOW TO REPLY

Every reply is one JSON object and nothing else — no prose around it, no code fence.

You may LOOK before you answer. To use a tool, reply:
{"thinking":"why you need this","tool":"<name>","args":{ ... }}

The tools:
  read_transcript   {"from":40,"to":95}      Lines of the transcript between those seconds of the finished video.
  search_transcript {"query":"pricing"}      Every line that mentions it, with its time.
  find_phrase       {"phrase":"three times faster"}
                                             Whether captionPhrase can time to those exact words, and when they are said.
                                             Use this before every captionPhrase you are not certain of.
  inspect           {}                       What is on screen now: elements, subtitles, transitions, the frame.
  measure           {}                       Counts from the footage: fillers, dead air, pace, clips.

You get at most 6 looks. Do not look at something you were already shown above.

When you are ready, reply with the plan instead:
{"thinking":"how this makes the highest-quality edit","summary":"one sentence, what you did","ops":[ ... ]}

"ops" must not be empty. If you are still working out what to do, use a tool — a plan with no operations
is not a way to think out loud, it is the answer "nothing about this video needs changing", and you will be
asked to justify it in the summary.

Keep "thinking" to a few sentences. It shares one budget with the plan, and a reply that reasons at length
runs out of room and arrives with no plan in it at all — which costs you the turn and helps nobody.`;

/**
 * Proposal mode.
 *
 * The difference is only in what comes back: grouped, named steps with a
 * sentence of reasoning each, so the edit can be read before it is run and
 * accepted a step at a time. The vocabulary is identical — the same schema
 * validates the ops either way — because a proposal the person accepts has to
 * be exactly the thing that then executes.
 */
const PROPOSE_SUFFIX = `

YOU ARE PROPOSING, NOT EXECUTING
The looking tools work exactly the same. When you are ready, the plan takes this shape instead:
{"thinking":"deep analysis and planning, step by step",
 "summary":"one sentence on the edit you are proposing",
 "findings":["what you noticed about this footage, one short sentence each"],
 "steps":[{"title":"Short name","detail":"one sentence on why","ops":[ ... ]}]}

Do NOT use the top-level "ops" field in this mode — put every operation inside a step, and do not send an
empty "steps".

Base "findings" on the measurements you were given, not on impressions: quote the filler count, the dead
air, the pace, the length. Say what you would do about each. If something is already fine, say so rather
than inventing work.

Group the steps the way an editor would talk about them, cutting steps first, in this order where they
apply: shape (the frame), tighten (fillers, silences), choose (what to keep), pace (transitions), read
(subtitles), produce (titles, kinetic captions, b-roll). Three to six steps. Every step must carry the
operations that do it — a step with an empty "ops" is not a step, it is a comment.`;

function stripFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

/**
 * Undo the one JSON slip these models actually make.
 *
 * Observed live, twice in one session: a complete, well-reasoned five-step
 * proposal — findings, ordering, colour discipline, the lot — thrown away
 * because it ended `"hold":1.2"` instead of `"hold":1.2`. A stray quote after a
 * number. The retry then came back worse each time, so a single mistyped
 * character cost the best answer of the run.
 *
 * The repair is deliberately narrow: a double quote wedged between a numeric
 * literal and the delimiter that must follow it is not valid JSON under any
 * reading, so removing it cannot change the meaning of a document that would
 * otherwise have parsed. Anything more ambitious — balancing braces, closing
 * strings — starts guessing at intent, and a plan invented by the parser is
 * worse than no plan.
 */
export function repairJson(value: string): string {
  // The colon must be the one that closes a key — hence the leading quote.
  // Without it, `"aspect":"9:16",` matches on the colon *inside* the string and
  // the repair strips a quote that was doing its job.
  const quotes = value.replace(/("\s*:\s*-?\d+(?:\.\d+)?)"(\s*[,}\]])/g, "$1$2");
  return escapeControlCharacters(quotes);
}

/**
 * Escape raw control characters that ended up inside a string.
 *
 * The second slip these models make, seen four turns running in one session:
 * the reasoning is written with real newlines in it rather than `\n`, and
 * `JSON.parse` answers "Invalid control character". The whole plan goes with it.
 *
 * A raw control character is never legal inside a JSON string, so escaping one
 * cannot change the meaning of a document that would otherwise have parsed —
 * which is the same bar the quote repair above has to clear. Characters outside
 * a string are left exactly as they are, since that is where the real
 * whitespace lives.
 */
function escapeControlCharacters(value: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (const ch of value) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = inString;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && ch < " ") {
      out +=
        ch === "\n" ? "\\n" : ch === "\t" ? "\\t" : ch === "\r" ? "\\r" : "";
      continue;
    }
    out += ch;
  }

  return out;
}

/**
 * Every balanced top-level object in a reply, in order.
 *
 * This used to be "from the first brace to the last one", which is right for a
 * single object wrapped in prose and wrong the moment there are two — and there
 * are two more often than you would think, because a model that has second
 * thoughts writes another object rather than editing the first. Slicing across
 * both produced `}{` in the middle and "Unexpected non-whitespace character
 * after JSON", so a reply whose *first* object was perfectly good was thrown
 * away and retried.
 *
 * Braces inside strings do not count, which is the whole reason this needs a
 * scanner rather than a counter.
 */
export function jsonObjects(value: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        found.push(value.slice(start, i + 1));
        start = -1;
      }
      // A stray closing brace outside any object: ignore rather than going
      // negative and mis-framing everything after it.
      if (depth < 0) depth = 0;
    }
  }

  // An object that never closed — the reply was cut off mid-write. Worth
  // returning: the repair pass below may still be able to use it, and if not
  // the caller reports a parse failure exactly as before.
  if (depth > 0 && start >= 0) found.push(value.slice(start));

  return found;
}

export interface RescriptAgentContext {
  /** Length of the finished video in seconds. */
  duration: number;
  /** Where the playhead is, so "here" means something. */
  playhead: number;
  /** Clip boundaries on the output clock, in order. */
  boundaries: Array<{ number: number; at: number }>;
  /** Overlay elements as the person sees them, numbered from 1. */
  elements: Array<{
    number: number;
    kind: string;
    name: string;
    text?: string;
    start: number;
    end: number;
    position: { x: number; y: number };
  }>;
  subtitles: {
    enabled: boolean;
    cueCount: number;
    preset?: string;
    position?: "top" | "center" | "bottom";
  };
  transitions: Array<{ between: number; kind: string; duration: number }>;
  /** Plain transcript with per-sentence timestamps, on the output clock. */
  transcript?: string;
  /** Measured in the browser — filler counts, dead air, pace. */
  analysis?: {
    wordCount: number;
    wordsPerMinute: number;
    speakerCount: number;
    fillerCount: number;
    fillerSeconds: number;
    silenceCount: number;
    silenceSeconds: number;
    longestPauses: Array<{ at: number; seconds: number }>;
    clipCount: number;
    runsLong: boolean;
  };
  /** Frame width ÷ height. Below 1 is a vertical video. */
  aspect?: number;
  /** The output frame as the project has it set. */
  frame?: { aspect: string; fit: string; zoom: number };
  can: { generateImage: boolean; photoSearch: boolean };
}

/** One exchange the person has already had, so follow-ups make sense. */
export interface RescriptExchange {
  instruction: string;
  /** What the assistant said it did. */
  summary: string;
  /** Lines from the run log, so "that didn't work" has a referent. */
  outcome?: string;
}

export interface RescriptAgentInput {
  instruction: string;
  context: RescriptAgentContext;
  /** "propose" returns named steps to accept; "execute" returns flat ops. */
  mode?: "propose" | "execute";
  /** Earlier turns in this conversation, oldest first. */
  history?: RescriptExchange[];
  model?: string;
  signal?: AbortSignal;
  /**
   * Called as the agent works. Supplying it also turns on token streaming, so
   * the reasoning arrives while it is being written rather than afterwards.
   */
  onEvent?: (event: AgentEvent) => void;
  /**
   * Stand in for the model. Tests only.
   *
   * The loop's job is to converge against a model that misbehaves — repeats
   * itself, ignores the budget, answers in the wrong shape — and the only
   * honest way to check that it does is to hand it one that always misbehaves.
   * Paying a provider to maybe reproduce a loop is not a test.
   */
  generate?: (input: TextGenerationInput) => Promise<string>;
}

export interface RescriptStep {
  title: string;
  detail: string;
  ops: AgentOp[];
}

/** One line of what the agent did on the way to its answer. */
export interface RescriptTraceEntry {
  tool: string;
  detail: string;
}

export interface RescriptPlan {
  summary: string;
  findings: string[];
  steps: RescriptStep[];
  ops: AgentOp[];
  rejected: string[];
  /** What it looked at, for the log. */
  trace: RescriptTraceEntry[];
  /** Problems the verifier found that survived the repair attempt. */
  warnings: string[];
}

/* -------------------------------- transcript ------------------------------- */

interface TranscriptLine {
  at: number;
  text: string;
}

/**
 * Split the stamped transcript back into addressable lines.
 *
 * The browser builds it as `[m:ss] a whole sentence` precisely so it can be cut
 * on sentence boundaries; parsing it back is how the reading tools window into a
 * long recording without the whole thing ever entering the prompt.
 */
function parseTranscript(transcript: string | undefined): TranscriptLine[] {
  if (!transcript) return [];
  const lines: TranscriptLine[] = [];
  for (const raw of transcript.split("\n")) {
    const match = /^\[(\d+):(\d\d(?:\.\d+)?)\]\s*(.*)$/.exec(raw.trim());
    if (!match) {
      // A continuation of the previous line rather than a new one.
      if (lines.length && raw.trim()) lines[lines.length - 1].text += ` ${raw.trim()}`;
      continue;
    }
    lines.push({
      at: Number(match[1]) * 60 + Number(match[2]),
      text: match[3],
    });
  }
  return lines;
}

function stamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function renderLines(lines: TranscriptLine[]): string {
  return lines.map((line) => `[${stamp(line.at)}] ${line.text}`).join("\n");
}

/** Roughly what fits in the prompt beside everything else. */
const INLINE_TRANSCRIPT_BUDGET = 9_000;

/**
 * Every Nth line, for a transcript too long to include whole.
 *
 * An outline is not a summary: it is the real sentences, just sparser, so the
 * model can see the arc of the video and knows where to read in full. Handing it
 * a truncated first 9,000 characters instead — which is what happened before —
 * meant a plan for a forty-minute recording could only ever be a plan for its
 * first six minutes.
 */
function outline(lines: TranscriptLine[], budget: number): string {
  if (!lines.length) return "";
  const step = Math.max(1, Math.ceil(lines.length / Math.max(1, budget / 90)));
  const picked = lines.filter((_, i) => i % step === 0);
  return renderLines(picked);
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------------------------- tools ---------------------------------- */

interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

function num(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

/**
 * Answer a tool call from the request payload.
 *
 * Every tool is a pure function of what the browser already sent, so a look
 * costs one model round trip and nothing else — no second request to the
 * browser, no state to keep, and no way for a tool to see anything the person
 * did not hand over.
 */
function runTool(
  call: ToolCall,
  context: RescriptAgentContext,
  lines: TranscriptLine[]
): { result: string; detail: string } {
  switch (call.tool) {
    case "read_transcript": {
      const from = num(call.args, "from") ?? 0;
      const to = num(call.args, "to") ?? from + 60;
      const window = lines.filter((line) => line.at >= from && line.at <= to);
      if (!window.length) {
        return {
          result: `Nothing is said between ${stamp(from)} and ${stamp(to)}.`,
          detail: `Read ${stamp(from)}–${stamp(to)} — nothing there`,
        };
      }
      // A window is capped so a model that asks for the whole video cannot
      // simply route around the outline.
      const capped = renderLines(window).slice(0, 6_000);
      return {
        result: capped,
        detail: `Read the transcript, ${stamp(from)}–${stamp(to)}`,
      };
    }

    case "search_transcript": {
      const query = normalise(str(call.args, "query"));
      if (!query) return { result: "No query given.", detail: "Searched for nothing" };
      const hits = lines.filter((line) => normalise(line.text).includes(query));
      if (!hits.length) {
        return {
          result: `"${str(call.args, "query")}" is never said.`,
          detail: `Searched for "${str(call.args, "query")}" — not said`,
        };
      }
      return {
        result: renderLines(hits.slice(0, 40)),
        detail: `Searched for "${str(call.args, "query")}" — ${hits.length} line${hits.length === 1 ? "" : "s"}`,
      };
    }

    case "find_phrase": {
      const phrase = str(call.args, "phrase");
      const needle = normalise(phrase);
      if (!needle) return { result: "No phrase given.", detail: "Checked nothing" };
      const hits = lines.filter((line) => normalise(line.text).includes(needle));
      if (!hits.length) {
        return {
          result: `"${phrase}" does not appear in the transcript, so captionPhrase cannot time to it. Quote the words exactly as they are transcribed, or use addText with a time.`,
          detail: `Checked "${phrase}" — not in the transcript`,
        };
      }
      return {
        result: `"${phrase}" is said ${hits.length} time${hits.length === 1 ? "" : "s"}, at ${hits
          .slice(0, 8)
          .map((h) => stamp(h.at))
          .join(", ")}. captionPhrase will time to it.`,
        detail: `Checked "${phrase}" — said ${hits.length}×`,
      };
    }

    case "inspect": {
      return {
        result: describeProject(context),
        detail: "Looked at what is on screen",
      };
    }

    case "measure": {
      return {
        result: context.analysis
          ? describeAnalysis(context.analysis)
          : "Nothing has been measured for this project.",
        detail: "Measured the footage",
      };
    }

    default:
      return {
        result: `There is no tool called "${call.tool}". The tools are read_transcript, search_transcript, find_phrase, inspect and measure.`,
        detail: `Asked for an unknown tool (${call.tool})`,
      };
  }
}

/* -------------------------------- description ------------------------------ */

function describeAnalysis(
  analysis: NonNullable<RescriptAgentContext["analysis"]>
): string {
  return [
    "MEASURED IN THE FOOTAGE (these are counts, not estimates — plan from them):",
    `  ${analysis.wordCount} words at ${analysis.wordsPerMinute} wpm across ${analysis.clipCount} clip(s), ${analysis.speakerCount} speaker(s).`,
    `  ${analysis.fillerCount} filler words, worth ${analysis.fillerSeconds.toFixed(1)}s.`,
    `  ${analysis.silenceCount} pauses, worth ${analysis.silenceSeconds.toFixed(1)}s of dead air.`,
    analysis.longestPauses.length
      ? `  Longest pauses: ${analysis.longestPauses.map((p) => `${p.seconds.toFixed(1)}s at ${p.at.toFixed(1)}s`).join(", ")}.`
      : "  No pause is long enough to name.",
    analysis.runsLong
      ? "  This runs long: choosing what to keep matters more than trimming."
      : "  This is short enough that trimming is the main job.",
  ].join("\n");
}

/** What is on screen, without the transcript. Also the `inspect` tool's answer. */
function describeProject(context: RescriptAgentContext): string {
  const elements = context.elements.length
    ? context.elements
        .map(
          (e) =>
            `  ${e.number}. ${e.kind}${e.text ? ` "${e.text.slice(0, 60)}"` : ` (${e.name})`} — ${e.start.toFixed(1)}s to ${e.end.toFixed(1)}s at x=${e.position.x.toFixed(2)} y=${e.position.y.toFixed(2)}`
        )
        .join("\n")
    : "  (none yet)";

  const boundaries = context.boundaries.length
    ? context.boundaries
        .map((b) => `  boundary ${b.number} at ${b.at.toFixed(2)}s`)
        .join("\n")
    : "  (the video is a single clip — there is nowhere to put a transition)";

  const transitions = context.transitions.length
    ? context.transitions
        .map((t) => `  boundary ${t.between}: ${t.kind} ${t.duration}s`)
        .join("\n")
    : "  (none)";

  const shape = context.aspect
    ? context.aspect < 0.9
      ? "vertical (a Short or a Reel)"
      : context.aspect > 1.5
        ? "widescreen"
        : "square-ish"
    : "unknown";

  return [
    `ELEMENTS ON SCREEN (numbered as the person sees them):\n${elements}`,
    `CLIP BOUNDARIES:\n${boundaries}`,
    `TRANSITIONS SET:\n${transitions}`,
    `SUBTITLES: ${
      context.subtitles.enabled
        ? `on, ${context.subtitles.cueCount} cues, sitting ${context.subtitles.position ?? "bottom"}`
        : "off"
    }`,
    `FRAME: ${context.frame?.aspect ?? "source"} — ${shape}, ratio ${(context.aspect ?? 16 / 9).toFixed(2)}${
      context.frame ? `, footage ${context.frame.fit === "cover" ? "cropped to fill" : "fitted whole"}` : ""
    }.`,
  ].join("\n\n");
}

function describe(
  context: RescriptAgentContext,
  lines: TranscriptLine[]
): { text: string; windowed: boolean } {
  const full = context.transcript ?? "";
  const windowed = full.length > INLINE_TRANSCRIPT_BUDGET;

  const transcriptBlock = !full
    ? ""
    : windowed
      ? `TRANSCRIPT — OUTLINE ONLY. This video is too long to show you whole, so these are its sentences sampled across the whole running time. The [m:ss] stamps are seconds on the finished video's clock — the same clock deleteRange, keepOnly and splitAt use. Use read_transcript to see any stretch in full before you cut it or caption it:\n${outline(lines, INLINE_TRANSCRIPT_BUDGET)}`
      : `TRANSCRIPT OF THE CURRENT CUT. The [m:ss] stamps are seconds on the finished video's clock — the same clock deleteRange, keepOnly and splitAt use:\n${full}`;

  return {
    windowed,
    text: [
      `FINISHED VIDEO: ${context.duration.toFixed(2)}s long. The playhead is at ${context.playhead.toFixed(2)}s.`,
      describeProject(context),
      context.analysis ? describeAnalysis(context.analysis) : "",
      `WHAT THIS DEPLOYMENT CAN DO:\n  - Generate artwork (addImage with "prompt"): ${context.can.generateImage ? "available" : "NOT configured — do not plan it"}\n  - Search real photos (addImage with "query"): ${context.can.photoSearch ? "available" : "NOT configured — do not plan it"}`,
      transcriptBlock,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/**
 * A sentence describing what a plan does, for when the model did not write one.
 *
 * Observed live: a plan can come back complete and correct with `summary` an
 * empty string, and the panel then reports nothing at all — the edit happens in
 * silence, which reads as a bug rather than as a terse answer. The schema
 * defaults it to "" rather than rejecting, because throwing away eleven good
 * operations over a missing sentence would be the worse trade; so the sentence
 * is written here instead, from the operations themselves.
 */
function summarise(ops: AgentOp[]): string {
  if (!ops.length) return "Nothing to change.";

  const parts: string[] = [];
  const has = (name: AgentOp["op"]) => ops.some((o) => o.op === name);

  const frame = ops.find((o) => o.op === "setFrame");
  if (frame && frame.op === "setFrame" && frame.aspect !== "source") {
    parts.push(`reframed to ${frame.aspect}`);
  }
  if (has("keepOnly")) parts.push("kept the best spans");
  else if (has("deleteRange")) parts.push("cut a section");
  if (has("removeFillers")) parts.push("cut the fillers");
  if (has("removeSilences")) parts.push("cut the dead air");
  if (has("setAllTransitions") || has("setTransition")) parts.push("set transitions");
  if (ops.some((o) => o.op === "subtitles" && o.action !== "off")) {
    parts.push("burned in subtitles");
  }

  const captions = ops.filter(
    (o) => o.op === "addText" || o.op === "captionPhrase"
  ).length;
  if (captions) parts.push(`added ${captions} caption${captions === 1 ? "" : "s"}`);
  const images = ops.filter((o) => o.op === "addImage").length;
  if (images) parts.push(`added ${images} picture${images === 1 ? "" : "s"}`);

  if (!parts.length) {
    return `Ran ${ops.length} operation${ops.length === 1 ? "" : "s"}.`;
  }
  const sentence = parts.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/* --------------------------------- progress -------------------------------- */

/**
 * What the agent is doing, as it does it.
 *
 * The loop can run for a minute and a half — several model turns, a few reads,
 * a verification pass and a repair — and until these existed all of it happened
 * behind one spinner that said "Working…". The person could not tell a slow
 * answer from a hung one, and none of the reasoning that makes the answer good
 * was visible.
 */
export type AgentEvent =
  | { type: "turn"; index: number }
  /** A slice of the model's own reasoning, as it is generated. */
  | { type: "thinking"; text: string }
  | { type: "look"; tool: string; detail: string }
  | { type: "verify"; problems: number }
  | { type: "repair"; problems: string[] }
  | { type: "retry"; reason: string }
  /** The conversation was shortened to fit the model's context window. */
  | { type: "trim"; dropped: number; digested: number; tokens: number };

/**
 * Pulls the `thinking` field out of a JSON object that is still arriving.
 *
 * The reply is one JSON object, so nothing can be parsed until the last brace
 * lands — but `thinking` is the first field in it and is by far the longest, so
 * by the time the object closes the interesting part has been sitting in the
 * buffer, unread, for most of a minute. This walks the raw string as it streams
 * and decodes just that one value: enough to show the reasoning live without
 * pretending the document is parseable yet.
 *
 * It only ever reads. A malformed or missing field yields nothing and the
 * normal parse still decides what the reply actually was.
 */
class ThinkingTap {
  private buffer = "";
  /** Index into `buffer` of the next raw character to decode. */
  private cursor = -1;
  private escaped = false;
  private finished = false;

  /** New plain text revealed by this chunk. Empty when there is none. */
  push(delta: string): string {
    if (this.finished) return "";
    this.buffer += delta;

    if (this.cursor < 0) {
      // Find the opening quote of the value, tolerating whitespace anywhere a
      // JSON writer is allowed to put it.
      const opening = /"thinking"\s*:\s*"/.exec(this.buffer);
      if (!opening) return "";
      this.cursor = opening.index + opening[0].length;
    }

    let out = "";
    while (this.cursor < this.buffer.length) {
      const ch = this.buffer[this.cursor];
      this.cursor += 1;

      if (this.escaped) {
        this.escaped = false;
        // \uXXXX needs four more characters; wait for them rather than
        // emitting a half-decoded escape.
        if (ch === "u") {
          if (this.cursor + 4 > this.buffer.length) {
            this.cursor -= 2;
            this.escaped = false;
            return out;
          }
          const hex = this.buffer.slice(this.cursor, this.cursor + 4);
          this.cursor += 4;
          const code = Number.parseInt(hex, 16);
          out += Number.isFinite(code) ? String.fromCharCode(code) : "";
          continue;
        }
        out +=
          ch === "n" ? "\n" : ch === "t" ? "\t" : ch === "r" ? "" : ch;
        continue;
      }

      if (ch === "\\") {
        if (this.cursor >= this.buffer.length) {
          // The escape's partner has not arrived; resume from the backslash.
          this.cursor -= 1;
          return out;
        }
        this.escaped = true;
        continue;
      }

      if (ch === '"') {
        this.finished = true;
        return out;
      }

      out += ch;
    }

    return out;
  }
}

/**
 * Is a zero-token stream failure worth one non-streaming retry?
 *
 * Only when the provider has not already made up its mind about the request. A
 * 4xx is a verdict — malformed body, no credit, over the rate limit, context
 * too long — and it will be the same verdict a second time. Anything else
 * (a transport error, a 5xx, a deployment that simply does not stream) can
 * legitimately succeed on the unstreamed path.
 */
function worthRetryingUnstreamed(err: unknown): boolean {
  if (err instanceof AppError) {
    return err.status < 400 || err.status >= 500;
  }
  return true;
}

/**
 * One model turn, streamed where possible.
 *
 * Falls back to the non-streaming call if the deployment behind the id will not
 * stream — the answer is identical either way, only the reasoning goes unseen.
 */
async function runTurn(
  input: TextGenerationInput,
  onEvent: ((event: AgentEvent) => void) | undefined,
  generate?: (input: TextGenerationInput) => Promise<string>
): Promise<string> {
  if (generate) return generate(input);
  if (!onEvent) return (await omega.generateText(input)).text;

  const tap = new ThinkingTap();
  let text = "";
  try {
    for await (const delta of omega.streamText(input)) {
      text += delta;
      const thought = tap.push(delta);
      if (thought) onEvent({ type: "thinking", text: thought });
    }
  } catch (err) {
    if (text) throw err;
    // Nothing arrived at all. That is *usually* a provider which will not
    // stream, in which case asking again the old way is right — but it is also
    // what a rejected request looks like, and those are rejected identically
    // the second time. Retrying a 400 or a 429 bought nothing and cost a second
    // billed call, so the retry is limited to failures that are plausibly about
    // streaming rather than about the request.
    if (!worthRetryingUnstreamed(err)) throw err;
    return (await omega.generateText(input)).text;
  }
  return text;
}

/* ---------------------------------- parsing -------------------------------- */

interface ParsedReply {
  call: ToolCall | null;
  plan: ReturnType<typeof agentPlanSchema.safeParse> | null;
  problem: string | null;
}

/**
 * True when a reply carries reasoning and nothing else.
 *
 * Distinguished from a deliberate empty plan by what the model actually wrote:
 * an answer of "nothing needs changing" has a summary in it, and a reply that
 * ran out of room has only `thinking`.
 */
function onlyReasoning(text: string): boolean {
  const objects = jsonObjects(stripFence(text));
  if (!objects.length) return false;
  return objects.every((candidate) => {
    const hasThinking = /"thinking"\s*:/.test(candidate);
    const hasAnswer = REPLY_KEYS.some((key) =>
      new RegExp(`"${key}"\\s*:`).test(candidate)
    );
    return hasThinking && !hasAnswer;
  });
}

/** Keys that mean "this object is the reply", not a fragment beside it. */
const REPLY_KEYS = ["tool", "ops", "steps", "summary", "findings"];

function parseReply(text: string): ParsedReply {
  const candidates = jsonObjects(stripFence(text));
  if (!candidates.length) {
    return { call: null, plan: null, problem: "no JSON object in the reply" };
  }

  const read = (candidate: string): unknown | undefined => {
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        return JSON.parse(repairJson(candidate));
      } catch {
        return undefined;
      }
    }
  };

  // Take the first object that parses *and* looks like an answer. A model with
  // second thoughts leaves the discarded one behind, and it is usually the
  // shorter of the two — so "first that parses" alone would take the fragment.
  let value: unknown;
  for (const candidate of candidates) {
    const parsed = read(candidate);
    if (parsed === undefined) continue;
    if (
      parsed &&
      typeof parsed === "object" &&
      REPLY_KEYS.some((key) => key in (parsed as Record<string, unknown>))
    ) {
      value = parsed;
      break;
    }
    if (value === undefined) value = parsed;
  }

  if (value === undefined) {
    return {
      call: null,
      plan: null,
      problem: `invalid JSON — ${candidates.length} object(s) in the reply, none usable`,
    };
  }

  if (value && typeof value === "object" && typeof (value as { tool?: unknown }).tool === "string") {
    const record = value as Record<string, unknown> & { tool: string };
    // Arguments belong under `args`, and half the time they arrive beside
    // `tool` instead — `{"tool":"find_phrase","phrase":"four minutes"}`. Both
    // say the same thing perfectly clearly, and answering "no phrase given" to
    // the second was the harness being pedantic at its own expense: the model
    // spent three turns trying to satisfy it and ran out of looks.
    const loose: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      if (key === "tool" || key === "args" || key === "thinking") continue;
      loose[key] = item;
    }
    const nested =
      record.args && typeof record.args === "object"
        ? (record.args as Record<string, unknown>)
        : {};

    return {
      call: { tool: record.tool, args: { ...loose, ...nested } },
      plan: null,
      problem: null,
    };
  }

  return { call: null, plan: agentPlanSchema.safeParse(value), problem: null };
}

/* ----------------------------------- loop ---------------------------------- */

/** Looks the model is allowed before it must answer. */
const MAX_TOOL_CALLS = 6;
/**
 * Turns spent on a look that taught it nothing — a repeat, or one asked after
 * the budget is gone.
 *
 * There has to be a cap, and the reason is a loop that shipped: a repeated
 * question was answered from cache and told it was "free", which meant it cost
 * no look and made no progress. A model that kept asking the same thing spun
 * until the turn limit and the person got "That edit couldn't be worked out"
 * after ninety seconds of nothing. Free was the bug.
 */
const MAX_WASTED_LOOKS = 3;
/**
 * Empty plans tolerated before giving up.
 *
 * Two: one to catch a turn that simply went nowhere, and one more in case the
 * nudge itself was misread. Past that it is not going to produce work, and
 * saying so beats returning silence dressed as an answer.
 */
const MAX_EMPTY_PLANS = 2;
/** Total model turns, including looks, malformed retries and the repair. */
const MAX_TURNS = 16;

export async function planRescriptEdit(
  input: RescriptAgentInput
): Promise<RescriptPlan> {
  const propose = input.mode === "propose";
  const lines = parseTranscript(input.context.transcript);
  const brief = describe(input.context, lines);

  const system = [
    SYSTEM,
    PROTOCOL,
    propose ? PROPOSE_SUFFIX : "",
    brief.windowed
      ? "\nThis transcript was shown to you as an outline. Do not plan a cut or a caption on a stretch you have not read in full."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  /**
   * The same brief with the tools taken out.
   *
   * Swapped in when looking stops being productive, so the model is not still
   * being shown a vocabulary it is being told not to use.
   */
  const closedSystem = [
    SYSTEM,
    propose ? PROPOSE_SUFFIX : "",
    `HOW TO REPLY

Reply with one JSON object and nothing else — no prose, no code fence. There are no tools; you have already
seen everything you are going to see, and a reply that asks for one will be discarded.

${
  propose
    ? '{"thinking":"…","summary":"one sentence on the edit you are proposing","findings":[…],"steps":[{"title":"…","detail":"…","ops":[ … ]}]}'
    : '{"thinking":"…","summary":"one sentence, what you did","ops":[ … ]}'
}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: ChatMessage[] = [{ role: "system", content: system }];

  // Earlier turns, compressed: what was asked and what came of it. Enough for
  // "make that bigger" to resolve, without re-sending plans that already ran.
  for (const exchange of input.history ?? []) {
    messages.push({ role: "user", content: exchange.instruction });
    messages.push({
      role: "assistant",
      content: exchange.outcome
        ? `${exchange.summary}\n(what happened: ${exchange.outcome})`
        : exchange.summary,
    });
  }

  messages.push({
    role: "user",
    content: `${brief.text}\n\nWHAT THEY ASKED FOR:\n${input.instruction}`,
  });

  const trace: RescriptTraceEntry[] = [];
  /**
   * Answers already given, keyed by the call that produced them.
   *
   * Observed live: the model will sometimes ask `find_phrase` the same question
   * twice in a row. Charging a look for an answer it has already been told is
   * how a six-look budget gets spent on four questions, so a repeat is answered
   * from here, is not counted, and says so — which is also the fastest way for
   * the model to notice it is going in a circle.
   */
  const answered = new Map<string, string>();
  let looks = 0;
  /** Looks that returned nothing new. See MAX_WASTED_LOOKS. */
  let wasted = 0;
  /**
   * Whether the tools have been taken away.
   *
   * Asking it to stop looking is not enough — it will keep reaching for a tool
   * it can still see. So the vocabulary is withdrawn from the system message
   * as well, which is what actually ends the loop.
   */
  let toolsClosed = false;
  /**
   * Whether an empty plan has already been queried.
   *
   * An empty plan is ambiguous, and the ambiguity used to resolve the wrong
   * way. Observed live: asked to propose an edit, the model spent its turn
   * reasoning, ended with "let me read the transcript first" — and returned a
   * plan-shaped object with no operations in it. That was taken as "there is
   * nothing to do here", so a request to edit a forty-five minute recording
   * came back having done nothing and saying nothing was wrong.
   *
   * So it is asked once. "Nothing to do" is a real answer and stays available;
   * it just has to be meant.
   */
  let queriedEmpty = false;
  /** Empty plans seen. See the branch that handles them. */
  let emptyPlans = 0;
  let problem = "no output";
  let repaired = false;

  const emit = input.onEvent;

  /**
   * The first two messages are never trimmed.
   *
   * The system prompt is the operation vocabulary and the house style; the
   * brief is the project itself. Shortening either does not shorten the
   * conversation, it lobotomises it — the model would still answer, in a
   * vocabulary it no longer has.
   */
  const PINNED = 2;

  /**
   * Ask the model, having first made the conversation fit.
   *
   * `squeeze` shrinks the budget below what the model claims to take. It is
   * only ever above zero on the one retry after a rejection for length: the
   * table in `budget.ts` holds floors rather than the vendors' advertised
   * maxima, and a model whose real window is smaller than its entry is exactly
   * the case that estimate cannot catch.
   */
  const ask = async (
    turn: number,
    squeeze = 1
  ): Promise<{ text: string; finishReason?: string }> => {
    const maxTokens = 12_000;
    const budget = Math.floor(inputBudget(input.model, maxTokens) * squeeze);
    const packed = packMessages({
      pinned: messages.slice(0, PINNED),
      body: messages.slice(PINNED),
      budget,
      keepRecent: 4,
    });

    if (packed.dropped || packed.digested) {
      emit?.({
        type: "trim",
        dropped: packed.dropped,
        digested: packed.digested,
        tokens: packed.tokens,
      });
    }

    let finishReason: string | undefined;
    const text = await runTurn(
      {
        messages: packed.messages,
        model: input.model,
        // Cooler on a retry: the first attempt is allowed some judgement, a
        // second one is being asked to comply with something specific.
        temperature: turn === 0 ? 0.35 : 0.15,
        maxTokens,
        json: true,
        signal: input.signal,
        onMeta: (meta) => {
          finishReason = meta.finishReason;
        },
      },
      emit,
      input.generate
    );
    return { text, finishReason };
  };

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    emit?.({ type: "turn", index: turn });

    let result: { text: string; finishReason?: string };
    try {
      result = await ask(turn);
    } catch (err) {
      // A rejection for length is the one provider error worth answering
      // rather than surrendering to: the estimate was wrong, so make the same
      // request from less. Everything else is a verdict — no credit, no key,
      // over the rate limit — and asking again would only spend another call
      // on the same answer.
      if (!(err instanceof AppError) || err.code !== "context_overflow") throw err;
      emit?.({ type: "retry", reason: "the conversation was too long to read" });
      result = await ask(turn, 0.6);
    }

    /**
     * The provider says the reply hit the output ceiling.
     *
     * Previously this was only ever inferred — from a reply that was all
     * reasoning, or from a parse that failed on an unterminated object. Both
     * heuristics still stand, because a stub model and some deployments report
     * nothing; this just makes the common case certain instead of guessed, and
     * changes what the model is told to do about it.
     */
    const truncated = result.finishReason === "length";

    const reply = parseReply(result.text);
    // Set RESCRIPT_AGENT_DEBUG to a path to see what the model actually said.
    // The two harness bugs worth having — a plan discarded over a stray quote,
    // and a tool call with its argument in the wrong place — were both
    // invisible from the outside: the route answered 200 with an empty plan.
    if (process.env.RESCRIPT_AGENT_DEBUG) {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(
        process.env.RESCRIPT_AGENT_DEBUG,
        `\n=== turn ${turn} ===\n${result.text}\n`
      );
    }

    /* ----------------------------- a look ------------------------------- */
    if (reply.call) {
      messages.push({ role: "assistant", content: result.text.slice(0, 1_200) });

      const key = `${reply.call.tool}:${JSON.stringify(reply.call.args)}`;
      const seen = answered.get(key);
      const spent = looks >= MAX_TOOL_CALLS;

      // A look that teaches it nothing: one it has already had, or one past the
      // budget. Both cost a turn, so both have to be counted, or the loop has
      // no bottom.
      if (toolsClosed || spent || seen !== undefined) {
        wasted += 1;

        // Closing the tools persuades most models; one that reaches for them
        // anyway is not going to be talked round, and every further turn is a
        // turn the person waits for nothing. Stop rather than spend the budget
        // proving it.
        if (wasted > MAX_WASTED_LOOKS + 1) {
          problem = "it kept asking to look instead of answering";
          break;
        }

        const answer =
          seen !== undefined
            ? `You already asked that, and the answer has not changed:\n\n${seen}`
            : "You have used all of your looks.";

        if (wasted >= MAX_WASTED_LOOKS) {
          toolsClosed = true;
          // Withdrawing the vocabulary is the part that works. Telling it to
          // stop while the tools are still described to it does not.
          messages[0] = { role: "system", content: closedSystem };
          messages.push({
            role: "user",
            content: `${answer}\n\nThe tools are now closed. Reply with the plan itself and nothing else, using what you already know.`,
          });
        } else {
          messages.push({
            role: "user",
            content: `${answer}\n\nAsk something different, or reply with the plan.`,
          });
        }
        continue;
      }

      looks += 1;
      const result2 = runTool(reply.call, input.context, lines);
      answered.set(key, result2.result);
      trace.push({ tool: reply.call.tool, detail: result2.detail });
      emit?.({ type: "look", tool: reply.call.tool, detail: result2.detail });
      messages.push({
        role: "user",
        content: `${result2.result}\n\n(${MAX_TOOL_CALLS - looks} look${MAX_TOOL_CALLS - looks === 1 ? "" : "s"} left. Use another, or reply with the plan.)`,
      });
      continue;
    }

    /* ------------------ a reply that is only reasoning ------------------- */
    //
    // The reply shares one output budget between `thinking` and the plan, and a
    // model that reasons at length spends the lot: what arrives is a truncated
    // object with nothing in it but working-out. Seen at 15,799 characters of
    // `thinking` and no plan. It parses — every field of the plan schema has a
    // default — so without this it would look like a considered "nothing to do".
    if (reply.plan?.success && onlyReasoning(result.text)) {
      wasted += 1;
      if (wasted > MAX_WASTED_LOOKS + 1) {
        problem = "every reply was reasoning with no plan in it";
        break;
      }
      emit?.({ type: "retry", reason: "the reply was all reasoning and no plan" });
      messages.push({ role: "assistant", content: result.text.slice(0, 600) });
      messages.push({
        role: "user",
        content:
          "That reply was reasoning with no plan in it — you spent the whole budget thinking. Keep \"thinking\" to one or two sentences and send the plan itself.",
      });
      continue;
    }

    /* ---------------------------- a bad reply --------------------------- */
    if (!reply.plan || !reply.plan.success) {
      emit?.({
        type: "retry",
        reason: truncated
          ? "the reply ran out of room before it finished"
          : (reply.problem ?? "the reply could not be used"),
      });
      problem =
        reply.problem ??
        (reply.plan && !reply.plan.success
          ? `${reply.plan.error.issues[0]?.path.join(".") || "root"} ${reply.plan.error.issues[0]?.message}`
          : "unusable reply");
      messages.push({ role: "assistant", content: result.text.slice(0, 1_500) });
      messages.push({
        role: "user",
        content: truncated
          ? `That reply was cut off before it finished — it ran past the output budget, so what arrived was incomplete (${problem}). Send the same plan again, shorter: one sentence of "thinking", and fewer, larger steps.`
          : `That was rejected: ${problem}. Reply again with only the JSON object, using the operations exactly as specified.`,
      });
      continue;
    }

    /* ------------------------------ a plan ------------------------------ */
    const parsed = reply.plan.data;
    const rejected: string[] = [];
    const steps: RescriptStep[] = [];
    for (const step of parsed.steps) {
      const sifted = siftOps(step.ops);
      rejected.push(...sifted.rejected);
      // A step whose every operation was malformed is not worth showing:
      // accepting it would do nothing at all.
      if (sifted.ops.length) {
        steps.push({ title: step.title, detail: step.detail, ops: sifted.ops });
      }
    }

    const flat = siftOps(parsed.ops);
    rejected.push(...flat.rejected);

    const everyOp = [...steps.flatMap((s) => s.ops), ...flat.ops];
    const proposed = everyOp.length;
    const askedForNothing = !parsed.ops.length && !parsed.steps.length;

    if (!proposed && askedForNothing) {
      /**
       * "Nothing to do" has to be argued for.
       *
       * An empty plan carrying an empty summary is not a judgement, it is a
       * turn that went nowhere — and taking it at face value is how "edit this
       * for me end to end" came back having done nothing, with no reason given.
       * A model that genuinely thinks the video is fine can say so; one that
       * cannot even manage a sentence is asked again.
       */
      const justified = parsed.summary.trim().length > 0;
      if (justified && queriedEmpty) {
        return {
          summary: parsed.summary,
          findings: parsed.findings,
          steps,
          ops: flat.ops,
          rejected,
          trace,
          warnings: [],
        };
      }

      emptyPlans += 1;
      if (emptyPlans > MAX_EMPTY_PLANS) {
        problem = "it returned an empty plan and could not say why";
        break;
      }

      queriedEmpty = true;
      messages.push({ role: "assistant", content: result.text.slice(0, 1_500) });
      messages.push({
        role: "user",
        content: propose
          ? "That plan has no steps in it. If you still need to look at something, use a tool. If you are ready, send the steps. If you genuinely believe nothing about this video should change, say exactly why in the summary — an empty summary is not an answer."
          : "That plan has no operations in it. If you still need to look at something, use a tool. If you are ready, send the operations. If you genuinely believe nothing needs changing, say exactly why in the summary — an empty summary is not an answer.",
      });
      continue;
    }

    if (!proposed && !askedForNothing) {
      problem = rejected[0] ?? "no usable operations";
      messages.push({ role: "assistant", content: result.text.slice(0, 1_500) });
      messages.push({
        role: "user",
        content: `That was rejected: ${problem}. Reply again with only the JSON object, using the operations exactly as specified.`,
      });
      continue;
    }

    /* --------------------------- verification --------------------------- */
    const world: PlanWorld = {
      duration: input.context.duration,
      boundaryCount: input.context.boundaries.length,
      elementCount: input.context.elements.length,
      subtitlesOn: input.context.subtitles.enabled,
      subtitlePosition: input.context.subtitles.position ?? "bottom",
      transcript: input.context.transcript ?? "",
      can: input.context.can,
    };
    const problems = proposed ? verifyPlan(everyOp, world) : [];
    if (proposed) emit?.({ type: "verify", problems: problems.length });

    if (problems.length && !repaired) {
      repaired = true;
      emit?.({ type: "repair", problems });
      trace.push({
        tool: "verify",
        detail: `Checked the plan — ${problems.length} problem${problems.length === 1 ? "" : "s"} to fix`,
      });
      messages.push({ role: "assistant", content: result.text.slice(0, 2_500) });
      messages.push({
        role: "user",
        content: [
          "That plan was checked against the project before running it, and these are wrong:",
          ...problems.map((p) => `  - ${p}`),
          "",
          "Send the whole plan again with those fixed. Keep everything that was right; change only what has to change.",
        ].join("\n"),
      });
      continue;
    }

    if (problems.length) {
      trace.push({
        tool: "verify",
        detail: `${problems.length} problem${problems.length === 1 ? "" : "s"} could not be resolved`,
      });
    }

    return {
      summary: parsed.summary.trim() || summarise(everyOp),
      findings: parsed.findings,
      steps,
      ops: flat.ops,
      rejected,
      trace,
      warnings: problems,
    };
  }

  // Naming what actually went wrong. "Try describing it a different way" is
  // useless advice when the model spent every turn re-reading the transcript
  // rather than answering — the person's wording was never the problem.
  const ranOut = looks >= MAX_TOOL_CALLS || wasted > 0;
  throw new AppError("malformed_response", {
    userMessage: ranOut
      ? "That edit couldn't be settled — it kept looking at the footage instead of answering. Try again, or ask for something narrower."
      : "That edit couldn't be worked out. Try describing it a different way.",
    detail: `rescript plan gave up after ${MAX_TURNS} turns (${looks} looks, ${wasted} wasted, tools ${toolsClosed ? "closed" : "open"}): ${problem}`,
  });
}
