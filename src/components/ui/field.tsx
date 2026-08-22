"use client";

import { useId, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[12px] font-medium tracking-wide text-muted">
        {label}
      </label>
      {children(id)}
      {hint ? <p className="text-[11px] leading-relaxed text-faint">{hint}</p> : null}
    </div>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}

/**
 * A native select, restyled. Native keeps keyboard and mobile behaviour correct
 * for free, which matters more here than a bespoke listbox.
 */
export function Select({ options, className, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-9 w-full appearance-none rounded-[10px] border border-line bg-surface-raised",
          "pl-3 pr-8 text-[13px] text-ink transition-colors",
          "hover:border-line-strong focus:border-line-strong disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint"
        aria-hidden
      />
    </div>
  );
}

export function Slider({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="range"
      className={cn(
        "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-hover",
        "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-3.5",
        "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink",
        "[&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:transition-transform",
        "[&::-webkit-slider-thumb]:hover:scale-110",
        "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full",
        "[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white",
        className,
      )}
      {...props}
    />
  );
}
