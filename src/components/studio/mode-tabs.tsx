"use client";

import { cn } from "@/lib/utils/cn";
import type { Mode } from "@/lib/studio/types";
import { MODE_CONFIG, MODE_ORDER } from "./mode-config";

export function ModeTabs({
  value,
  onChange,
  disabled,
}: {
  value: Mode;
  onChange: (mode: Mode) => void;
  disabled?: boolean;
}) {
  return (
    <div role="tablist" aria-label="Generation mode" className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {MODE_ORDER.map((mode) => {
        const config = MODE_CONFIG[mode];
        const active = value === mode;
        return (
          <button
            key={mode}
            role="tab"
            type="button"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(mode)}
            className={cn(
              "group flex items-center gap-2 border-b pb-1 pt-0.5 text-[13px] font-medium transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
              active ? "border-ink text-ink" : "border-transparent text-muted hover:border-line-strong hover:text-ink",
            )}
          >
            <span
              className={cn("size-1.5 transition-opacity", active ? "opacity-100" : "opacity-40")}
              style={{ background: config.accent }}
              aria-hidden
            />
            {config.label}
          </button>
        );
      })}
    </div>
  );
}
