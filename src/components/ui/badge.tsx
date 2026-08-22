import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-raised",
        "px-2.5 py-1 text-[11px] font-medium tracking-wide text-muted",
        className,
      )}
      {...props}
    />
  );
}
