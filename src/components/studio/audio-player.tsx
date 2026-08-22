"use client";

import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils/cn";

function format(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

/** Compact waveform-ish scrubber. Deterministic bars, so it never jitters. */
const BARS = Array.from({ length: 56 }, (_, index) => {
  const wave = Math.sin(index * 0.7) * 0.5 + Math.sin(index * 1.9) * 0.28;
  return 0.32 + Math.abs(wave) * 0.62;
});

/** Remount this with `key={src}` when the clip changes -- state resets with it. */
export function AudioPlayer({ src, className }: { src: string; className?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);

  const progress = duration > 0 ? time / duration : 0;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-card border border-line bg-surface-raised px-3 py-2.5",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) void audio.play();
          else audio.pause();
        }}
        aria-label={playing ? "Pause narration" : "Play narration"}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-[#0a0b0d] transition-transform hover:scale-105 active:scale-95"
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
      </button>

      <button
        type="button"
        aria-label="Seek narration"
        className="flex h-9 flex-1 items-end gap-[2px]"
        onClick={(event) => {
          const audio = audioRef.current;
          if (!audio || !duration) return;
          const rect = event.currentTarget.getBoundingClientRect();
          audio.currentTime = ((event.clientX - rect.left) / rect.width) * duration;
        }}
      >
        {BARS.map((height, index) => (
          <span
            key={index}
            className="flex-1 rounded-full transition-colors"
            style={{
              height: `${height * 100}%`,
              background:
                index / BARS.length <= progress ? "var(--text)" : "rgba(255,255,255,0.14)",
            }}
          />
        ))}
      </button>

      <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
        {ready ? `${format(time)} / ${format(duration)}` : "—:—"}
      </span>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration);
          setReady(true);
        }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
    </div>
  );
}
