"use client";

import { useState } from "react";
import { ImageIcon, LayoutTemplate, Mic, Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { curateVisual, resolveBoard } from "@/lib/studio/api";
import { prevailingVoice, relayoutScene, speakScene } from "@/lib/studio/edit-ops";
import { generateImage } from "@/lib/ai/image/client";
import type { ImageStyle } from "@/lib/ai/types";
import type { ProjectAsset, SceneAsset } from "@/lib/studio/types";
import { useStudio } from "@/lib/studio/use-studio";
import type { SceneSpec } from "@/lib/whiteboard/scene";
import { BoardEditor } from "./board-editor";
import { Choice, LabelledArea, LabelledInput, StringList } from "./controls";

/**
 * Every field of one scene, and the four pipelines that can refill it.
 *
 * These are the same routes the generator uses, pointed at a single scene:
 * Tavily for a real photograph, the image chain for artwork, the scene writer
 * for the board layout, and the speech route for the narration.
 */

const THEMES = [
  { value: "studio-dark" as const, label: "Dark" },
  { value: "cyber-blue" as const, label: "Blue" },
  { value: "sunset" as const, label: "Warm" },
  { value: "clean-light" as const, label: "Light" },
];

export function SceneInspector({
  project,
  index,
  busy,
  onPatch,
  onRun,
}: {
  project: ProjectAsset;
  index: number;
  busy: boolean;
  onPatch: (patch: Partial<SceneAsset>) => void;
  onRun: (label: string, task: (draft: ProjectAsset) => Promise<string | void>) => Promise<void>;
}) {
  const { settings } = useStudio();
  const [task, setTask] = useState<string | null>(null);
  const scene = project.scenes[index];

  if (!scene) return null;

  const run = async (name: string, label: string, fn: (draft: ProjectAsset) => Promise<string | void>) => {
    setTask(name);
    try {
      await onRun(label, fn);
    } finally {
      setTask(null);
    }
  };

  /**
   * A renamed icon is only a word until the server looks it up: the hand-drawn
   * set, then the Lucide catalogue, then a model shortlist. Resolving the whole
   * board at once is what keeps it from drawing the same picture twice.
   */
  const resolveIcons = async (spec: SceneSpec) => {
    setTask("board");
    try {
      const resolved = await resolveBoard({ scene: spec, model: settings.textModel || undefined });
      onPatch({ scene: resolved.scene });
    } catch (err) {
      console.warn("icon lookup failed, keeping the names as typed:", err);
    } finally {
      setTask(null);
    }
  };

  /**
   * Which engine draws this video.
   *
   * It decides which half of a scene is real. A whiteboard draws the composed
   * board and ignores heading and bullets; a Modern frame draws heading,
   * bullets, keywords and the stat, and ignores the board completely. Showing
   * the wrong half is how an edit ends up doing nothing.
   */
  const isModern = (project.videoStyle ?? settings.videoStyle) === "hyperframes";

  const imageStyle: ImageStyle =
    (project.videoStyle ?? settings.videoStyle) === "hyperframes"
      ? ((settings.imageStyle === "auto" ? "photorealistic" : settings.imageStyle) as ImageStyle)
      : ("whiteboard" as ImageStyle);

  return (
    <div className="space-y-5 pb-6">
      <LabelledArea
        label="Heading"
        rows={2}
        value={scene.heading}
        hint={
          isModern
            ? "Drawn across the frame, word by word, as the narrator reaches it."
            : "Names the scene in the timeline. The title drawn on the board is under Board, below."
        }
        onChange={(event) => onPatch({ heading: event.target.value })}
      />

      <LabelledArea
        label="Narration"
        rows={5}
        value={scene.narration}
        hint="Editing this leaves the recorded voice out of date — re-record it below."
        onChange={(event) => onPatch({ narration: event.target.value })}
      />

      <StringList
        label="Bullets"
        values={scene.bullets}
        max={4}
        placeholder="Short fragment"
        hint={
          isModern
            ? "Revealed one at a time, timed to the narration. Two or three shapes the shot."
            : "What the board is re-laid out from — not drawn as-is. The captions on the canvas are under Board."
        }
        onChange={(bullets) => onPatch({ bullets })}
      />

      <StringList
        label="Keywords"
        values={scene.keywords ?? []}
        max={6}
        addLabel="Add"
        placeholder="Word the narrator says"
        hint={
          isModern
            ? "Picked out in the accent colour as the heading lands."
            : "Guides the board's captions on a re-layout."
        }
        onChange={(keywords) => onPatch({ keywords })}
      />

      <div className="grid grid-cols-2 gap-2.5">
        <LabelledInput
          label="Stat"
          value={scene.stat ?? ""}
          placeholder="85%"
          onChange={(event) => onPatch({ stat: event.target.value || undefined })}
        />
        <LabelledInput
          label="Stat caption"
          value={scene.statCaption ?? ""}
          placeholder="Growth"
          onChange={(event) => onPatch({ statCaption: event.target.value || undefined })}
        />
      </div>

      <Choice
        label="Theme"
        value={scene.visualTheme}
        options={THEMES}
        columns={4}
        onChange={(visualTheme) => onPatch({ visualTheme })}
      />

      {/* ── the board ── */}
      <Section title={isModern ? "Shot" : "Board"}>
        {isModern ? (
          <p className="text-[11px] leading-relaxed text-faint">
            Modern frames are composed from the fields above — the shot is chosen from what the scene
            carries: a stat makes a metric shot, three bullets a process, two a contrast. There is no
            drawn board to edit.
          </p>
        ) : scene.scene ? (
          <>
            <p className="text-[11px] leading-relaxed text-faint">
              Everything drawn on the canvas, laid out as “{scene.scene.layout}”. Where things sit comes
              from the layout — re-lay it out to change the arrangement.
            </p>
            <BoardEditor
              spec={scene.scene}
              busy={task === "board"}
              onChange={(next, iconsChanged) => {
                onPatch({ scene: next });
                if (iconsChanged) void resolveIcons(next);
              }}
            />
          </>
        ) : (
          <p className="text-[11px] leading-relaxed text-faint">This scene has no drawn board yet.</p>
        )}

        <Action
          icon={LayoutTemplate}
          label={scene.scene ? "Re-lay out the board" : "Lay out the board"}
          busy={task === "relayout"}
          disabled={busy || isModern}
          hidden={isModern}
          onClick={() =>
            run("relayout", "Re-laid out the board", async (draft) => {
              const layout = await relayoutScene(draft, index, settings);
              return `Scene ${index + 1}: re-laid out as “${layout}”`;
            })
          }
        />
      </Section>

      {/* ── the picture ── */}
      <Section title="Picture">
        <Choice
          label="What shares the board"
          value={scene.supportVisual ?? "none"}
          columns={3}
          options={[
            { value: "photo" as const, label: "Photo" },
            { value: "generated" as const, label: "Generated" },
            { value: "none" as const, label: "None" },
          ]}
          onChange={(supportVisual) => onPatch({ supportVisual })}
        />

        <LabelledInput
          label="Photo search"
          value={scene.photoQuery ?? ""}
          placeholder="datacenter server racks"
          onChange={(event) => onPatch({ photoQuery: event.target.value || undefined })}
        />
        <Action
          icon={Search}
          label="Find a real photo"
          busy={task === "photo"}
          disabled={busy || !(scene.photoQuery ?? "").trim()}
          onClick={() =>
            run("photo", "Searched for a photo", async (draft) => {
              const target = draft.scenes[index];
              const query = (target.photoQuery ?? "").trim();
              const found = await curateVisual({
                brief: `${target.heading}. ${target.narration}`.slice(0, 560),
                query,
                model: settings.textModel || undefined,
              });
              target.imageNote = found.reason;
              if (!found.image) return `Scene ${index + 1}: no usable photo — ${found.reason}`;
              target.image = { ...found.image, kind: "photo", promptUsed: query };
              target.supportVisual = "photo";
              return `Scene ${index + 1}: found a photo — ${found.reason}`;
            })
          }
        />

        <LabelledArea
          label="Image prompt"
          rows={4}
          value={scene.imagePrompt}
          onChange={(event) => onPatch({ imagePrompt: event.target.value })}
        />
        <Action
          icon={ImageIcon}
          label="Generate artwork"
          busy={task === "image"}
          disabled={busy || !scene.imagePrompt.trim()}
          onClick={() =>
            run("image", "Generated artwork", async (draft) => {
              const target = draft.scenes[index];
              const made = await generateImage({
                prompt: target.imagePrompt,
                provider: settings.imageProvider,
                model: settings.imageModel || undefined,
                width: 1280,
                height: 720,
                style: imageStyle,
                enhance: false,
              });
              target.image = { ...made, kind: "drawn" };
              target.supportVisual = "generated";
              target.imageNote = undefined;
              return `Scene ${index + 1}: generated a new plate (${made.model})`;
            })
          }
        />

        {scene.imageNote ? (
          <p className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-[11px] leading-relaxed text-muted">
            {scene.imageNote}
          </p>
        ) : null}

        {scene.image ? (
          <div className="overflow-hidden rounded-lg border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element -- object URLs from IndexedDB */}
            <img src={scene.image.url} alt="" className="block w-full" />
            <p className="border-t border-line bg-surface-raised px-2.5 py-1.5 font-mono text-[10px] text-faint">
              {scene.image.kind ?? "image"} · {scene.image.provider} · {scene.image.width}×
              {scene.image.height}
            </p>
          </div>
        ) : null}
      </Section>

      {/* ── the voice ── */}
      <Section title="Voice">
        <p className="text-[11px] leading-relaxed text-faint">
          {scene.audio
            ? `${scene.audio.provider} · ${scene.audio.duration?.toFixed(2) ?? "?"}s · ${scene.audio.words?.length ?? 0} word timings`
            : "No narration recorded for this scene."}
        </p>
        {scene.audio ? <audio src={scene.audio.url} controls className="w-full" /> : null}
        <Action
          icon={Mic}
          label={scene.audio ? "Re-record the narration" : "Record the narration"}
          busy={task === "voice"}
          disabled={busy || !scene.narration.trim()}
          onClick={() =>
            run("voice", "Re-recorded the narration", async (draft) => {
              const target = draft.scenes[index];
              await speakScene(target, settings, undefined, {
                // A scene with no recording yet takes the voice the rest of the
                // video already uses, not the global default.
                voiceId: target.audio ? undefined : prevailingVoice(draft.scenes, settings.voiceId),
              });
              return `Scene ${index + 1}: re-recorded the narration`;
            })
          }
        />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 border-t border-line pt-4">
      <h4 className="text-[11px] font-medium tracking-wide text-ink">{title}</h4>
      {children}
    </section>
  );
}

function Action({
  icon: Icon,
  label,
  busy,
  disabled,
  hidden,
  onClick,
}: {
  icon: typeof Mic;
  label: string;
  busy: boolean;
  disabled?: boolean;
  hidden?: boolean;
  onClick: () => void;
}) {
  if (hidden) return null;
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-surface-raised",
        "px-3 py-2 text-[11px] font-medium text-ink transition-colors",
        "hover:border-line-strong hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-45",
      )}
    >
      <Icon className={cn("size-3.5", busy && "animate-pulse")} aria-hidden />
      {busy ? "Working…" : label}
    </button>
  );
}
