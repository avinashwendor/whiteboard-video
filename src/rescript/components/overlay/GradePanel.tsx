"use client";

import { useCallback, useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { useEditorStore } from "@/rescript/lib/store";
import { useOverlayStore } from "@/rescript/lib/overlay/store";
import { useOutputTime } from "@/rescript/hooks/useOverlayTimeline";
import {
  GRADE_PRESETS,
  NEUTRAL_GRADE,
  gradeFilter,
  isNeutralGrade,
  withGradeDefaults,
  type GradeSpec,
} from "@/rescript/lib/overlay/grade";
import { formatSeconds, Row, Section, Segmented, Slider } from "./ui";

/**
 * The look.
 *
 * Presets first and sliders second, and the sliders deliberately narrow. The
 * failure mode of a grading panel is a video that has been *processed* rather
 * than graded, and the way you get there is a saturation control that reaches
 * neon. Every preset here is usable on a talking head with nothing else
 * touched, which is the only thing that makes a preset list worth having.
 *
 * The swatches are the real thing: each one is the actual CSS filter chain the
 * renderer will apply, over a strip of the same colours. A preview that
 * approximates the look it is selling is worse than no preview.
 */

/** The strip the swatches are drawn on: a skin tone, a mid, a sky, a shadow. */
const SWATCH = ["#c98c6f", "#8a8f7a", "#5b7fa6", "#2b2b2f"];

function Swatch({ grade }: { grade: GradeSpec }) {
  const filter = gradeFilter(grade);
  return (
    <span
      aria-hidden
      className="flex h-5 w-full overflow-hidden rounded"
      style={filter ? { filter } : undefined}
    >
      {SWATCH.map((c) => (
        <span key={c} className="flex-1" style={{ background: c }} />
      ))}
    </span>
  );
}

export default function GradePanel() {
  const projectGrade = useOverlayStore((s) => s.grade);
  const shots = useOverlayStore((s) => s.shots);
  const setGrade = useOverlayStore((s) => s.setGrade);
  const mediaKind = useEditorStore((s) => s.mediaKind);
  const playhead = useOutputTime();

  /** The shot under the playhead, if it has a look of its own to edit. */
  const shot = useMemo(
    () => shots.find((s) => playhead >= s.start && playhead < s.end) ?? null,
    [shots, playhead]
  );

  /** Whose look the controls are editing. */
  const scoped = shot?.grade !== undefined && shot?.grade !== null;
  const grade = withGradeDefaults(scoped ? shot!.grade : projectGrade);
  const target = scoped ? shot!.id : undefined;

  const set = useCallback(
    (patch: Partial<GradeSpec>) => setGrade(patch, target),
    [setGrade, target]
  );

  if (mediaKind === "audio") {
    return (
      <div className="p-3 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        This project is audio only, so there is no picture to grade.
      </div>
    );
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <Section
        title={scoped ? `Look — shot at ${formatSeconds(shot!.start)}` : "Look"}
        action={
          !isNeutralGrade(scoped ? shot!.grade : projectGrade) ? (
            <button
              type="button"
              onClick={() => setGrade(null, target)}
              title="Back to neutral"
              className="cursor-pointer text-[10px] text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <RotateCcw size={11} />
            </button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-2 gap-1">
          {GRADE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() =>
                setGrade(preset.id === "none" ? null : preset.grade, target)
              }
              className="flex cursor-pointer flex-col gap-1 rounded-lg border border-zinc-200 p-1.5 text-[10px] font-medium text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800/60"
            >
              <Swatch grade={preset.grade} />
              <span className="truncate text-left">{preset.label}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Adjust">
        <Row label="Exposure">
          <Slider
            value={grade.exposure}
            min={-1}
            max={1}
            step={0.05}
            onChange={(exposure) => set({ exposure })}
            format={(v) => v.toFixed(2)}
          />
        </Row>
        <Row label="Contrast">
          <Slider
            value={grade.contrast}
            min={-1}
            max={1}
            step={0.05}
            onChange={(contrast) => set({ contrast })}
            format={(v) => v.toFixed(2)}
          />
        </Row>
        <Row label="Saturation">
          <Slider
            value={grade.saturation}
            min={-1}
            max={1}
            step={0.05}
            onChange={(saturation) => set({ saturation })}
            format={(v) => v.toFixed(2)}
          />
        </Row>
        <Row label="Warmth">
          <Slider
            value={grade.temperature}
            min={-1}
            max={1}
            step={0.05}
            onChange={(temperature) => set({ temperature })}
            format={(v) => v.toFixed(2)}
          />
        </Row>
        <Row label="Tint">
          <Slider
            value={grade.tint}
            min={-1}
            max={1}
            step={0.05}
            onChange={(tint) => set({ tint })}
            format={(v) => v.toFixed(2)}
          />
        </Row>
      </Section>

      <Section title="Lens">
        <Row label="Vignette">
          <Slider
            value={grade.vignette}
            min={0}
            max={1}
            step={0.05}
            onChange={(vignette) => set({ vignette })}
            format={(v) => v.toFixed(2)}
          />
        </Row>
        <Row label="Grain">
          <Slider
            value={grade.grain}
            min={0}
            max={1}
            step={0.05}
            onChange={(grain) => set({ grain })}
            format={(v) => v.toFixed(2)}
          />
        </Row>
      </Section>

      {shot && (
        <Section title="This shot">
          <Segmented
            value={scoped ? "own" : "project"}
            options={[
              { value: "project", label: "Match video", title: "Use the project look" },
              { value: "own", label: "Its own", title: "Grade this shot separately" },
            ]}
            onChange={(choice) => {
              if (choice === "own") {
                // Seeded from the project's look rather than from neutral, so
                // "its own" starts as a match and becomes a difference — which
                // is how a mismatched cutaway is actually corrected.
                setGrade(withGradeDefaults(projectGrade ?? NEUTRAL_GRADE), shot.id);
              } else {
                useOverlayStore.getState().updateShot(shot.id, { grade: undefined });
              }
            }}
          />
          <p className="px-1 pt-1 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-600">
            One look across the whole video is what makes separate clips read as
            one piece. Grade a shot on its own only when it was filmed on a
            different camera.
          </p>
        </Section>
      )}
    </div>
  );
}
