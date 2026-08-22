"use client";

import { useCallback, useMemo } from "react";
import { Captions, Image as ImageIcon, Shapes, Type } from "lucide-react";
import { useOverlayStore } from "@/rescript/lib/overlay/store";
import {
  outputRangeToSource,
  type OutputTimeline,
} from "@/rescript/lib/overlay/timeline";
import type { OverlayElement } from "@/rescript/lib/overlay/types";

/**
 * The composition, drawn on the timeline.
 *
 * Elements live on the *output* clock and the timeline is drawn on the
 * *source* clock, so each one is mapped back through the kept ranges before it
 * is placed. That mapping can return more than one span — an element that spans
 * a cut really does occupy two separate stretches of the file — and drawing all
 * of them is the honest picture: it shows exactly which footage the caption
 * covers.
 *
 * Bars can be dragged along the lane to retime an element and pulled by either
 * edge to change how long it stays up.
 */

const ROW_H = 13;
const ROW_GAP = 2;
const MAX_ROWS = 4;
const SUBTITLE_ROW_H = 9;

const TONE: Record<OverlayElement["kind"], { bar: string; ring: string }> = {
  text: {
    bar: "bg-indigo-500/85 hover:bg-indigo-500",
    ring: "ring-indigo-300 dark:ring-indigo-400",
  },
  image: {
    bar: "bg-emerald-500/85 hover:bg-emerald-500",
    ring: "ring-emerald-300 dark:ring-emerald-400",
  },
  shape: {
    bar: "bg-amber-500/85 hover:bg-amber-500",
    ring: "ring-amber-300 dark:ring-amber-400",
  },
};

const ICON: Record<OverlayElement["kind"], typeof Type> = {
  text: Type,
  image: ImageIcon,
  shape: Shapes,
};

export interface OverlayTrackProps {
  /** Pixels per second of *source* time, matching the rest of the timeline. */
  pps: number;
  /** Distance from the top of the track to this lane. */
  top: number;
  timeline: OutputTimeline;
}

/** Height this lane needs, so the caller can reserve room for it. */
export function overlayLaneHeight(rows: number, hasSubtitles: boolean): number {
  const used = Math.min(Math.max(rows, 0), MAX_ROWS);
  if (!used && !hasSubtitles) return 0;
  return used * (ROW_H + ROW_GAP) + (hasSubtitles ? SUBTITLE_ROW_H + ROW_GAP : 0);
}

export default function OverlayTrack({ pps, top, timeline }: OverlayTrackProps) {
  const elements = useOverlayStore((s) => s.elements);
  const subtitles = useOverlayStore((s) => s.subtitles);
  const selectedId = useOverlayStore((s) => s.selectedId);
  const select = useOverlayStore((s) => s.select);

  const ordered = useMemo(
    () => [...elements].sort((a, b) => a.start - b.start || a.z - b.z),
    [elements]
  );

  /** Drag a bar to retime, or an edge to trim. */
  const startDrag = useCallback(
    (
      event: React.PointerEvent,
      element: OverlayElement,
      mode: "move" | "start" | "end"
    ) => {
      event.preventDefault();
      event.stopPropagation();
      if (element.locked) return;

      const store = useOverlayStore.getState();
      store.select(element.id);
      store.beginGesture();

      const originX = event.clientX;
      const from = element.start;
      const to = element.end;
      const limit = timeline.duration || to;

      const move = (e: PointerEvent) => {
        const delta = (e.clientX - originX) / pps;
        if (mode === "move") {
          const length = to - from;
          const start = Math.max(0, Math.min(from + delta, limit - length));
          useOverlayStore
            .getState()
            .updateElement(element.id, { start, end: start + length });
          return;
        }
        if (mode === "start") {
          const start = Math.max(0, Math.min(from + delta, to - 0.2));
          useOverlayStore.getState().updateElement(element.id, { start });
          return;
        }
        const end = Math.min(limit, Math.max(to + delta, from + 0.2));
        useOverlayStore.getState().updateElement(element.id, { end });
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        useOverlayStore.getState().endGesture();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [pps, timeline.duration]
  );

  if (!ordered.length && !(subtitles.enabled && subtitles.cues.length)) {
    return null;
  }

  const rowCount = Math.min(ordered.length, MAX_ROWS);

  return (
    <div
      className="pointer-events-none absolute right-0 left-0 z-[7]"
      style={{ top }}
    >
      {ordered.map((element, index) => {
        const spans = outputRangeToSource(
          element.start,
          element.end,
          timeline.keepRanges
        );
        if (!spans.length) return null;

        const row = index % MAX_ROWS;
        const y = row * (ROW_H + ROW_GAP);
        const tone = TONE[element.kind];
        const Icon = ICON[element.kind];
        const selected = selectedId === element.id;

        return spans.map((span, part) => {
          const left = span.start * pps;
          const width = Math.max(3, (span.end - span.start) * pps);
          // Only the first piece carries the label and the trim handles: the
          // rest are the same element continuing on the far side of a cut.
          const lead = part === 0;
          const tail = part === spans.length - 1;

          return (
            <div
              key={`${element.id}-${part}`}
              data-tl-interactive
              role="button"
              tabIndex={-1}
              title={`${element.name} · ${element.start.toFixed(1)}s–${element.end.toFixed(1)}s`}
              onPointerDown={(e) => startDrag(e, element, "move")}
              onClick={(e) => {
                e.stopPropagation();
                select(element.id);
              }}
              className={`pointer-events-auto absolute flex items-center gap-1 overflow-hidden rounded-[3px] px-1 transition ${
                tone.bar
              } ${element.hidden ? "opacity-35" : ""} ${
                element.locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"
              } ${selected ? `ring-2 ${tone.ring}` : ""}`}
              style={{ left, width, top: y, height: ROW_H }}
            >
              {lead && width > 34 && (
                <>
                  <Icon size={8} className="shrink-0 text-white/90" />
                  <span className="truncate text-[9px] leading-none font-medium text-white">
                    {element.kind === "text" ? element.text : element.name}
                  </span>
                </>
              )}

              {lead && !element.locked && width > 12 && (
                <span
                  onPointerDown={(e) => startDrag(e, element, "start")}
                  title="Drag to change when it appears"
                  className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
                />
              )}
              {tail && !element.locked && width > 12 && (
                <span
                  onPointerDown={(e) => startDrag(e, element, "end")}
                  title="Drag to change when it goes away"
                  className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
                />
              )}
            </div>
          );
        });
      })}

      {subtitles.enabled && subtitles.cues.length > 0 && (
        <div
          className="pointer-events-none absolute right-0 left-0"
          style={{ top: rowCount * (ROW_H + ROW_GAP), height: SUBTITLE_ROW_H }}
        >
          {subtitles.cues.map((cue) => {
            const spans = outputRangeToSource(
              cue.start,
              cue.end,
              timeline.keepRanges
            );
            return spans.map((span, part) => (
              <div
                key={`${cue.id}-${part}`}
                title={cue.text}
                className="absolute rounded-[2px] bg-sky-500/70"
                style={{
                  left: span.start * pps,
                  width: Math.max(2, (span.end - span.start) * pps),
                  top: 0,
                  height: SUBTITLE_ROW_H,
                }}
              />
            ));
          })}
          <Captions
            size={8}
            className="sticky left-0.5 text-sky-600 dark:text-sky-400"
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}
