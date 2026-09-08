"use client";

import type { ReactNode } from "react";

/**
 * The small set of controls every composition panel is built from.
 *
 * Kept together so the sidebar reads as one surface rather than five, and
 * styled against the same zinc scale the ported editor already uses — a second
 * palette in the same window is the fastest way to make an app look bolted
 * together.
 */

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-zinc-200 px-3 py-3 last:border-0 dark:border-zinc-800">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="mb-2 flex items-center gap-2 last:mb-0" title={hint}>
      <span className="w-20 shrink-0 text-[12px] text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">{children}</span>
    </label>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "ghost",
  title,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "ghost" | "solid" | "danger";
  title?: string;
  className?: string;
  type?: "button" | "submit";
}) {
  const styles = {
    ghost:
      "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800",
    solid:
      "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white",
    danger:
      "border border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950/40",
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`flex h-8 flex-1 cursor-pointer items-center justify-center px-1 text-[12px] font-medium transition ${
            value === option.value
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-8 w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-2 text-[12px] text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  onCommit,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
  format?: (value: number) => string;
}) {
  return (
    <>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        className="h-8 min-w-0 flex-1 cursor-pointer accent-zinc-900 dark:accent-zinc-100"
      />
      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
        {format ? format(value) : value.toFixed(2)}
      </span>
    </>
  );
}

export function NumberInput({
  value,
  min,
  max,
  step = 0.1,
  onChange,
  suffix,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <input
        type="number"
        value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="h-8 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2 text-[12px] tabular-nums text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
      />
      {suffix && (
        <span className="shrink-0 text-[11px] text-zinc-400">{suffix}</span>
      )}
    </span>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  multiline,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const shared =
    "w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[12px] text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500";
  if (multiline) {
    return (
      <textarea
        value={value}
        rows={3}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        className={`${shared} resize-none`}
      />
    );
  }
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
      className={`${shared} h-8 py-0`}
    />
  );
}

/**
 * A colour well plus a text field.
 *
 * `null` is a real value here — "no background" is not the same as black — so
 * the clear button is part of the control rather than a separate checkbox.
 */
export function ColorInput({
  value,
  onChange,
  allowNone,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  allowNone?: boolean;
}) {
  // <input type="color"> only speaks #rrggbb, so an rgba() value shows as its
  // nearest opaque swatch while the text field keeps the alpha.
  const swatch = /^#[0-9a-fA-F]{6}$/.test(value ?? "") ? value! : "#ffffff";
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <input
        type="color"
        value={swatch}
        onChange={(e) => onChange(e.target.value)}
        className="size-8 shrink-0 cursor-pointer rounded-lg border border-zinc-200 bg-transparent p-0.5 dark:border-zinc-700"
      />
      <input
        value={value ?? ""}
        placeholder={allowNone ? "none" : "#ffffff"}
        onChange={(e) => onChange(e.target.value.trim() || null)}
        onKeyDown={(e) => e.stopPropagation()}
        className="h-8 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2 font-mono text-[11px] text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
      />
      {allowNone && value !== null && (
        <button
          type="button"
          title="No colour"
          onClick={() => onChange(null)}
          className="h-8 shrink-0 cursor-pointer rounded-lg border border-zinc-200 px-1.5 text-[11px] text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          ✕
        </button>
      )}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-center justify-between gap-2 py-1"
    >
      <span className="text-[12px] text-zinc-600 dark:text-zinc-300">{label}</span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${
          checked ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-all dark:bg-zinc-900 ${
            checked ? "left-4.5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="px-1 py-6 text-center text-[12px] leading-relaxed text-zinc-400 dark:text-zinc-500">
      {children}
    </p>
  );
}

export function formatSeconds(value: number): string {
  const total = Math.max(0, value);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
