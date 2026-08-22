"use client";

import { ArrowUpRight } from "lucide-react";
import { useStudio } from "@/lib/studio/use-studio";
import type { Mode } from "@/lib/studio/types";
import { MODE_CONFIG } from "./mode-config";

const EXAMPLES: Array<{ mode: Mode; prompt: string }> = [
  { mode: "create", prompt: "How UPI revolutionized digital instant payments in India" },
  { mode: "create", prompt: "How LLM Neural Attention works, explained visually step by step" },
  { mode: "create", prompt: "The science of deep sleep, brain waves and memory consolidation" },
  { mode: "create", prompt: "How compound interest turns small monthly savings into wealth" },
  { mode: "write", prompt: "Write an inspiring keynote speech for an Indian AI and robotics summit" },
  { mode: "voice", prompt: "Narrate a warm motivational message in Indian English for engineering students" },
  { mode: "image", prompt: "A futuristic solar-powered Indian smart city with elevated transit and green architecture" },
];

export function Examples() {
  const { setPrompt, setMode, running } = useStudio();

  return (
    <section aria-labelledby="examples-heading" className="space-y-3">
      <h2 id="examples-heading" className="text-[12px] font-medium tracking-wide text-faint">
        Try one of these
      </h2>
      <div className="flex flex-wrap gap-2">
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
              className="group flex max-w-full items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-left text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: config.accent }}
                aria-hidden
              />
              <span className="truncate">{example.prompt}</span>
              <ArrowUpRight className="size-3.5 shrink-0 text-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
            </button>
          );
        })}
      </div>
    </section>
  );
}
