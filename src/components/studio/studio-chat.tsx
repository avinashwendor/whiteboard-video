"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUp, Square } from "lucide-react";
import {
  AsciiSpinner,
  AsciiVeil,
  BlurredWhileBusy,
  GrainShimmer,
} from "@/components/ui/ascii-loader";
import { WhiteboardPlayer } from "@/components/whiteboard/whiteboard-player";
import { Markdown } from "@/lib/utils/markdown";
import { cn } from "@/lib/utils/cn";
import { useStudio } from "@/lib/studio/use-studio";
import { MAX_PROMPT_CHARS } from "@/lib/validation/schemas";
import type { Generation, Mode } from "@/lib/studio/types";
import { AdvancedSettings } from "./advanced-settings";
import { MODE_CONFIG } from "./mode-config";
import { ModeTabs } from "./mode-tabs";
import { StillResult, StoryboardResult, VoiceoverResult } from "./results";

/**
 * The studio, as a conversation.
 *
 * Every mode produces something you react to — read the draft, look at the
 * frame, listen to the take — and then ask for the next version. A static
 * composer with a result panel bolted underneath makes that a sequence of
 * unrelated one-shots. A transcript makes it one piece of work, and it means
 * one waiting state, one place output appears, and one animation, whatever is
 * being made.
 *
 * The composer starts on the centre line of an empty page and moves to the
 * bottom the moment there is something to read. That move is a real FLIP
 * rather than a crossfade between two layouts, so the box you just typed into
 * is visibly the same box.
 */

const SPEAKING_WPM = 150;

export function StudioChat() {
  const { mode, setMode, current, history, running, prompt, setPrompt, run, cancel, capabilities } =
    useStudio();

  /**
   * The thread is this sitting, not the whole archive. Everything older is
   * still in History; replaying it here would be someone else's conversation.
   */
  const [since, setSince] = useState(() => Date.now());

  const thread = useMemo(() => {
    const past = history.filter((entry) => entry.createdAt >= since);
    // A run in flight lives on `current` before it is committed to history,
    // and opening an old one from History puts it back in the thread — so it
    // is included whatever its age.
    const merged = current
      ? [current, ...past.filter((entry) => entry.id !== current.id)]
      : past;
    return merged.sort((a, b) => a.createdAt - b.createdAt);
  }, [history, current, since]);

  const docked = thread.length > 0;
  const config = MODE_CONFIG[mode];

  /* ------------------------------- the FLIP ------------------------------- */

  const dock = useRef<HTMLDivElement>(null);
  const previousRect = useRef<DOMRect | null>(null);
  const previousDocked = useRef(docked);

  useLayoutEffect(() => {
    const node = dock.current;
    if (!node) return;

    const next = node.getBoundingClientRect();

    if (previousDocked.current !== docked && previousRect.current) {
      const delta = previousRect.current.top - next.top;
      if (Math.abs(delta) > 4 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        node.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], {
          duration: 620,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        });
      }
    }

    previousDocked.current = docked;
    previousRect.current = next;
  });

  /* ------------------------------ transcript ------------------------------ */

  const scroller = useRef<HTMLDivElement>(null);
  const tail = thread[thread.length - 1];

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [tail?.id, tail?.text, tail?.status, tail?.stage]);

  /* --------------------------------- input -------------------------------- */

  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(200, Math.max(docked ? 26 : 62, node.scrollHeight))}px`;
  }, [prompt, docked]);

  const tooLong = prompt.length > MAX_PROMPT_CHARS;
  const blocked = blockingReason(mode, capabilities);
  const canSubmit = prompt.trim().length >= 3 && !tooLong && !running && !blocked;

  const submit = () => {
    if (!canSubmit) return;
    void run();
    setPrompt("");
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      {/* ── transcript, or the empty opening ── */}
      <div
        ref={scroller}
        className={cn(
          "studio-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto",
          docked ? "justify-start" : "justify-end",
        )}
      >
        {docked ? (
          <div className="mx-auto w-full max-w-[760px] px-5 pb-10 pt-8 sm:px-8">
            {thread.map((turn) => (
              <Turn key={turn.id} generation={turn} />
            ))}
          </div>
        ) : (
          <Opening mode={mode} />
        )}
      </div>

      {/* ── the composer: centred, then docked ── */}
      <div
        ref={dock}
        className={cn("shrink-0", docked && "border-t border-line bg-bg/95 backdrop-blur-sm")}
      >
        <div className="mx-auto w-full max-w-[760px] px-5 py-4 sm:px-8">
          <div className="border border-line bg-surface shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <ModeTabs value={mode} onChange={setMode} disabled={running} />
              {docked ? (
                <button
                  type="button"
                  onClick={() => setSince(Date.now())}
                  className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-dim transition-colors hover:text-ink"
                >
                  New thread
                </button>
              ) : null}
            </div>

            <div className="flex items-start gap-3 px-4 pt-4">
              <span className="pt-1 font-mono text-[13px]" style={{ color: config.accent }} aria-hidden>
                &gt;
              </span>
              <label htmlFor="studio-prompt" className="sr-only">
                {config.blurb}
              </label>
              <textarea
                id="studio-prompt"
                ref={input}
                rows={1}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends, shift+enter breaks the line — the shape every
                  // chat input has, and the shape people's hands expect here.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={config.placeholder}
                spellCheck
                className={cn(
                  "w-full resize-none bg-transparent leading-relaxed tracking-[-0.01em] text-ink outline-none placeholder:text-faint",
                  docked ? "text-[15px]" : "text-[18px] sm:text-[19px]",
                )}
              />
            </div>

            <ModeOptions mode={mode} disabled={running} />

            <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-2">
              <span className={cn("truncate text-[11.5px]", blocked ? "text-danger" : "text-faint")}>
                {blocked ?? "↵ to send · ⇧↵ for a new line"}
              </span>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={cn(
                    "font-mono text-[10.5px] tabular-nums",
                    tooLong ? "text-danger" : "text-faint",
                  )}
                >
                  {prompt.length}/{MAX_PROMPT_CHARS}
                </span>
                {running ? (
                  <button
                    type="button"
                    onClick={cancel}
                    aria-label="Stop"
                    className="grid size-8 place-items-center border border-line-strong text-ink transition-colors hover:bg-surface-hover"
                  >
                    <Square className="size-3 fill-current" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!canSubmit}
                    title={blocked ?? undefined}
                    aria-label={config.cta}
                    className="grid size-8 place-items-center bg-ink text-[#0a0b0d] transition-colors hover:bg-white disabled:pointer-events-none disabled:opacity-35"
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>

            <AdvancedSettings mode={mode} />
          </div>
        </div>
      </div>

      {/* The lower half of the empty state. Two equal spacers put the composer
          on the centre line; removing this one drops it to the bottom. */}
      {docked ? null : <div className="min-h-0 flex-1" />}
    </div>
  );
}

/* ------------------------------- mode options ----------------------------- */

/**
 * The one or two choices a mode needs in front of you rather than buried in
 * production settings.
 *
 * "Video" is the deliverable; whiteboard and hyperframes are two ways of
 * drawing it, and which one you get should never be a thing you discover after
 * waiting two minutes. Everything finer — voice, pace, aspect, length — stays
 * behind the settings drawer.
 */
function ModeOptions({ mode, disabled }: { mode: Mode; disabled: boolean }) {
  const { settings, updateSettings } = useStudio();

  if (mode === "create") {
    return (
      <OptionRow label="Style">
        {(
          [
            { value: "whiteboard", label: "Drawn whiteboard" },
            { value: "hyperframes", label: "Modern frames" },
          ] as const
        ).map((option) => (
          <Option
            key={option.value}
            label={option.label}
            active={settings.videoStyle === option.value}
            disabled={disabled}
            onSelect={() => updateSettings({ videoStyle: option.value })}
          />
        ))}
      </OptionRow>
    );
  }

  if (mode === "voice") {
    return (
      <OptionRow label="Source">
        {(
          [
            { value: "verbatim", label: "Read my text" },
            { value: "script", label: "Write it first" },
          ] as const
        ).map((option) => (
          <Option
            key={option.value}
            label={option.label}
            active={settings.voiceSource === option.value}
            disabled={disabled}
            onSelect={() => updateSettings({ voiceSource: option.value })}
          />
        ))}
      </OptionRow>
    );
  }

  return null;
}

function OptionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-2.5">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#4e4e4a]">
        {label}
      </span>
      {children}
    </div>
  );
}

function Option({
  label,
  active,
  disabled,
  onSelect,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "border-b pb-0.5 text-[12.5px] transition-colors disabled:opacity-50",
        active
          ? "border-ink font-medium text-ink"
          : "border-transparent text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}

/* -------------------------------- opening --------------------------------- */

function Opening({ mode }: { mode: Mode }) {
  const config = MODE_CONFIG[mode];
  const headline: Record<Mode, string> = {
    create: "What should we make?",
    write: "What should it say?",
    image: "What should it look like?",
    storyboard: "How should it be shot?",
    voice: "What should it sound like?",
  };

  return (
    <div className="mx-auto w-full max-w-[760px] px-5 pb-7 text-center sm:px-8">
      <p
        className="font-mono text-[10px] uppercase tracking-[0.22em]"
        style={{ color: config.accent }}
      >
        {config.label}
      </p>
      <h1 className="mt-4 text-[32px] font-medium leading-[1.06] tracking-[-0.035em] text-ink sm:text-[38px]">
        {headline[mode]}
      </h1>
      <p className="mx-auto mt-3 max-w-[460px] text-pretty text-[14.5px] leading-relaxed text-muted">
        {config.blurb}. Ask for a first pass, then keep asking until it is right.
      </p>
    </div>
  );
}

/* ---------------------------------- turn ---------------------------------- */

function Turn({ generation }: { generation: Generation }) {
  const config = MODE_CONFIG[generation.mode];

  return (
    <div className="animate-rise pb-12">
      {/* what was asked */}
      <div className="flex justify-end pb-7">
        <p className="max-w-[85%] border border-line bg-surface-raised px-4 py-2.5 text-[14.5px] leading-relaxed text-ink">
          {generation.prompt}
        </p>
      </div>

      {/* what came back */}
      <div className="flex gap-4">
        <span
          className="mt-0.5 grid size-[26px] shrink-0 place-items-center border font-mono text-[11px] font-medium"
          style={{ borderColor: config.accent, color: config.accent }}
          aria-hidden
        >
          M
        </span>

        <div className="min-w-0 flex-1">
          {generation.status === "error" ? (
            <p className="text-[14px] leading-relaxed text-danger">
              {generation.error?.message ?? "That didn't run."}
            </p>
          ) : (
            <Answer generation={generation} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The one waiting state.
 *
 * Whatever is being made, the answer opens with the same line — the mode's
 * spinner and the stage the runner is on — and the plate underneath is grain
 * shaped like the thing that is coming.
 */
function Waiting({
  generation,
  children,
}: {
  generation: Generation;
  children: React.ReactNode;
}) {
  const config = MODE_CONFIG[generation.mode];
  return (
    <div className="space-y-2.5">
      <p className="flex items-center gap-2 pb-0.5 text-[12.5px] text-muted">
        <AsciiSpinner variant="braille" style={{ color: config.accent }} />
        {generation.stage ?? "Working"}
      </p>
      {children}
    </div>
  );
}

function Answer({ generation }: { generation: Generation }) {
  const running = generation.status === "running";

  switch (generation.mode) {
    case "write":
      return <ScriptAnswer generation={generation} />;

    case "image":
      return generation.image ? (
        <div className="border border-line bg-surface">
          <StillResult generation={generation} />
        </div>
      ) : (
        <Waiting generation={generation}>
          <GrainShimmer className="aspect-video w-full border border-line" sweep={2.8} />
        </Waiting>
      );

    case "storyboard":
      return generation.project ? (
        <div className="border border-line bg-surface">
          <StoryboardResult generation={generation} />
        </div>
      ) : (
        <Waiting generation={generation}>
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((index) => (
              <GrainShimmer
                key={index}
                className="aspect-video w-full border border-line"
                sweep={2.5 + index * 0.25}
              />
            ))}
          </div>
        </Waiting>
      );

    case "voice":
      return generation.audio ? (
        <div className="border border-line bg-surface">
          <VoiceoverResult generation={generation} />
        </div>
      ) : (
        <Waiting generation={generation}>
          <GrainShimmer className="h-[86px] w-full border border-line" sweep={2.4} />
        </Waiting>
      );

    case "create":
      return <VideoAnswer generation={generation} running={running} />;
  }
}

/* ------------------------------ script answer ----------------------------- */

function ScriptAnswer({ generation }: { generation: Generation }) {
  const running = generation.status === "running";
  const text = generation.text;

  const words = useMemo(
    () => (text ? text.replace(/[#*_`>[\]()-]/g, " ").split(/\s+/).filter(Boolean).length : 0),
    [text],
  );

  if (!text) {
    return (
      <Waiting generation={generation}>
        <GrainShimmer className="h-[15px] w-full border border-line" sweep={2.2} glow={false} />
        <GrainShimmer className="h-[15px] w-[88%] border border-line" sweep={2.6} glow={false} />
        <GrainShimmer className="h-[15px] w-[62%] border border-line" sweep={2.4} glow={false} />
      </Waiting>
    );
  }

  return (
    <>
      <div className="script-body">
        <Markdown text={text} />
        {running ? (
          <span
            className="ml-0.5 inline-block h-[1.05em] w-[2px] animate-pulse bg-ink align-[-0.15em]"
            aria-hidden
          />
        ) : null}
      </div>

      {!running ? (
        <p className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#4e4e4a]">
          <span>{words.toLocaleString()} words</span>
          <span>~{clock((words / SPEAKING_WPM) * 60)} spoken</span>
          {generation.meta.model ? <span>{generation.meta.model}</span> : null}
        </p>
      ) : null}
    </>
  );
}

/* ------------------------------ video answer ------------------------------ */

function VideoAnswer({ generation, running }: { generation: Generation; running: boolean }) {
  const project = generation.project;

  if (running || !project) {
    const ready = project
      ? project.scenes.filter((scene) => scene.scene || scene.image).length
      : 0;
    const total = project?.scenes.length ?? 0;
    const progress = total ? ready / total : undefined;

    return (
      <BlurredWhileBusy
        busy
        blur={progress === undefined ? 24 : 22 - 10 * progress}
        className="w-full border border-line bg-[#0d0d0e]"
        overlay={
          <AsciiVeil
            title={generation.stage ?? "Planning the story"}
            detail={project?.title}
            progress={progress}
            footnote={total ? `${total} scenes · 1920 × 1080` : undefined}
          />
        }
      >
        {project ? (
          <WhiteboardPlayer project={project} className="generation-player" />
        ) : (
          <div className="aspect-video w-full" aria-hidden />
        )}
      </BlurredWhileBusy>
    );
  }

  const runtime = project.scenes.reduce(
    (total, scene) =>
      total + (scene.audio?.duration ?? Math.max(4.5, scene.narration.split(/\s+/).length / 2.5)),
    project.introDuration ?? 3,
  );

  return (
    <div className="border border-line bg-surface">
      {project.cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- object URLs from IndexedDB
        <img src={project.cover.url} alt="" className="block w-full border-b border-line" />
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-[15px] font-medium tracking-[-0.01em] text-ink">{project.title}</p>
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#4e4e4a]">
            {project.scenes.length} scenes · ~{Math.round(runtime)}s ·{" "}
            {project.videoStyle === "hyperframes" ? "Modern frames" : "Whiteboard"}
          </p>
        </div>
        <Link
          href={`/editor/${generation.id}`}
          className="flex shrink-0 items-center gap-1.5 bg-ink px-3.5 py-2 text-[12.5px] font-medium text-[#0a0b0d] transition-colors hover:bg-white"
        >
          Open in editor
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

/* -------------------------------- helpers --------------------------------- */

function clock(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

function blockingReason(
  mode: Mode,
  capabilities: ReturnType<typeof useStudio>["capabilities"],
): string | null {
  if (!capabilities) return null;
  const needsText = mode === "write" || mode === "create" || mode === "storyboard";

  if (needsText && !capabilities.text.configured) {
    return "Text generation needs OMEGA_API_KEY in .env.local. Restart the dev server after adding it.";
  }
  if (mode === "voice" && !capabilities.voice.configured) {
    return "Narration needs CARTESIA_API_KEY in .env.local. Restart the dev server after adding it.";
  }
  return null;
}
