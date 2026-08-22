import { cn } from "@/lib/utils/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-card", className)} aria-hidden />;
}

export function TextSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-2.5" role="status" aria-label="Generating">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className={cn("h-3.5", index === lines - 1 ? "w-2/5" : index % 3 === 1 ? "w-11/12" : "w-full")}
        />
      ))}
    </div>
  );
}
