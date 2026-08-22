"use client";

import { Check, Minus } from "lucide-react";
import { useStudio } from "@/lib/studio/use-studio";
import { MODE_CONFIG, MODE_ORDER } from "./mode-config";

/**
 * Says plainly what each mode does and whether this deployment can run it, so a
 * missing key shows up as a state rather than as a failed generation.
 */
export function CapabilityCards() {
  const { capabilities, setMode } = useStudio();

  const ready = (mode: string): boolean | null => {
    if (!capabilities) return null;
    if (mode === "write") return capabilities.text.configured;
    if (mode === "voice") return capabilities.voice.configured;
    if (mode === "image") return true;
    return capabilities.text.configured;
  };

  return (
    <section aria-labelledby="capabilities-heading" className="space-y-3">
      <h2 id="capabilities-heading" className="text-[12px] font-medium tracking-wide text-faint">
        What it does
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {MODE_ORDER.map((mode) => {
          const config = MODE_CONFIG[mode];
          const state = ready(mode);
          return (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setMode(mode);
                document.getElementById("studio-prompt")?.focus();
              }}
              className="group rounded-card border border-line bg-surface p-4 text-left transition-colors hover:border-line-strong hover:bg-surface-raised"
            >
              <span
                className="grid size-8 place-items-center rounded-[10px] border border-line"
                style={{ color: config.accent }}
              >
                <config.icon className="size-4" aria-hidden />
              </span>
              <p className="mt-3 text-[14px] font-medium text-ink">{config.label}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{config.blurb}</p>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-faint">
                {state === null ? (
                  <>
                    <Minus className="size-3" aria-hidden />
                    Checking
                  </>
                ) : state ? (
                  <>
                    <Check className="size-3 text-create" aria-hidden />
                    Ready
                  </>
                ) : (
                  <>
                    <Minus className="size-3" aria-hidden />
                    Needs an API key
                  </>
                )}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
