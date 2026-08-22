"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The ASCII loading language.
 *
 * Every waiting state in Motionhouse is drawn from the same three pieces: a
 * shimmer field standing in for pixels that do not exist yet, a spinner for
 * inline work, and a bracketed bar for work with a known end. They share one
 * palette and one monospace grid so a busy editor reads as one machine rather
 * than four different loading widgets.
 *
 * Nothing here uses Math.random at render time — the fields are generated from
 * a seeded sequence so the server and the client agree on the same glyphs.
 */

/* ---------------------------------- grain --------------------------------- */

export interface GrainShimmerProps {
  /** Noise opacity, 0..1. */
  intensity?: number;
  /** Sweep duration in seconds. 0 disables the light band. */
  sweep?: number;
  /** Draw the soft centre glow under the grain. */
  glow?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The waiting texture.
 *
 * Fractal noise jittered on a half-second loop, a light band crossing it, and
 * a slow breath underneath — film grain rather than a widget. It stands in for
 * pixels that do not exist yet without pretending to be a preview of them.
 *
 * All three layers are CSS; there is no canvas and no per-frame JavaScript, so
 * a dozen of these cost nothing.
 */
export function GrainShimmer({
  intensity = 0.5,
  sweep = 3.2,
  glow = true,
  className,
  style,
}: GrainShimmerProps) {
  return (
    <div className={cn("grain-shimmer", className)} style={style} aria-hidden>
      <div className="grain-shimmer__noise" style={{ opacity: intensity }} />
      {glow ? <div className="grain-shimmer__glow" /> : null}
      {sweep > 0 ? (
        <div className="grain-shimmer__sweep" style={{ animationDuration: `${sweep}s` }} />
      ) : null}
    </div>
  );
}

/* --------------------------------- spinner -------------------------------- */

const SPINNERS = {
  braille: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  blocks: ["░", "▒", "▓", "█", "▓", "▒"],
  bar: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"],
  arc: ["◜", "◝", "◞", "◟"],
  quadrant: ["▖", "▘", "▝", "▗"],
  /** Reads as a strip of film advancing. */
  film: ["▰▱▱▱", "▱▰▱▱", "▱▱▰▱", "▱▱▱▰", "▱▱▰▱", "▱▰▱▱"],
  /** A dot travelling a fixed track — good next to a percentage. */
  track: ["·—————", "—·————", "——·———", "———·——", "————·—", "—————·"],
} as const;

export type AsciiSpinnerVariant = keyof typeof SPINNERS;

/** Shared clock so every spinner on screen steps on the same beat. */
function useFrameIndex(length: number, intervalMs: number, paused = false) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setIndex((value) => (value + 1) % length), intervalMs);
    return () => clearInterval(id);
  }, [length, intervalMs, paused]);
  return index;
}

export function AsciiSpinner({
  variant = "braille",
  intervalMs = 90,
  className,
  style,
  label,
}: {
  variant?: AsciiSpinnerVariant;
  intervalMs?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Announced to screen readers in place of the glyph animation. */
  label?: string;
}) {
  const frames = SPINNERS[variant];
  const reduced = usePrefersReducedMotion();
  const index = useFrameIndex(frames.length, intervalMs, reduced);

  return (
    <span
      className={cn("inline-block select-none font-mono tabular-nums", className)}
      style={style}
      role={label ? "status" : undefined}
      aria-label={label}
    >
      <span aria-hidden>{frames[index]}</span>
    </span>
  );
}

/* -------------------------------- progress -------------------------------- */

/**
 * A bracketed bar. Pass a value for determinate work; leave it undefined and a
 * lit segment cycles across instead, which is honest about not knowing.
 */
export function AsciiProgress({
  value,
  width = 28,
  showPercent = true,
  className,
}: {
  value?: number;
  width?: number;
  showPercent?: boolean;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const cycle = useFrameIndex(width, 70, reduced || value !== undefined);

  const bar = useMemo(() => {
    if (value === undefined) {
      return Array.from({ length: width }, (_, i) => {
        const distance = Math.abs(i - cycle);
        return distance === 0 ? "█" : distance === 1 ? "▓" : distance === 2 ? "▒" : "░";
      }).join("");
    }
    const filled = Math.round(Math.min(1, Math.max(0, value)) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
  }, [value, width, cycle]);

  return (
    <span className={cn("select-none font-mono tabular-nums", className)} aria-hidden>
      ├{bar}┤
      {showPercent && value !== undefined ? (
        <span className="pl-2">{String(Math.round(value * 100)).padStart(3, " ")}%</span>
      ) : null}
    </span>
  );
}

/* ---------------------------------- veil ---------------------------------- */

export interface AsciiVeilStep {
  label: string;
  /** done → ✓, active → spinner, pending → dim. */
  state: "done" | "active" | "pending";
}

/**
 * The overlay that sits on top of blurred output.
 *
 * Output in progress is never shown as-is: the work underneath is blurred and
 * this covers it, so a half-drawn frame reads as "not ready" instead of "bad".
 */
export function AsciiVeil({
  title,
  detail,
  progress,
  steps,
  elapsedSeconds,
  footnote,
  className,
}: {
  title: string;
  detail?: string;
  progress?: number;
  steps?: AsciiVeilStep[];
  elapsedSeconds?: number;
  footnote?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center overflow-hidden",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {/* the field itself, clipped to the frame */}
      <GrainShimmer intensity={0.42} sweep={3.2} className="absolute inset-0" />

      {/* darkening so the copy stays readable over both the field and the blur */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(10,10,11,0.52) 0%, rgba(10,10,11,0.3) 52%, rgba(10,10,11,0.66) 100%)",
        }}
      />

      <div className="relative flex w-full max-w-[440px] flex-col items-center px-6 text-center">
        <p className="flex items-center gap-2.5 text-[15px] font-medium tracking-[-0.01em] text-ink">
          <AsciiSpinner variant="braille" className="text-[15px] text-create" />
          {title}
        </p>

        {detail ? <p className="mt-2 text-[13px] leading-relaxed text-muted">{detail}</p> : null}

        <AsciiProgress value={progress} width={30} className="mt-5 text-[11px] text-faint" />

        {steps?.length ? (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em]">
            {steps.map((step, index) => (
              <span key={step.label} className="flex items-center gap-1.5">
                {index > 0 ? <span className="pr-3 text-[#3a3a37]">·</span> : null}
                <span
                  className={
                    step.state === "done"
                      ? "text-create"
                      : step.state === "active"
                        ? "text-ink"
                        : "text-[#4e4e4a]"
                  }
                >
                  {step.state === "done" ? "✓" : step.state === "active" ? <AsciiSpinner variant="quadrant" intervalMs={140} /> : "·"}
                </span>
                <span className={step.state === "pending" ? "text-[#4e4e4a]" : "text-muted"}>
                  {step.label}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* corner telemetry, matching the frame marks used elsewhere */}
      {elapsedSeconds !== undefined ? (
        <span className="absolute left-6 top-5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#4e4e4a]">
          {formatClock(elapsedSeconds)} · working
        </span>
      ) : null}
      {footnote ? (
        <span className="absolute bottom-5 left-6 font-mono text-[10px] uppercase tracking-[0.14em] text-[#4e4e4a]">
          {footnote}
        </span>
      ) : null}
    </div>
  );
}

/* --------------------------------- helpers -------------------------------- */

/**
 * Wraps content that must not be read while it is still being produced.
 * The child is blurred and inert; the veil goes on top.
 */
export function BlurredWhileBusy({
  busy,
  blur = 18,
  children,
  className,
  overlay,
}: {
  busy: boolean;
  /** Radius in pixels while busy. Lower it as the work converges. */
  blur?: number;
  children: React.ReactNode;
  className?: string;
  overlay?: React.ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div
        className="transition-[filter,transform,opacity] duration-700 ease-out"
        style={{
          filter: busy ? `blur(${blur}px) saturate(0.55) brightness(0.85)` : "none",
          // scale hides the transparent skirt a CSS blur leaves at the edges
          transform: busy ? "scale(1.04)" : "none",
          pointerEvents: busy ? "none" : undefined,
        }}
        aria-hidden={busy || undefined}
      >
        {children}
      </div>
      {busy ? overlay : null}
    </div>
  );
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/** Seconds since mount, ticking once a second. */
export function useElapsed(active: boolean) {
  const start = useRef<number | null>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      start.current = null;
      return;
    }
    start.current = Date.now();
    const id = setInterval(() => {
      if (start.current) setSeconds(Math.floor((Date.now() - start.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  return seconds;
}

export function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** A one-line inline loader: spinner + label, for panels and buttons. */
export function AsciiInline({
  label,
  variant = "braille",
  className,
}: {
  label: string;
  variant?: AsciiSpinnerVariant;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2 font-mono text-[11px] text-muted", className)}>
      <AsciiSpinner variant={variant} className="text-create" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * A grain block that stands in for a paragraph or a card while it loads — the
 * textured answer to a skeleton row.
 */
export function GrainSkeleton({
  lines = 3,
  className,
}: {
  /** Height is derived from the line count so it matches the copy it replaces. */
  lines?: number;
  className?: string;
}) {
  return (
    <GrainShimmer
      intensity={0.55}
      sweep={2.4}
      className={cn("w-full border border-line", className)}
      style={{ height: lines * 18 }}
    />
  );
}
