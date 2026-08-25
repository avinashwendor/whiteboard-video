"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  ANNOTATION_LABELS,
  ANNOTATION_NAMES,
  pathsFor,
  searchShapes,
  VIEWBOX,
} from "@/rescript/lib/overlay/shapes";
import { TextInput } from "./ui";

/**
 * Marks and icons.
 *
 * The sixteen annotations come first and unprompted — an arrow, a circle round
 * something, a tick — because those are what anyone reaches for when pointing
 * at a frame. The 1,776 icons are behind the search box, since a wall of them
 * is a catalogue rather than a tool.
 *
 * Previews are SVG rather than the canvas the renderer uses. Everything here is
 * path data in one 24×24 box, so the browser can draw the same geometry
 * directly and there is nothing for the two to disagree about — unlike the text
 * templates, where the look *is* the rendering and had to be drawn by the real
 * renderer to be honest.
 */

function Glyph({ name }: { name: string }) {
  const paths = pathsFor(name);
  if (!paths) return null;
  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export default function ShapePicker({
  onPick,
}: {
  onPick: (name: string) => void;
}) {
  const [query, setQuery] = useState("");

  const names = useMemo(() => {
    const found = searchShapes(query, 48);
    // With no query the marks are the whole answer; the icons are opt-in.
    return query.trim() ? found : ANNOTATION_NAMES;
  }, [query]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Search size={12} className="shrink-0 text-zinc-400" />
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Search 1,776 icons…"
        />
      </div>

      {names.length === 0 ? (
        <p className="px-1 py-2 text-[11px] text-zinc-400 dark:text-zinc-600">
          Nothing called “{query.trim()}”.
        </p>
      ) : (
        <div className="grid grid-cols-6 gap-1">
          {names.map((name) => (
            <button
              key={name}
              type="button"
              title={ANNOTATION_LABELS[name] ?? name}
              onClick={() => onPick(name)}
              className="flex aspect-square cursor-pointer items-center justify-center rounded-md border border-zinc-200 text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
            >
              <Glyph name={name} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
