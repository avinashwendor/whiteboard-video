import fs from "node:fs";
import path from "node:path";
import { omega } from "./omega";
import type { ChatMessage } from "./types";
import { GENERAL_ICONS, LUCIDE_NAMES, pickIcon, shortlistFor, type PickedIcon } from "@/lib/whiteboard/icon-picker";
import { findIcon } from "@/lib/whiteboard/icons";
import type { SceneSpec } from "@/lib/whiteboard/scene";

/**
 * Resolving a scene's icons, once, on the server.
 *
 * Two things were wrong before. The model was asked to invent SVG geometry,
 * which it cannot do -- hence the brain that looked like a spilled drink. And
 * whatever it invented was registered into a server-side module map that the
 * browser never sees, so the canvas quietly drew a lightbulb instead.
 *
 * Both go away if geometry is chosen from a real icon set here and travels
 * with the scene. The model's only job is naming the idea, which is the thing
 * it is actually good at.
 *
 * The hand-drawn library goes first and wins whenever it has the concept: it
 * is chunky, filled and coloured, and on a whiteboard that reads far better
 * than a thin outline. The 1700-icon catalogue exists for everything the
 * hand-drawn set never covered, which is where the old code gave up and drew
 * a lightbulb for the fifth time in one video.
 */

const CACHE_FILE = path.join(process.cwd(), ".icon-cache.json");

/** concept -> Lucide name. Small enough to keep entirely in memory. */
let cache: Record<string, string> | null = null;

function loadCache(): Record<string, string> {
  if (cache) return cache;
  cache = {};
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        // Older builds cached whole geometry objects here. Those are the ones
        // that drew badly, so anything that is not a plain name is dropped.
        if (typeof value === "string") cache[key] = value;
      }
    }
  } catch {
    /* a cache that will not load is simply a cold cache */
  }
  return cache;
}

function saveCache(entries: Record<string, string>) {
  const store = loadCache();
  Object.assign(store, entries);
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch {
    /* the cache is an optimisation, never a requirement */
  }
}

/**
 * Roughly 6.5k tokens of icon names.
 *
 * Worth it, and only paid once per concept: a hand-written synonym table
 * covers the vocabulary someone thought to type, and the world contains
 * "beekeeping", "glacier" and "calligraphy". Showing the model everything is
 * the only version of this that genuinely covers anything, and the answer is
 * cached to disk so the second video about bees is free.
 */
const FULL_CATALOGUE = LUCIDE_NAMES.join(", ");

const SYSTEM = `You match an idea to the closest icon in a fixed set.

You are given concepts and a list of allowed icon names. For each concept, choose the name that a viewer would most readily read as that idea in a hand-drawn explainer.

- Think about what the idea LOOKS like, not what it is called. "hippocampus" is a brain. "quarterly revenue" is trending-up. "attrition" is trending-down.
- Only ever answer with names from the allowed list. Never invent one.
- If nothing fits, use "sparkles".

Every concept must get a DIFFERENT icon: they appear side by side on one board, and repeating a drawing tells the viewer the ideas are the same.

Reply with JSON only, mapping each concept to one name: {"concept":"icon-name", ...}`;

function stripFence(value: string): string {
  return value.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

function firstJsonObject(value: string): string | null {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return value.slice(start, end + 1);
}

/** Asks the model to translate whatever the matcher could not place. */
async function askModel(
  concepts: string[],
  model: string | undefined,
  signal: AbortSignal | undefined,
): Promise<Record<string, string>> {
  if (!concepts.length || !omega.isConfigured()) return {};

  // A word that shares nothing with any icon name gets the whole catalogue;
  // anything with near neighbours gets those plus the general vocabulary,
  // which keeps the usual call small.
  const neighbours = [...new Set(concepts.flatMap((concept) => shortlistFor(concept, 40)))];
  const allowed =
    neighbours.length >= concepts.length * 4
      ? [...new Set([...neighbours, ...GENERAL_ICONS])].join(", ")
      : FULL_CATALOGUE;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Concepts: ${JSON.stringify(concepts)}\n\nAllowed icon names: ${allowed}`,
    },
  ];

  try {
    const result = await omega.generateText({
      messages,
      model,
      temperature: 0.2,
      maxTokens: 500,
      json: true,
      signal,
    });

    const candidate = firstJsonObject(stripFence(result.text));
    if (!candidate) return {};

    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const resolved: Record<string, string> = {};
    for (const [concept, name] of Object.entries(parsed)) {
      if (typeof name !== "string") continue;
      // The model is told to stay inside the list; this is what enforces it.
      if (pickIcon(name)) resolved[concept.toLowerCase()] = name;
    }
    return resolved;
  } catch {
    return {};
  }
}

/* ------------------------------- walking a spec ------------------------------ */

type IconSlot = { get: () => string | undefined; set: (picked: PickedIcon) => void };

/** Every place a scene layout can carry an icon. */
function slotsOf(spec: SceneSpec): IconSlot[] {
  const slots: IconSlot[] = [];

  const fromItems = (items: Array<{ icon: string; glyph?: string[] }> | undefined) => {
    for (const item of items ?? []) {
      slots.push({
        get: () => item.icon,
        set: (picked) => {
          item.glyph = picked.paths;
          item.icon = picked.name;
        },
      });
    }
  };

  if ("items" in spec) fromItems(spec.items as Array<{ icon: string; glyph?: string[] }>);
  if ("left" in spec) fromItems(spec.left.items as Array<{ icon: string; glyph?: string[] }>);
  if ("right" in spec) fromItems(spec.right.items as Array<{ icon: string; glyph?: string[] }>);

  if (spec.layout === "stat") {
    const stat = spec as SceneSpec & { icon?: string; glyph?: string[] };
    slots.push({
      get: () => stat.icon,
      set: (picked) => {
        stat.glyph = picked.paths;
        stat.icon = picked.name;
      },
    });
  }

  return slots;
}

/**
 * Fills in the geometry for every icon a scene asks for.
 *
 * Mutates the spec: the resolved paths ride along to the browser, so the
 * canvas draws precisely what was chosen here.
 */
export async function attachIconGeometry(
  spec: SceneSpec,
  model?: string,
  signal?: AbortSignal,
): Promise<void> {
  const slots = slotsOf(spec).filter((slot) => Boolean(slot.get()));
  if (!slots.length) return;

  const store = loadCache();
  const unresolved: string[] = [];
  const pending: Array<{ slot: IconSlot; concept: string }> = [];

  /**
   * Icons already committed on this board.
   *
   * Without this, a scene about banking draws the same bank three times: the
   * concepts differ but they all resolve to the nearest available drawing, and
   * a row of identical icons tells the viewer nothing.
   */
  const taken = new Set<string>();

  for (const slot of slots) {
    const concept = (slot.get() ?? "").trim().toLowerCase();
    if (!concept) continue;

    // The hand-drawn one, if we have it. Leaving `glyph` unset is the signal
    // for the board to draw its own version, colours and all.
    const drawn = findIcon(concept, taken);
    if (drawn) {
      taken.add(drawn.name);
      continue;
    }

    const cached = store[concept];
    const direct = pickIcon(cached ?? concept, taken) ?? pickIcon(concept, taken);
    if (direct) {
      slot.set(direct);
      taken.add(direct.name);
      continue;
    }

    pending.push({ slot, concept });
    if (!unresolved.includes(concept)) unresolved.push(concept);
  }

  if (!pending.length) return;

  const answered = await askModel(unresolved, model, signal);
  const learned: Record<string, string> = {};

  for (const { slot, concept } of pending) {
    const name = answered[concept];
    const picked =
      (name ? pickIcon(name, taken) : null) ??
      pickIcon(concept, taken) ??
      pickIcon("sparkles", taken) ??
      pickIcon("sparkles");
    if (!picked) continue;
    slot.set(picked);
    taken.add(picked.name);
    if (name) learned[concept] = name;
  }

  if (Object.keys(learned).length) saveCache(learned);
}
