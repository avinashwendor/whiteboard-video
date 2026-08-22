"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-ink text-[#0a0a0b] hover:bg-white active:bg-white/90 font-medium",
  secondary:
    "bg-transparent text-ink border border-line-strong hover:bg-surface-raised hover:border-line-strong hover:text-white",
  ghost: "text-muted hover:text-ink hover:bg-surface-raised",
  danger: "border border-danger/30 text-danger hover:bg-danger/10 hover:border-danger/50",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[12.5px] gap-1.5 rounded-none",
  md: "h-10 px-4 text-[13px] gap-2 rounded-none",
  lg: "h-12 px-6 text-[14px] gap-2.5 rounded-none",
  icon: "h-9 w-9 rounded-none justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium whitespace-nowrap",
        "transition-[background-color,border-color,color,opacity] duration-150",
        "disabled:pointer-events-none disabled:opacity-40 rounded-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});
