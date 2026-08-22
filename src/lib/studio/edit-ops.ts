"use client";

import { generateImage as generateClientImage } from "@/lib/ai/image/client";
import type { ImageStyle } from "@/lib/ai/types";
import {
  curateVisual,
  generateScene,
  generateServerImage,
  generateSpeech,
  resolveBoard,
  type Capabilities,
} from "./api";
import { checkSet, type EditOp } from "./edit-plan";
import type { SceneItem, SceneSpec } from "@/lib/whiteboard/scene";
import type { ImageAsset, ProjectAsset, SceneAsset, Settings } from "./types";

export type { EditOp, EditPlan } from "./edit-plan";
export { checkSet, editOpSchema, editPlanSchema, pruneForAgent } from "./edit-plan";

export interface OpLogEntry {
  op: EditOp["op"];
  message: string;
  ok: boolean;
}

export interface ApplyContext {
  settings: Settings;
  capabilities?: Capabilities | null;
  signal?: AbortSignal;
  /** Called as each op starts, so the panel can say what is happening. */
  onProgress?: (message: string) => void;
}

/* ------------------------------ asset helpers ------------------------------ */

function styleFor(project: ProjectAsset, settings: Settings, requested?: string): ImageStyle {
  if (requested) return requested as ImageStyle;
  if ((project.videoStyle ?? settings.videoStyle) === "hyperframes") {
    return settings.imageStyle === "auto" ? "photorealistic" : (settings.imageStyle as ImageStyle);
  }
  return "whiteboard" as ImageStyle;
}

/**
 * The same fallback chain the generator uses: Puter or Pollinations from the
 * browser, and the server route when the browser path cannot run at all.
 */
async function drawImage(
  prompt: string,
  style: ImageStyle,
  settings: Settings,
  signal?: AbortSignal,
): Promise<ImageAsset | undefined> {
  try {
    const made = await generateClientImage({
      prompt,
      provider: settings.imageProvider,
      model: settings.imageModel || undefined,
      width: 1280,
      height: 720,
      style,
      enhance: false,
      signal,
    });
    return { ...made, kind: "drawn" as const };
  } catch (err) {
    if (signal?.aborted) throw err;
    try {
      const fallback = await generateServerImage(
        { prompt, width: 1280, height: 720, style, enhance: false },
        signal,
      );
      return { ...fallback.image, kind: "drawn" as const, promptUsed: fallback.prompt.used };
    } catch {
      return undefined;
    }
  }
}

/** Reads a clip's real length, so scenes can be timed against it. */
function measureDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const settle = (value?: number) => {
      audio.removeAttribute("src");
      resolve(Number.isFinite(value) && (value ?? 0) > 0 ? value : undefined);
    };
    audio.addEventListener("loadedmetadata", () => settle(audio.duration), { once: true });
    audio.addEventListener("error", () => settle(undefined), { once: true });
    setTimeout(() => settle(undefined), 8_000);
    audio.preload = "metadata";
    audio.src = url;
  });
}

/** Re-records one scene. Keeps whichever narrator that scene already had. */
export async function speakScene(
  scene: SceneAsset,
  settings: Settings,
  signal?: AbortSignal,
): Promise<void> {
  const speech = await generateSpeech(
    {
      transcript: scene.narration,
      voiceId: scene.audio?.voiceId || settings.voiceId,
      language: scene.audio?.language || settings.language || undefined,
      speed: settings.speed,
    },
    signal,
  );
  scene.audio = {
    url: speech.audioUrl,
    provider: speech.provider,
    model: speech.model,
    voiceId: speech.voiceId,
    language: scene.audio?.language ?? settings.language,
    duration: speech.duration ?? (await measureDuration(speech.audioUrl)),
    words: speech.words,
  };
}

/** Re-picks the layout and the slots -- where everything sits on the board. */
export async function relayoutScene(
  project: ProjectAsset,
  index: number,
  settings: Settings,
  hint?: string,
  signal?: AbortSignal,
): Promise<string> {
  const scene = project.scenes[index];
  const brief = [
    `Heading: ${scene.heading}`,
    scene.bullets.length ? `Key points: ${scene.bullets.join("; ")}` : "",
    `Narration: ${scene.narration}`,
    hint ? `The editor asked for: ${hint}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // The other scenes' layouts keep two boards in one video from looking alike,
  // and a photograph on the board means the drawing only gets the left column.
  const usedLayouts = project.scenes
    .map((entry, i) => (i === index ? undefined : entry.scene?.layout))
    .filter((layout): layout is NonNullable<typeof layout> => Boolean(layout));

  const result = await generateScene(
    {
      brief,
      usedLayouts,
      hasPhoto: Boolean(scene.image),
      model: settings.textModel || undefined,
    },
    signal,
  );
  scene.scene = result.scene;
  return result.scene.layout;
}

/* --------------------------------- runner --------------------------------- */

function label(index: number): string {
  return `Scene ${index + 1}`;
}

/** The drawn items of a board, whichever shape it is. */
function itemsOf(spec: SceneSpec, side?: "left" | "right"): SceneItem[] | undefined {
  if (spec.layout === "compare") return side === "right" ? spec.right.items : spec.left.items;
  return "items" in spec ? spec.items : undefined;
}

/**
 * Runs a plan against a copy of the project.
 *
 * Each op is isolated: a Tavily search that finds nothing must not cost you the
 * three text edits that ran before it, so failures are logged and the batch
 * carries on.
 */
export async function applyOps(
  project: ProjectAsset,
  ops: EditOp[],
  ctx: ApplyContext,
): Promise<{ project: ProjectAsset; log: OpLogEntry[]; touched: number[] }> {
  const next = structuredClone(project) as ProjectAsset;
  const log: OpLogEntry[] = [];
  const { settings, signal } = ctx;

  /**
   * Narration that changed and has not been re-recorded yet.
   *
   * Every visual beat is scheduled against `audio.words`. New words with the
   * old timings means the drawing lands on the wrong sentence, so an edited
   * script always drags a fresh recording along behind it.
   */
  const needsVoice = new Set<number>();
  /** Scenes this batch changed, so the editor can show you what it did. */
  const touched = new Set<number>();
  /** Boards whose icon names changed and still need real geometry. */
  const boardsToResolve = new Set<number>();

  const note = (op: EditOp["op"], message: string, ok = true) => {
    log.push({ op, message, ok });
  };

  const sceneAt = (index: number): SceneAsset | undefined => {
    const scene = next.scenes[index];
    if (scene) touched.add(index);
    return scene;
  };

  for (const op of ops) {
    if (signal?.aborted) break;

    try {
      switch (op.op) {
        case "set": {
          const onScene = typeof op.scene === "number";
          const rejected = checkSet(op.field, op.value, onScene);
          if (rejected) {
            note("set", `Left ${op.field} alone — ${rejected}`, false);
            break;
          }

          if (!onScene) {
            (next as unknown as Record<string, unknown>)[op.field] = op.value;
            note("set", `Set the video's ${op.field}`);
            break;
          }

          const index = op.scene! - 1;
          const scene = sceneAt(index);
          if (!scene) {
            note("set", `${label(index)} doesn't exist`, false);
            break;
          }

          if (op.field === "boardTitle") {
            if (!scene.scene) {
              note("set", `${label(index)} has no drawn board`, false);
              break;
            }
            scene.scene.title = String(op.value);
            note("set", `${label(index)}: board title is now “${op.value}”`);
            break;
          }

          (scene as unknown as Record<string, unknown>)[op.field] = op.value;
          if (op.field === "narration") needsVoice.add(index);
          note("set", `${label(index)}: set ${op.field}`);
          break;
        }

        case "findPhoto": {
          const index = op.scene - 1;
          const scene = sceneAt(index);
          if (!scene) {
            note("findPhoto", `${label(index)} doesn't exist`, false);
            break;
          }
          ctx.onProgress?.(`Searching the web for “${op.query}”`);
          const found = await curateVisual(
            {
              brief: (op.brief || `${scene.heading}. ${scene.narration}`).slice(0, 560),
              query: op.query,
              model: settings.textModel || undefined,
            },
            signal,
          );
          scene.photoQuery = op.query;
          scene.imageNote = found.reason;
          if (found.image) {
            scene.image = { ...found.image, kind: "photo" as const, promptUsed: op.query };
            scene.supportVisual = "photo";
            note("findPhoto", `${label(index)}: found a photo — ${found.reason}`);
          } else {
            note("findPhoto", `${label(index)}: no usable photo — ${found.reason}`, false);
          }
          break;
        }

        case "generateImage": {
          const index = op.scene - 1;
          const scene = sceneAt(index);
          if (!scene) {
            note("generateImage", `${label(index)} doesn't exist`, false);
            break;
          }
          ctx.onProgress?.(`Generating artwork for ${label(index).toLowerCase()}`);
          scene.imagePrompt = op.prompt;
          const image = await drawImage(op.prompt, styleFor(next, settings, op.style), settings, signal);
          if (image) {
            scene.image = image;
            scene.supportVisual = "generated";
            scene.imageNote = undefined;
            note("generateImage", `${label(index)}: generated a new plate (${image.model})`);
          } else {
            note("generateImage", `${label(index)}: no image provider could run`, false);
          }
          break;
        }

        case "relayout": {
          const index = op.scene - 1;
          if (!sceneAt(index)) {
            note("relayout", `${label(index)} doesn't exist`, false);
            break;
          }
          touched.add(index);
          ctx.onProgress?.(`Re-laying out ${label(index).toLowerCase()}`);
          const layout = await relayoutScene(next, index, settings, op.hint, signal);
          note("relayout", `${label(index)}: re-laid out as “${layout}”`);
          break;
        }

        case "setBoardItem": {
          const index = op.scene - 1;
          const scene = sceneAt(index);
          if (!scene?.scene) {
            note("setBoardItem", `${label(index)} has no drawn board`, false);
            break;
          }

          const items = itemsOf(scene.scene, op.side);
          const target = items?.[op.item - 1];
          if (!target) {
            note("setBoardItem", `${label(index)} has no item ${op.item}`, false);
            break;
          }

          const renamedIcon = op.icon !== undefined && op.icon !== target.icon;
          if (op.label !== undefined) target.label = op.label;
          if (op.icon !== undefined) target.icon = op.icon;
          if (op.badge !== undefined) target.badge = op.badge;
          if (op.colour !== undefined) target.colour = op.colour;

          // An icon name draws nothing until the server has matched it to real
          // geometry, and the match is board-wide so no two items come out the
          // same picture.
          if (renamedIcon) {
            ctx.onProgress?.(`Looking up “${op.icon}”`);
            boardsToResolve.add(index);
          }

          note(
            "setBoardItem",
            `${label(index)}: item ${op.item} is now ${[op.label && `“${op.label}”`, op.icon && `the ${op.icon} icon`]
              .filter(Boolean)
              .join(", ") || "updated"}`,
          );
          break;
        }

        case "speak": {
          const index = op.scene - 1;
          const scene = sceneAt(index);
          if (!scene) {
            note("speak", `${label(index)} doesn't exist`, false);
            break;
          }
          ctx.onProgress?.(`Recording ${label(index).toLowerCase()}`);
          await speakScene(scene, settings, signal);
          needsVoice.delete(index);
          note("speak", `${label(index)}: re-recorded the narration`);
          break;
        }

        case "addScene": {
          const at = Math.min(next.scenes.length, Math.max(0, op.after ?? next.scenes.length));
          const scene: SceneAsset = {
            heading: op.heading,
            bullets: op.bullets,
            narration: op.narration,
            imagePrompt: op.imagePrompt ?? op.heading,
            photoQuery: op.photoQuery,
            supportVisual: op.supportVisual,
            status: "done",
            visualTheme: next.scenes[0]?.visualTheme,
          };
          next.scenes.splice(at, 0, scene);
          needsVoice.add(at);
          touched.add(at);
          note("addScene", `Added a scene at position ${at + 1}`);

          // The picture the new scene asked for, fetched here rather than left
          // to a follow-up op -- an insert shifts every index after it, and a
          // plan written against the old numbering would land on the wrong scene.
          if (scene.supportVisual === "photo" && scene.photoQuery?.trim()) {
            ctx.onProgress?.(`Searching the web for “${scene.photoQuery}”`);
            const found = await curateVisual(
              {
                brief: `${scene.heading}. ${scene.narration}`.slice(0, 560),
                query: scene.photoQuery,
                model: settings.textModel || undefined,
              },
              signal,
            );
            scene.imageNote = found.reason;
            if (found.image) {
              scene.image = { ...found.image, kind: "photo" as const, promptUsed: scene.photoQuery };
              note("findPhoto", `${label(at)}: found a photo — ${found.reason}`);
            } else {
              note("findPhoto", `${label(at)}: no usable photo — ${found.reason}`, false);
            }
          } else if (scene.supportVisual === "generated" && scene.imagePrompt.trim()) {
            ctx.onProgress?.(`Generating artwork for the new scene`);
            const image = await drawImage(
              scene.imagePrompt,
              styleFor(next, settings),
              settings,
              signal,
            );
            if (image) scene.image = image;
            note(
              "generateImage",
              image
                ? `${label(at)}: generated a plate (${image.model})`
                : `${label(at)}: no image provider could run`,
              Boolean(image),
            );
          }

          if ((next.videoStyle ?? settings.videoStyle) === "whiteboard") {
            ctx.onProgress?.(`Laying out the new scene`);
            const layout = await relayoutScene(next, at, settings, undefined, signal);
            note("relayout", `${label(at)}: laid out as “${layout}”`);
          }
          break;
        }

        case "removeScene": {
          const index = op.scene - 1;
          if (!sceneAt(index)) {
            note("removeScene", `${label(index)} doesn't exist`, false);
            break;
          }
          if (next.scenes.length <= 1) {
            note("removeScene", "A video needs at least one scene", false);
            break;
          }
          const [removed] = next.scenes.splice(index, 1);
          note("removeScene", `Removed “${removed.heading}”`);
          break;
        }

        case "moveScene": {
          const from = op.from - 1;
          const to = op.to - 1;
          if (!sceneAt(from) || to >= next.scenes.length) {
            note("moveScene", "That scene doesn't exist", false);
            break;
          }
          const [moved] = next.scenes.splice(from, 1);
          next.scenes.splice(to, 0, moved);
          touched.add(to);
          note("moveScene", `Moved “${moved.heading}” to position ${to + 1}`);
          break;
        }
      }
    } catch (err) {
      if (signal?.aborted) break;
      note(op.op, err instanceof Error ? err.message : "That step failed", false);
    }
  }

  // Renamed icons, looked up.
  for (const index of boardsToResolve) {
    if (signal?.aborted) break;
    const spec = sceneAt(index)?.scene;
    if (!spec) continue;
    try {
      const resolved = await resolveBoard(
        { scene: spec, model: settings.textModel || undefined },
        signal,
      );
      next.scenes[index].scene = resolved.scene;
    } catch (err) {
      note("setBoardItem", `${label(index)}: kept the icon names as written — ${err instanceof Error ? err.message : "lookup failed"}`, false);
    }
  }

  // Edited scripts, re-recorded.
  for (const index of needsVoice) {
    if (signal?.aborted) break;
    const scene = sceneAt(index);
    if (!scene?.narration) continue;
    try {
      ctx.onProgress?.(`Re-recording ${label(index).toLowerCase()}`);
      await speakScene(scene, settings, signal);
      note("speak", `${label(index)}: re-recorded to match the new script`);
    } catch (err) {
      note("speak", `${label(index)}: couldn't re-record — ${err instanceof Error ? err.message : "failed"}`, false);
    }
  }

  return {
    project: next,
    log,
    touched: [...touched].filter((index) => index < next.scenes.length).sort((a, b) => a - b),
  };
}
