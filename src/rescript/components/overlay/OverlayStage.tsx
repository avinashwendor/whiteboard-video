"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditorStore } from "@/rescript/lib/store";
import { getCutRanges, originalToEdited } from "@/rescript/lib/edits";
import { useOverlayStore } from "@/rescript/lib/overlay/store";
import { paintFrame } from "@/rescript/lib/overlay/frame";
import { loadImage } from "@/rescript/lib/overlay/render";
import { transitionAt } from "@/rescript/lib/overlay/timeline";
import { useOutputTimeline } from "@/rescript/hooks/useOverlayTimeline";
import type { OverlayElement, Rect } from "@/rescript/lib/overlay/types";

/**
 * The picture.
 *
 * The `<video>` stays in the tree — it is the playback engine and the audio —
 * but it is not what you look at. A canvas over it draws every frame through
 * the same `paintFrame` the exporter uses, which is the only way a preview can
 * honestly promise that the file will match. Interaction (select, drag, resize,
 * rotate, drop) happens in a DOM layer above the canvas, where hit targets can
 * be real elements with real cursors instead of hand-rolled hit tests.
 */

/** Handles, in the order they are drawn. */
const HANDLES = [
  { id: "nw", x: 0, y: 0, cursor: "nwse-resize" },
  { id: "n", x: 0.5, y: 0, cursor: "ns-resize" },
  { id: "ne", x: 1, y: 0, cursor: "nesw-resize" },
  { id: "e", x: 1, y: 0.5, cursor: "ew-resize" },
  { id: "se", x: 1, y: 1, cursor: "nwse-resize" },
  { id: "s", x: 0.5, y: 1, cursor: "ns-resize" },
  { id: "sw", x: 0, y: 1, cursor: "nesw-resize" },
  { id: "w", x: 0, y: 0.5, cursor: "ew-resize" },
] as const;

type HandleId = (typeof HANDLES)[number]["id"];

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN_SIZE = 0.02;

/** Snap to the frame's centre lines and thirds when within this fraction. */
const SNAP = 0.012;

function snapValue(value: number, targets: number[]): number {
  for (const target of targets) {
    if (Math.abs(value - target) < SNAP) return target;
  }
  return value;
}

export default function OverlayStage({
  onBackgroundClick,
}: {
  /** Clicking bare frame with nothing selected plays/pauses, as it used to. */
  onBackgroundClick?: () => void;
}) {
  const videoEl = useEditorStore((s) => s.videoEl);
  const words = useEditorStore((s) => s.words);
  const duration = useEditorStore((s) => s.duration);
  const manualCuts = useEditorStore((s) => s.manualCuts);

  const elements = useOverlayStore((s) => s.elements);
  const subtitles = useOverlayStore((s) => s.subtitles);
  const transitions = useOverlayStore((s) => s.transitions);
  const selectedId = useOverlayStore((s) => s.selectedId);
  const select = useOverlayStore((s) => s.select);
  const setAspect = useOverlayStore((s) => s.setAspect);

  const timeline = useOutputTimeline();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({
    x: [],
    y: [],
  });

  const freezeCache = useRef(new Map<number, HTMLCanvasElement>());

  // Live values for the animation frame, which must not re-subscribe per frame.
  const live = useRef({ elements, subtitles, transitions, timeline, words, duration, manualCuts });
  useEffect(() => {
    live.current = { elements, subtitles, transitions, timeline, words, duration, manualCuts };
  }, [elements, subtitles, transitions, timeline, words, duration, manualCuts]);

  /* ------------------------------ geometry ------------------------------- */

  // Track exactly where the video is painted inside the host so the canvas and
  // the handle layer sit on the same pixels at any window size.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!videoEl || !host) return;

    const measure = () => {
      const hostRect = host.getBoundingClientRect();
      const videoRect = videoEl.getBoundingClientRect();
      if (!videoRect.width || !videoRect.height) return;
      setBox({
        left: videoRect.left - hostRect.left,
        top: videoRect.top - hostRect.top,
        width: videoRect.width,
        height: videoRect.height,
      });
      // The store types the element as HTMLMediaElement because audio-only
      // projects mount an <audio>; this stage only ever renders for video.
      const asVideo = videoEl as HTMLVideoElement;
      if (asVideo.videoWidth && asVideo.videoHeight) {
        setAspect(asVideo.videoWidth / asVideo.videoHeight);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(videoEl);
    observer.observe(host);
    videoEl.addEventListener("loadedmetadata", measure);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      videoEl.removeEventListener("loadedmetadata", measure);
      window.removeEventListener("resize", measure);
    };
  }, [videoEl, setAspect]);

  /* -------------------------------- paint -------------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box) return;

    // Cap the backing store: a retina 4K preview costs more to paint every
    // frame than it adds to what anyone can see at this size.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(2, Math.round(box.width * dpr));
    const height = Math.max(2, Math.round(box.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let raf = 0;
    let paintFailures = 0;
    const size = { width, height };

    const tick = () => {
      const state = live.current;
      const video = useEditorStore.getState().videoEl as HTMLVideoElement | null;
      const cuts = getCutRanges(state.words, state.duration, state.manualCuts);
      const t = originalToEdited(
        video?.currentTime ?? useEditorStore.getState().currentTime,
        cuts
      );

      const active = transitionAt(t, state.timeline, state.transitions);
      let freeze: HTMLCanvasElement | null = null;
      
      if (video && video.videoWidth && video.videoHeight) {
        // Buffer freeze frames for upcoming push transitions without stalling playback.
        for (const spec of state.transitions) {
          const boundary = state.timeline.boundaries.find((b) => b.index === spec.index);
          if (!boundary) continue;

          // Capture the frame when we are playing through the last 0.15s of the outgoing clip
          if (t >= boundary.outTime - 0.15 && t < boundary.outTime) {
            let canvas = freezeCache.current.get(boundary.index);
            if (!canvas) {
              canvas = document.createElement("canvas");
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              freezeCache.current.set(boundary.index, canvas);
            }
            const ctxCanvas = canvas.getContext("2d", { alpha: false });
            if (ctxCanvas) {
              ctxCanvas.drawImage(video, 0, 0, canvas.width, canvas.height);
            }
          }
        }

        if (active && active.family === "push") {
          freeze = freezeCache.current.get(active.boundary.index) ?? null;
        }
      }

      // A throw here used to end the preview: the exception escaped the frame
      // callback, no further frame was ever scheduled, and the canvas simply
      // froze on whatever it had last painted. Canvas2D throws on any non-finite geometry,
      // so the loop keeps going and reports instead.
      try {
        paintFrame(
          ctx,
          size,
          { live: video && video.videoWidth ? video : null, freeze },
          active,
          {
            elements: state.elements,
            subtitles: state.subtitles,
            transitions: state.transitions,
          },
          t
        );
        paintFailures = 0;
      } catch (err) {
        paintFailures += 1;
        if (paintFailures === 1 || paintFailures % 120 === 0) {
          console.error("[overlay] frame failed to paint", err);
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [box]);

  /* ------------------------------ interaction ----------------------------- */

  const toRect = useCallback(
    (rect: Rect): Box => ({
      left: rect.x * (box?.width ?? 0),
      top: rect.y * (box?.height ?? 0),
      width: rect.w * (box?.width ?? 0),
      height: rect.h * (box?.height ?? 0),
    }),
    [box]
  );

  const outputTime = useCallback(() => {
    const state = useEditorStore.getState();
    const cuts = getCutRanges(state.words, state.duration, state.manualCuts);
    return originalToEdited(state.videoEl?.currentTime ?? state.currentTime, cuts);
  }, []);

  const startDrag = useCallback(
    (
      event: React.PointerEvent,
      element: OverlayElement,
      mode: "move" | "rotate" | HandleId
    ) => {
      if (!box || element.locked) return;
      event.preventDefault();
      event.stopPropagation();
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

      const store = useOverlayStore.getState();
      store.select(element.id);
      store.beginGesture();

      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { ...element.rect };
      const originRotation = element.rotation;
      const centreX = origin.x + origin.w / 2;
      const centreY = origin.y + origin.h / 2;

      const move = (e: PointerEvent) => {
        const dx = (e.clientX - startX) / box.width;
        const dy = (e.clientY - startY) / box.height;

        if (mode === "rotate") {
          const hostRect = hostRef.current!.getBoundingClientRect();
          const cx = hostRect.left + box.left + centreX * box.width;
          const cy = hostRect.top + box.top + centreY * box.height;
          const angle =
            (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
          // Shift snaps to 15° so "straight" and "a nice tilt" are both easy.
          const snapped = e.shiftKey ? Math.round(angle / 15) * 15 : angle;
          useOverlayStore
            .getState()
            .updateElement(element.id, { rotation: Math.round(snapped) });
          return;
        }

        if (mode === "move") {
          let x = origin.x + dx;
          let y = origin.y + dy;
          const hits: { x: number[]; y: number[] } = { x: [], y: [] };
          if (!e.altKey) {
            // Snap the element's centre, not its corner: centring on the frame
            // is the alignment people actually want.
            const centred = snapValue(x + origin.w / 2, [0.5]) - origin.w / 2;
            if (centred !== x) {
              x = centred;
              hits.x.push(0.5);
            }
            const middled = snapValue(y + origin.h / 2, [0.5]) - origin.h / 2;
            if (middled !== y) {
              y = middled;
              hits.y.push(0.5);
            }
            const edgedX = snapValue(x, [0.05, 1 - 0.05 - origin.w]);
            if (edgedX !== x) {
              x = edgedX;
              hits.x.push(x < 0.5 ? 0.05 : 1 - 0.05);
            }
            const edgedY = snapValue(y, [0.05, 1 - 0.05 - origin.h, 0.66, 0.14]);
            if (edgedY !== y) {
              y = edgedY;
              hits.y.push(y + (y > 0.5 ? 0 : origin.h * 0));
            }
          }
          setGuides(hits);
          useOverlayStore
            .getState()
            .updateElement(element.id, { rect: { ...origin, x, y } });
          return;
        }

        // Resize: each handle moves the edges it owns, keeping the opposite
        // ones pinned. Shift keeps the aspect from the corner handles.
        let { x, y, w, h } = origin;
        const id = mode as HandleId;
        if (id.includes("w")) {
          const nx = Math.min(origin.x + dx, origin.x + origin.w - MIN_SIZE);
          w = origin.w + (origin.x - nx);
          x = nx;
        }
        if (id.includes("e")) w = Math.max(MIN_SIZE, origin.w + dx);
        if (id.includes("n")) {
          const ny = Math.min(origin.y + dy, origin.y + origin.h - MIN_SIZE);
          h = origin.h + (origin.y - ny);
          y = ny;
        }
        if (id.includes("s")) h = Math.max(MIN_SIZE, origin.h + dy);

        if (e.shiftKey && id.length === 2) {
          const ratio = origin.h / Math.max(MIN_SIZE, origin.w);
          h = w * ratio;
          if (id.includes("n")) y = origin.y + origin.h - h;
        }

        // Type scales with its box, or resizing a caption would only change
        // where it wraps.
        const scaled =
          element.kind === "text" && origin.h > 0
            ? {
                fontSize: Math.max(
                  0.012,
                  Math.min(0.4, element.fontSize * (h / origin.h))
                ),
              }
            : {};
        useOverlayStore
          .getState()
          .updateElement(element.id, { rect: { x, y, w, h }, ...scaled });
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setGuides({ x: [], y: [] });
        useOverlayStore.getState().endGesture();
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      void originRotation;
    },
    [box]
  );

  /* --------------------------------- drop --------------------------------- */

  const acceptDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setDropping(false);
      if (!box) return;

      const store = useOverlayStore.getState();
      const at = outputTime();
      const rect = hostRef.current?.getBoundingClientRect();
      const x = rect ? (event.clientX - rect.left - box.left) / box.width : 0.5;
      const y = rect ? (event.clientY - rect.top - box.top) / box.height : 0.5;

      // Something dragged out of the AI tray or the layer list.
      const url = event.dataTransfer.getData("application/x-rescript-image");
      if (url) {
        const w = 0.34;
        store.addImage(url, {
          start: at,
          end: at + 4,
          rect: { x: clampPlace(x - w / 2), y: clampPlace(y - w / 2), w, h: w },
          origin: "generated",
        });
        void fitDroppedImage(url, w, store.aspect);
        return;
      }

      const files = Array.from(event.dataTransfer.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      );
      for (const file of files) {
        const objectUrl = URL.createObjectURL(file);
        const w = 0.34;
        const id = store.addImage(objectUrl, {
          name: file.name.slice(0, 28),
          start: at,
          end: at + 4,
          rect: { x: clampPlace(x - w / 2), y: clampPlace(y - w / 2), w, h: w },
          origin: "upload",
        });
        void fitDroppedImage(objectUrl, w, store.aspect, id);
      }
    },
    [box, outputTime]
  );

  /* -------------------------------- render -------------------------------- */

  const t = useOutputTimeVisible();
  const selected = elements.find((e) => e.id === selectedId) ?? null;
  const visible = selected && t >= selected.start && t < selected.end;

  return (
    <div
      ref={hostRef}
      className="pointer-events-none absolute inset-0"
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={acceptDrop}
      style={{ pointerEvents: "auto" }}
    >
      {box && (
        <>
          <canvas
            ref={canvasRef}
            className="absolute rounded-sm"
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
            }}
          />

          {/* Interaction layer, exactly over the canvas. */}
          <div
            className="absolute"
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
            }}
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return;
              setEditingId(null);
              // First click clears the selection; a click on already-bare frame
              // means the person wants the player, not the canvas.
              if (useOverlayStore.getState().selectedId) select(null);
              else onBackgroundClick?.();
            }}
          >
            {elements
              .filter((e) => !e.hidden && t >= e.start && t < e.end)
              .sort((a, b) => a.z - b.z)
              .map((element) => {
                const r = toRect(element.rect);
                return (
                  <div
                    key={element.id}
                    role="button"
                    tabIndex={-1}
                    aria-label={element.name}
                    onPointerDown={(e) => startDrag(e, element, "move")}
                    onDoubleClick={() => {
                      if (element.kind === "text") setEditingId(element.id);
                    }}
                    className={`absolute ${
                      element.locked ? "cursor-default" : "cursor-move"
                    } ${
                      selectedId === element.id
                        ? "outline outline-2 outline-indigo-400"
                        : "outline outline-1 outline-transparent hover:outline-indigo-300/60"
                    }`}
                    style={{
                      left: r.left,
                      top: r.top,
                      width: r.width,
                      height: r.height,
                      transform: element.rotation
                        ? `rotate(${element.rotation}deg)`
                        : undefined,
                    }}
                  />
                );
              })}

            {selected && visible && !selected.locked && (
              <Handles
                element={selected}
                box={toRect(selected.rect)}
                onStart={startDrag}
              />
            )}

            {guides.x.map((gx) => (
              <div
                key={`gx-${gx}`}
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-fuchsia-400/80"
                style={{ left: gx * box.width }}
              />
            ))}
            {guides.y.map((gy) => (
              <div
                key={`gy-${gy}`}
                className="pointer-events-none absolute right-0 left-0 h-px bg-fuchsia-400/80"
                style={{ top: gy * box.height }}
              />
            ))}

            {editingId && (
              <InlineTextEditor
                id={editingId}
                box={box}
                onDone={() => setEditingId(null)}
              />
            )}
          </div>

          {dropping && (
            <div
              className="pointer-events-none absolute rounded-sm border-2 border-dashed border-indigo-400 bg-indigo-500/10"
              style={{
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
              }}
            >
              <div className="flex h-full items-center justify-center text-[13px] font-medium text-indigo-200">
                Drop to place on the video
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function clampPlace(v: number): number {
  return Math.max(0.01, Math.min(0.99, v));
}

/** Correct a dropped image's height to its real aspect once it decodes. */
async function fitDroppedImage(
  src: string,
  w: number,
  aspect: number,
  id?: string
) {
  try {
    const img = await loadImage(src);
    const store = useOverlayStore.getState();
    const element = id
      ? store.elements.find((e) => e.id === id)
      : [...store.elements].reverse().find((e) => e.kind === "image" && e.src === src);
    if (!element || !img.naturalWidth) return;
    const h = Math.min(0.85, (w * aspect) / (img.naturalWidth / img.naturalHeight));
    store.updateElement(element.id, { rect: { ...element.rect, h } });
  } catch {
    // The canvas already draws a placeholder for a picture that never arrived.
  }
}

/** Output time, re-read every animation frame for the handle layer. */
function useOutputTimeVisible(): number {
  const currentTime = useEditorStore((s) => s.currentTime);
  const words = useEditorStore((s) => s.words);
  const duration = useEditorStore((s) => s.duration);
  const manualCuts = useEditorStore((s) => s.manualCuts);

  const cuts = useMemo(
    () => getCutRanges(words, duration, manualCuts),
    [words, duration, manualCuts],
  );
  return originalToEdited(currentTime, cuts);
}

function Handles({
  element,
  box,
  onStart,
}: {
  element: OverlayElement;
  box: Box;
  onStart: (
    e: React.PointerEvent,
    element: OverlayElement,
    mode: "move" | "rotate" | HandleId
  ) => void;
}) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
      }}
    >
      {HANDLES.map((handle) => (
        <span
          key={handle.id}
          onPointerDown={(e) => onStart(e, element, handle.id)}
          className="pointer-events-auto absolute size-2.5 rounded-[3px] border border-white bg-indigo-500 shadow"
          style={{
            left: `calc(${handle.x * 100}% - 5px)`,
            top: `calc(${handle.y * 100}% - 5px)`,
            cursor: handle.cursor,
          }}
        />
      ))}
      <span
        onPointerDown={(e) => onStart(e, element, "rotate")}
        title="Rotate — hold Shift to snap"
        className="pointer-events-auto absolute size-3 -translate-x-1/2 cursor-grab rounded-full border border-white bg-fuchsia-500 shadow"
        style={{ left: "50%", top: -22 }}
      />
      <span
        className="pointer-events-none absolute left-1/2 h-4 w-px -translate-x-1/2 bg-fuchsia-400/70"
        style={{ top: -18 }}
      />
    </div>
  );
}

/** Edit a text element in place, over the canvas, at its real size. */
function InlineTextEditor({
  id,
  box,
  onDone,
}: {
  id: string;
  box: Box;
  onDone: () => void;
}) {
  const element = useOverlayStore((s) => s.elements.find((e) => e.id === id));
  const updateElement = useOverlayStore((s) => s.updateElement);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (!element || element.kind !== "text") return null;

  return (
    <textarea
      ref={ref}
      value={element.text}
      onChange={(e) =>
        updateElement(id, { text: e.target.value, name: e.target.value.slice(0, 28) })
      }
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          onDone();
        }
        e.stopPropagation();
      }}
      spellCheck={false}
      className="absolute resize-none rounded-sm border-2 border-indigo-400 bg-black/70 text-center outline-none"
      style={{
        left: element.rect.x * box.width,
        top: element.rect.y * box.height,
        width: element.rect.w * box.width,
        height: element.rect.h * box.height,
        fontSize: element.fontSize * box.height,
        lineHeight: element.lineHeight,
        fontWeight: element.fontWeight,
        color: element.color,
        fontFamily: element.fontFamily,
        textAlign: element.align,
      }}
    />
  );
}
