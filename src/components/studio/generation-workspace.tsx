"use client";

import { useEffect, useMemo, useState } from "react";
import { Square } from "lucide-react";
import { WhiteboardPlayer } from "@/components/whiteboard/whiteboard-player";
import { Button } from "@/components/ui/button";
import {
  AsciiProgress,
  AsciiVeil,
  BlurredWhileBusy,
  formatClock,
  useElapsed,
  type AsciiVeilStep,
} from "@/components/ui/ascii-loader";
import type { Generation } from "@/lib/studio/types";
import { useStudio } from "@/lib/studio/use-studio";

/**
 * The in-place production view for an active video generation.
 *
 * Half-drawn output is never shown as itself. The runner patches scenes as
 * their assets settle, which means the canvas spends most of a run holding a
 * frame that is technically real and visually wrong — a heading with no
 * artwork, an image with no narration under it. So the player is blurred and
 * covered by the ASCII veil, and the blur only relaxes as scenes actually land.
 */
export function GenerationWorkspace({ generation }: { generation: Generation }) {
  const { cancel } = useStudio();
  const project = generation.project;
  const [seekRequest, setSeekRequest] = useState<{ index: number; nonce: number } | null>(null);
  const elapsed = useElapsed(true);

  const live = useMemo(() => {
    if (!project) return { sceneIndex: null, readyCount: 0, total: 0, active: null };

    const ready = project.scenes
      .map((scene, index) => ({ scene, index }))
      .filter(({ scene }) =>
        project.videoStyle === "hyperframes"
          ? Boolean(scene.heading)
          : Boolean(scene.scene || scene.image),
      );

    const active = project.scenes.findIndex((scene) => scene.status === "running");
    return {
      sceneIndex: ready[ready.length - 1]?.index ?? null,
      readyCount: ready.length,
      total: project.scenes.length,
      active: active >= 0 ? active : null,
    };
  }, [project]);

  // The shared player treats a seek as a command, so send it after mount and
  // whenever the latest real scene changes. Its transport behaviour remains
  // unchanged for the editor.
  useEffect(() => {
    if (live.sceneIndex === null) return;
    const frame = requestAnimationFrame(() => {
      setSeekRequest((previous) => ({
        index: live.sceneIndex,
        nonce: (previous?.nonce ?? 0) + 1,
      }));
    });
    return () => cancelAnimationFrame(frame);
  }, [live.readyCount, live.sceneIndex]);

  /** 0 before the plan exists, then the share of scenes carrying real assets. */
  const progress = project && live.total ? live.readyCount / live.total : undefined;

  /**
   * The veil never fully lifts here — this view only exists while a run is in
   * flight — but the blur relaxes as the project converges, so the shape of the
   * video becomes legible before the detail does.
   */
  const blur = progress === undefined ? 26 : 24 - 12 * progress;

  const steps: AsciiVeilStep[] = useMemo(() => {
    const planned = Boolean(project);
    const scripted = Boolean(project?.scenes.some((scene) => scene.narration));
    const voiced = Boolean(project?.scenes.some((scene) => scene.audio));
    const drawing = live.active !== null;
    return [
      { label: "Story", state: planned ? "done" : "active" },
      { label: "Script", state: scripted ? "done" : planned ? "active" : "pending" },
      { label: "Voice", state: voiced ? "done" : scripted ? "active" : "pending" },
      { label: "Render", state: drawing ? "active" : voiced ? "active" : "pending" },
    ];
  }, [project, live.active]);

  const sceneCounter =
    live.active !== null
      ? `${String(live.active + 1).padStart(2, "0")} / ${String(live.total).padStart(2, "0")}`
      : live.total
        ? `${String(live.readyCount).padStart(2, "0")} / ${String(live.total).padStart(2, "0")}`
        : "—";

  const title = project
    ? live.active !== null
      ? `Drawing scene ${String(live.active + 1).padStart(2, "0")}`
      : `${live.readyCount} of ${live.total} scenes ready`
    : "Planning the story";

  const detail = project
    ? (live.active !== null ? project.scenes[live.active]?.heading : undefined) ??
      generation.stage ??
      "Assembling the production"
    : "Deciding how this should be seen, then writing it.";

  return (
    <section className="studio-generation animate-fade" aria-live="polite" aria-label="Video generation workspace">
      <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col px-5 pb-28 pt-12 sm:px-8 sm:pt-16">
        <div className="mb-4 flex items-center justify-between gap-4 border-b border-line pb-3">
          <p className="truncate text-[13px] text-muted">{generation.prompt}</p>
          <p className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
            Scene {sceneCounter}
          </p>
        </div>

        <div className="flex flex-1 flex-col justify-center">
          <BlurredWhileBusy
            busy
            blur={blur}
            className="w-full border border-line bg-[#0d0d0e] shadow-[0_30px_70px_rgba(0,0,0,0.45)]"
            overlay={
              <AsciiVeil
                title={title}
                detail={detail}
                progress={progress}
                steps={steps}
                elapsedSeconds={elapsed}
                footnote={project ? `${live.total} scenes · 1920 × 1080` : "1920 × 1080"}
              />
            }
          >
            {project ? (
              <WhiteboardPlayer
                key={generation.id}
                project={project}
                seekRequest={seekRequest}
                className="generation-player"
              />
            ) : (
              <div className="aspect-video w-full" aria-hidden />
            )}
          </BlurredWhileBusy>

          <div className="mt-5 flex flex-wrap items-baseline justify-between gap-4 border-t border-line pt-4">
            <div className="min-w-0">
              <p className="truncate text-[16px] font-medium tracking-[-0.01em] text-ink">
                {title}
                {detail ? <span className="text-muted"> — {detail}</span> : null}
              </p>
              <AsciiProgress
                value={progress}
                width={34}
                className="mt-2.5 block text-[10.5px] text-faint"
              />
            </div>
            <p className="shrink-0 text-right text-[13px] text-muted">
              Elapsed <span className="font-mono text-[12px] tabular-nums">{formatClock(elapsed)}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-16 max-w-[1440px] items-center gap-4 px-5 py-3 sm:px-7">
          <p className="min-w-0 flex-1 truncate text-[14px] text-muted">{generation.prompt}</p>
          <Button variant="secondary" size="sm" className="shrink-0 rounded-none" onClick={cancel}>
            <Square className="size-3 fill-current" aria-hidden />
            Stop
          </Button>
        </div>
      </div>
    </section>
  );
}
