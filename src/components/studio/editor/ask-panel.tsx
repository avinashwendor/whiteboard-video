"use client";

import { useState } from "react";
import { CornerDownLeft, Sparkles, Undo2 } from "lucide-react";
import { AsciiSpinner, GrainShimmer } from "@/components/ui/ascii-loader";
import { cn } from "@/lib/utils/cn";
import { MicButton } from "@/components/ui/mic-button";

/**
 * Editing by description.
 *
 * The instruction goes to the planner, which answers with operations pointed at
 * the pipelines the studio already has -- a Tavily search, the image chain, the
 * board writer, the speech route. They run immediately and every one of them is
 * named in the log, because an edit you cannot see is an edit you cannot undo.
 */

export interface ActivityEntry {
  id: string;
  message: string;
  ok: boolean;
  /** Set on the line that opens a batch, so the log reads as a conversation. */
  instruction?: boolean;
}

const EXAMPLES = [
  "Give scene 2 a real photo of a server rack",
  "Re-lay out scene 1 as a timeline",
  "Make the last scene's script shorter and punchier",
];

export function AskPanel({
  sceneNumber,
  busy,
  status,
  activity,
  canUndo,
  onAsk,
  onUndo,
}: {
  sceneNumber: number;
  busy: boolean;
  status: string | null;
  activity: ActivityEntry[];
  canUndo: boolean;
  onAsk: (instruction: string) => void;
  onUndo: () => void;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    const instruction = value.trim();
    if (!instruction || busy) return;
    setValue("");
    onAsk(instruction);
  };

  return (
    <div className="flex h-full flex-col gap-3 pb-6">
      <div className="border border-line bg-surface-raised p-2.5">
        <textarea
          rows={3}
          value={value}
          disabled={busy}
          placeholder={`Describe a change… (scene ${sceneNumber} is open)`}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          className="w-full resize-none bg-transparent text-[12px] leading-relaxed text-ink outline-none placeholder:text-faint"
        />
        <div className="flex items-center justify-between pt-1.5">
          <span className="text-[10px] text-faint">⌘↵ to send</span>
          <div className="flex items-center gap-1.5">
            <MicButton 
              onTranscription={(text) => setValue((prev) => (prev ? prev + " " + text : text))} 
            />
            <button
              type="button"
              onClick={submit}
              disabled={busy || !value.trim()}
              className="flex items-center gap-1.5 bg-ink px-2.5 py-1 text-[11px] font-medium text-[#0a0b0d] transition-colors hover:bg-white disabled:pointer-events-none disabled:opacity-45"
            >
              {busy ? <AsciiSpinner variant="braille" className="text-[11px]" /> : <CornerDownLeft className="size-3" aria-hidden />}
              Send
            </button>
          </div>
        </div>
      </div>

      {activity.length ? null : (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium tracking-wide text-faint">TRY</p>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setValue(example)}
              className="block w-full border border-line bg-surface-raised px-2.5 py-2 text-left text-[11px] leading-relaxed text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto studio-scrollbar">
        {/*
          The planner is reading the scene and has nothing to show yet. A
          shimmer field says that honestly; a progress bar would be inventing
          a completion figure nobody can compute.
        */}
        {status ? (
          <div className="border border-line bg-surface-raised p-2.5">
            <p className="flex items-center gap-2 text-[11px] text-muted">
              <AsciiSpinner variant="braille" className="text-[11px] text-create" />
              {status}
            </p>
            <GrainShimmer
              intensity={0.5}
              sweep={2.4}
              className="mt-2.5 h-[54px] w-full border border-line"
            />
          </div>
        ) : null}

        {activity.map((entry) => (
          <p
            key={entry.id}
            className={cn(
              "flex items-start gap-1.5 px-2.5 py-2 text-[11px] leading-relaxed",
              entry.instruction
                ? "border border-line-strong bg-surface-hover text-ink"
                : entry.ok
                  ? "text-muted"
                  : "text-danger",
            )}
          >
            {entry.instruction ? (
              <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden />
            ) : (
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-current" aria-hidden />
            )}
            {entry.message}
          </p>
        ))}
      </div>

      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo || busy}
        className="flex items-center justify-center gap-1.5 border border-line bg-surface-raised px-3 py-2 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink disabled:pointer-events-none disabled:opacity-40"
      >
        <Undo2 className="size-3.5" aria-hidden />
        Undo last change
      </button>
    </div>
  );
}
