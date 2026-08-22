"use client";

import { useStudio } from "@/lib/studio/use-studio";
import type { Mode } from "@/lib/studio/types";
import { MODE_CONFIG } from "./mode-config";

const EXAMPLES: Array<{ mode: Mode; prompt: string }> = [
  { mode: "create", prompt: "How UPI revolutionized instant payments in India" },
  { mode: "create", prompt: "How LLM neural attention works, step by step" },
  { mode: "create", prompt: "Deep sleep, brain waves and memory consolidation" },
  { mode: "create", prompt: "How compound interest turns small monthly savings into wealth" },
  { mode: "write", prompt: "An inspiring keynote for an AI and robotics summit" },
  { mode: "voice", prompt: "A warm motivational message for engineering students" },
  { mode: "image", prompt: "A solar-powered city with elevated transit" },
];

export function Examples() {
  const { setPrompt, setMode, running } = useStudio();

  return (
    <section aria-labelledby="examples-heading" className="border-t border-line pt-6">
      <div className="flex flex-col gap-4">
        <h2 id="examples-heading" className="text-[13px] font-medium text-muted">
          Try one of these
        </h2>
        <div className="grid gap-x-12 gap-y-3.5 sm:grid-cols-2">
          {EXAMPLES.map((example) => {
            const config = MODE_CONFIG[example.mode];
            return (
              <button
                key={example.prompt}
                type="button"
                disabled={running}
                onClick={() => {
                  setMode(example.mode);
                  setPrompt(example.prompt);
                  document.getElementById("studio-prompt")?.focus();
                }}
                className="group flex items-center gap-2.5 text-left text-[13.5px] text-muted transition-colors hover:text-ink disabled:opacity-50"
              >
                <span
                  className="size-1.5 shrink-0 transition-transform group-hover:scale-125"
                  style={{ background: config.accent }}
                  aria-hidden
                />
                <span className="truncate">{example.prompt}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
