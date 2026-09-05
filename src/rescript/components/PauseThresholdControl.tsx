"use client";

import { useEffect, useMemo, useState } from "react";
import { AudioLines } from "lucide-react";
import { hydratePauseThresholdPreference, useEditorStore } from "@/rescript/lib/store";
import {
  MAX_PAUSE_THRESHOLD_S,
  MIN_PAUSE_THRESHOLD_S,
  PAUSE_THRESHOLD_PRESETS,
  findPauses,
  formatPause,
} from "@/rescript/lib/pauses";
import Popover, { PopoverContent, PopoverTrigger } from "./Popover";
import { useI18n } from "./I18nProvider";

/**
 * How long a gap has to be before the editor calls it a pause.
 *
 * Every pause chip in the transcript and on the timeline is derived from this
 * one number, so it is the difference between a transcript that shows every
 * breath and one that shows only the places worth cutting. Which of those is
 * right depends entirely on the take, which is why it is a control rather than
 * a constant.
 *
 * The live count is the point of the popover: dragging the slider and watching
 * "31 pauses" fall to "4" is how you find the threshold for *this* recording
 * without closing the menu and squinting at the timeline.
 */
export default function PauseThresholdControl() {
  const { t } = useI18n();
  const words = useEditorStore((s) => s.words);
  const duration = useEditorStore((s) => s.duration);
  const threshold = useEditorStore((s) => s.pauseThreshold);
  const setPauseThreshold = useEditorStore((s) => s.setPauseThreshold);

  const [open, setOpen] = useState(false);

  // Read the stored preference after mount rather than during render: the
  // server has no localStorage, and disagreeing about it is a hydration error.
  useEffect(() => {
    hydratePauseThresholdPreference();
  }, []);

  const count = useMemo(() => {
    const kept = words.filter((w) => !w.deleted);
    return findPauses(kept, { minDuration: threshold, duration }).length;
  }, [words, threshold, duration]);

  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-end" offsetMain={6}>
      <PopoverTrigger>
        <button
          type="button"
          title={t("pauses.title")}
          aria-haspopup="dialog"
          aria-expanded={open}
          // PopoverTrigger only supplies the positioning ref; opening is ours.
          onClick={() => setOpen(!open)}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <AudioLines size={13} />
          <span className="hidden font-mono tabular-nums sm:inline">
            {formatPause(threshold)}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="z-50 w-64 p-3" aria-label={t("pauses.title")}>
        <p className="text-[11px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
          {t("pauses.title")}
        </p>

        <div className="mt-2 flex items-baseline justify-between">
          <span className="font-mono text-[15px] tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatPause(threshold)}
          </span>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {t(count === 1 ? "pauses.count" : "pauses.countPlural", { count })}
          </span>
        </div>

        <input
          type="range"
          min={MIN_PAUSE_THRESHOLD_S}
          max={MAX_PAUSE_THRESHOLD_S}
          step={0.05}
          value={threshold}
          aria-label={t("pauses.title")}
          onChange={(e) => setPauseThreshold(e.currentTarget.valueAsNumber)}
          className="mt-2 w-full cursor-pointer accent-zinc-900 dark:accent-zinc-100"
        />

        <div className="mt-2 flex gap-1">
          {PAUSE_THRESHOLD_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setPauseThreshold(preset)}
              aria-pressed={threshold === preset}
              className={`flex-1 cursor-pointer rounded-md px-1.5 py-1 font-mono text-[11px] tabular-nums transition ${
                threshold === preset
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {formatPause(preset)}
            </button>
          ))}
        </div>

        <p className="mt-2 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
          {t("pauses.hint")}
        </p>
      </PopoverContent>
    </Popover>
  );
}
