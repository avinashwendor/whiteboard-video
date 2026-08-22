"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, PenLine, Sparkles, Square } from "lucide-react";
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

  // Grow with the content instead of scrolling inside a fixed box.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(320, Math.max(96, node.scrollHeight))}px`;
  }, [prompt, mode]);

  const tooLong = prompt.length > MAX_PROMPT_CHARS;
  const canSubmit = prompt.trim().length >= 3 && !tooLong && !running;

  const blocked = blockingReason(mode, capabilities);

  const submit = () => {
    if (canSubmit && !blocked) void run();
  };

  return (
    <div className="rounded-panel border border-line bg-surface shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3.5 sm:px-5">
        <ModeTabs value={mode} onChange={setMode} disabled={running} />
        <p className="ml-auto hidden text-[12px] text-faint sm:block">{config.blurb}</p>
      </div>

      <div className="px-4 pb-3 pt-2.5 sm:px-5">
        <label htmlFor="studio-prompt" className="sr-only">
          What do you want to create?
        </label>
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
            "w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none",
            "placeholder:text-faint",
          )}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {mode === "create" ? (
            <div className="flex rounded-lg border border-line bg-surface-raised p-0.5">
              {(
                [
                  { value: "whiteboard", label: "Drawn Whiteboard", icon: PenLine },
                  { value: "hyperframes", label: "Modern Video (Hyperframes)", icon: Sparkles },
                ] as const
              ).map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateSettings({ videoStyle: option.value })}
                    aria-pressed={settings.videoStyle === option.value}
                    className={cn(
                      "flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition-colors",
                      settings.videoStyle === option.value
                        ? "bg-surface-hover text-ink shadow-sm"
                        : "text-muted hover:text-ink",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {mode === "voice" ? (
            <div className="flex rounded-lg border border-line bg-surface-raised p-0.5">
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
                    "rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition-colors",
                    settings.voiceSource === option.value
                      ? "bg-surface-hover text-ink"
                      : "text-muted hover:text-ink",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="ml-auto flex items-center gap-3">
            <span
              className={cn(
                "font-mono text-[11px] tabular-nums",
                tooLong ? "text-danger" : "text-faint",
              )}
            >
              {prompt.length}/{MAX_PROMPT_CHARS}
            </span>

            {running ? (
              <Button variant="secondary" size="md" onClick={cancel}>
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
              >
                {config.cta}
                <ArrowUp className="size-3.5" aria-hidden />
              </Button>
            )}
          </div>
        </div>

        {blocked ? (
          <p className="mt-2 rounded-lg border border-line bg-surface-raised px-3 py-2 text-[12px] text-muted">
            {blocked}
          </p>
        ) : null}
      </div>

      <AdvancedSettings mode={mode} />
    </div>
  );
}

/** A clear sentence when a mode simply cannot run in this deployment. */
function blockingReason(
  mode: string,
  capabilities: ReturnType<typeof useStudio>["capabilities"],
): string | null {
  if (!capabilities) return null;
  const needsText = mode === "write" || mode === "create";
  const needsVoice = mode === "voice" || mode === "create";

  if (needsText && !capabilities.text.configured) {
    return "Text generation needs OMEGA_API_KEY in .env.local. Restart the dev server after adding it.";
  }
  if (mode === "voice" && !capabilities.voice.configured) {
    return "Narration needs CARTESIA_API_KEY in .env.local. Restart the dev server after adding it.";
  }
  if (needsVoice && mode === "create" && !capabilities.voice.configured) {
    // Not blocking: the video still renders, just silently.
    return null;
  }
  return null;
}
