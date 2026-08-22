import { omega } from "./omega";
import type { ChatMessage } from "./types";
import { AppError } from "@/lib/utils/errors";
import {
  agentPlanSchema,
  siftOps,
  type AgentOp,
} from "@/rescript/lib/overlay/ops-schema";

/**
 * Turns "put a title card on the first clip and burn in subtitles" into work.
 *
 * Same split as the studio's editor agent: the model reads a pruned view of the
 * project and answers with operations the browser runs against pipelines that
 * already exist. It never writes an asset — an `addImage` is a *request* for a
 * picture, fulfilled by the browser calling the image route — and it never
 * emits anything that is not in the schema.
 */

const SYSTEM = `You are the editor of a video. The person tells you what they want; you answer with the operations that make it happen.

TIME
All times are seconds on the FINISHED video's clock — after cuts, which is what the person sees in the player. 0 is the first frame.

NUMBERING
Elements are numbered from 1, exactly as they are listed to you. "The first caption" is element 1. Never subtract one from anything.
Transition boundaries are numbered from 1: boundary 1 is between clip 1 and clip 2.

Reply with JSON only — no prose, no code fence:
{"reasoning":"think step-by-step about how to make this the highest quality, most dynamic edit. Analyze transcript and plan visuals, text, subtitles, colors, and animations.","summary":"one sentence, what you did","ops":[ ... ]}

OPERATIONS

{"op":"addText","text":"...","start":0,"duration":3,"position":"lower-third","size":"l","style":"title","color":"#ffffff","background":"rgba(0,0,0,0.55)","align":"center","uppercase":false,"enter":"slideUp","exit":"fade"}
  Puts words on screen. Only "text" is required; everything else has a sensible default.
  position: top-left top top-right left center right bottom-left bottom bottom-right lower-third upper-third
            or an exact {"x":0.1,"y":0.7} in fractions of the frame, origin top-left.
  size: xs s m l xl        style: plain title subtitle caption badge quote handwritten
  Give "duration" OR "end", not both. Keep text short — this is a caption, not a paragraph.

{"op":"addImage","prompt":"a hand-drawn rocket, marker on white","start":2,"duration":4,"position":"top-right","size":"m","enter":"pop"}
{"op":"addImage","query":"golden gate bridge fog","start":2,"duration":4,"position":"right"}
  A picture on top of the video. Use "prompt" to GENERATE artwork (things that cannot be photographed,
  illustrations, diagrams, anything they say to draw or generate). Use "query" to SEARCH for a real
  photograph of something that exists. Exactly one of the two. The browser fetches it; you do not.

{"op":"addShape","shape":"rect","position":"bottom","size":"l","fill":"rgba(0,0,0,0.6)"}
  A plain block — usually a scrim so text over busy footage stays readable. shape: rect ellipse line

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

{"op":"removeFillers"}                       — cut every "um", "uh" and similar
{"op":"removeSilences","minDuration":0.4}    — cut pauses at least this long
{"op":"deletePhrase","text":"you know what I mean","occurrence":2}
  Cuts spoken words out of the video by deleting them from the transcript. Omit "occurrence" to cut every one.
  Only use text that actually appears in the transcript you were shown.

{"op":"deleteRange","from":42,"to":55}
  Cuts a span of the finished video. Use this for a tangent, a stumble, or dead air that the transcript shows
  you. The times are the ones stamped in the transcript below.

{"op":"keepOnly","ranges":[{"from":12,"to":28},{"from":61,"to":74}]}
  Keeps only these spans and cuts everything else — one operation for a highlight reel, a trailer, or a
  short. Choose the spans from the transcript: complete thoughts, starting on the first word of a sentence
  and ending on the last. Never cut mid-sentence.

{"op":"captionPhrase","phrase":"three times faster","text":"3× FASTER","style":"badge","position":"upper-third","enter":"pop","hold":0.8}
  Puts words on screen exactly as they are spoken. The browser finds the phrase in the transcript and takes
  the timing from the word timings, so it lands on the beat — use this for every kinetic caption instead of
  guessing a time with addText. "phrase" must appear in the transcript; "text" is what is shown and can be
  shorter or capitalised. This is the operation that makes an edit feel produced.

{"op":"splitAt","at":30}
  Puts a clip boundary at that second without removing anything. Transitions sit between clips, so if the
  video has no cuts yet, split before asking for one.

RULES ABOUT ORDER
Cuts change the clock. Put every cutting operation (removeFillers, removeSilences, deletePhrase,
deleteRange, keepOnly, splitAt) FIRST, and write every later time — caption starts, boundary numbers — as
they will be AFTER those cuts. Removing fillers and silences typically takes 5-15% off the length; if you
cannot work out the new time exactly, place captions relative to the start of the video, which does not
move.

DOING A WHOLE EDIT AT ONCE
When asked for something broad — "edit this for me", "make it a short", "tighten it up", "make it
publishable" — do the entire job in one plan, in this order:
  1. removeFillers, then removeSilences (0.35-0.5s is a natural threshold for talking-head footage).
  2. keepOnly or deleteRange to drop tangents and dead ends, if a target length was named or the material
     obviously runs long. Respect a requested length: a "30 second short" means the kept spans add up to
     roughly 30 seconds.
  3. setAllTransitions — a dissolve or a fade of 0.3-0.5s reads well over the jump cuts that step 1 leaves.
  4. subtitles on, with a preset that matches the format ("shorts" or "karaoke" for vertical/social,
     "clean" or "broadcast" otherwise).
  5. One addText title card over the opening two or three seconds, taken from what they actually talk
     about in the transcript. Not a generic word like "Intro".
  6. Add rich B-roll (addImage) and kinetic text (captionPhrase). A premium edit MUST have high visual variety! Liberally add real photos (query) or generated artwork (prompt) when the speaker mentions concrete concepts, locations, or emotions. Use captionPhrase with striking styles (like badge) and popping colors/animations. Make it look like the best edit in the world.

HOW TO MAKE IT LOOK EDITED, NOT GENERATED
These are the rules a working editor applies without thinking. Follow them.

  Space. Two things never share the same part of the frame at the same time. If subtitles are on they own
  their band — a lower third with subtitles underneath goes to "upper-third" or "top", never "bottom" or
  "center". A picture goes to a side or a corner, never over the middle where the speaker is. The app will
  move anything that collides, but a plan that needs moving was a worse plan.

  Restraint. One idea on screen at a time. A title card OR a kinetic caption, not both. If a caption is
  already up, wait for it to leave before the next one. Across a two-minute video: one title, three or four
  kinetic captions, two or three pictures. More than that is a slideshow.

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

B-ROLL
When the speaker names something concrete and visual — a place, an object, a company, a chart, a person —
put a picture over it for the seconds they are talking about it. Use "query" for things that exist and can
be photographed and "prompt" for things that cannot. Two or three across a couple of minutes is a produced
video; one every ten seconds is a slideshow. Never cover the speaker's face: use a corner or a side, size
"s" or "m", and let it come and go with a pop or a fade. Hold a picture for as long as they are talking
about the thing — two to four seconds — and take it away when they move on. A photograph of something real
beats generated art whenever the thing exists; generate only what cannot be photographed. BE PROACTIVE: even if they don't explicitly ask for pictures, add them to elevate the production quality!

RULES
- Answer only with operations that do what was asked. On a narrow request ("add a caption", "cut the ums")
  do exactly that and nothing more. A broad request is the exception — see above; there, doing the whole
  job is what was asked.
- If they ask for something this deployment cannot do, say so in "summary" and return an empty "ops".
- Prefer updating an existing element over adding a second one on top of it.
- Text on video needs contrast: over footage, either give it a background scrim or turn on a colour that
  reads. White with a dark background is the safe default.
- If no time is given for a new element, start it at the current playhead and run it for 3 seconds.
- Never invent an element number that is not in the list.`;

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
Reply with JSON only:
{"reasoning":"deep analysis and planning step-by-step",
 "summary":"one sentence on the edit you are proposing",
 "findings":["what you noticed about this footage, one short sentence each"],
 "steps":[{"title":"Short name","detail":"one sentence on why","ops":[ ... ]}]}

Do NOT use the top-level "ops" field in this mode — put every operation inside a step.

Base "findings" on the measurements you were given, not on impressions: quote the filler count, the dead
air, the pace, the length. Say what you would do about each. If something is already fine, say so rather
than inventing work.

Group the steps the way an editor would talk about them, cutting steps first, in this order where they
apply: tighten (fillers, silences), choose (what to keep), pace (transitions), read (subtitles), produce
(titles, kinetic captions, b-roll). Three to six steps. Every step must carry the operations that do it —
a step with an empty "ops" is not a step, it is a comment.`;

function stripFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

function firstJsonObject(value: string): string | null {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return value.slice(start, end + 1);
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
  subtitles: { enabled: boolean; cueCount: number; preset?: string };
  transitions: Array<{ between: number; kind: string; duration: number }>;
  /** Plain transcript with coarse timestamps, trimmed to fit the window. */
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
  can: { generateImage: boolean; photoSearch: boolean };
}

export interface RescriptAgentInput {
  instruction: string;
  context: RescriptAgentContext;
  /** "propose" returns named steps to accept; "execute" returns flat ops. */
  mode?: "propose" | "execute";
  model?: string;
  signal?: AbortSignal;
}

export interface RescriptStep {
  title: string;
  detail: string;
  ops: AgentOp[];
}

export interface RescriptPlan {
  summary: string;
  findings: string[];
  steps: RescriptStep[];
  ops: AgentOp[];
  rejected: string[];
}

function describe(context: RescriptAgentContext): string {
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

  return [
    `FINISHED VIDEO: ${context.duration.toFixed(2)}s long. The playhead is at ${context.playhead.toFixed(2)}s.`,
    `ELEMENTS ON SCREEN (numbered as the person sees them):\n${elements}`,
    `CLIP BOUNDARIES:\n${boundaries}`,
    `TRANSITIONS SET:\n${transitions}`,
    `SUBTITLES: ${context.subtitles.enabled ? `on, ${context.subtitles.cueCount} cues` : "off"}`,
    context.aspect
      ? `FRAME: ${context.aspect < 0.9 ? "vertical (a Short or a Reel)" : context.aspect > 1.5 ? "widescreen" : "square-ish"}, ratio ${context.aspect.toFixed(2)}.`
      : "",
    context.analysis
      ? [
          "MEASURED IN THE FOOTAGE (these are counts, not estimates — plan from them):",
          `  ${context.analysis.wordCount} words at ${context.analysis.wordsPerMinute} wpm across ${context.analysis.clipCount} clip(s), ${context.analysis.speakerCount} speaker(s).`,
          `  ${context.analysis.fillerCount} filler words, worth ${context.analysis.fillerSeconds.toFixed(1)}s.`,
          `  ${context.analysis.silenceCount} pauses, worth ${context.analysis.silenceSeconds.toFixed(1)}s of dead air.`,
          context.analysis.longestPauses.length
            ? `  Longest pauses: ${context.analysis.longestPauses.map((p) => `${p.seconds.toFixed(1)}s at ${p.at.toFixed(1)}s`).join(", ")}.`
            : "  No pause is long enough to name.",
          context.analysis.runsLong
            ? "  This runs long: choosing what to keep matters more than trimming."
            : "  This is short enough that trimming is the main job.",
        ].join("\n")
      : "",
    `WHAT THIS DEPLOYMENT CAN DO:\n  - Generate artwork (addImage with "prompt"): ${context.can.generateImage ? "available" : "NOT configured — do not plan it"}\n  - Search real photos (addImage with "query"): ${context.can.photoSearch ? "available" : "NOT configured — do not plan it"}`,
    context.transcript
      ? `TRANSCRIPT OF THE CURRENT CUT. The [m:ss] stamps are seconds on the finished video's clock — the same clock deleteRange, keepOnly and splitAt use:\n${context.transcript}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function planRescriptEdit(
  input: RescriptAgentInput
): Promise<RescriptPlan> {
  const propose = input.mode === "propose";
  const messages: ChatMessage[] = [
    { role: "system", content: propose ? SYSTEM + PROPOSE_SUFFIX : SYSTEM },
    {
      role: "user",
      content: `${describe(input.context)}\n\nWHAT THEY ASKED FOR:\n${input.instruction}`,
    },
  ];

  let problem = "no output";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await omega.generateText({
      messages,
      model: input.model,
      temperature: attempt === 0 ? 0.3 : 0.15,
      maxTokens: 1_800,
      json: true,
      signal: input.signal,
    });

    const candidate = firstJsonObject(stripFence(result.text));
    if (candidate) {
      try {
        const parsed = agentPlanSchema.safeParse(JSON.parse(candidate));
        if (parsed.success) {
          const rejected: string[] = [];
          const steps: RescriptStep[] = [];
          for (const step of parsed.data.steps) {
            const sifted = siftOps(step.ops);
            rejected.push(...sifted.rejected);
            // A step whose every operation was malformed is not worth showing:
            // accepting it would do nothing at all.
            if (sifted.ops.length) {
              steps.push({ title: step.title, detail: step.detail, ops: sifted.ops });
            }
          }

          const flat = siftOps(parsed.data.ops);
          rejected.push(...flat.rejected);

          const proposed = steps.reduce((n, s) => n + s.ops.length, 0);
          const anything = proposed > 0 || flat.ops.length > 0;
          const askedForNothing =
            !parsed.data.ops.length && !parsed.data.steps.length;

          // Something usable, or a deliberate "nothing to do": both are answers.
          if (anything || askedForNothing) {
            return {
              summary: parsed.data.summary,
              findings: parsed.data.findings,
              steps,
              ops: flat.ops,
              rejected,
            };
          }
          problem = rejected[0] ?? "no usable operations";
        } else {
          const issue = parsed.error.issues[0];
          problem = `${issue.path.join(".") || "root"} ${issue.message}`;
        }
      } catch (err) {
        problem = `invalid JSON (${err instanceof Error ? err.message : "parse error"})`;
      }
    } else {
      problem = "no JSON object in the reply";
    }

    messages.push({ role: "assistant", content: result.text.slice(0, 1_500) });
    messages.push({
      role: "user",
      content: `That was rejected: ${problem}. Reply again with only the JSON object, using the operations exactly as specified.`,
    });
  }

  throw new AppError("malformed_response", {
    userMessage: "That edit couldn't be worked out. Try describing it a different way.",
    detail: `rescript plan validation failed: ${problem}`,
  });
}
