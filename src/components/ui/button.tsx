"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-ink text-[#0a0b0d] hover:bg-white active:bg-white/90 shadow-[0_1px_0_rgba(255,255,255,0.4)_inset]",
  secondary:
    "bg-surface-raised text-ink border border-line hover:bg-surface-hover hover:border-line-strong",
  ghost: "text-muted hover:text-ink hover:bg-surface-raised",
  danger: "bg-danger/12 text-danger border border-danger/25 hover:bg-danger/18",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-[10px]",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-[10px] justify-center",
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
        "transition-[background-color,border-color,color,transform,opacity] duration-150",
        "disabled:pointer-events-none disabled:opacity-45 active:scale-[0.985]",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});
