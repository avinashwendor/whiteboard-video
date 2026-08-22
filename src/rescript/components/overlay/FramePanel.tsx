"use client";

import { useCallback, useMemo, useRef } from "react";
import { Crop, Maximize2, RotateCcw } from "lucide-react";
import { useEditorStore } from "@/rescript/lib/store";
import { useOverlayStore } from "@/rescript/lib/overlay/store";
import { outputSize } from "@/rescript/lib/overlay/compose";
import { regenerateCues } from "@/rescript/lib/overlay/ops";
import {
  DEFAULT_FRAME,
  FRAME_ASPECTS,
  frameRatio,
  type FrameAspectId,
  type FrameBackground,
  type FrameFit,
} from "@/rescript/lib/overlay/types";
import { Button, Row, Section, Segmented, Slider } from "./ui";

/**
 * The shape of the finished video, and where the footage sits inside it.
 *
 * This is the panel a vertical deliverable actually needs. Everything in the
 * composition is already in fractions of the frame, so changing the frame moves
 * the captions with the picture rather than leaving them where the old shape
 * put them — the reframe is a property of the project, not a crop applied at
 * the end.
 */
export default function FramePanel() {
  const frame = useOverlayStore((s) => s.frame);
  const setFrame = useOverlayStore((s) => s.setFrame);
  const sourceAspect = useOverlayStore((s) => s.sourceAspect);
  const mediaKind = useEditorStore((s) => s.mediaKind);

  /**
   * Changing the shape re-wraps the captions.
   *
   * Cue text is broken to a line length that fits the frame, so a project taken
   * from widescreen to vertical keeps captions cut for a frame it no longer
   * has — three words too long, every one of them. Rebuilding is cheap and the
   * timings come straight back off the transcript, so it is done rather than
   * announced.
   */
  const applyAspect = useCallback(
    (aspect: FrameAspectId) => {
      setFrame({ aspect });
      const subtitles = useOverlayStore.getState().subtitles;
      if (subtitles.cues.length) regenerateCues();
    },
    [setFrame]
  );

  const ratio = frameRatio(frame, sourceAspect);
  const cropping = frame.fit === "cover" && Math.abs(ratio - sourceAspect) > 0.01;

  const size = useMemo(() => {
    const videoEl = useEditorStore.getState().videoEl as HTMLVideoElement | null;
    return outputSize(
      ratio,
      videoEl?.videoWidth || 1920,
      videoEl?.videoHeight || 1080
    );
  }, [ratio]);

  if (mediaKind === "audio") {
    return (
      <div className="p-3 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        This project is audio only, so there is no frame to shape.
      </div>
    );
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <Section
        title="Output frame"
        action={
          <span className="text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
            {size.width}×{size.height}
          </span>
        }
      >
        <div className="grid grid-cols-4 gap-1">
          {FRAME_ASPECTS.map((option) => {
            const on = frame.aspect === option.id;
            return (
              <button
                key={option.id}
                type="button"
                title={option.hint}
                onClick={() => applyAspect(option.id)}
                className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-1 py-1.5 transition ${
                  on
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                <AspectGlyph
                  ratio={option.ratio ?? sourceAspect}
                  active={on}
                />
                <span className="text-[9.5px] leading-none font-medium">
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {frame.aspect === "source"
            ? "The video keeps the shape it was shot in."
            : FRAME_ASPECTS.find((a) => a.id === frame.aspect)?.hint}
        </p>
      </Section>

      <Section title="How the footage fits">
        <Row label="Fit">
          <Segmented<FrameFit>
            value={frame.fit}
            options={[
              { value: "cover", label: "Fill", title: "Crop to fill the frame" },
              {
                value: "contain",
                label: "Fit",
                title: "Show the whole picture, fill the rest",
              },
            ]}
            onChange={(fit) => setFrame({ fit })}
          />
        </Row>

        {frame.fit === "contain" && (
          <Row label="Backdrop">
            <Segmented<FrameBackground>
              value={frame.background}
              options={[
                { value: "blur", label: "Blur" },
                { value: "black", label: "Black" },
                { value: "white", label: "White" },
              ]}
              onChange={(background) => setFrame({ background })}
            />
          </Row>
        )}

        <Row label="Zoom" hint="Scale the picture inside the frame">
          <Slider
            value={frame.zoom}
            min={1}
            max={3}
            step={0.01}
            onChange={(zoom) => setFrame({ zoom })}
            format={(v) => `${v.toFixed(2)}×`}
          />
        </Row>
      </Section>

      <Section
        title="Focus"
        action={
          <Button
            title="Back to the centre"
            onClick={() =>
              setFrame({
                zoom: 1,
                focusX: DEFAULT_FRAME.focusX,
                focusY: DEFAULT_FRAME.focusY,
              })
            }
          >
            <RotateCcw size={11} />
            Centre
          </Button>
        }
      >
        <FocusPad
          sourceAspect={sourceAspect}
          frameRatioValue={ratio}
          zoom={frame.zoom}
          fit={frame.fit}
          x={frame.focusX}
          y={frame.focusY}
          onChange={(focusX, focusY) => setFrame({ focusX, focusY })}
        />
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {cropping ? (
            <>
              <Crop size={11} className="mt-0.5 shrink-0" />
              <span>
                Drag the box to choose what stays in shot. Everything outside it
                is cropped away.
              </span>
            </>
          ) : (
            <>
              <Maximize2 size={11} className="mt-0.5 shrink-0" />
              <span>
                Nothing is being cropped at this frame and zoom, so the focus
                point has nothing to choose between.
              </span>
            </>
          )}
        </p>
      </Section>
    </div>
  );
}

/** A small outline of an aspect ratio, for the picker buttons. */
function AspectGlyph({ ratio, active }: { ratio: number; active: boolean }) {
  const safe = ratio > 0 ? ratio : 16 / 9;
  const height = 15;
  const width = Math.max(6, Math.min(26, height * safe));
  return (
    <span
      aria-hidden
      className={`block rounded-[2px] border ${
        active
          ? "border-white/80 dark:border-zinc-900/70"
          : "border-zinc-400 dark:border-zinc-500"
      }`}
      style={{ width, height }}
    />
  );
}

/**
 * Pick the point of the source held in the middle of the frame, by dragging.
 *
 * Drawn as the source's rectangle with the visible frame marked inside it,
 * because that is the question being answered — "which part of what I shot ends
 * up on screen" — and a pair of X/Y sliders makes you solve it twice in your
 * head.
 */
function FocusPad({
  sourceAspect,
  frameRatioValue,
  zoom,
  fit,
  x,
  y,
  onChange,
}: {
  sourceAspect: number;
  frameRatioValue: number;
  zoom: number;
  fit: FrameFit;
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const beginGesture = useOverlayStore((s) => s.beginGesture);
  const endGesture = useOverlayStore((s) => s.endGesture);

  // The visible window, as a fraction of the source picture.
  //
  // Under "cover" the frame crops whichever axis is proportionally longer; a
  // 16:9 source in a 9:16 frame keeps 9/16 ÷ 16/9 = 32% of its width and all of
  // its height. Zoom shrinks the window on both axes. Under "fit" nothing is
  // cropped until the zoom passes 1.
  const view = useMemo(() => {
    const source = sourceAspect > 0 ? sourceAspect : 16 / 9;
    const target = frameRatioValue > 0 ? frameRatioValue : source;
    const w = (fit === "cover" ? Math.min(1, target / source) : 1) / zoom;
    const h = (fit === "cover" ? Math.min(1, source / target) : 1) / zoom;
    return { w: Math.min(1, w), h: Math.min(1, h) };
  }, [sourceAspect, frameRatioValue, fit, zoom]);

  const apply = useCallback(
    (clientX: number, clientY: number) => {
      const host = ref.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = (clientX - rect.left) / rect.width;
      const ny = (clientY - rect.top) / rect.height;
      // The centre of the window cannot leave the window's own half-size, or it
      // would ask to show source that is not there.
      const halfW = view.w / 2;
      const halfH = view.h / 2;
      onChange(
        Math.max(halfW, Math.min(1 - halfW, nx)),
        Math.max(halfH, Math.min(1 - halfH, ny))
      );
    },
    [onChange, view]
  );

  const start = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      // One undo step for the whole drag, like every other gesture here.
      beginGesture();
      apply(event.clientX, event.clientY);

      const move = (e: PointerEvent) => apply(e.clientX, e.clientY);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        endGesture();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [apply, beginGesture, endGesture]
  );

  const source = sourceAspect > 0 ? sourceAspect : 16 / 9;

  return (
    <div
      ref={ref}
      onPointerDown={start}
      className="relative w-full cursor-crosshair overflow-hidden rounded-lg border border-zinc-200 bg-[repeating-conic-gradient(#e4e4e7_0%_25%,#fafafa_0%_50%)] bg-[length:14px_14px] dark:border-zinc-700 dark:bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)]"
      style={{ aspectRatio: `${source}` }}
    >
      <div
        className="pointer-events-none absolute border-2 border-indigo-400 bg-indigo-400/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
        style={{
          left: `${(x - view.w / 2) * 100}%`,
          top: `${(y - view.h / 2) * 100}%`,
          width: `${view.w * 100}%`,
          height: `${view.h * 100}%`,
        }}
      />
    </div>
  );
}
