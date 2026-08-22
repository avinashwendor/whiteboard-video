"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MODE_CONFIG, MODE_ORDER } from "@/components/studio/mode-config";
import { clearHistory, removeGeneration } from "@/lib/studio/history";
import { useStudio } from "@/lib/studio/use-studio";
import type { Mode } from "@/lib/studio/types";
import { cn } from "@/lib/utils/cn";

function relative(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function HistoryPage() {
  const { history, openGeneration, refreshHistory } = useStudio();
  const router = useRouter();
  const [filter, setFilter] = useState<Mode | "all">("all");

  const filtered = useMemo(
    () => (filter === "all" ? history : history.filter((entry) => entry.mode === filter)),
    [filter, history],
  );

  const open = (id: string) => {
    const generation = history.find((entry) => entry.id === id);
    if (!generation) return;
    openGeneration(generation);
    // A video is a project you carry on editing; everything else is a result.
    router.push(generation.project ? `/editor/${generation.id}` : "/");
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="mt-1 text-[13px] text-muted">
            Everything you&apos;ve generated, stored in this browser only.
          </p>
        </div>
        {history.length ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              clearHistory();
              refreshHistory();
            }}
          >
            <Trash2 className="size-3.5" />
            Clear all
          </Button>
        ) : null}
      </div>

      {history.length ? (
        <div className="mb-5 flex flex-wrap gap-1">
          {(["all", ...MODE_ORDER] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "h-8 rounded-lg px-3 text-[13px] font-medium transition-colors",
                filter === value ? "bg-surface-hover text-ink" : "text-muted hover:text-ink",
              )}
            >
              {value === "all" ? "All" : MODE_CONFIG[value].label}
            </button>
          ))}
        </div>
      ) : null}

      {filtered.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((generation) => {
            const config = MODE_CONFIG[generation.mode];
            const thumbnail = generation.image?.url ?? generation.project?.cover?.url;
            return (
              <li key={generation.id} className="animate-rise">
                <div className="group relative h-full overflow-hidden rounded-panel border border-line bg-surface transition-colors hover:border-line-strong">
                  <button
                    type="button"
                    onClick={() => open(generation.id)}
                    className="block w-full text-left"
                  >
                    <div className="aspect-video overflow-hidden border-b border-line bg-surface-raised">
                      {thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element -- object URLs from IndexedDB
                        <img
                          src={thumbnail}
                          alt=""
                          className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="grid size-full place-items-center">
                          <config.icon className="size-5" style={{ color: config.accent }} aria-hidden />
                        </div>
                      )}
                    </div>
                    <div className="p-3.5">
                      <p className="line-clamp-2 text-[13px] leading-relaxed text-ink">
                        {generation.project?.title ?? generation.prompt}
                      </p>
                      <p className="mt-2 flex items-center gap-2 text-[11px] text-faint">
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: config.accent }}
                          aria-hidden
                        />
                        {config.label}
                        <span aria-hidden>·</span>
                        {relative(generation.createdAt)}
                        {generation.meta.imageModel ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="truncate font-mono">{generation.meta.imageModel}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    aria-label="Delete this generation"
                    onClick={() => {
                      removeGeneration(generation.id);
                      refreshHistory();
                    }}
                    className="absolute right-2 top-2 grid size-8 place-items-center rounded-lg border border-line bg-bg/80 text-muted opacity-0 backdrop-blur transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-panel border border-dashed border-line py-20 text-center">
          <p className="text-[14px] text-muted">
            {history.length ? "Nothing in this filter yet." : "No generations yet."}
          </p>
          <Button className="mt-4" variant="secondary" size="sm" onClick={() => router.push("/")}>
            Start creating
          </Button>
        </div>
      )}
    </div>
  );
}
