"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff, Pause, Play } from "lucide-react";
import { GrainShimmer } from "@/components/ui/ascii-loader";
import { Markdown } from "@/lib/utils/markdown";
import { cn } from "@/lib/utils/cn";
import type { Generation } from "@/lib/studio/types";

/**
 * The three single-asset results: a script, a still, a voiceover.
 *
 * Each one is presented as the thing it is rather than as a generic payload in
 * a card. A script gets a reading column and a spoken-length estimate because
 * that is the number you actually need before narrating it; a still gets a mat
 * and its real dimensions; a voiceover gets its own words highlighted as they
 * are spoken, which is the only way to check a take without listening twice.
 */

/* --------------------------------- shared --------------------------------- */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#4e4e4a]">
        {label}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-muted">{value}</span>
    </span>
  );
}

function StatBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line px-4 py-2.5 sm:px-5">
      {children}
    </div>
  );
}

function clock(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

/* --------------------------------- script --------------------------------- */

/** Words per minute for read-aloud pacing. Broadcast narration sits near 150. */
const SPEAKING_WPM = 150;
/** Silent reading is roughly a third faster again. */
const READING_WPM = 240;

export function ScriptResult({ generation }: { generation: Generation }) {
  const running = generation.status === "running";
  const text = generation.text;
  const [expanded, setExpanded] = useState(false);

  const words = useMemo(
    () => (text ? text.replace(/[#*_`>[\]()-]/g, " ").split(/\s+/).filter(Boolean).length : 0),
    [text],
  );

  /** Roughly two screens of copy. Below that, collapsing is just friction. */
  const long = words > 220;

  if (!text) {
    return (
      <div className="space-y-2.5 p-4 sm:p-5">
        <GrainShimmer className="h-[15px] w-full border border-line" sweep={2.2} glow={false} />
        <GrainShimmer className="h-[15px] w-[92%] border border-line" sweep={2.6} glow={false} />
        <GrainShimmer className="h-[15px] w-full border border-line" sweep={2.4} glow={false} />
        <GrainShimmer className="h-[15px] w-[64%] border border-line" sweep={2.8} glow={false} />
        <p className="pt-2 text-[12px] text-faint">{generation.stage ?? "Writing"}</p>
      </div>
    );
  }

  return (
    <>
      <StatBar>
        <Stat label="Words" value={words.toLocaleString()} />
        <Stat label="Spoken" value={`~${clock((words / SPEAKING_WPM) * 60)}`} />
        <Stat label="Read" value={`~${clock((words / READING_WPM) * 60)}`} />
        {running ? <Stat label="Status" value="writing" /> : null}
      </StatBar>

      {/*
        A measured column, not the full panel width. Long-form copy set across
        1100px is unreadable, and the script is the one output here that people
        actually read end to end.

        Past a few hundred words it also stops being something you skim past on
        the way to the rest of the page, so it collapses until asked for.
      */}
      <div className={cn("px-4 py-8 sm:px-8", !expanded && long && "script-clamp")}>
        <div className="script-body mx-auto max-w-[62ch]">
          <Markdown text={text} />
          {running ? (
            <span
              className="ml-0.5 inline-block h-[1.05em] w-[2px] animate-pulse bg-ink align-[-0.15em]"
              aria-hidden
            />
          ) : null}
        </div>
      </div>

      {long && !running ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center justify-center gap-2 border-t border-line py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-dim transition-colors hover:text-ink"
        >
          {expanded ? "Collapse" : `Read all ${words.toLocaleString()} words`}
          <span aria-hidden>{expanded ? "↑" : "↓"}</span>
        </button>
      ) : null}
    </>
  );
}

/* ---------------------------------- still --------------------------------- */

export function StillResult({ generation }: { generation: Generation }) {
  const [failed, setFailed] = useState(false);
  const image = generation.image;

  if (!image) {
    return (
      <div className="p-4 sm:p-5">
        <GrainShimmer className="aspect-video w-full border border-line" sweep={3} />
        <p className="pt-3 text-[12px] text-faint">{generation.stage ?? "Generating"}</p>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 border-b border-line py-16 text-center">
        <ImageOff className="size-5 text-faint" aria-hidden />
        <p className="text-[13px] text-muted">This image is no longer available.</p>
      </div>
    );
  }

  const ratio = image.width && image.height ? image.width / image.height : 0;
  const aspect =
    ratio > 1.7 ? "16:9" : ratio > 1.4 ? "3:2" : ratio > 1.1 ? "4:3" : ratio > 0.9 ? "1:1" : "portrait";

  return (
    <>
      <StatBar>
        <Stat label="Size" value={`${image.width} × ${image.height}`} />
        <Stat label="Aspect" value={aspect} />
        <Stat label="Engine" value={image.model} />
        {image.kind ? <Stat label="Kind" value={image.kind} /> : null}
      </StatBar>

      {image.fallbackFrom ? (
        <p className="border-b border-line px-4 py-2.5 text-[12px] leading-relaxed text-voice sm:px-5">
          <span className="font-medium">{image.fallbackFrom} couldn&apos;t run</span> —{" "}
          {image.fallbackReason} Generated with {image.provider} ({image.model}) instead.
        </p>
      ) : null}

      {/*
        A mat around the plate. Generated stills come back at wildly different
        shapes, and letting a 3:4 portrait stretch the panel to 1400px tall is
        worse than showing it small on a ground of its own.
      */}
      <div className="group relative flex items-center justify-center bg-[#08080a] p-6 sm:p-10">
        {/* eslint-disable-next-line @next/next/no-img-element -- blob and object URLs bypass the optimiser */}
        <img
          src={image.url}
          alt={generation.prompt}
          width={image.width}
          height={image.height}
          onError={() => setFailed(true)}
          className="animate-fade block max-h-[62vh] w-auto max-w-full border border-line object-contain"
        />

        <FrameMarks />

        <span className="pointer-events-none absolute bottom-3 right-4 font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#4e4e4a] opacity-0 transition-opacity group-hover:opacity-100">
          {image.provider} · {image.width} × {image.height}
        </span>
      </div>

      {image.promptUsed && image.promptUsed !== generation.prompt ? (
        <details className="border-t border-line">
          <summary className="cursor-pointer list-none px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-dim transition-colors hover:text-ink sm:px-5">
            The prompt that was actually used
          </summary>
          <p className="border-t border-line bg-bg-soft px-4 py-3.5 text-[12.5px] leading-relaxed text-muted sm:px-5">
            {image.promptUsed}
          </p>
        </details>
      ) : null}
    </>
  );
}

/** Corner ticks, the same registration marks the generation frame uses. */
function FrameMarks() {
  const base = "pointer-events-none absolute size-3 border-[#2a2a28]";
  return (
    <>
      <span className={cn(base, "left-3 top-3 border-l border-t")} aria-hidden />
      <span className={cn(base, "right-3 top-3 border-r border-t")} aria-hidden />
      <span className={cn(base, "bottom-3 left-3 border-b border-l")} aria-hidden />
      <span className={cn(base, "bottom-3 right-3 border-b border-r")} aria-hidden />
    </>
  );
}

/* -------------------------------- voiceover ------------------------------- */

/** Deterministic bars, so the waveform never jitters between renders. */
const BARS = Array.from({ length: 120 }, (_, index) => {
  const wave =
    Math.sin(index * 0.31) * 0.42 + Math.sin(index * 1.13) * 0.3 + Math.sin(index * 2.7) * 0.16;
  return 0.22 + Math.abs(wave) * 0.74;
});

export function VoiceoverResult({ generation }: { generation: Generation }) {
  const audio = generation.audio;

  if (!audio) {
    return (
      <div className="p-4 sm:p-5">
        <GrainShimmer className="h-[92px] w-full border border-line" sweep={2.6} />
        <p className="pt-3 text-[12px] text-faint">{generation.stage ?? "Recording the take"}</p>
      </div>
    );
  }

  return (
    <VoiceoverTake
      key={audio.url}
      audio={audio}
      script={generation.text}
      voiceId={generation.meta.voiceId}
    />
  );
}

function VoiceoverTake({
  audio,
  script,
  voiceId,
}: {
  audio: NonNullable<Generation["audio"]>;
  script?: string;
  voiceId?: string;
}) {
  const element = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(audio.duration ?? 0);

  const progress = duration > 0 ? time / duration : 0;
  const words = audio.words;

  /** Index of the word being spoken right now, or -1. */
  const spoken = useMemo(() => {
    if (!words?.length) return -1;
    // Playback is monotonic, but seeking is not, so scan rather than advance.
    for (let index = words.length - 1; index >= 0; index -= 1) {
      if (time >= words[index].start) return index;
    }
    return -1;
  }, [words, time]);

  const active = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [spoken]);

  const seekTo = (fraction: number) => {
    const node = element.current;
    if (!node || !duration) return;
    node.currentTime = Math.min(duration, Math.max(0, fraction * duration));
  };

  return (
    <>
      <StatBar>
        <Stat label="Length" value={clock(duration)} />
        <Stat label="Voice" value={voiceId ? voiceId.slice(0, 8) : audio.voiceId.slice(0, 8)} />
        <Stat label="Engine" value={audio.model} />
        {audio.language ? <Stat label="Lang" value={audio.language} /> : null}
        {words?.length ? <Stat label="Words" value={String(words.length)} /> : null}
      </StatBar>

      {/* ── transport ── */}
      <div className="flex items-center gap-4 border-b border-line px-4 py-4 sm:px-5">
        <button
          type="button"
          onClick={() => {
            const node = element.current;
            if (!node) return;
            if (node.paused) void node.play();
            else node.pause();
          }}
          aria-label={playing ? "Pause the take" : "Play the take"}
          className="grid size-10 shrink-0 place-items-center bg-ink text-[#0a0b0d] transition-colors hover:bg-white"
        >
          {playing ? (
            <Pause className="size-4 fill-current" aria-hidden />
          ) : (
            <Play className="size-4 translate-x-px fill-current" aria-hidden />
          )}
        </button>

        <button
          type="button"
          aria-label="Seek"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            seekTo((event.clientX - rect.left) / rect.width);
          }}
          className="flex h-14 flex-1 items-center gap-px"
        >
          {BARS.map((height, index) => (
            <span
              key={index}
              className="flex-1 transition-colors duration-150"
              style={{
                height: `${height * 100}%`,
                background:
                  index / BARS.length <= progress ? "var(--text)" : "rgba(242,242,240,0.13)",
              }}
            />
          ))}
        </button>

        <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
          {clock(time)} / {clock(duration)}
        </span>
      </div>

      {/*
        ── the take, in words ──
        With per-word timings the transcript becomes the scrubber: you can see
        which syllable a bad read landed on and click straight to it.
      */}
      {words?.length ? (
        <div className="studio-scrollbar max-h-[240px] overflow-y-auto px-4 py-5 sm:px-5">
          <p className="mx-auto max-w-[62ch] text-[16px] leading-[1.85]">
            {words.map((word, index) => (
              <span
                key={index}
                ref={index === spoken ? active : undefined}
                role="button"
                tabIndex={-1}
                onClick={() => {
                  const node = element.current;
                  if (node) node.currentTime = word.start;
                }}
                className={cn(
                  "cursor-pointer transition-colors duration-150",
                  index === spoken
                    ? "bg-ink text-[#0a0b0d]"
                    : index < spoken
                      ? "text-muted"
                      : "text-faint hover:text-muted",
                )}
              >
                {word.word}{" "}
              </span>
            ))}
          </p>
        </div>
      ) : script ? (
        <div className="px-4 py-5 sm:px-5">
          <div className="prose-generated mx-auto max-w-[62ch] text-muted">
            <Markdown text={script} />
          </div>
        </div>
      ) : null}

      <audio
        ref={element}
        src={audio.url}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
    </>
  );
}
