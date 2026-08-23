"use client";

import { useEffect, useState } from "react";
import {
  Captions,
  Layers,
  Redo2,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useOverlayStore } from "@/motionscript/lib/overlay/store";
import AiPanel from "./AiPanel";
import ElementsPanel from "./ElementsPanel";
import InspectorPanel from "./InspectorPanel";
import SubtitlesPanel from "./SubtitlesPanel";
import TransitionsPanel from "./TransitionsPanel";

/**
 * The composition side of the editor.
 *
 * Five tabs rather than one long scroll, because the four jobs are genuinely
 * separate: describing a change, adding things, styling the thing that is
 * selected, captions, and cuts. Selecting an element on the video jumps to
 * Style, since that is what you wanted when you clicked it.
 */

type Tab = "ai" | "elements" | "style" | "subtitles" | "transitions";

const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "elements", label: "Add", icon: Layers },
  { id: "style", label: "Style", icon: SlidersHorizontal },
  { id: "subtitles", label: "Subs", icon: Captions },
  { id: "transitions", label: "Cuts", icon: Shuffle },
];

export default function Sidebar() {
  const [tab, setTab] = useState<Tab>("ai");
  const undo = useOverlayStore((s) => s.undo);
  const redo = useOverlayStore((s) => s.redo);
  const canUndo = useOverlayStore((s) => s.past.length > 0);
  const canRedo = useOverlayStore((s) => s.future.length > 0);

  // Clicking something on the video means "let me change this", so follow the
  // selection to the panel that can. Driven by a store subscription rather than
  // an effect on the value: this must fire on a *change* of selection, not on
  // every render where something happens to be selected, or picking another tab
  // by hand would be undone immediately.
  useEffect(
    () =>
      useOverlayStore.subscribe((state, previous) => {
        if (state.selectedId && state.selectedId !== previous.selectedId) {
          setTab("style");
        }
      }),
    []
  );

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-0.5 border-b border-zinc-200 px-1.5 py-1.5 dark:border-zinc-800">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            title={label}
            className={`flex h-8 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg text-[9px] font-medium transition ${
              tab === id
                ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
        <span className="mx-0.5 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          title="Undo the last composition change"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Undo2 size={13} />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          title="Redo"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Redo2 size={13} />
        </button>
      </div>

      {tab === "ai" && <AiPanel />}
      {tab === "elements" && <ElementsPanel />}
      {tab === "style" && <InspectorPanel />}
      {tab === "subtitles" && <SubtitlesPanel />}
      {tab === "transitions" && <TransitionsPanel />}
    </div>
  );
}
