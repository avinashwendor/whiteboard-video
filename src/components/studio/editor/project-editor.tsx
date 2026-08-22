"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { planEdit } from "@/lib/studio/api";
import { applyOps, pruneForAgent } from "@/lib/studio/edit-ops";
import type { Generation, ProjectAsset, SceneAsset } from "@/lib/studio/types";
import { useStudio } from "@/lib/studio/use-studio";
import { WhiteboardPlayer } from "@/components/whiteboard/whiteboard-player";
import { AsciiInline, AsciiVeil, BlurredWhileBusy } from "@/components/ui/ascii-loader";
import { AskPanel, type ActivityEntry } from "./ask-panel";
import { Choice, LabelledArea, LabelledInput } from "./controls";
import { JsonPanel } from "./json-panel";
import { SceneInspector } from "./scene-inspector";

/**
 * The editor.
 *
 * One project, three ways into it: the fields, the raw JSON, and a sentence
 * describing what you want. All three write to the same object, every write is
 * snapshotted for undo, and the studio persists it behind a debounce.
 */

type Tab = "ask" | "scene" | "json";

const UNDO_DEPTH = 20;
/** How long typing settles before the preview re-plans the whole video. */
const PREVIEW_DELAY_MS = 600;

let activitySeq = 0;
function entry(message: string, ok = true, instruction = false): ActivityEntry {
  activitySeq += 1;
  return { id: `activity-${activitySeq}`, message, ok, instruction };
}

function blankScene(index: number): SceneAsset {
  return {
    heading: `Scene ${index + 1}`,
    bullets: [""],
    narration: "",
    imagePrompt: "",
    status: "pending",
  };
}

export function ProjectEditor({ generation }: { generation: Generation }) {
  const { settings, capabilities, catalogues, updateProject } = useStudio();

  /**
   * The studio owns the project, not this component. Every edit goes straight
   * back through `updateProject`, so the copy on screen, the copy in history
   * and the copy in IndexedDB can never drift apart -- and the cache keys the
   * persist layer writes flow back down without a second source of truth.
   */
  const project = generation.project!;
  const [preview, setPreview] = useState<ProjectAsset>(project);
  const [activeScene, setActiveScene] = useState(0);
  /** A jump the rail asked for. The nonce lets the same scene be asked for twice. */
  const [seekRequest, setSeekRequest] = useState<{ index: number; nonce: number } | null>(null);
  const [tab, setTab] = useState<Tab>("ask");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);

  const undoStack = useRef<ProjectAsset[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  /* -------------------------------- committing ------------------------------ */

  const commit = useCallback(
    (next: ProjectAsset, options: { snapshot?: boolean; from?: ProjectAsset } = {}) => {
      if (options.snapshot) {
        // `from` matters for a long batch: it saves as it goes, so by the time
        // it finishes the current project IS the result and snapshotting that
        // would make Undo a no-op.
        const before = options.from ?? project;
        undoStack.current = [...undoStack.current, structuredClone(before)].slice(-UNDO_DEPTH);
        setCanUndo(true);
      }
      updateProject(generation.id, next);
    },
    [generation.id, project, updateProject],
  );

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    setCanUndo(undoStack.current.length > 0);
    if (!previous) return;
    updateProject(generation.id, previous);
    setActivity((log) => [entry("Undid the last change"), ...log]);
  }, [generation.id, updateProject]);

  /**
   * The preview lags the fields on purpose. Every keystroke produces a new
   * project object, and re-planning a four-scene video on each one would make
   * the whole editor stutter -- so the canvas waits for typing to stop.
   */
  useEffect(() => {
    const timer = setTimeout(() => setPreview(project), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [project]);

  const patchScene = useCallback(
    (index: number, patch: Partial<SceneAsset>) => {
      const scenes = [...project.scenes];
      scenes[index] = { ...scenes[index], ...patch };
      commit({ ...project, scenes });
    },
    [commit, project],
  );

  /** Runs one asynchronous job against a draft copy and logs what it did. */
  const runTask = useCallback(
    async (label: string, task: (draft: ProjectAsset) => Promise<string | void>) => {
      setBusy(true);
      setStatus(`${label}…`);
      const before = project;
      const draft = structuredClone(project) as ProjectAsset;
      try {
        const message = await task(draft);
        commit(draft, { snapshot: true, from: before });
        setActivity((log) => [entry(typeof message === "string" ? message : label), ...log]);
      } catch (err) {
        setActivity((log) => [
          entry(`${label} failed — ${err instanceof Error ? err.message : "unknown error"}`, false),
          ...log,
        ]);
      } finally {
        setBusy(false);
        setStatus(null);
      }
    },
    [commit, project],
  );

  /** Selecting a scene shows it, in the inspector and on the canvas. */
  const openScene = useCallback((index: number) => {
    setActiveScene(index);
    setSeekRequest((previous) => ({ index, nonce: (previous?.nonce ?? 0) + 1 }));
  }, []);

  const followPlayback = useCallback((index: number) => setActiveScene(index), []);

  /* ---------------------------------- ask ----------------------------------- */

  const ask = useCallback(
    (instruction: string) => {
      const before = project;
      void (async () => {
        setBusy(true);
        setStatus("Working out what to change");
        setActivity((log) => [entry(instruction, true, true), ...log]);
        try {
          const provider = capabilities?.image.providers.find(
            (entry) => entry.id === settings.imageProvider,
          );

          const plan = await planEdit({
            instruction,
            project: pruneForAgent(project) as Record<string, unknown>,
            sceneNumber: activeScene + 1,
            // Casting a narrator and picking a pipeline are only sensible if
            // the planner knows which ones this deployment actually has.
            voices: catalogues.voices.map((voice) => ({
              id: voice.id,
              name: voice.name,
              gender: voice.gender,
              language: voice.language,
              accent: voice.accent,
              description: voice.description,
            })),
            can: {
              photoSearch: capabilities?.text.configured ?? true,
              generateImage: provider?.configured ?? true,
              lineArt: provider?.lineArt ?? false,
            },
            model: settings.textModel || undefined,
          });

          if (plan.summary) setActivity((log) => [entry(plan.summary), ...log]);

          // A plan can be part-usable. Saying so beats silently doing less
          // than was asked.
          for (const reason of plan.rejected ?? []) {
            setActivity((log) => [entry(`Skipped one step — ${reason}`, false), ...log]);
          }

          if (!plan.ops.length) {
            setActivity((log) => [entry("Nothing was changed.", false), ...log]);
            return;
          }

          const result = await applyOps(project, plan.ops, {
            settings,
            capabilities,
            onProgress: (message) => setStatus(message),
            // Saved as it goes: a re-cast of a six-scene video is minutes of
            // speech requests, and none of it should depend on the tab
            // surviving to the end. The undo snapshot was taken before the
            // batch, so stepping back still undoes the whole thing.
            onPartial: (partial) => updateProject(generation.id, partial),
          });

          commit(result.project, { snapshot: true, from: before });
          setActivity((log) => [
            ...result.log.map((line) => entry(line.message, line.ok)).reverse(),
            ...log,
          ]);
          // Show what just changed rather than leaving the canvas wherever it
          // happened to be parked.
          if (result.touched.length) openScene(result.touched[0]);
        } catch (err) {
          setActivity((log) => [
            entry(err instanceof Error ? err.message : "That edit couldn't run", false),
            ...log,
          ]);
        } finally {
          setBusy(false);
          setStatus(null);
        }
      })();
    },
    [
      activeScene,
      capabilities,
      catalogues.voices,
      commit,
      generation.id,
      openScene,
      project,
      settings,
      updateProject,
    ],
  );

  /* --------------------------------- scenes --------------------------------- */

  const addScene = () => {
    const scenes = [...project.scenes, blankScene(project.scenes.length)];
    commit({ ...project, scenes }, { snapshot: true });
    setActiveScene(scenes.length - 1);
    setTab("scene");
  };

  const removeScene = (index: number) => {
    if (project.scenes.length <= 1) return;
    const scenes = project.scenes.filter((_, i) => i !== index);
    commit({ ...project, scenes }, { snapshot: true });
    openScene(Math.max(0, Math.min(activeScene, scenes.length - 1)));
  };

  const moveScene = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= project.scenes.length) return;
    const scenes = [...project.scenes];
    const [moved] = scenes.splice(index, 1);
    scenes.splice(to, 0, moved);
    commit({ ...project, scenes }, { snapshot: true });
    openScene(to);
  };

  const copyScript = () => {
    const script = [
      `# ${project.title}`,
      project.description,
      "",
      ...project.scenes.map((scene, index) => `## Scene ${index + 1}: ${scene.heading}\n${scene.narration}\n`),
    ].join("\n");
    navigator.clipboard.writeText(script).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1_800);
  };

  const totalDuration = useMemo(
    () =>
      project.scenes.reduce(
        (total, scene) =>
          total + (scene.audio?.duration ?? Math.max(4.5, scene.narration.split(/\s+/).length / 2.5)),
        project.introDuration ?? 3,
      ),
    [project],
  );

  /** Duration a scene occupies once narrated, used by the rail and the timeline. */
  const sceneSeconds = useCallback(
    (scene: SceneAsset) =>
      scene.audio?.duration ?? Math.max(4.5, scene.narration.split(/\s+/).filter(Boolean).length / 2.5),
    [],
  );

  /* --------------------------------- render --------------------------------- */

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-5">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-1.5 border border-line px-3.5 py-1.5 text-[12.5px] text-[#c9c9c4] transition-colors hover:border-line-strong hover:text-ink"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Create
          </Link>
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="truncate text-[14.5px] font-medium text-ink">{project.title}</h1>
            <p className="hidden shrink-0 text-[12.5px] text-dim sm:block">
              {project.scenes.length} scenes · {totalDuration.toFixed(1)}s ·{" "}
              {project.videoStyle === "hyperframes" ? "Modern frames" : "Whiteboard"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5">
          {busy ? <AsciiInline label={status ?? "Working"} /> : null}
          <button
            type="button"
            onClick={copyScript}
            className="flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-ink"
          >
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? "Copied" : "Script"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/*
          ── the scene rail ──
          Full-bleed rows on a single hairline grid, not a stack of cards. A
          card inside a panel inside a column reads as three nested boxes; the
          rail is one column of records with the open one marked at its edge.
        */}
        <aside className="flex w-full shrink-0 flex-col border-b border-line lg:max-h-[calc(100vh-6.75rem)] lg:w-[268px] lg:border-b-0 lg:border-r">
          <div className="flex h-[38px] shrink-0 items-center justify-between border-b border-line px-4">
            <span className="text-[13px] text-muted">Scenes</span>
            <button
              type="button"
              onClick={addScene}
              className="text-[13px] text-muted transition-colors hover:text-ink"
            >
              Add
            </button>
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto studio-scrollbar">
            {project.scenes.map((scene, index) => {
              const open = activeScene === index;
              return (
                <li key={index}>
                  <div
                    className={cn(
                      "group relative border-b border-line px-4 py-3.5 transition-colors",
                      open
                        ? "bg-[rgba(242,242,240,0.03)] shadow-[inset_2px_0_0_var(--text)]"
                        : "hover:bg-surface",
                    )}
                  >
                    <button type="button" onClick={() => openScene(index)} className="block w-full text-left">
                      <span className="flex items-center justify-between font-mono text-[11.5px]">
                        <span className={open ? "text-muted" : "text-dim"}>
                          {String(index + 1).padStart(2, "0")} · {sceneKind(scene, project.videoStyle)}
                        </span>
                        <span className={open ? "text-muted" : "text-dim"}>
                          {sceneSeconds(scene).toFixed(1)}s
                        </span>
                      </span>
                      <span
                        className={cn(
                          "mt-1.5 block truncate text-[13.5px] font-medium",
                          open ? "text-ink" : "text-[#c9c9c4]",
                        )}
                      >
                        {scene.heading || `Scene ${index + 1}`}
                      </span>
                      <span
                        className={cn(
                          "mt-1 line-clamp-2 block text-[12px] leading-[1.5]",
                          open ? "text-dim" : "text-faint",
                        )}
                      >
                        {scene.narration || "No narration"}
                      </span>
                    </button>

                    <div className="mt-2.5 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <RailButton label="Move up" onClick={() => moveScene(index, -1)} disabled={index === 0}>
                        ↑
                      </RailButton>
                      <RailButton
                        label="Move down"
                        onClick={() => moveScene(index, 1)}
                        disabled={index === project.scenes.length - 1}
                      >
                        ↓
                      </RailButton>
                      <RailButton
                        label="Delete scene"
                        onClick={() => removeScene(index)}
                        disabled={project.scenes.length <= 1}
                        danger
                      >
                        <Trash2 className="size-3" aria-hidden />
                      </RailButton>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={() => setShowSettings((value) => !value)}
            className="flex h-[42px] shrink-0 items-center justify-between border-t border-line px-4 text-[13px] text-muted transition-colors hover:text-ink"
          >
            Video settings
            <span className="font-mono text-[11px]">{showSettings ? "−" : "+"}</span>
          </button>

          {showSettings ? (
            <div className="max-h-[42vh] shrink-0 space-y-3 overflow-y-auto border-t border-line bg-bg-soft p-4 studio-scrollbar">
              <LabelledInput
                label="Title"
                value={project.title}
                onChange={(event) => commit({ ...project, title: event.target.value })}
              />
              <LabelledArea
                label="Description"
                rows={3}
                value={project.description}
                hint="Also read out on the closing card."
                onChange={(event) => commit({ ...project, description: event.target.value })}
              />
              <Choice
                label="Engine"
                value={project.videoStyle ?? "whiteboard"}
                options={[
                  { value: "whiteboard" as const, label: "Whiteboard" },
                  { value: "hyperframes" as const, label: "Frames" },
                ]}
                onChange={(videoStyle) => commit({ ...project, videoStyle })}
              />
              <Choice
                label="Music"
                value={project.musicMood ?? "calm"}
                columns={3}
                options={[
                  { value: "calm" as const, label: "Calm" },
                  { value: "curious" as const, label: "Curious" },
                  { value: "driving" as const, label: "Driving" },
                  { value: "warm" as const, label: "Warm" },
                  { value: "serious" as const, label: "Serious" },
                  { value: "none" as const, label: "None" },
                ]}
                onChange={(musicMood) => commit({ ...project, musicMood })}
              />
              <div className="grid grid-cols-2 gap-2.5">
                <LabelledInput
                  label="Intro (s)"
                  type="number"
                  step="0.1"
                  min="0"
                  value={project.introDuration ?? 3}
                  onChange={(event) =>
                    commit({ ...project, introDuration: Number(event.target.value) || 0 })
                  }
                />
                <LabelledInput
                  label="Voice delay (s)"
                  type="number"
                  step="0.1"
                  min="0"
                  value={project.voiceDelay ?? 0.6}
                  onChange={(event) => commit({ ...project, voiceDelay: Number(event.target.value) || 0 })}
                />
              </div>
            </div>
          ) : null}
        </aside>

        {/* ── preview ── */}
        <main className="flex min-w-0 flex-1 flex-col bg-bg-soft px-6 pb-5 pt-4">
          <div className="flex items-baseline justify-between pb-3">
            <span className="text-[13px] text-muted">
              Preview — scene {String(activeScene + 1).padStart(2, "0")}
            </span>
            {preview !== project ? (
              <AsciiInline label="re-planning" variant="track" />
            ) : (
              <span className="text-[12.5px] text-faint">1920 × 1080 · 24 fps</span>
            )}
          </div>

          <div className="flex flex-1 items-start justify-center">
            <div className="w-full max-w-[880px]">
              {/*
                A re-plan swaps the whole project under the canvas, which shows
                as a frame drawn from half-old, half-new state. Blur it and put
                the shimmer over it rather than showing a frame that lies.
              */}
              <BlurredWhileBusy
                busy={preview !== project}
                blur={14}
                overlay={
                  <AsciiVeil
                    title="Re-planning the video"
                    detail="Applying your edits to the timeline"
                  />
                }
              >
                <WhiteboardPlayer
                  project={preview}
                  seekRequest={seekRequest}
                  onSceneChange={followPlayback}
                />
              </BlurredWhileBusy>
            </div>
          </div>

          <Timeline
            scenes={project.scenes}
            activeScene={activeScene}
            videoStyle={project.videoStyle}
            durations={project.scenes.map(sceneSeconds)}
            onSelect={openScene}
          />
        </main>

        {/* ── inspector ── */}
        <aside className="flex w-full shrink-0 flex-col border-t border-line lg:max-h-[calc(100vh-6.75rem)] lg:w-[340px] lg:border-l lg:border-t-0">
          <div className="flex h-[38px] shrink-0 border-b border-line">
            {(
              [
                { value: "ask" as const, label: "Ask" },
                { value: "scene" as const, label: "Scene" },
                { value: "json" as const, label: "JSON" },
              ]
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTab(option.value)}
                className={cn(
                  "flex-1 text-center text-[13px] transition-colors",
                  tab === option.value ? "border-b border-ink text-ink" : "text-dim hover:text-ink",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto studio-scrollbar p-4">
            {tab === "ask" ? (
              <AskPanel
                sceneNumber={activeScene + 1}
                busy={busy}
                status={status}
                activity={activity}
                canUndo={canUndo}
                onAsk={ask}
                onUndo={undo}
              />
            ) : null}

            {tab === "scene" ? (
              <SceneInspector
                project={project}
                index={activeScene}
                busy={busy}
                onPatch={(patch) => patchScene(activeScene, patch)}
                onRun={runTask}
              />
            ) : null}

            {tab === "json" ? (
              <JsonPanel
                project={project}
                onApply={(next) => {
                  commit(next, { snapshot: true });
                  setActivity((log) => [entry("Applied hand-edited JSON"), ...log]);
                }}
              />
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------- timeline -------------------------------- */

/** What a scene is made of, for the mono meta line. */
function sceneKind(scene: SceneAsset, videoStyle?: string) {
  if (videoStyle === "hyperframes") return "Frame";
  if (scene.image) return "Image";
  if (scene.scene) return "Whiteboard";
  return "Draft";
}

/**
 * The scene strip.
 *
 * Widths are the real durations, so the shape of the video is visible at a
 * glance — a 21-second closing block next to a 14-second one is the kind of
 * imbalance the rail's tidy equal rows hide completely.
 */
function Timeline({
  scenes,
  durations,
  activeScene,
  videoStyle,
  onSelect,
}: {
  scenes: SceneAsset[];
  durations: number[];
  activeScene: number;
  videoStyle?: string;
  onSelect: (index: number) => void;
}) {
  const total = durations.reduce((sum, value) => sum + value, 0) || 1;
  const ticks = Math.max(2, Math.min(8, Math.ceil(total / 10)));

  return (
    <div className="shrink-0 border-t border-line pt-3">
      <div className="flex justify-between pb-1.5 font-mono text-[9.5px] tracking-[0.14em] text-[#4e4e4a]">
        {Array.from({ length: ticks + 1 }, (_, index) => {
          const seconds = (total / ticks) * index;
          return (
            <span key={index}>
              {Math.floor(seconds / 60)}:{String(Math.round(seconds % 60)).padStart(2, "0")}
            </span>
          );
        })}
      </div>

      <div className="flex h-[44px] gap-0.5">
        {scenes.map((scene, index) => {
          const open = activeScene === index;
          return (
            <button
              key={index}
              type="button"
              onClick={() => onSelect(index)}
              style={{ width: `${(durations[index] / total) * 100}%` }}
              title={scene.heading || `Scene ${index + 1}`}
              className={cn(
                "min-w-0 overflow-hidden px-2.5 py-2 text-left transition-colors",
                open
                  ? "border-t-2 border-ink bg-[rgba(242,242,240,0.13)]"
                  : "border-t-2 border-[rgba(242,242,240,0.2)] bg-[rgba(242,242,240,0.07)] hover:bg-[rgba(242,242,240,0.1)]",
              )}
            >
              <span
                className={cn(
                  "block truncate font-mono text-[9.5px]",
                  open ? "text-[#c9c9c4]" : "text-muted",
                )}
              >
                {String(index + 1).padStart(2, "0")} {sceneKind(scene, videoStyle)}
              </span>
              <span
                className={cn("mt-0.5 block font-mono text-[9.5px]", open ? "text-dim" : "text-faint")}
              >
                {durations[index].toFixed(1)}s
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-0.5 bg-[rgba(242,242,240,0.05)] px-2.5 py-1 text-[11px] text-faint">
        Narration · word-synced
      </div>
    </div>
  );
}

function RailButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-6 place-items-center border border-line bg-surface-raised text-[10px] text-muted",
        "transition-colors hover:border-line-strong hover:text-ink disabled:pointer-events-none disabled:opacity-30",
        danger && "hover:text-danger",
      )}
    >
      {children}
    </button>
  );
}
