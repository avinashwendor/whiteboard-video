"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Film,
  Monitor,
  Plus,
  Smartphone,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { planEdit } from "@/lib/studio/api";
import { applyOps, pruneForAgent } from "@/lib/studio/edit-ops";
import type { Generation, ProjectAsset, SceneAsset } from "@/lib/studio/types";
import { useStudio } from "@/lib/studio/use-studio";
import { WhiteboardPlayer } from "@/components/whiteboard/whiteboard-player";
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
type AspectRatio = "16:9" | "9:16";

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
  const { settings, capabilities, updateProject } = useStudio();

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
  const [aspect, setAspect] = useState<AspectRatio>("16:9");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);

  const undoStack = useRef<ProjectAsset[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  /* -------------------------------- committing ------------------------------ */

  const commit = useCallback(
    (next: ProjectAsset, options: { snapshot?: boolean } = {}) => {
      if (options.snapshot) {
        undoStack.current = [...undoStack.current, structuredClone(project)].slice(-UNDO_DEPTH);
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
      const draft = structuredClone(project) as ProjectAsset;
      try {
        const message = await task(draft);
        commit(draft, { snapshot: true });
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
      void (async () => {
        setBusy(true);
        setStatus("Working out what to change");
        setActivity((log) => [entry(instruction, true, true), ...log]);
        try {
          const plan = await planEdit({
            instruction,
            project: pruneForAgent(project) as Record<string, unknown>,
            sceneNumber: activeScene + 1,
            model: settings.textModel || undefined,
          });

          if (plan.summary) setActivity((log) => [entry(plan.summary), ...log]);
          if (!plan.ops.length) {
            setActivity((log) => [entry("Nothing was changed.", false), ...log]);
            return;
          }

          const result = await applyOps(project, plan.ops, {
            settings,
            capabilities,
            onProgress: (message) => setStatus(message),
          });

          commit(result.project, { snapshot: true });
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
    [activeScene, capabilities, commit, openScene, project, settings],
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

  /* --------------------------------- render --------------------------------- */

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Create
          </Link>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-raised text-create">
            <Film className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[13px] font-medium text-ink">{project.title}</h1>
            <p className="truncate text-[11px] text-faint">
              {project.scenes.length} scenes · ~{totalDuration.toFixed(1)}s ·{" "}
              {project.videoStyle === "hyperframes" ? "Modern frames" : "Whiteboard"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-line bg-surface-raised p-0.5">
            {(
              [
                { value: "16:9" as const, icon: Monitor },
                { value: "9:16" as const, icon: Smartphone },
              ]
            ).map(({ value, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setAspect(value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  aspect === value ? "bg-surface-hover text-ink" : "text-muted hover:text-ink",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {value}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={copyScript}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? "Copied" : "Script"}
          </button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 divide-y divide-line lg:grid-cols-12 lg:divide-x lg:divide-y-0">
        {/* ── scenes and video settings ── */}
        <aside className="flex flex-col gap-3 p-3 lg:col-span-3 lg:max-h-[calc(100vh-7.5rem)] lg:overflow-y-auto studio-scrollbar">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-medium tracking-wide text-muted">Scenes</h2>
            <button
              type="button"
              onClick={addScene}
              className="flex items-center gap-1 text-[10px] font-medium text-muted transition-colors hover:text-ink"
            >
              <Plus className="size-3" aria-hidden />
              Add
            </button>
          </div>

          <ul className="space-y-1.5">
            {project.scenes.map((scene, index) => (
              <li key={index}>
                <div
                  className={cn(
                    "group rounded-lg border p-2.5 transition-colors",
                    activeScene === index
                      ? "border-line-strong bg-surface-hover"
                      : "border-line bg-surface hover:bg-surface-raised",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => openScene(index)}
                    className="block w-full text-left"
                  >
                    <span className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-faint">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="font-mono text-[10px] text-faint">
                        {scene.audio?.duration ? `${scene.audio.duration.toFixed(1)}s` : "—"}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-[12px] font-medium text-ink">
                      {scene.heading || `Scene ${index + 1}`}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-faint">
                      {scene.narration || "No narration"}
                    </span>
                  </button>

                  <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setShowSettings((value) => !value)}
            className="mt-1 flex items-center justify-between rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-[11px] font-medium text-muted transition-colors hover:text-ink"
          >
            Video settings
            <ChevronDown className={cn("size-3.5 transition-transform", showSettings && "rotate-180")} aria-hidden />
          </button>

          {showSettings ? (
            <div className="space-y-3 rounded-lg border border-line bg-surface p-2.5">
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
        <main className="flex flex-col gap-3 bg-bg-soft p-4 lg:col-span-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-medium tracking-wide text-muted">Preview</h2>
            {preview !== project ? (
              <span className="text-[10px] text-faint">updating…</span>
            ) : null}
          </div>
          <div className="flex flex-1 items-start justify-center">
            <div
              className={cn(
                "w-full transition-all duration-300",
                aspect === "9:16" ? "max-w-[340px]" : "max-w-[880px]",
              )}
            >
              <WhiteboardPlayer
                project={preview}
                seekRequest={seekRequest}
                onSceneChange={followPlayback}
              />
            </div>
          </div>
        </main>

        {/* ── inspector ── */}
        <aside className="flex flex-col p-3 lg:col-span-3 lg:max-h-[calc(100vh-7.5rem)]">
          <div className="mb-3 flex rounded-lg border border-line bg-surface-raised p-0.5">
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
                  "flex-1 rounded-md py-1.5 text-center text-[11px] font-medium transition-colors",
                  tab === option.value ? "bg-surface-hover text-ink" : "text-muted hover:text-ink",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto studio-scrollbar">
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
        "grid size-6 place-items-center rounded-md border border-line bg-surface-raised text-[10px] text-muted",
        "transition-colors hover:border-line-strong hover:text-ink disabled:pointer-events-none disabled:opacity-30",
        danger && "hover:text-danger",
      )}
    >
      {children}
    </button>
  );
}
