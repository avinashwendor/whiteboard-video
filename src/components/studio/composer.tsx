"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { useStudio } from "@/lib/studio/use-studio";
import { MAX_PROMPT_CHARS } from "@/lib/validation/schemas";
import { AdvancedSettings } from "./advanced-settings";
import { MODE_CONFIG } from "./mode-config";
import { ModeTabs } from "./mode-tabs";

export function Composer() {
  const { mode, setMode, prompt, setPrompt, run, running, cancel, settings, updateSettings, capabilities } =
    useStudio();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const config = MODE_CONFIG[mode];

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(360, Math.max(110, node.scrollHeight))}px`;
  }, [prompt, mode]);

  const tooLong = prompt.length > MAX_PROMPT_CHARS;
  const canSubmit = prompt.trim().length >= 3 && !tooLong && !running;
  const blocked = blockingReason(mode, capabilities);

  const submit = () => {
    if (!canSubmit || blocked) return;
    void run();
  };

  return (
    <div className="border border-line bg-surface shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
      {/* Mode bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3.5 sm:px-8">
        <ModeTabs value={mode} onChange={setMode} disabled={running} />
        <p className="hidden text-[13px] text-muted md:block">
          {config.blurb}
        </p>
      </div>

      {/* Input area */}
      <div className="px-6 pt-7 pb-6 sm:px-8">
        <label htmlFor="studio-prompt" className="sr-only">
          What do you want to create?
        </label>
        <div className="flex items-start gap-3.5">
          <span
            className="select-none pt-1 font-mono text-[14px] font-medium"
            style={{ color: config.accent }}
            aria-hidden
          >
            &gt;
          </span>
          <textarea
            id="studio-prompt"
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={config.placeholder}
            rows={3}
            spellCheck
            className={cn(
              "w-full resize-none bg-transparent text-[19px] leading-relaxed tracking-[-0.015em] text-ink outline-none sm:text-[22px]",
              "placeholder:text-faint",
            )}
          />
        </div>

        {blocked ? (
          <p className="mt-4 border-l border-danger pl-3 text-[12px] leading-relaxed text-muted">
            {blocked}
          </p>
        ) : null}
      </div>

      {/* Quick controls & Action bar */}
      <div className="flex flex-col border-t border-line sm:flex-row sm:items-stretch sm:justify-between">
        {/* Left option toggles */}
        <div className="flex min-h-[56px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2.5 sm:px-8">
          {mode === "create" ? (
            <div className="flex items-center gap-3.5" aria-label="Video style">
              <span className="text-[12px] text-muted">Style</span>
              {(
                [
                  { value: "whiteboard", label: "Drawn whiteboard" },
                  { value: "hyperframes", label: "Modern frames" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateSettings({ videoStyle: option.value })}
                  aria-pressed={settings.videoStyle === option.value}
                  className={cn(
                    "border-b py-1 text-[13px] font-medium transition-colors",
                    settings.videoStyle === option.value
                      ? "border-ink text-ink"
                      : "border-transparent text-muted hover:border-line-strong hover:text-ink",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}

          {mode === "voice" ? (
            <div className="flex items-center gap-3.5" aria-label="Voice source">
              <span className="text-[12px] text-muted">Source</span>
              {(
                [
                  { value: "verbatim", label: "Read my text" },
                  { value: "script", label: "Write it first" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateSettings({ voiceSource: option.value })}
                  aria-pressed={settings.voiceSource === option.value}
                  className={cn(
                    "border-b py-1 text-[13px] font-medium transition-colors",
                    settings.voiceSource === option.value
                      ? "border-ink text-ink"
                      : "border-transparent text-muted hover:border-line-strong hover:text-ink",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Right submit / stop button & counter */}
        <div className="flex items-center justify-between border-t border-line pl-6 sm:justify-end sm:border-l sm:border-t-0 sm:pl-5">
          <span className={cn("font-mono text-[11.5px] tabular-nums", tooLong ? "text-danger" : "text-faint")}>
            {prompt.length}/{MAX_PROMPT_CHARS}
          </span>

          {running ? (
            <Button
              variant="secondary"
              size="md"
              className="h-[56px] rounded-none border-0 border-l border-line px-7 text-[13.5px]"
              onClick={cancel}
            >
              <Square className="size-3.5 fill-current" aria-hidden />
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={submit}
              disabled={!canSubmit || Boolean(blocked)}
              title={blocked ?? undefined}
              className="ml-5 h-[56px] rounded-none border-0 px-8 text-[14px]"
            >
              {config.cta}
              <ArrowUp className="size-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      {/* Advanced production settings */}
      <AdvancedSettings mode={mode} />
    </div>
  );
}

function blockingReason(
  mode: string,
  capabilities: ReturnType<typeof useStudio>["capabilities"],
): string | null {
  if (!capabilities) return null;
  const needsText = mode === "write" || mode === "create";

  if (needsText && !capabilities.text.configured) {
    return "Text generation needs OMEGA_API_KEY in .env.local. Restart the dev server after adding it.";
  }
  if (mode === "voice" && !capabilities.voice.configured) {
    return "Narration needs CARTESIA_API_KEY in .env.local. Restart the dev server after adding it.";
  }
  return null;
}
