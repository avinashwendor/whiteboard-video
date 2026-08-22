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
    <div role="tablist" aria-label="Generation mode" className="flex flex-wrap gap-1">
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
              "group flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
              active ? "bg-surface-hover text-ink" : "text-muted hover:bg-surface-raised hover:text-ink",
            )}
          >
            <span
              className={cn("size-1.5 rounded-full transition-opacity", active ? "opacity-100" : "opacity-35")}
              style={{ background: config.accent }}
              aria-hidden
            />
            <config.icon className="size-3.5" aria-hidden />
            {config.label}
          </button>
        );
      })}
    </div>
  );
}
