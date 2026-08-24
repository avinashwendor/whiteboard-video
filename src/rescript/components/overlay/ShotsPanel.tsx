"use client";

import { useCallback, useMemo } from "react";
import { Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useEditorStore } from "@/rescript/lib/store";
import { useOverlayStore } from "@/rescript/lib/overlay/store";
import { useOutputTime, useOutputTimeline } from "@/rescript/hooks/useOverlayTimeline";
import { cameraFor, fitCamera } from "@/rescript/lib/overlay/camera";
import { findBeats, placePunchIns } from "@/rescript/lib/overlay/emphasis";
import { regionsFor } from "@/rescript/lib/overlay/shots";
import {
  primaryPlate,
  regionCount,
  SHOT_LAYOUT_LABELS,
  type CameraKind,
  type Shot,
  type ShotLayout,
} from "@/rescript/lib/overlay/types";
import { Button, Empty, Row, Section, Segmented, Slider, formatSeconds } from "./ui";

/**
 * Shots: how the frame is divided, and how it moves.
 *
 * Laid out around the playhead rather than as a free-standing list, because a
 * shot is a decision about a moment — "here, tighter" — and a panel that makes
 * you type two timestamps to express that is a panel nobody opens twice.
 *
 * The layout picker is drawn rather than named. "splitLeft" and "splitRight"
 * are indistinguishable as words at this size and instantly obvious as two
 * rectangles, and the diagrams come from the same `regionsFor` the renderer
 * uses — so a layout cannot look like one thing here and draw as another.
 */

/** How long a shot is when it is made from the playhead alone. */
const DEFAULT_SHOT_S = 3.2;

const CAMERAS: { value: CameraKind; label: string; title: string }[] = [
  { value: "hold", label: "Hold", title: "No move" },
  { value: "punchIn", label: "In", title: "Push in and settle — emphasis" },
  { value: "punchOut", label: "Out", title: "Open up" },
  { value: "push", label: "Push", title: "A slow creep that should never be noticed" },
  { value: "snap", label: "Snap", title: "Hard cut to tighter, no travel" },
  { value: "kenBurns", label: "Burns", title: "Slow drift across the picture" },
];

const LAYOUTS = Object.keys(SHOT_LAYOUT_LABELS) as ShotLayout[];

/** A little diagram of a layout, drawn from the real region maths. */
function LayoutGlyph({ layout }: { layout: ShotLayout }) {
  // A landscape box, so the picture-in-picture bubble is drawn at the shape it
  // would actually have rather than at the shape of the panel.
  const size = { width: 32, height: 20 };
  const regions = regionsFor(layout, size, regionCount(layout, 2));
  return (
    <svg width={32} height={20} viewBox="0 0 32 20" aria-hidden className="shrink-0">
      {regions.map((r, i) => (
        <rect
          key={i}
          x={r.x * 32 + 0.5}
          y={r.y * 20 + 0.5}
          width={Math.max(1, r.w * 32 - 1)}
          height={Math.max(1, r.h * 20 - 1)}
          rx={layout === "pip" && i === 1 ? 2 : 1}
          className={
            i === 0
              ? "fill-zinc-300 dark:fill-zinc-600"
              : "fill-zinc-500 dark:fill-zinc-300"
          }
        />
      ))}
    </svg>
  );
}

export default function ShotsPanel() {
  const shots = useOverlayStore((s) => s.shots);
  const addShot = useOverlayStore((s) => s.addShot);
  const setLayout = useOverlayStore((s) => s.setLayout);
  const setCamera = useOverlayStore((s) => s.setCamera);
  const setPlate = useOverlayStore((s) => s.setPlate);
  const removeShot = useOverlayStore((s) => s.removeShot);
  const replaceShots = useOverlayStore((s) => s.replaceShots);

  const mediaKind = useEditorStore((s) => s.mediaKind);
  const playhead = useOutputTime();
  const timeline = useOutputTimeline();
  const duration = timeline.duration;

  /** The shot under the playhead — what every control below acts on. */
  const current = useMemo(
    () => shots.find((s) => playhead >= s.start && playhead < s.end) ?? null,
    [shots, playhead]
  );

  const add = useCallback(() => {
    const start = Math.max(0, Math.min(playhead, Math.max(0, duration - 0.4)));
    const end = Math.min(duration, start + DEFAULT_SHOT_S);
    if (end - start < 0.4) return;
    addShot({ start, end, layout: "full", plates: [primaryPlate()] });
  }, [addShot, playhead, duration]);

  /**
   * The same placement pass the agent's `autoPunchIns` runs.
   *
   * Shared deliberately: a button that placed zooms differently from the one
   * the prompt describes would make the agent's plans unreproducible by hand,
   * and "why did it do that" unanswerable.
   */
  const autoPunch = useCallback(() => {
    const editor = useEditorStore.getState();
    const beats = findBeats(editor.words, editor.duration, editor.manualCuts);
    const placed = placePunchIns(beats, { duration });
    if (placed.length === 0) return;

    const made: Shot[] = placed.map((p, i) => ({
      id: `auto-${Date.now().toString(36)}-${i}`,
      start: p.start,
      end: p.end,
      layout: "full" as const,
      plates: [
        {
          ...primaryPlate(),
          camera: fitCamera(cameraFor({ kind: "punchIn" }), p.end - p.start),
        },
      ],
    }));
    replaceShots([...shots, ...made]);
  }, [duration, replaceShots, shots]);

  if (mediaKind === "audio") {
    return (
      <div className="p-3 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        This project is audio only, so there is no frame to divide.
      </div>
    );
  }

  const plate = current?.plates[0];
  const camera = plate?.camera;

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <Section
        title="At the playhead"
        action={
          <span className="text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
            {formatSeconds(playhead)}
          </span>
        }
      >
        {current ? (
          <Row label="Shot">
            <span className="flex-1 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
              {formatSeconds(current.start)} – {formatSeconds(current.end)}
            </span>
            <Button
              variant="ghost"
              title="Remove this shot"
              onClick={() => removeShot(current.id)}
            >
              <Trash2 size={12} />
            </Button>
          </Row>
        ) : (
          <Button onClick={add} disabled={duration <= 0}>
            <Plus size={12} />
            Frame this moment
          </Button>
        )}
      </Section>

      {current && (
        <>
          <Section title="Layout">
            <div className="grid grid-cols-3 gap-1">
              {LAYOUTS.map((id) => {
                const on = current.layout === id;
                return (
                  <button
                    key={id}
                    type="button"
                    title={SHOT_LAYOUT_LABELS[id]}
                    onClick={() => setLayout(current.id, id)}
                    className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-1 py-1.5 text-[9px] font-medium transition ${
                      on
                        ? "border-zinc-900 bg-zinc-50 text-zinc-900 dark:border-zinc-100 dark:bg-zinc-800 dark:text-zinc-100"
                        : "border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
                    }`}
                  >
                    <LayoutGlyph layout={id} />
                    <span className="truncate">{SHOT_LAYOUT_LABELS[id].replace("Split — ", "")}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Camera">
            <Segmented
              value={camera?.kind ?? "hold"}
              options={CAMERAS}
              onChange={(kind) =>
                setCamera(
                  current.id,
                  0,
                  fitCamera(cameraFor({ kind }), current.end - current.start)
                )
              }
            />
            {camera && camera.kind !== "hold" && (
              <>
                <Row label="Amount">
                  <Slider
                    value={(camera.to.zoom - 1) / 0.18}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(amount) =>
                      setCamera(
                        current.id,
                        0,
                        fitCamera(
                          cameraFor({
                            kind: camera.kind,
                            amount,
                            focusX: camera.to.focusX,
                            focusY: camera.to.focusY,
                          }),
                          current.end - current.start
                        )
                      )
                    }
                    format={(v) => `${v.toFixed(1)}×`}
                  />
                </Row>
                <Row label="Fit">
                  <Segmented
                    value={plate?.fit ?? "cover"}
                    options={[
                      { value: "cover", label: "Fill" },
                      { value: "contain", label: "Fit" },
                    ]}
                    onChange={(fit) => setPlate(current.id, 0, { fit })}
                  />
                </Row>
              </>
            )}
          </Section>
        </>
      )}

      <Section title="Whole video">
        <Button onClick={autoPunch} disabled={duration <= 0}>
          <Wand2 size={12} />
          Punch in on the beats
        </Button>
        <p className="px-1 pt-1 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-600">
          Reads the delivery — pauses, figures, new thoughts, a change of
          speaker — and pushes in on the strongest, spaced so they stay emphasis
          rather than a tic.
        </p>
      </Section>

      <Section
        title={`Shots (${shots.length})`}
        action={
          shots.length > 0 ? (
            <button
              type="button"
              onClick={() => replaceShots([])}
              className="cursor-pointer text-[10px] text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Clear
            </button>
          ) : undefined
        }
      >
        {shots.length === 0 ? (
          <Empty>
            <Sparkles size={12} /> Nothing framed yet — the footage plays full
            frame, as shot.
          </Empty>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
            {shots.map((s) => {
              const on = s.id === current?.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() =>
                      // Shot times are on the output clock and `seekTo` takes
                      // source time; nudging in and letting the player's own
                      // cut-skipping land it is what the subtitle list does too.
                      useEditorStore.getState().seekTo(s.start)
                    }
                    className={`flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-[11px] transition ${
                      on
                        ? "bg-zinc-100 dark:bg-zinc-800"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                    }`}
                  >
                    <LayoutGlyph layout={s.layout} />
                    <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">
                      {SHOT_LAYOUT_LABELS[s.layout]}
                      {s.plates[0]?.camera.kind !== "hold" && (
                        <span className="text-zinc-400 dark:text-zinc-500">
                          {" · "}
                          {s.plates[0]?.camera.kind}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-zinc-400 dark:text-zinc-500">
                      {formatSeconds(s.start)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
