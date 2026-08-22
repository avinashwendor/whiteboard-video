import { z } from "zod";
import { sceneSpecSchema } from "@/lib/whiteboard/scene";
import type { ProjectAsset } from "./types";

/**
 * What an instruction turns into.
 *
 * The model plans, it does not execute: `/api/edit` returns a list of these and
 * `edit-ops` runs them in the browser. That split is deliberate. Puter only
 * generates images from a browser, audio has to be measured by an `<audio>`
 * element, and every asset has to land in IndexedDB on that side anyway -- so
 * the work belongs next to the pipelines the studio already uses, and only the
 * vocabulary is shared with the server.
 *
 * **Scenes are numbered from 1 here, not indexed from 0.** A planner asked to
 * translate "scene 1" into an index gets it wrong often enough to matter, and
 * an off-by-one silently edits the wrong scene. So the model reads scenes
 * numbered exactly as the person sees them, writes the same numbers back, and
 * the conversion happens once, here.
 */

const sceneNumber = z.number().int().min(1).max(12);

/** Fields a `set` may write on the video itself. */
export const PROJECT_FIELDS = {
  title: { kind: "string" },
  description: { kind: "string" },
  videoStyle: { kind: "enum", values: ["whiteboard", "hyperframes"] },
  musicMood: { kind: "enum", values: ["calm", "curious", "driving", "warm", "serious", "none"] },
  introDuration: { kind: "number", min: 0, max: 20 },
  voiceDelay: { kind: "number", min: 0, max: 10 },
} as const;

/**
 * Fields a `set` may write on one scene.
 *
 * `boardTitle` is the one drawn on the canvas; `heading` only names the scene
 * in the timeline. Confusing the two is the difference between an edit that
 * shows up and one that appears to do nothing.
 */
export const SCENE_FIELDS = {
  boardTitle: { kind: "string" },
  heading: { kind: "string" },
  narration: { kind: "string" },
  imagePrompt: { kind: "string" },
  photoQuery: { kind: "string" },
  stat: { kind: "string" },
  statCaption: { kind: "string" },
  supportVisual: { kind: "enum", values: ["photo", "generated", "none"] },
  visualTheme: { kind: "enum", values: ["studio-dark", "cyber-blue", "sunset", "clean-light"] },
  bullets: { kind: "strings" },
  keywords: { kind: "strings" },
} as const;

type FieldRule =
  | { readonly kind: "string" }
  | { readonly kind: "number"; readonly min: number; readonly max: number }
  | { readonly kind: "strings" }
  | { readonly kind: "enum"; readonly values: readonly string[] };

export const editOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set"),
    /** Omitted for a field on the video itself. */
    scene: sceneNumber.optional(),
    field: z.string().trim().min(1).max(40),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  }),
  z.object({
    op: z.literal("findPhoto"),
    scene: sceneNumber,
    query: z.string().trim().min(3).max(160),
    brief: z.string().trim().max(560).optional(),
  }),
  z.object({
    op: z.literal("generateImage"),
    scene: sceneNumber,
    prompt: z.string().trim().min(10).max(900),
    style: z.string().trim().max(40).optional(),
  }),
  z.object({
    op: z.literal("relayout"),
    scene: sceneNumber,
    hint: z.string().trim().max(400).optional(),
  }),
  z.object({
    op: z.literal("setBoardItem"),
    scene: sceneNumber,
    /** Which drawn item, numbered from 1 in the order they appear. */
    item: z.number().int().min(1).max(4),
    /** Which column, for a compare board. */
    side: z.enum(["left", "right"]).optional(),
    label: z.string().trim().max(20).optional(),
    icon: z.string().trim().max(40).optional(),
    badge: z.enum(["check", "cross", "alert"]).optional(),
    colour: z.enum(["blue", "yellow", "orange", "green", "red", "violet", "teal", "pink"]).optional(),
  }),
  z.object({
    op: z.literal("setBoard"),
    scene: sceneNumber,
    /**
     * A whole board, written out. This is the only op that can change the
     * layout, add or remove items, reorder them, or touch a pie's slices and a
     * compare's columns -- everything `setBoardItem` cannot reach.
     */
    board: sceneSpecSchema,
  }),
  z.object({
    op: z.literal("removeImage"),
    scene: sceneNumber,
  }),
  z.object({
    op: z.literal("setVoice"),
    /** Omit to re-cast the whole video. */
    scene: sceneNumber.optional(),
    voiceId: z.string().trim().min(1).max(120).optional(),
    speed: z.number().min(0.6).max(1.5).optional(),
  }),
  z.object({ op: z.literal("speak"), scene: sceneNumber }),
  z.object({
    op: z.literal("addScene"),
    /** Put the new scene after this one. 0 puts it first. */
    after: z.number().int().min(0).max(12).optional(),
    heading: z.string().trim().min(1).max(160),
    bullets: z.array(z.string().trim().min(1).max(240)).min(1).max(4),
    narration: z.string().trim().min(10).max(1_200),
    imagePrompt: z.string().trim().max(900).optional(),
    photoQuery: z.string().trim().max(160).optional(),
    supportVisual: z.enum(["photo", "generated", "none"]).optional(),
  }),
  z.object({ op: z.literal("removeScene"), scene: sceneNumber }),
  z.object({ op: z.literal("moveScene"), from: sceneNumber, to: sceneNumber }),
]);

export type EditOp = z.infer<typeof editOpSchema>;

/**
 * The reply, before the ops are judged.
 *
 * Ops are taken one at a time rather than as a block: a plan of six good edits
 * and one malformed seventh used to fail whole, which is a bad trade for the
 * person who asked. The bad one is reported and the rest still run.
 */
export const editPlanSchema = z.object({
  summary: z.string().trim().max(400),
  // Generous, because "give every scene a photo" on a six-scene video is
  // already six, and a rewrite is three or four each.
  ops: z.array(z.unknown()).max(30),
});

export interface EditPlan {
  summary: string;
  ops: EditOp[];
  /** One sentence per op that could not be understood. */
  rejected: string[];
}

/**
 * The one shape planners reliably get wrong.
 *
 * On a pie or a bar board, `data` is the chart and `items` is an optional row
 * of icons underneath -- so an entry there needs an icon, not a label and a
 * number. Models write the chart rows into both. The duplicates carry nothing
 * `data` does not already have, so they are dropped rather than failed.
 */
function tidyBoard(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object") return candidate;
  const op = candidate as { op?: unknown; board?: { items?: unknown } };
  if (op.op !== "setBoard" || !op.board || typeof op.board !== "object") return candidate;

  const items = op.board.items;
  if (!Array.isArray(items)) return candidate;

  const kept = items.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as { icon?: unknown }).icon === "string" &&
      (item as { icon: string }).icon.trim().length > 0,
  );
  if (kept.length === items.length) return candidate;

  return {
    ...op,
    board: { ...op.board, ...(kept.length ? { items: kept } : {}) },
    ...(kept.length ? {} : {}),
  };
}

/** Keeps every op that validates, and says why the others were dropped. */
export function sift(raw: unknown[]): { ops: EditOp[]; rejected: string[] } {
  const ops: EditOp[] = [];
  const rejected: string[] = [];

  for (const entry of raw) {
    const candidate = tidyBoard(entry);
    const parsed = editOpSchema.safeParse(candidate);
    if (parsed.success) {
      ops.push(parsed.data);
      continue;
    }
    const issue = parsed.error.issues[0];
    const name =
      candidate && typeof candidate === "object" && "op" in candidate
        ? String((candidate as { op: unknown }).op)
        : "an operation";
    rejected.push(`${name}: ${[issue.path.join("."), issue.message].filter(Boolean).join(" ")}`);
  }

  return { ops, rejected };
}

/* ------------------------------- set guards -------------------------------- */

function check(rule: FieldRule, field: string, value: unknown): string | null {
  switch (rule.kind) {
    case "string":
      return typeof value === "string" ? null : `${field} takes text`;
    case "number":
      return typeof value === "number" &&
        Number.isFinite(value) &&
        value >= rule.min &&
        value <= rule.max
        ? null
        : `${field} takes a number between ${rule.min} and ${rule.max}`;
    case "strings":
      return Array.isArray(value) && value.every((entry) => typeof entry === "string")
        ? null
        : `${field} takes a list of short strings`;
    case "enum":
      return typeof value === "string" && rule.values.includes(value)
        ? null
        : `${field} must be one of: ${rule.values.join(", ")}`;
  }
}

/**
 * Returns null when the write is allowed, or a sentence saying why not.
 *
 * A planner that writes `videoStyle: "dark"` produces a project the renderer
 * cannot read, and the failure surfaces three components away as a blank
 * canvas. Rejecting the value here turns that into one line in the log.
 */
export function checkSet(field: string, value: unknown, onScene: boolean): string | null {
  const table: Record<string, FieldRule> = onScene ? SCENE_FIELDS : PROJECT_FIELDS;
  const rule = table[field];
  if (!rule) {
    return onScene
      ? `a scene has no editable "${field}"`
      : `the video has no editable "${field}"`;
  }
  return check(rule, field, value);
}

/**
 * Strips the project down to what the planner needs to read.
 *
 * Word timings and resolved icon geometry are most of a project's bytes and
 * none of its meaning -- a four-scene video is tens of thousands of tokens of
 * numbers and SVG path data before this runs. Scenes carry their own number so
 * the model never has to count.
 */
/**
 * The board as it stands, minus the resolved geometry.
 *
 * The planner is handed the real spec rather than a summary of it, because it
 * can now write one back -- and it cannot edit a shape it has only been told
 * about. The `glyph` arrays are the one thing stripped: thousands of SVG path
 * numbers that mean nothing to a model and would dwarf the rest of the prompt.
 */
function boardOf(spec: ProjectAsset["scenes"][number]["scene"]): unknown {
  if (!spec) return null;
  const clone = structuredClone(spec) as Record<string, unknown>;
  const strip = (items?: Array<{ glyph?: unknown }>) => {
    for (const item of items ?? []) delete item.glyph;
  };
  strip(clone.items as Array<{ glyph?: unknown }>);
  strip((clone.left as { items?: Array<{ glyph?: unknown }> })?.items);
  strip((clone.right as { items?: Array<{ glyph?: unknown }> })?.items);
  delete clone.glyph;
  return clone;
}

export function pruneForAgent(project: ProjectAsset): unknown {
  return {
    title: project.title,
    description: project.description,
    videoStyle: project.videoStyle,
    musicMood: project.musicMood,
    introDuration: project.introDuration,
    voiceDelay: project.voiceDelay,
    scenes: project.scenes.map((scene, index) => ({
      scene: index + 1,
      heading: scene.heading,
      bullets: scene.bullets,
      narration: scene.narration,
      imagePrompt: scene.imagePrompt,
      photoQuery: scene.photoQuery,
      supportVisual: scene.supportVisual,
      keywords: scene.keywords,
      stat: scene.stat,
      statCaption: scene.statCaption,
      visualTheme: scene.visualTheme,
      board: boardOf(scene.scene),
      image: scene.image
        ? `${scene.image.kind ?? "image"} · ${scene.image.provider} · ${scene.image.width}x${scene.image.height}`
        : null,
      audio: scene.audio
        ? `${scene.audio.provider} · ${scene.audio.voiceId} · ${scene.audio.duration?.toFixed(1) ?? "?"}s`
        : null,
    })),
  };
}
