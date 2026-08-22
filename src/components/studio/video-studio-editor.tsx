"use client";

import { useCallback, useState } from "react";
import {
  Check,
  ChevronRight,
  Clock,
  Copy,
  Film,
  Layers,
  Mic,
  Monitor,
  PenLine,
  Plus,
  RefreshCw,
  Sliders,
  Smartphone,
  Sparkles,
  Trash2,
  Tv,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ProjectAsset, SceneAsset } from "@/lib/studio/types";
import { useStudio } from "@/lib/studio/use-studio";
import { generateSpeech, generateServerImage } from "@/lib/studio/api";
import { WhiteboardPlayer } from "@/components/whiteboard/whiteboard-player";

export type AspectRatio = "16:9" | "9:16";

interface VideoStudioEditorProps {
  project: ProjectAsset;
  onUpdateProject?: (updated: ProjectAsset) => void;
}

export function VideoStudioEditor({ project, onUpdateProject }: VideoStudioEditorProps) {
  const { settings, updateSettings } = useStudio();
  const [activeSceneIdx, setActiveSceneIdx] = useState<number>(0);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [activeTab, setActiveTab] = useState<"content" | "voice" | "visual">("content");
  const [isRegeneratingAudio, setIsRegeneratingAudio] = useState<number | null>(null);
  const [isRegeneratingImage, setIsRegeneratingImage] = useState<number | null>(null);
  const [copiedScript, setCopiedScript] = useState(false);

  // Local editable project state
  const [editableProject, setEditableProject] = useState<ProjectAsset>(project);

  const updateScene = useCallback(
    (index: number, patch: Partial<SceneAsset>) => {
      setEditableProject((prev) => {
        const nextScenes = [...prev.scenes];
        nextScenes[index] = { ...nextScenes[index], ...patch };
        const updated = { ...prev, scenes: nextScenes };
        onUpdateProject?.(updated);
        return updated;
      });
    },
    [onUpdateProject],
  );

  const activeScene = editableProject.scenes[activeSceneIdx] ?? editableProject.scenes[0];

  // Calculate total estimated duration
  const totalDuration = editableProject.scenes.reduce((acc, s) => {
    const d = s.audio?.duration ?? Math.max(4.5, s.narration.split(/\s+/).length / 2.5);
    return acc + d;
  }, editableProject.introDuration ?? 3);

  // Re-generate audio narration with Siya (Cartesia)
  const handleRegenerateAudio = async (index: number) => {
    const scene = editableProject.scenes[index];
    if (!scene?.narration) return;
    setIsRegeneratingAudio(index);
    try {
      const res = await generateSpeech({
        transcript: scene.narration,
        voiceId: settings.voiceId || "4459a9a5-69d6-4680-b970-e13dc51845b6", // Siya default
        language: settings.language || "en",
        speed: settings.speed,
      });
      updateScene(index, {
        audio: {
          url: res.audioUrl,
          provider: res.provider,
          model: res.model,
          voiceId: res.voiceId,
          language: settings.language,
          duration: res.duration,
          words: res.words,
        },
      });
    } catch (err) {
      console.error("Audio regeneration failed:", err);
    } finally {
      setIsRegeneratingAudio(null);
    }
  };

  // Re-generate background visual plate
  const handleRegenerateImage = async (index: number) => {
    const scene = editableProject.scenes[index];
    if (!scene?.imagePrompt) return;
    setIsRegeneratingImage(index);
    try {
      const res = await generateServerImage({
        prompt: scene.imagePrompt,
        width: aspectRatio === "9:16" ? 720 : 1280,
        height: aspectRatio === "9:16" ? 1280 : 720,
        style: settings.videoStyle === "hyperframes" ? "illustration" : "whiteboard",
        enhance: false,
      });
      updateScene(index, {
        image: {
          ...res.image,
          promptUsed: res.prompt.used,
        },
      });
    } catch (err) {
      console.error("Image regeneration failed:", err);
    } finally {
      setIsRegeneratingImage(null);
    }
  };

  const copyFullScript = () => {
    const full = [
      `# ${editableProject.title}`,
      editableProject.description,
      "",
      ...editableProject.scenes.map(
        (s, i) => `## Scene ${i + 1}: ${s.heading}\n${s.narration}\n`,
      ),
    ].join("\n");
    navigator.clipboard.writeText(full).catch(() => {});
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  return (
    <div className="flex w-full flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c0e12] text-neutral-200 shadow-sm font-sans">
      {/* ─────────────────────────────────────────────────────────────
          1. HEADER
         ───────────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] bg-[#0c0e12] px-5 py-3">
        {/* Left: Project Info */}
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.04] text-neutral-400">
            <Film className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-medium tracking-tight text-neutral-100">{editableProject.title}</h2>
            <p className="flex items-center gap-2 text-[11px] text-neutral-500 mt-0.5">
              <span>{editableProject.scenes.length} scenes</span>
              <span>·</span>
              <span>Siya Voice ({settings.language.toUpperCase()})</span>
              <span>·</span>
              <span>~{totalDuration.toFixed(1)}s total</span>
            </p>
          </div>
        </div>

        {/* Center: Controls */}
        <div className="flex items-center gap-2">
          {/* Aspect Ratio Switch */}
          <div className="flex rounded-lg border border-white/[0.06] bg-[#111318] p-1">
            <button
              type="button"
              onClick={() => setAspectRatio("16:9")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                aspectRatio === "16:9"
                  ? "bg-white/[0.08] text-white"
                  : "text-neutral-500 hover:text-neutral-300",
              )}
            >
              <Monitor className="size-3.5" />
              <span>16:9</span>
            </button>
            <button
              type="button"
              onClick={() => setAspectRatio("9:16")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                aspectRatio === "9:16"
                  ? "bg-white/[0.08] text-white"
                  : "text-neutral-500 hover:text-neutral-300",
              )}
            >
              <Smartphone className="size-3.5" />
              <span>9:16</span>
            </button>
          </div>

          {/* Style Switch */}
          <div className="flex rounded-lg border border-white/[0.06] bg-[#111318] p-1">
            <button
              type="button"
              onClick={() => updateSettings({ videoStyle: "hyperframes" })}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                settings.videoStyle === "hyperframes"
                  ? "bg-white/[0.08] text-white"
                  : "text-neutral-500 hover:text-neutral-300",
              )}
            >
              <Sparkles className="size-3.5" />
              <span>Frames</span>
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ videoStyle: "whiteboard" })}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                settings.videoStyle === "whiteboard"
                  ? "bg-white/[0.08] text-white"
                  : "text-neutral-500 hover:text-neutral-300",
              )}
            >
              <PenLine className="size-3.5" />
              <span>Board</span>
            </button>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center">
          <button
            type="button"
            onClick={copyFullScript}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            {copiedScript ? <Check className="size-3.5 text-neutral-300" /> : <Copy className="size-3.5" />}
            <span>{copiedScript ? "Copied" : "Copy script"}</span>
          </button>
        </div>
      </header>

      {/* ─────────────────────────────────────────────────────────────
          2. MAIN WORKSPACE
         ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 divide-y divide-white/[0.06] lg:grid-cols-12 lg:divide-x lg:divide-y-0 min-h-[560px]">
        {/* ── LEFT COLUMN: Scene List ── */}
        <aside className="flex flex-col bg-[#0c0e12] p-4 lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xs font-medium text-neutral-400">Scenes</h3>
            <span className="text-xs text-neutral-500">{editableProject.scenes.length}</span>
          </div>

          <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-2 studio-scrollbar max-h-[560px]">
            {editableProject.scenes.map((scene, idx) => {
              const isActive = activeSceneIdx === idx;
              const sceneSec = scene.audio?.duration
                ? `${scene.audio.duration.toFixed(1)}s`
                : "Auto";

              return (
                <div
                  key={idx}
                  onClick={() => setActiveSceneIdx(idx)}
                  className={cn(
                    "group relative flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors",
                    isActive
                      ? "border-white/[0.15] bg-[#161921] text-white"
                      : "border-transparent bg-transparent text-neutral-400 hover:bg-[#111318]",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "text-[11px] font-medium tracking-tight",
                        isActive ? "text-neutral-200" : "text-neutral-500",
                      )}
                    >
                      Scene {idx + 1}
                    </span>
                    <span className="text-[10px] text-neutral-500 font-mono">
                      {sceneSec}
                    </span>
                  </div>

                  <h4 className="line-clamp-1 text-xs font-medium text-neutral-200">
                    {scene.heading || `Scene ${idx + 1}`}
                  </h4>

                  <p className="line-clamp-2 text-[11px] leading-relaxed text-neutral-500">
                    {scene.narration}
                  </p>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── CENTER COLUMN: Preview ── */}
        <main className="flex flex-col bg-[#0a0c0f] p-4 lg:col-span-6 relative">
           <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xs font-medium text-neutral-400">Preview</h3>
          </div>

          <div className="flex flex-1 items-center justify-center overflow-hidden rounded-xl bg-[#060709] border border-white/[0.04]">
            <div
              className={cn(
                "relative mx-auto w-full transition-all duration-300",
                aspectRatio === "9:16" ? "max-w-[340px]" : "max-w-[800px]",
              )}
            >
              <WhiteboardPlayer project={editableProject} />
            </div>
          </div>
        </main>

        {/* ── RIGHT COLUMN: Inspector ── */}
        <aside className="flex flex-col bg-[#0c0e12] p-4 lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
             <h3 className="text-xs font-medium text-neutral-400">Settings</h3>
          </div>

          {/* Inspector Tabs */}
          <div className="mb-5 flex rounded-lg border border-white/[0.06] bg-[#111318] p-1">
            {(["content", "voice", "visual"] as const).map((tab) => (
               <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                     "flex-1 rounded-md py-1.5 text-center text-[11px] font-medium transition-all capitalize",
                     activeTab === tab
                        ? "bg-white/[0.08] text-white"
                        : "text-neutral-500 hover:text-neutral-300",
                  )}
               >
                  {tab}
               </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeScene ? (
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto pr-2 studio-scrollbar max-h-[480px]">
              {/* ── TAB 1: CONTENT ── */}
              {activeTab === "content" && (
                <div className="space-y-4 animate-fade">
                  <div>
                    <label className="text-[11px] font-medium text-neutral-400">Heading</label>
                    <input
                      type="text"
                      value={activeScene.heading}
                      onChange={(e) => updateScene(activeSceneIdx, { heading: e.target.value })}
                      className="mt-1.5 w-full rounded-md border border-white/[0.08] bg-[#111318] px-3 py-2 text-xs text-neutral-200 outline-none focus:border-neutral-500 transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-neutral-400">Metric</label>
                      <input
                        type="text"
                        value={activeScene.stat ?? ""}
                        placeholder="e.g. 100x"
                        onChange={(e) => updateScene(activeSceneIdx, { stat: e.target.value })}
                        className="mt-1.5 w-full rounded-md border border-white/[0.08] bg-[#111318] px-3 py-2 text-xs text-neutral-200 outline-none focus:border-neutral-500 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-neutral-400">Metric Label</label>
                      <input
                        type="text"
                        value={activeScene.statCaption ?? ""}
                        placeholder="e.g. Growth"
                        onChange={(e) => updateScene(activeSceneIdx, { statCaption: e.target.value })}
                        className="mt-1.5 w-full rounded-md border border-white/[0.08] bg-[#111318] px-3 py-2 text-xs text-neutral-200 outline-none focus:border-neutral-500 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[11px] font-medium text-neutral-400">Bullet Points</label>
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...activeScene.bullets, ""];
                          updateScene(activeSceneIdx, { bullets: next });
                        }}
                        className="flex items-center gap-1 text-[10px] font-medium text-neutral-400 hover:text-neutral-200"
                      >
                        <Plus className="size-3" />
                        Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {activeScene.bullets.map((b, bIdx) => (
                        <div key={bIdx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={b}
                            onChange={(e) => {
                              const next = [...activeScene.bullets];
                              next[bIdx] = e.target.value;
                              updateScene(activeSceneIdx, { bullets: next });
                            }}
                            className="flex-1 rounded-md border border-white/[0.08] bg-[#111318] px-3 py-1.5 text-xs text-neutral-200 outline-none focus:border-neutral-500 transition-colors"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const next = activeScene.bullets.filter((_, i) => i !== bIdx);
                              updateScene(activeSceneIdx, { bullets: next });
                            }}
                            className="text-neutral-500 hover:text-neutral-300 transition-colors"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── TAB 2: VOICE ── */}
              {activeTab === "voice" && (
                <div className="space-y-4 animate-fade">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-medium text-neutral-400">Narration Script</label>
                    </div>
                    <textarea
                      rows={6}
                      value={activeScene.narration}
                      onChange={(e) => updateScene(activeSceneIdx, { narration: e.target.value })}
                      className="w-full resize-none rounded-md border border-white/[0.08] bg-[#111318] p-3 text-xs leading-relaxed text-neutral-200 outline-none focus:border-neutral-500 transition-colors"
                      placeholder="Enter narration text..."
                    />
                  </div>

                  <button
                    type="button"
                    disabled={isRegeneratingAudio === activeSceneIdx}
                    onClick={() => void handleRegenerateAudio(activeSceneIdx)}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-2 text-xs font-medium text-black transition-colors hover:bg-neutral-200 active:bg-neutral-300 disabled:opacity-50"
                  >
                    <RefreshCw className={cn("size-3.5", isRegeneratingAudio === activeSceneIdx && "animate-spin")} />
                    <span>{isRegeneratingAudio === activeSceneIdx ? "Generating..." : "Generate Voice"}</span>
                  </button>

                  {activeScene.audio?.duration ? (
                     <p className="text-[11px] text-neutral-500 mt-2">
                        Generated audio: {activeScene.audio.duration.toFixed(2)}s duration.
                     </p>
                  ) : null}
                </div>
              )}

              {/* ── TAB 3: VISUAL ── */}
              {activeTab === "visual" && (
                <div className="space-y-4 animate-fade">
                  <div>
                    <label className="text-[11px] font-medium text-neutral-400">Image Prompt</label>
                    <textarea
                      rows={5}
                      value={activeScene.imagePrompt}
                      onChange={(e) => updateScene(activeSceneIdx, { imagePrompt: e.target.value })}
                      className="mt-1.5 w-full resize-none rounded-md border border-white/[0.08] bg-[#111318] p-3 text-xs leading-relaxed text-neutral-200 outline-none focus:border-neutral-500 transition-colors"
                      placeholder="Image generation prompt..."
                    />
                  </div>

                  <button
                    type="button"
                    disabled={isRegeneratingImage === activeSceneIdx}
                    onClick={() => void handleRegenerateImage(activeSceneIdx)}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-2 text-xs font-medium text-black transition-colors hover:bg-neutral-200 active:bg-neutral-300 disabled:opacity-50"
                  >
                    <Wand2 className={cn("size-3.5", isRegeneratingImage === activeSceneIdx && "animate-spin")} />
                    <span>{isRegeneratingImage === activeSceneIdx ? "Rendering..." : "Generate Image"}</span>
                  </button>

                  <div>
                    <label className="text-[11px] font-medium text-neutral-400">Theme</label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {[
                        { id: "studio-dark", name: "Dark" },
                        { id: "cyber-blue", name: "Blue" },
                        { id: "sunset", name: "Warm" },
                        { id: "clean-light", name: "Light" },
                      ].map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => updateScene(activeSceneIdx, { visualTheme: t.id as any })}
                          className={cn(
                            "rounded-md border p-2 text-center text-[11px] font-medium transition-colors",
                            activeScene.visualTheme === t.id
                              ? "border-white/[0.15] bg-[#161921] text-white"
                              : "border-white/[0.06] bg-[#111318] text-neutral-500 hover:text-neutral-300",
                          )}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
