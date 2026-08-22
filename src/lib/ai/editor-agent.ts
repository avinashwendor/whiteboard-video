import { omega } from "./omega";
import type { ChatMessage } from "./types";
import { AppError } from "@/lib/utils/errors";
import { editPlanSchema, type EditPlan } from "@/lib/studio/edit-plan";

/**
 * Turns "make scene two use a real photo of a server rack" into work.
 *
 * The model never writes assets and never rewrites the project wholesale. It
 * reads a pruned copy and answers with a short list of operations, each one
 * pointing at a pipeline that already exists -- Tavily search, image
 * generation, board layout, narration. The browser runs them.
 */

const SYSTEM = `You are the editor of an AI-generated explainer video. The person tells you what they want changed; you answer with the operations that make it happen.

Scenes are numbered from 1, exactly as they are numbered in the video you are shown and exactly as the person says them. "Scene 1" is 1. Never subtract one from anything.

Reply with JSON only -- no prose, no code fence:
{"summary":"one sentence on what you are doing","ops":[ ... ]}

OPERATIONS

{"op":"set","scene":2,"field":"heading","value":"..."}      one scene's field
{"op":"set","field":"musicMood","value":"serious"}          the video's own field (no "scene")
  Scene fields, and nothing else:
    boardTitle      text, 2-6 words -- THE TITLE DRAWN ON THE CANVAS
    heading         text, 2-8 words -- names the scene in the timeline; not drawn on a board
    narration       text, spoken aloud
    bullets         array of short fragments; what the board is re-laid out from, not drawn as-is
    keywords        array of short words the narrator actually says
    imagePrompt     text describing artwork to generate
    photoQuery      text to search the web for
    stat            short number as text, e.g. "85%"
    statCaption     text
    supportVisual   "photo" | "generated" | "none"
    visualTheme     "studio-dark" | "cyber-blue" | "sunset" | "clean-light"
  Video fields, and nothing else:
    title           text
    description     text
    videoStyle      "whiteboard" | "hyperframes"   (the rendering engine, not a mood)
    musicMood       "calm" | "curious" | "driving" | "warm" | "serious" | "none"
    introDuration   seconds, 0-20
    voiceDelay      seconds, 0-10
  A mood or a feeling is musicMood and visualTheme. It is never videoStyle.

{"op":"setBoardItem","scene":2,"item":3,"label":"CASH WAS KING","icon":"banknote"}
  One drawn item on the board: its caption, its icon, its tick/cross/warning badge, its colour. Add
  "side":"left"|"right" for a compare board. Captions are at most 20 characters and are drawn in capitals.
  Icons are named, not drawn -- one or two plain nouns for the thing itself ("banknote", not "finance") --
  and the geometry is looked up for you.

{"op":"findPhoto","scene":2,"query":"datacenter server rack","brief":"what the scene is about"}
  A real photograph, searched on the web and checked by a vision model. Use this whenever they ask for a
  real, actual or photographic picture of something that exists.

{"op":"generateImage","scene":2,"prompt":"...","style":"photorealistic|illustration|diagram|whiteboard"}
  Generated artwork. Use this for things that cannot be photographed, for marker illustrations, and when
  they explicitly say generate, draw or illustrate. The prompt describes subject, composition and mood.

{"op":"relayout","scene":2,"hint":"put the three stages in order across the board"}
  Re-composes the board: it picks a new layout (icons, steps, compare, pie, bars, timeline, stat), chooses
  the icons, and decides where everything sits. This is the ONLY way to change positions, arrangement,
  ordering, icons or the diagram type -- there are no x/y coordinates in this system. Use it whenever they
  talk about layout, position, arrangement, spacing, which icon, or "this scene looks wrong".

{"op":"speak","scene":2}
  Re-records the narration. You do NOT need this after editing narration -- that happens automatically.
  Only emit it when they ask for the voice to be redone on its own.

{"op":"addScene","after":2,"heading":"...","bullets":["..."],"narration":"...","imagePrompt":"...","photoQuery":"...","supportVisual":"photo|generated|none"}
  "after" is the scene number it should follow; 0 puts it first. The new scene is recorded, laid out and
  given the picture "supportVisual" asks for, all on its own. Do not follow it with findPhoto,
  generateImage, relayout or speak -- the insert renumbers every later scene and your follow-up would
  land on the wrong one.

{"op":"removeScene","scene":3}
{"op":"moveScene","from":4,"to":2}

WHAT IS ACTUALLY ON SCREEN
A whiteboard scene keeps two sets of words. The board -- "boardTitle" and the drawn items -- is what a
viewer sees. "heading" and "bullets" are the writer's notes: they name the scene and feed a re-layout, and
they are not drawn. So when someone asks to change wording they can see, edit boardTitle and setBoardItem.
Editing bullets alone changes nothing on the canvas, and asking for a relayout to fix one caption throws
away the whole board to fix a word.

"The title", with a scene open, means that scene's boardTitle -- the words drawn across the top of the
board they are looking at. The video's own "title" is only what they mean when they say the video's title,
the whole video, the project, or the intro card.

RULES
- Do only what was asked. Two words of feedback is not licence to rewrite the video.
- When they name no scene and the request is clearly about one, use the scene they have open.
- Editing narration re-records the voice by itself, which takes time -- so do not rewrite a script unless
  they asked you to.
- Board labels come from the narration: if you change what a scene says, relayout it so its captions still
  use words the narrator actually speaks.
- Never invent statistics. Never put a url, a file path or base64 in a value.
- If the request is unclear or you cannot do it, return an empty ops array and say why in "summary".`;

function stripFence(value: string): string {
  return value.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

function firstJsonObject(value: string): string | null {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return value.slice(start, end + 1);
}

export interface EditPlannerInput {
  /** What the person typed. */
  instruction: string;
  /** The project, already pruned of word timings and icon geometry. */
  project: unknown;
  /** The scene open in the editor (1-based), used when no scene is named. */
  sceneNumber?: number;
  model?: string;
  signal?: AbortSignal;
}

export async function planEdit(input: EditPlannerInput): Promise<EditPlan> {
  const context = [
    `THE VIDEO AS IT STANDS:\n${JSON.stringify(input.project)}`,
    typeof input.sceneNumber === "number"
      ? `The editor currently has scene ${input.sceneNumber} open.`
      : "",
    `WHAT THEY ASKED FOR:\n${input.instruction}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: context },
  ];

  let problem = "no output";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await omega.generateText({
      messages,
      model: input.model,
      temperature: attempt === 0 ? 0.3 : 0.15,
      maxTokens: 1_600,
      json: true,
      signal: input.signal,
    });

    const candidate = firstJsonObject(stripFence(result.text));
    if (candidate) {
      try {
        const parsed = editPlanSchema.safeParse(JSON.parse(candidate));
        if (parsed.success) return parsed.data;
        const issue = parsed.error.issues[0];
        problem = `${issue.path.join(".") || "root"} ${issue.message}`;
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
    detail: `edit plan validation failed: ${problem}`,
  });
}
