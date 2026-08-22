"use client";

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/** The small labelled inputs the inspector is built out of. */

export function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium tracking-wide text-muted">{children}</span>;
}

const BOX =
  "w-full rounded-lg border border-line bg-surface-raised px-3 text-[12px] text-ink outline-none " +
  "transition-colors placeholder:text-faint hover:border-line-strong focus:border-line-strong";

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" className={cn(BOX, "h-8", className)} {...props} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(BOX, "resize-none py-2 leading-relaxed", className)} {...props} />;
}

export function LabelledInput({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      <TextInput {...props} />
    </label>
  );
}

export function LabelledArea({
  label,
  hint,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      <TextArea {...props} />
      {hint ? <span className="text-[10px] leading-relaxed text-faint">{hint}</span> : null}
    </label>
  );
}

/** A row of mutually exclusive pills -- used for every small enum in the JSON. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 2,
}: {
  label: string;
  value: T | undefined;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  columns?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-lg border px-2 py-1.5 text-center text-[11px] font-medium transition-colors",
              value === option.value
                ? "border-line-strong bg-surface-hover text-ink"
                : "border-line bg-surface-raised text-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A list of short strings: bullets, keywords. */
export function StringList({
  label,
  values,
  onChange,
  placeholder,
  hint,
  addLabel = "Add",
  max = 8,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  hint?: string;
  addLabel?: string;
  max?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {values.length < max ? (
          <button
            type="button"
            onClick={() => onChange([...values, ""])}
            className="text-[10px] font-medium text-muted transition-colors hover:text-ink"
          >
            + {addLabel}
          </button>
        ) : null}
      </div>
      <div className="space-y-1.5">
        {values.map((entry, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <TextInput
              value={entry}
              placeholder={placeholder}
              onChange={(event) => {
                const next = [...values];
                next[index] = event.target.value;
                onChange(next);
              }}
            />
            <button
              type="button"
              aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
              className="shrink-0 px-1 text-[11px] text-faint transition-colors hover:text-danger"
            >
              ✕
            </button>
          </div>
        ))}
        {values.length ? null : (
          <p className="text-[11px] text-faint">Nothing here yet.</p>
        )}
      </div>
      {hint ? <span className="text-[10px] leading-relaxed text-faint">{hint}</span> : null}
    </div>
  );
}
