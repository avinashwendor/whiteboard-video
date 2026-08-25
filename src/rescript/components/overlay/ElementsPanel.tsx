"use client";

import { useCallback, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Lock,
  Search,
  Shapes,
  Sparkles,
  Trash2,
  Type,
  Unlock,
  Upload,
} from "lucide-react";
import { useOverlayStore } from "@/rescript/lib/overlay/store";
import { generateImage, searchPhoto } from "@/rescript/lib/overlay/ops";
import { loadImage } from "@/rescript/lib/overlay/render";
import { useOutputTime } from "@/rescript/hooks/useOverlayTimeline";
import {
  startAtPlayhead,
  TEXT_STYLES,
  TEXT_STYLE_LABELS,
} from "@/rescript/lib/overlay/presets";
import type { TextStyleName } from "@/rescript/lib/overlay/ops-schema";
import type { OverlayElement } from "@/rescript/lib/overlay/types";
import ShapePicker from "./ShapePicker";
import TemplatePicker from "./TemplatePicker";
import { Button, Empty, Section, Segmented, TextInput, formatSeconds } from "./ui";

/**
 * Everything that goes on top of the video, and where it comes from.
 *
 * The generator tray is deliberately a *tray* rather than a button that drops
 * something straight onto the frame: making a picture takes real seconds and
 * costs a real request, so what comes back is kept, re-usable, and placed by
 * dragging it exactly where it belongs.
 */

interface TrayItem {
  id: string;
  url: string;
  label: string;
  origin: "generated" | "search" | "upload";
}

const DEFAULT_SECONDS = 3.5;

export default function ElementsPanel() {
  const elements = useOverlayStore((s) => s.elements);
  const selectedId = useOverlayStore((s) => s.selectedId);
  const playhead = useOutputTime();
  const at = startAtPlayhead(playhead);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <AddSection at={at} />
      <TemplateSection at={at} />
      <MarkSection at={at} />
      <GeneratorSection at={at} />
      <LayerSection elements={elements} selectedId={selectedId} at={at} />
    </div>
  );
}

/* --------------------------------- adding --------------------------------- */

function AddSection({ at }: { at: number }) {
  const addText = useOverlayStore((s) => s.addText);
  const addShape = useOverlayStore((s) => s.addShape);
  const [style, setStyle] = useState<TextStyleName>("title");
  const fileRef = useRef<HTMLInputElement>(null);
  const addImage = useOverlayStore((s) => s.addImage);
  const aspect = useOverlayStore((s) => s.aspect);

  const placeFiles = useCallback(
    async (files: FileList | null) => {
      for (const file of Array.from(files ?? [])) {
        if (!file.type.startsWith("image/")) continue;
        const url = URL.createObjectURL(file);
        const w = 0.34;
        const id = addImage(url, {
          name: file.name.slice(0, 28),
          start: at,
          end: at + DEFAULT_SECONDS,
          rect: { x: 0.06, y: 0.1, w, h: w },
          origin: "upload",
        });
        try {
          const img = await loadImage(url);
          if (img.naturalWidth) {
            const h = Math.min(
              0.85,
              (w * aspect) / (img.naturalWidth / img.naturalHeight)
            );
            useOverlayStore.getState().updateElement(id, {
              rect: { x: 0.06, y: 0.1, w, h },
            });
          }
        } catch {
          // The canvas draws a placeholder; nothing else to do.
        }
      }
    },
    [addImage, at, aspect]
  );

  return (
    <Section title="Add">
      <div className="mb-2">
        <Segmented
          value={style}
          onChange={setStyle}
          options={(Object.keys(TEXT_STYLES) as TextStyleName[])
            .slice(0, 4)
            .map((id) => ({ value: id, label: TEXT_STYLE_LABELS[id] }))}
        />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Button
          onClick={() => {
            const { sizeScale, ...fields } = TEXT_STYLES[style];
            addText({
              text: TEXT_STYLE_LABELS[style],
              name: TEXT_STYLE_LABELS[style],
              start: at,
              end: at + DEFAULT_SECONDS,
              fontSize: 0.082 * (sizeScale ?? 1),
              ...fields,
            });
          }}
        >
          <Type size={13} /> Text
        </Button>
        <Button onClick={() => fileRef.current?.click()}>
          <Upload size={13} /> Image
        </Button>
        <Button
          onClick={() =>
            addShape({ start: at, end: at + DEFAULT_SECONDS })
          }
        >
          <Shapes size={13} /> Shape
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          void placeFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </Section>
  );
}

/* -------------------------------- templates -------------------------------- */

/**
 * The template library.
 *
 * Below "Add" rather than replacing it: the plain buttons are how you put an
 * unstyled box on the frame to type into, and a library is how you pick
 * something finished. Conflating the two would make every quick label a
 * decision about house style.
 */
function TemplateSection({ at }: { at: number }) {
  const addText = useOverlayStore((s) => s.addText);

  return (
    <Section title="Templates">
      <TemplatePicker
        onPick={(template) => {
          const { sizeScale, ...fields } = template.style;
          addText({
            text: template.sample,
            name: template.label,
            start: at,
            // A template's entrance can be most of a second, so a fixed
            // three-second life would leave some of them still arriving when
            // they begin to leave. Long enough that every one of them settles.
            end: at + Math.max(DEFAULT_SECONDS, template.enter.duration * 3),
            fontSize: 0.082 * (sizeScale ?? 1),
            enter: template.enter,
            exit: template.exit,
            ...fields,
          });
        }}
      />
    </Section>
  );
}

/* ---------------------------------- marks ---------------------------------- */

/**
 * Arrows, circles, ticks — and 1,776 icons behind the search box.
 *
 * Separate from the plain Shape button above, which makes a rectangle to put
 * something on. These are gestures you draw *at* the picture, and they arrive
 * with ink and no fill because that is what a mark is.
 */
function MarkSection({ at }: { at: number }) {
  const addShape = useOverlayStore((s) => s.addShape);

  return (
    <Section title="Marks & icons">
      <ShapePicker
        onPick={(name) =>
          addShape({
            shape: "path",
            pathName: name,
            name,
            start: at,
            end: at + DEFAULT_SECONDS,
            // `wipeRight` on a mark is the draw-on: the renderer reveals the
            // path along its own length rather than sliding a box over it.
            enter: { kind: "wipeRight", duration: 0.55, easing: "easeOut" },
          })
        }
      />
    </Section>
  );
}

/* ------------------------------- generation -------------------------------- */

/**
 * Search the openly-licensed catalogues and bring the results onto our origin.
 *
 * Several at once rather than one at a time: unlike a generated image, which
 * costs a real request and real seconds, a stock search returns a page and the
 * useful thing is to see them side by side. Only the first few are fetched
 * through the proxy — enough to fill the tray without pulling a dozen files
 * somebody may not want.
 */
async function searchStock(
  query: string,
  kind: "image" | "gif"
): Promise<TrayItem[]> {
  const res = await fetch("/api/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      kind,
      limit: 6,
      // Tenor's licence covers social use and not client work, so its results
      // are excluded from a commercial search — which is the default. Asking
      // for GIFs at all is asking for that catalogue.
      ...(kind === "gif" ? { allowNonCommercial: true } : {}),
    }),
  });
  const json = (await res.json()) as {
    success?: boolean;
    results?: { id: string; title: string; downloadUrl: string }[];
    error?: { message?: string };
  };
  if (!json.success) throw new Error(json.error?.message ?? "That search didn't work.");

  const found: TrayItem[] = [];
  for (const result of (json.results ?? []).slice(0, 6)) {
    const proxied = await fetch("/api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "fetch",
        url: result.downloadUrl,
        filename: result.title.slice(0, 40),
      }),
    });
    const asset = (await proxied.json()) as { success?: boolean; url?: string };
    // One that will not fetch is skipped rather than failing the search: five
    // results is a better answer than an error.
    if (asset.success && asset.url) {
      found.push({
        id: `${result.id}`,
        url: asset.url,
        label: result.title,
        origin: "search",
      });
    }
  }
  return found;
}



function GeneratorSection({ at }: { at: number }) {
  const [mode, setMode] = useState<"generate" | "search" | "stock" | "gif">(
    "generate"
  );
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tray, setTray] = useState<TrayItem[]>([]);
  const addImage = useOverlayStore((s) => s.addImage);
  const aspect = useOverlayStore((s) => s.aspect);

  const run = useCallback(async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Stock and GIF go through the media route, which searches the
      // openly-licensed catalogues and proxies the bytes onto our origin —
      // the same requirement every other picture here has, for the same
      // reason: a cross-origin image taints the canvas and kills the export.
      if (mode === "stock" || mode === "gif") {
        const found = await searchStock(text, mode === "gif" ? "gif" : "image");
        if (found.length === 0) {
          setError(
            mode === "gif"
              ? "Nothing came back. GIFs need TENOR_API_KEY on the server."
              : "Nothing came back. Try a broader word."
          );
          return;
        }
        setTray((prev) => [...found, ...prev].slice(0, 12));
        for (const item of found) void loadImage(item.url).catch(() => null);
        return;
      }

      const image =
        mode === "generate"
          ? await generateImage(text)
          : await searchPhoto(text, text);
      setTray((prev) => [
        {
          id: `${Date.now()}`,
          url: image.url,
          label: text,
          origin: mode === "generate" ? "generated" : "search",
        },
        ...prev.slice(0, 11),
      ]);
      void loadImage(image.url).catch(() => null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't come back.");
    } finally {
      setBusy(false);
    }
  }, [prompt, busy, mode]);

  const place = useCallback(
    async (item: TrayItem) => {
      const w = 0.34;
      const id = addImage(item.url, {
        name: item.label.slice(0, 28),
        start: at,
        end: at + DEFAULT_SECONDS,
        rect: { x: 0.6, y: 0.1, w, h: w },
        prompt: item.origin === "generated" ? item.label : undefined,
        origin: item.origin,
        enter: { kind: "pop", duration: 0.4, easing: "backOut" },
        exit: { kind: "fade", duration: 0.3, easing: "easeIn" },
      });
      try {
        const img = await loadImage(item.url);
        if (!img.naturalWidth) return;
        const h = Math.min(0.85, (w * aspect) / (img.naturalWidth / img.naturalHeight));
        const element = useOverlayStore.getState().elements.find((e) => e.id === id);
        if (element) {
          useOverlayStore
            .getState()
            .updateElement(id, { rect: { ...element.rect, h } });
        }
      } catch {
        // Placeholder already drawn.
      }
    },
    [addImage, at, aspect]
  );

  return (
    <Section title="Generate">
      <div className="mb-2">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "generate", label: "Artwork" },
            { value: "search", label: "Photo" },
            { value: "stock", label: "Stock" },
            { value: "gif", label: "GIF" },
          ]}
        />
      </div>
      <div className="mb-2">
        <TextInput
          value={prompt}
          onChange={setPrompt}
          multiline
          placeholder={
            mode === "generate"
              ? "a hand-drawn rocket, marker on white"
              : "golden gate bridge in fog"
          }
        />
      </div>
      <Button
        variant="solid"
        onClick={() => void run()}
        disabled={!prompt.trim() || busy}
        className="w-full"
      >
        {busy ? (
          <>
            <Loader2 size={13} className="animate-spin" /> Working…
          </>
        ) : mode === "generate" ? (
          <>
            <Sparkles size={13} /> Generate
          </>
        ) : (
          <>
            <Search size={13} /> Find a photo
          </>
        )}
      </Button>

      {error && (
        <p className="mt-2 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {tray.length > 0 && (
        <>
          <p className="mt-3 mb-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
            Drag onto the video, or click to place.
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {tray.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.label}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-rescript-image", item.url);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => void place(item)}
                className="group relative aspect-square cursor-grab overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a blob/asset URL of unknown size, drawn to canvas rather than laid out */}
                <img
                  src={item.url}
                  alt={item.label}
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
              </button>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

/* --------------------------------- layers ---------------------------------- */

function LayerSection({
  elements,
  selectedId,
  at,
}: {
  elements: OverlayElement[];
  selectedId: string | null;
  at: number;
}) {
  const select = useOverlayStore((s) => s.select);
  const update = useOverlayStore((s) => s.updateElement);
  const remove = useOverlayStore((s) => s.removeElement);
  const duplicate = useOverlayStore((s) => s.duplicateElement);
  const reorder = useOverlayStore((s) => s.reorder);

  // Top of the list is the top of the stack, which is how every editor shows it.
  const ordered = [...elements].sort((a, b) => b.z - a.z);

  return (
    <Section title={`Layers (${elements.length})`}>
      {ordered.length === 0 ? (
        <Empty>
          Nothing on top of the video yet. Add a caption or generate a picture.
        </Empty>
      ) : (
        <ul className="space-y-1">
          {ordered.map((element) => {
            const live = at >= element.start && at < element.end;
            const Icon =
              element.kind === "text"
                ? Type
                : element.kind === "image"
                  ? ImageIcon
                  : Shapes;
            return (
              <li key={element.id}>
                <div
                  className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 transition ${
                    selectedId === element.id
                      ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500/70 dark:bg-indigo-950/30"
                      : "border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => select(element.id)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
                  >
                    <Icon
                      size={13}
                      className={
                        live
                          ? "shrink-0 text-indigo-500"
                          : "shrink-0 text-zinc-400 dark:text-zinc-500"
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-zinc-800 dark:text-zinc-100">
                        {element.name || element.kind}
                      </span>
                      <span className="block text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                        {formatSeconds(element.start)} – {formatSeconds(element.end)}
                      </span>
                    </span>
                  </button>

                  <IconButton
                    title={element.hidden ? "Show" : "Hide"}
                    onClick={() => update(element.id, { hidden: !element.hidden })}
                  >
                    {element.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </IconButton>
                  <IconButton
                    title={element.locked ? "Unlock" : "Lock"}
                    onClick={() => update(element.id, { locked: !element.locked })}
                  >
                    {element.locked ? <Lock size={12} /> : <Unlock size={12} />}
                  </IconButton>
                </div>

                {selectedId === element.id && (
                  <div className="mt-1 mb-1 flex gap-1 pl-6">
                    <IconButton
                      title="Bring forward"
                      onClick={() => reorder(element.id, "forward")}
                    >
                      <ArrowUp size={12} />
                    </IconButton>
                    <IconButton
                      title="Send backward"
                      onClick={() => reorder(element.id, "backward")}
                    >
                      <ArrowDown size={12} />
                    </IconButton>
                    <IconButton
                      title="Duplicate"
                      onClick={() => duplicate(element.id)}
                    >
                      <Copy size={12} />
                    </IconButton>
                    <IconButton
                      title="Delete"
                      danger
                      onClick={() => remove(element.id)}
                    >
                      <Trash2 size={12} />
                    </IconButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function IconButton({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition ${
        danger
          ? "text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          : "text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}
