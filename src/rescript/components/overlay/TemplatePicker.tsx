"use client";

import { useEffect, useRef, useState } from "react";
import { paintComposition } from "@/rescript/lib/overlay/render";
import {
  templatesByCategory,
  type TextTemplate,
} from "@/rescript/lib/overlay/templates";
import {
  DEFAULT_FRAME,
  DEFAULT_SUBTITLE_STYLE,
  type Composition,
  type TextElement,
} from "@/rescript/lib/overlay/types";

/**
 * The template library.
 *
 * Every card is drawn by **the actual renderer**, at a moment part-way through
 * the template's own entrance, over a stand-in for footage. A picker that
 * approximates what it is selling — a font sample, a coloured rectangle — is
 * worse than no picker: people choose from it, get something else, and stop
 * trusting the list. `paintComposition` is already a pure function of
 * (composition, time, size), so drawing thirty-six of them costs nothing but a
 * few small canvases.
 *
 * They are caught part-way through the entrance rather than settled, because
 * the motion is half of what is being chosen and a settled frame hides it.
 */

/** How far into the entrance the thumbnails are frozen. */
const PREVIEW_AT = 0.62;

const CARD = { width: 132, height: 74 };

function previewElement(template: TextTemplate): TextElement {
  const { sizeScale, ...look } = template.style;
  return {
    id: `preview-${template.id}`,
    kind: "text",
    name: template.label,
    start: 0,
    end: 100,
    rect: { x: 0.06, y: 0.3, w: 0.88, h: 0.4 },
    rotation: 0,
    opacity: 1,
    z: 1,
    locked: false,
    hidden: false,
    enter: template.enter,
    exit: { kind: "none", duration: 0, easing: "linear" },
    text: template.sample,
    fontFamily: "system-ui, sans-serif",
    fontWeight: 700,
    italic: false,
    // A fraction of the card, not of the output frame: the thumbnails are tiny
    // and the point is the shape of the type, not its literal size.
    fontSize: 0.16 * (sizeScale ?? 1),
    color: "#ffffff",
    align: "center",
    lineHeight: 1.15,
    letterSpacing: 0,
    uppercase: false,
    background: null,
    padding: 0.3,
    radius: 0.2,
    shadow: true,
    strokeColor: null,
    strokeWidth: 0,
    ...look,
  };
}

function previewComposition(template: TextTemplate): Composition {
  return {
    elements: [previewElement(template)],
    subtitles: {
      enabled: false,
      style: { ...DEFAULT_SUBTITLE_STYLE },
      cues: [],
      generated: false,
    },
    transitions: [],
    frame: { ...DEFAULT_FRAME },
    shots: [],
    grade: null,
  };
}

function Thumbnail({ template }: { template: TextTemplate }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = CARD.width * dpr;
    canvas.height = CARD.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // A stand-in for footage rather than a flat colour: half these templates
    // carry a stroke or a shadow whose whole job is legibility over a picture,
    // and against grey they all look equally fine.
    const gradient = ctx.createLinearGradient(0, 0, CARD.width, CARD.height);
    gradient.addColorStop(0, "#3f3f46");
    gradient.addColorStop(0.55, "#71717a");
    gradient.addColorStop(1, "#27272a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CARD.width, CARD.height);

    // The entrance is measured from the element's start, so the moment to draw
    // is a fraction of the template's own duration — a 1.2s typewriter and a
    // 0.3s pop are then both caught at the same point in their reveal.
    const t = template.enter.duration * PREVIEW_AT;
    try {
      paintComposition(ctx, previewComposition(template), CARD, t);
    } catch {
      // A template that cannot draw shows as an empty card rather than taking
      // the whole picker down with it — which also makes it obvious which one.
    }
  }, [template]);

  return (
    <canvas
      ref={ref}
      style={{ width: CARD.width, height: CARD.height }}
      className="block w-full rounded-md"
      aria-hidden
    />
  );
}

export default function TemplatePicker({
  onPick,
}: {
  onPick: (template: TextTemplate) => void;
}) {
  const groups = templatesByCategory();
  const [open, setOpen] = useState<string>(groups[0]?.category ?? "");

  return (
    <div className="flex flex-col gap-1">
      {groups.map((group) => {
        const showing = open === group.category;
        return (
          <div key={group.category}>
            <button
              type="button"
              onClick={() => setOpen(showing ? "" : group.category)}
              className="flex w-full cursor-pointer items-center justify-between rounded-md px-1 py-1.5 text-[10px] font-medium tracking-wide text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <span>{group.label}</span>
              <span className="tabular-nums text-zinc-400 dark:text-zinc-600">
                {group.templates.length}
              </span>
            </button>
            {showing && (
              <div className="grid grid-cols-2 gap-1.5 pb-2">
                {group.templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    title={template.label}
                    onClick={() => onPick(template)}
                    className="group cursor-pointer overflow-hidden rounded-lg border border-zinc-200 text-left transition hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
                  >
                    <Thumbnail template={template} />
                    <span className="block truncate px-1.5 py-1 text-[10px] font-medium text-zinc-600 dark:text-zinc-300">
                      {template.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
