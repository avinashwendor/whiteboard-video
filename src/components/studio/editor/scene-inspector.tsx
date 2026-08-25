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
import { THEMES, THEME_NAMES, type Finish, type ThemeName } from "@/lib/hyperframes/theme";
import { canCarry, roleFor } from "@/lib/hyperframes/modern-renderer";
import { SCENE_ROLES_TUPLE, SHOT_BRIEFS, type SceneRole } from "@/lib/hyperframes/roles";

/**
 * Every field of one scene, and the four pipelines that can refill it.
 *
 * These are the same routes the generator uses, pointed at a single scene:
 * Tavily for a real photograph, the image chain for artwork, the scene writer
 * for the board layout, and the speech route for the narration.
 */

/**
 * The palettes, grouped by the vocabulary they draw in.
 *
 * Grouped rather than listed because the finish is the real choice: picking
 * "obsidian" over "cobalt" is choosing a magazine cover over a product film,
 * and a flat row of eleven names hides that completely. The swatch shows the
 * actual ground, accent and ink, so the decision is made by eye.
 */
const THEME_GROUPS: Array<{ finish: Finish; label: string; hint: string }> = [
  { finish: "editorial", label: "Editorial", hint: "Cover type, crop marks, one plate of colour" },
  { finish: "glass", label: "Glass", hint: "Light blooms, frosted panels, brushed metal" },
  { finish: "print", label: "Printed", hint: "Ruled paper, hard shadows, marker swipes" },
];

const THEME_LABELS: Partial<Record<ThemeName, string>> = {
  "clean-light": "Light",
  "studio-dark": "Dark",
  "cyber-blue": "Blue",
  sunset: "Warm",
  obsidian: "Obsidian",
  noir: "Noir",
  newsprint: "Newsprint",
  ember: "Ember",
  cobalt: "Cobalt",
  abyss: "Abyss",
  daylight: "Daylight",
};

/** One palette, drawn as itself. */
function Swatch({
  name,
  selected,
  onSelect,
}: {
  name: ThemeName;
  selected: boolean;
  onSelect: () => void;
}) {
  const theme = THEMES[name];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={THEME_LABELS[name] ?? name}
      className={cn(
        "group relative h-12 overflow-hidden rounded-lg border text-left transition",
        selected
          ? "border-ink ring-2 ring-ink/20"
          : "border-line hover:border-ink/40",
      )}
      style={{
        background:
          theme.finish === "glass"
            ? `radial-gradient(120% 120% at 20% 10%, ${theme.mesh[0]}, transparent 60%), radial-gradient(120% 120% at 85% 90%, ${theme.mesh[1]}, transparent 55%), ${theme.mesh[2]}`
            : theme.ground,
      }}
    >
      <span
        className="absolute bottom-1.5 left-1.5 h-3 w-3 rounded-full"
        style={{ background: theme.accent }}
      />
      <span
        className="absolute bottom-2 left-6 h-1.5 w-6 rounded-full"
        style={{ background: theme.ink, opacity: 0.85 }}
      />
      <span
        className="absolute right-1.5 top-1.5 text-[9px] font-semibold uppercase tracking-wide"
        style={{ color: theme.inkMuted }}
      >
        {THEME_LABELS[name] ?? name}
      </span>
    </button>
  );
}

function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeName | undefined;
  onChange: (name: ThemeName) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Theme</p>
      {THEME_GROUPS.map((group) => {
        const names = THEME_NAMES.filter((name) => THEMES[name].finish === group.finish);
        return (
          <div key={group.finish} className="space-y-1.5">
            <p className="text-[10px] leading-none text-faint">
              <span className="font-semibold text-ink/70">{group.label}</span> — {group.hint}
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {names.map((name) => (
                <Swatch
                  key={name}
                  name={name}
                  selected={value === name}
                  onSelect={() => onChange(name)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Which composition this scene is cut as.
 *
 * Every shot is listed, including the ones this scene cannot carry -- but
 * those are disabled and say why. Hiding them would leave someone wondering
 * where "contrast" went; accepting them and rendering something else is worse,
 * because the control would appear to work and quietly not.
 *
 * "Auto" is first and is the honest default: it shows the shot the renderer
 * would actually choose, so picking it deliberately is a real decision rather
 * than a shrug.
 */
function ShotPicker({
  scene,
  index,
  total,
  onChange,
}: {
  scene: SceneAsset;
  index: number;
  total: number;
  onChange: (shot: SceneRole | undefined) => void;
}) {
  const content = { bullets: scene.bullets, stat: scene.stat, image: scene.image };
  const automatic = roleFor({ index, totalScenes: total, ...content, heading: scene.heading });
  const chosen = scene.shot;

  /** Why a shot is unavailable, in the words of what the scene is missing. */
  const blocker = (role: SceneRole): string | null => {
    if (canCarry(role, content)) return null;
    switch (role) {
      case "metric":
        return "needs a stat";
      case "process":
        return "needs 3+ bullets";
      case "deck":
        return "needs 2+ bullets";
      case "contrast":
        return "needs exactly 2 bullets";
      case "tree":
        return "needs 2-4 bullets";
      case "split":
      case "collage":
        return "needs a bullet";
      case "bracket":
        return "needs 2 bullets or fewer";
      default:
        return "unavailable";
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => onChange(undefined)}
          aria-pressed={!chosen}
          className={cn(
            "rounded-md border px-2 py-1.5 text-[11px] font-medium transition",
            !chosen ? "border-ink bg-surface-raised text-ink" : "border-line text-muted hover:text-ink",
          )}
        >
          Auto
        </button>
        {SCENE_ROLES_TUPLE.map((role) => {
          const why = blocker(role);
          return (
            <button
              key={role}
              type="button"
              disabled={Boolean(why)}
              onClick={() => onChange(role)}
              aria-pressed={chosen === role}
              title={why ? `${SHOT_BRIEFS[role]} — ${why}` : SHOT_BRIEFS[role]}
              className={cn(
                "rounded-md border px-2 py-1.5 text-[11px] font-medium capitalize transition",
                chosen === role
                  ? "border-ink bg-surface-raised text-ink"
                  : why
                    ? "cursor-not-allowed border-line/60 text-faint/60"
                    : "border-line text-muted hover:text-ink",
              )}
            >
              {role}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-faint">
        {chosen ? (
          SHOT_BRIEFS[chosen]
        ) : (
          <>
            Chosen from what the scene carries — right now that is{" "}
            <span className="font-medium text-ink/70">{automatic}</span>: {SHOT_BRIEFS[automatic]}.
          </>
        )}
      </p>
    </div>
  );
}

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
  onPatch: (index: number, patch: Partial<SceneAsset>) => void;
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
    // Capture the scene index before the await so that switching scenes
    // mid-flight cannot redirect the resolved board to the wrong scene.
    const targetIndex = index;
    setTask("board");
    try {
      const resolved = await resolveBoard({ scene: spec, model: settings.textModel || undefined });
      onPatch(targetIndex, { scene: resolved.scene });
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
        onChange={(event) => onPatch(index, { heading: event.target.value })}
      />

      <LabelledArea
        label="Narration"
        rows={5}
        value={scene.narration}
        hint="Editing this leaves the recorded voice out of date — re-record it below."
        onChange={(event) => onPatch(index, { narration: event.target.value })}
      />

      <StringList
        label="Bullets"
        values={scene.bullets}
        max={4}
        placeholder="Short fragment"
        hint={
          isModern
            ? "Revealed one at a time, timed to the narration. Two or three shapes the shot."
            : "Editing these re-lays out the board automatically so the canvas stays in sync."
        }
        onChange={(bullets) => {
          onPatch(index, { bullets });
          // In whiteboard mode the canvas draws scene.scene, not scene.bullets.
          // Auto-relayout bridges the gap so edits appear immediately.
          if (!isModern && scene.scene) {
            void onRun("Re-laying out the board", async (draft) => {
              const layout = await relayoutScene(draft, index, settings);
              return `Scene ${index + 1}: re-laid out as "${layout}"`;
            });
          }
        }}
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
        onChange={(keywords) => onPatch(index, { keywords })}
      />

      <div className="grid grid-cols-2 gap-2.5">
        <LabelledInput
          label="Stat"
          value={scene.stat ?? ""}
          placeholder="85%"
          onChange={(event) => onPatch(index, { stat: event.target.value || undefined })}
        />
        <LabelledInput
          label="Stat caption"
          value={scene.statCaption ?? ""}
          placeholder="Growth"
          onChange={(event) => onPatch(index, { statCaption: event.target.value || undefined })}
        />
      </div>

      <ThemePicker
        value={scene.visualTheme}
        onChange={(visualTheme) => onPatch(index, { visualTheme })}
      />

      {/* ── the board ── */}
      <Section title={isModern ? "Shot" : "Board"}>
        {isModern ? (
          <ShotPicker
            scene={scene}
            index={index}
            total={project.scenes.length}
            onChange={(shot) => onPatch(index, { shot })}
          />
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
                onPatch(index, { scene: next });
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
          onChange={(supportVisual) => onPatch(index, { supportVisual })}
        />

        <LabelledInput
          label="Photo search"
          value={scene.photoQuery ?? ""}
          placeholder="datacenter server racks"
          onChange={(event) => onPatch(index, { photoQuery: event.target.value || undefined })}
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
          onChange={(event) => onPatch(index, { imagePrompt: event.target.value })}
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
