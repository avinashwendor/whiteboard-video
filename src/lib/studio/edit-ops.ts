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
  /**
   * Called with the project after every completed op.
   *
   * Re-casting a six-scene video is six speech requests and a couple of
   * minutes. Holding all of it until the batch returns means a closed tab
   * throws the lot away, so each finished step is handed back to be saved.
   */
  onPartial?: (project: ProjectAsset) => void;
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

/**
 * Re-records one scene.
 *
 * Without an override it keeps whichever narrator that scene already had, so
 * fixing a typo in scene three does not silently re-cast it.
 */
export async function speakScene(
  scene: SceneAsset,
  settings: Settings,
  signal?: AbortSignal,
  override?: { voiceId?: string; speed?: number },
): Promise<void> {
  const speech = await generateSpeech(
    {
      transcript: scene.narration,
      voiceId: override?.voiceId || scene.audio?.voiceId || settings.voiceId,
      language: scene.audio?.language || settings.language || undefined,
      speed: override?.speed ?? settings.speed,
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

/**
 * The narrator this video is already using.
 *
 * A scene added later has no voice of its own, and falling through to the
 * global default casts a different person for one scene in the middle of a
 * finished video. The voice the rest of the scenes share is the right answer.
 */
export function prevailingVoice(scenes: SceneAsset[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const scene of scenes) {
    const voice = scene.audio?.voiceId;
    if (voice) counts.set(voice, (counts.get(voice) ?? 0) + 1);
  }
  let best = fallback;
  let bestCount = 0;
  for (const [voice, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = voice;
    }
  }
  return best;
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
  /** A re-cast this batch asked for, applied to every recording it makes. */
  let voiceSpeed: number | undefined;
  const voiceCast = new Map<number, string>();

  const note = (op: EditOp["op"], message: string, ok = true) => {
    log.push({ op, message, ok });
  };

  /**
   * Adjusts every stored scene index after a splice.
   *
   * `addScene` at position `at` pushes every index >= `at` up by one;
   * `removeScene` at `at` pulls every index > `at` down and deletes `at`.
   */
  function shiftIndices(at: number, delta: 1 | -1) {
    for (const set of [needsVoice, boardsToResolve, touched]) {
      const shifted = new Set<number>();
      for (const stored of set) {
        if (delta === 1) {
          // Insert: indices at or after the insertion point move up.
          shifted.add(stored >= at ? stored + 1 : stored);
        } else {
          // Remove: the removed index is dropped; indices after it move down.
          if (stored === at) continue;
          shifted.add(stored > at ? stored - 1 : stored);
        }
      }
      set.clear();
      for (const value of shifted) set.add(value);
    }

    // voiceCast is a Map<number, string> — same adjustment.
    const castEntries = [...voiceCast.entries()];
    voiceCast.clear();
    for (const [stored, voice] of castEntries) {
      if (delta === 1) {
        voiceCast.set(stored >= at ? stored + 1 : stored, voice);
      } else {
        if (stored === at) continue;
        voiceCast.set(stored > at ? stored - 1 : stored, voice);
      }
    }
  }

  /**
   * A Modern video draws its heading, bullets, keywords and stat; the composed
   * board is ignored by that renderer entirely. Board ops there would appear to
   * succeed and change nothing on screen, so they are refused with a reason.
   */
  const isModern = (next.videoStyle ?? settings.videoStyle) === "hyperframes";

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
            if (isModern) {
              note("set", "This is a Modern video — its heading is what is drawn, not a board title", false);
              break;
            }
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
          if (isModern) {
            note(
              "relayout",
              `This is a Modern video — it has no drawn board. Edit the heading, bullets, keywords or stat instead.`,
              false,
            );
            break;
          }
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
          if (isModern) {
            note(
              "setBoardItem",
              `This is a Modern video — it has no drawn board. Edit the heading, bullets, keywords or stat instead.`,
              false,
            );
            break;
          }
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

        case "setBoard": {
          const index = op.scene - 1;
          if (isModern) {
            note(
              "setBoard",
              `This is a Modern video — it has no drawn board. Edit the heading, bullets, keywords or stat instead.`,
              false,
            );
            break;
          }
          const scene = sceneAt(index);
          if (!scene) {
            note("setBoard", `${label(index)} doesn't exist`, false);
            break;
          }
          const before = scene.scene?.layout;
          scene.scene = op.board;
          // Written by a model, so every icon on it is a bare name.
          boardsToResolve.add(index);
          ctx.onProgress?.(`Rebuilding the board for ${label(index).toLowerCase()}`);
          note(
            "setBoard",
            before && before !== op.board.layout
              ? `${label(index)}: board rebuilt as “${op.board.layout}” (was “${before}”)`
              : `${label(index)}: board rewritten`,
          );
          break;
        }

        case "removeImage": {
          const index = op.scene - 1;
          const scene = sceneAt(index);
          if (!scene) {
            note("removeImage", `${label(index)} doesn't exist`, false);
            break;
          }
          if (!scene.image) {
            note("removeImage", `${label(index)} has no picture`, false);
            break;
          }
          scene.image = undefined;
          scene.imageNote = undefined;
          scene.supportVisual = "none";
          // The board was composed around a photo column that is now empty.
          if (scene.scene && !isModern) {
            ctx.onProgress?.(`Re-laying out ${label(index).toLowerCase()} without the picture`);
            const layout = await relayoutScene(next, index, settings, undefined, signal);
            note("removeImage", `${label(index)}: picture removed, board re-laid out as “${layout}”`);
          } else {
            note("removeImage", `${label(index)}: picture removed`);
          }
          break;
        }

        case "setVoice": {
          const targets =
            op.scene === undefined
              ? next.scenes.map((_, i) => i)
              : sceneAt(op.scene - 1)
                ? [op.scene - 1]
                : [];
          if (!targets.length) {
            note("setVoice", `${label((op.scene ?? 1) - 1)} doesn't exist`, false);
            break;
          }
          if (op.speed !== undefined) voiceSpeed = op.speed;

          for (const index of targets) {
            if (!next.scenes[index].narration.trim()) continue;
            if (op.voiceId) voiceCast.set(index, op.voiceId);
            touched.add(index);
            needsVoice.add(index);
          }
          note(
            "setVoice",
            `${op.scene === undefined ? "Every scene" : label(op.scene - 1)}: re-recording with ${
              [op.voiceId && `voice ${op.voiceId}`, op.speed !== undefined && `speed ${op.speed}×`]
                .filter(Boolean)
                .join(" and ") || "the same voice"
            }`,
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
          await speakScene(scene, settings, signal, {
            voiceId:
              voiceCast.get(index) ??
              (scene.audio ? undefined : prevailingVoice(next.scenes, settings.voiceId)),
            speed: voiceSpeed,
          });
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
          // Existing stored indices at or after `at` must shift up by one.
          shiftIndices(at, 1);
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
              // The same fallback the generator uses: a scene with no picture
              // beside four that have one reads as a mistake.
              ctx.onProgress?.(`No photo found — drawing one instead`);
              const drawn = await drawImage(
                scene.imagePrompt || scene.heading,
                styleFor(next, settings),
                settings,
                signal,
              );
              if (drawn) {
                scene.image = drawn;
                scene.supportVisual = "generated";
                scene.imageNote = `${found.reason} — generated one instead`;
                note("findPhoto", `${label(at)}: no usable photo, generated a plate instead`);
              } else {
                note("findPhoto", `${label(at)}: no usable photo — ${found.reason}`, false);
              }
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
          // Stored indices after the removed position must shift down.
          shiftIndices(index, -1);
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

    if (ctx.onPartial) ctx.onPartial(structuredClone(next) as ProjectAsset);
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
      if (ctx.onPartial) ctx.onPartial(structuredClone(next) as ProjectAsset);
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
      await speakScene(scene, settings, signal, {
        voiceId: voiceCast.get(index) ?? (scene.audio ? undefined : prevailingVoice(next.scenes, settings.voiceId)),
        speed: voiceSpeed,
      });
      note("speak", `${label(index)}: re-recorded to match the new script`);
      if (ctx.onPartial) ctx.onPartial(structuredClone(next) as ProjectAsset);
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
