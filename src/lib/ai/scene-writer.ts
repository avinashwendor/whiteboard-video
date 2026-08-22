import { omega } from "./omega";
import type { ChatMessage } from "./types";
import { AppError } from "@/lib/utils/errors";
import { sceneSpecSchema, type SceneSpec } from "@/lib/whiteboard/scene";

/**
 * Turns a scene brief into a board layout.
 *
 * The model picks one of seven layouts, fills in labelled slots, and names the
 * idea each icon should carry. It is never asked to draw: the geometry is
 * matched to a real icon set afterwards, in `icon-resolver`.
 */

const SYSTEM = `You lay out one slide of a hand-drawn whiteboard explainer video.

Choose the layout that genuinely fits what the narration says, then fill it in. Reply with JSON only -- no prose, no code fence.

LAYOUTS

{"layout":"icons","title":"...","items":[{"icon":"...","label":"...","badge":"check|cross|alert"}]}
  1-4 labelled icons in a row. The everyday choice for "here are the things".

{"layout":"steps","title":"...","items":[{"icon":"...","label":"..."}]}
  2-4 icons joined by arrows. Use for a sequence or a cause and effect.

{"layout":"compare","title":"...","left":{"title":"...","items":[...],"stat":"25%","statCaption":"..."},"right":{...}}
  Two columns split by a line. Use for before/after, myth/reality, A vs B. 1-3 items per side. The stat fields are optional.

{"layout":"pie","title":"...","data":[{"label":"...","value":60},{"label":"...","value":40}],"items":[...]}
  A share of a whole. 2-4 slices; values are shares and are turned into percentages for you. Up to 3 optional icons appear underneath.

{"layout":"bars","title":"...","data":[{"label":"...","value":85}],"items":[...]}
  2-5 bars for comparing quantities. Values are drawn as written.

{"layout":"timeline","title":"...","items":[{"icon":"...","label":"..."}]}
  2-4 points along a line. Use for anything over time.

{"layout":"stat","title":"...","stat":"85%","caption":"...","icon":"..."}
  One number that deserves the whole board.

RULES
- "title": 2-6 words, the point of the scene. It is drawn in capitals, so write it as ordinary words.
- "label" and "caption": one or two words, never more than 18 characters. They are captions, never sentences or statistics.
- Every "label", "title" and "caption" must use a word that is actually spoken in the narration. Each drawing is timed to the moment its own words are said, so a caption the script never says is drawn at the wrong moment.
- "stat": a short number like "85%", "3x", "₹10,000 CR", "$2M", "10 YEARS".
- Every "icon": one or two plain lowercase words naming what should be DRAWN, not the label text. Prefer a concrete object over an abstraction -- "banknote" over "finance", "rocket" over "launch strategy", "brain" over "cognition". Any everyday noun works; it is matched against a large icon set afterwards.
- "badge" marks an item good ("check"), failed ("cross") or risky ("alert"). Use it only when it means something.
- "colour" is optional on items and data: blue, yellow, orange, green, red, violet, teal, pink.
- Pick real numbers from the narration when it gives them. Never invent statistics that were not said.
- Vary the layouts across a video. Reach for compare, pie, bars, timeline and stat whenever the content supports them.`;

function stripFence(value: string): string {
  return value.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

function firstJsonObject(value: string): string | null {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return value.slice(start, end + 1);
}

export interface SceneWriterInput {
  /** The scene heading, its bullet fragments and its narration. */
  brief: string;
  /**
   * True when a photograph will be taped to the board. The drawing then has
   * roughly two thirds of the width, so wide layouts have to be avoided.
   */
  hasPhoto?: boolean;
  /** Layouts already used in this video, so the boards keep varying. */
  usedLayouts?: string[];
  model?: string;
  signal?: AbortSignal;
}

export async function writeScene(input: SceneWriterInput): Promise<SceneSpec> {
  const notes: string[] = [];
  if (input.usedLayouts?.length) {
    notes.push(
      `Earlier scenes in this video already used: ${input.usedLayouts.join(", ")}. Pick a layout that is not in that list, unless none of the others can carry this content.`,
    );
  }
  if (input.hasPhoto) {
    notes.push(
      "A photograph is being taped to the right of this board, so the drawing only gets the left two thirds of the width. Choose a layout that stays narrow: prefer \"stat\", or \"icons\"/\"steps\"/\"timeline\" with at most 3 items. Do not use \"compare\", and do not use \"bars\" or \"pie\" with more than 3 entries.",
    );
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: notes.length ? `${input.brief}\n\n${notes.join("\n\n")}` : input.brief,
    },
  ];

  let problem = "no output";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await omega.generateText({
      messages,
      model: input.model,
      temperature: attempt === 0 ? 0.6 : 0.25,
      maxTokens: 900,
      json: true,
      signal: input.signal,
    });

    const candidate = firstJsonObject(stripFence(result.text));
    if (candidate) {
      try {
        const parsed = sceneSpecSchema.safeParse(JSON.parse(candidate));
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
      content: `That was rejected: ${problem}. Reply again with only the JSON object, matching one of the layouts exactly.`,
    });
  }

  throw new AppError("malformed_response", {
    userMessage: "That scene couldn't be laid out. Try regenerating.",
    detail: `scene spec validation failed: ${problem}`,
  });
}
