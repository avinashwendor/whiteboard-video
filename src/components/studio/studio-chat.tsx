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
import { enhancePrompt } from "@/lib/studio/api";
import { useStudio } from "@/lib/studio/use-studio";
import { MAX_PROMPT_CHARS } from "@/lib/validation/schemas";
import type { Generation, Mode } from "@/lib/studio/types";
import { AdvancedSettings } from "./advanced-settings";
import { configFor, MODE_CONFIG } from "./mode-config";
import { ModeTabs } from "./mode-tabs";
import { StillResult, VoiceoverResult } from "./results";
import { MicButton } from "@/components/ui/mic-button";

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

  /**
   * The generation "New thread" cleared.
   *
   * `current` has to be in the thread whatever its age — a run in flight is
   * only on `current` until it commits, and opening an old one from History
   * has to show it. So clearing by timestamp alone could never hide the thing
   * on screen, which is exactly why the button looked broken. Naming the
   * dismissed id instead hides that one result and nothing else: the next run
   * has a different id, and so does anything reopened from History.
   */
  const [dismissed, setDismissed] = useState<string | null>(null);

  const startNewThread = () => {
    setSince(Date.now());
    setDismissed(current?.id ?? null);
  };

  const thread = useMemo(() => {
    const past = history.filter((entry) => entry.createdAt >= since);
    const merged = current
      ? [current, ...past.filter((entry) => entry.id !== current.id)]
      : past;
    return merged
      .filter((entry) => entry.id !== dismissed)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [history, current, since, dismissed]);

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
                  onClick={startNewThread}
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

            <Sharpen mode={mode} disabled={running} />

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
                <MicButton
                  onTranscription={(text) => setPrompt(prompt ? prompt + " " + text : text)}
                />
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

/* --------------------------------- sharpen -------------------------------- */

/**
 * The middle ground between a lazy prompt and an interrogation.
 *
 * Six words is a perfectly good way to start, and being asked four questions
 * before anything happens is how people close a tab. But "a video about UPI"
 * really does make a worse video than a brief that says who it is for and what
 * it should land. So: type whatever you like and send it, or spend one click
 * having the prompt written out properly and see what changed before you
 * commit to it.
 *
 * Only offered on short prompts. Past a sentence or two you have already told
 * it what you want.
 */
function Sharpen({ mode, disabled }: { mode: Mode; disabled: boolean }) {
  const { prompt, setPrompt, settings } = useStudio();
  const [busy, setBusy] = useState(false);
  const [previous, setPrevious] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  const worthOffering = words >= 3 && words <= 14 && mode !== "voice";

  if (previous === null && !worthOffering) return null;

  const sharpen = async () => {
    const original = prompt.trim();
    if (!original) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await enhancePrompt({
        prompt: original,
        style: mode === "image" ? (settings.imageStyle as string) : undefined,
      });
      if (result.used && result.used !== original) {
        setPrevious(original);
        setPrompt(result.used);
      }
    } catch {
      // A brief that will not rewrite is not a reason to block sending the
      // one you already have.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-2.5">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#4e4e4a]">
        Brief
      </span>

      {previous === null ? (
        <button
          type="button"
          onClick={() => void sharpen()}
          disabled={disabled || busy}
          className="flex items-center gap-2 border-b border-transparent pb-0.5 text-[12.5px] text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
        >
          {busy ? <AsciiSpinner variant="braille" className="text-create" /> : null}
          {busy ? "Writing it out" : "Sharpen this for me"}
        </button>
      ) : (
        <>
          <span className="text-[12.5px] text-create">Sharpened</span>
          <button
            type="button"
            onClick={() => {
              setPrompt(previous);
              setPrevious(null);
            }}
            disabled={disabled}
            className="border-b border-transparent pb-0.5 text-[12.5px] text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Use what I wrote
          </button>
        </>
      )}

      {failed ? (
        <span className="text-[12px] text-faint">Couldn&rsquo;t rewrite it — send yours.</span>
      ) : null}
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
            {
              value: "whiteboard",
              label: "Drawn whiteboard",
              detail: "A hand draws it as the narrator speaks",
            },
            {
              value: "hyperframes",
              label: "Modern frames",
              detail: "Designed slides with photos and motion",
            },
          ] as const
        ).map((option) => (
          <Choice
            key={option.value}
            label={option.label}
            detail={option.detail}
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
            {
              value: "verbatim",
              label: "Read my text",
              detail: "Spoken exactly as written",
            },
            {
              value: "script",
              label: "Write it first",
              detail: "Turned into a script, then spoken",
            },
          ] as const
        ).map((option) => (
          <Choice
            key={option.value}
            label={option.label}
            detail={option.detail}
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
    <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5 px-4 pt-2.5">
      <span className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#4e4e4a]">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * One of the choices that changes what you get back.
 *
 * It used to be a text label with a bottom border, and which one was selected
 * was the difference between one underline and another — invisible at this
 * size, so people sent a prompt without knowing which style they had asked for
 * and only found out two minutes later. It is a real control now: a filled
 * state you cannot miss, a dot that marks the live one, and a line saying what
 * the option actually produces, because "Modern frames" does not tell you.
 */
function Choice({
  label,
  detail,
  active,
  disabled,
  onSelect,
}: {
  label: string;
  detail: string;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      role="radio"
      aria-checked={active}
      className={cn(
        "group flex min-w-[168px] flex-1 items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors disabled:opacity-50",
        active
          ? "border-line-strong bg-surface-raised"
          : "border-line bg-transparent hover:border-line-strong hover:bg-surface-hover",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-[5px] size-[7px] shrink-0 rounded-full border transition-colors",
          active
            ? "border-ink bg-ink"
            : "border-line-strong bg-transparent group-hover:border-muted",
        )}
      />
      <span className="min-w-0">
        <span
          className={cn(
            "block text-[12.5px] leading-tight transition-colors",
            active ? "font-medium text-ink" : "text-muted group-hover:text-ink",
          )}
        >
          {label}
        </span>
        <span className="mt-0.5 block text-[10.5px] leading-tight text-faint">
          {detail}
        </span>
      </span>
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
  const config = configFor(generation.mode);

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
            <Failed generation={generation} />
          ) : (
            <Answer generation={generation} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A failed turn.
 *
 * What went wrong decides what to offer. Being offline is the person's problem
 * and retrying now is pointless; a 502 from a provider is nobody's fault and
 * retrying usually works; a rejected prompt needs editing, not repeating. One
 * generic red sentence made all three look the same.
 */
function Failed({ generation }: { generation: Generation }) {
  const { run, running } = useStudio();
  const code = generation.error?.code ?? "unknown";

  const advice =
    code === "offline"
      ? "Nothing left this machine — check the connection."
      : code === "network"
        ? "The request never reached the server."
        : code === "server_error"
          ? "The server answered, but with an error of its own."
          : code === "invalid_request" || code === "unsupported"
            ? "Change the prompt and send it again."
            : "The provider is having a moment.";

  const worthRetrying = code !== "invalid_request" && code !== "unsupported";

  return (
    <div className="border border-danger/30 bg-danger/[0.06] px-4 py-3.5">
      <p className="text-[14px] leading-relaxed text-danger">
        {generation.error?.message ?? "That didn't run."}
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{advice}</p>

      <div className="mt-3 flex items-center gap-4">
        {worthRetrying ? (
          <button
            type="button"
            disabled={running}
            onClick={() => void run({ prompt: generation.prompt, mode: generation.mode })}
            className="border border-line-strong px-3 py-1.5 text-[12.5px] text-ink transition-colors hover:bg-surface-hover disabled:opacity-40"
          >
            Try again
          </button>
        ) : null}
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#4e4e4a]">
          {code}
        </span>
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
  const config = configFor(generation.mode);
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
  const needsText = mode === "write" || mode === "create";

  if (needsText && !capabilities.text.configured) {
    return "Text generation needs OMEGA_API_KEY in .env.local. Restart the dev server after adding it.";
  }
  if (mode === "voice" && !capabilities.voice.configured) {
    return "Narration needs CARTESIA_API_KEY in .env.local. Restart the dev server after adding it.";
  }
  return null;
}
