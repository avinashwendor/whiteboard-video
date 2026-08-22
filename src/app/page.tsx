"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CapabilityCards } from "@/components/studio/capability-cards";
import { Composer } from "@/components/studio/composer";
import { Examples } from "@/components/studio/examples";
import { ResultPanel } from "@/components/studio/result-panel";
import { MODE_CONFIG } from "@/components/studio/mode-config";
import { useStudio } from "@/lib/studio/use-studio";
import { cn } from "@/lib/utils/cn";

export default function StudioPage() {
  const { current, history, openGeneration, reuse } = useStudio();
  const recent = history.filter((entry) => entry.id !== current?.id).slice(0, 4);

  const isEditingProject =
    current?.mode === "create" && current?.status === "done" && Boolean(current?.project);

  return (
    <div className="relative min-h-screen">
      <div className="grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-[420px]" aria-hidden />

      <div
        className={cn(
          "relative mx-auto px-4 pb-24 pt-8 transition-all duration-300 sm:px-6",
          isEditingProject ? "max-w-7xl" : "max-w-3xl pt-12 sm:pt-16",
        )}
      >
        {isEditingProject ? (
          <div className="mb-8 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                // Return to composer
                window.location.reload();
              }}
              className="flex items-center gap-2 text-xs font-medium text-neutral-400 transition-colors hover:text-neutral-200"
            >
              <ArrowRight className="size-3.5 rotate-180" />
              <span>Back to Create</span>
            </button>
          </div>
        ) : (
          <section className="mb-8 text-center sm:mb-10">
            <h1 className="text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[46px]">
              Create anything with AI.
            </h1>
            <p className="mx-auto mt-3.5 max-w-lg text-pretty text-[15px] leading-relaxed text-muted sm:text-base">
              Turn one idea into words, visuals and voice — assembled into a whiteboard video you can
              watch and export.
            </p>
          </section>
        )}

        {!isEditingProject ? <Composer /> : null}

        {current ? (
          <div className="mt-6">
            <ResultPanel generation={current} />
          </div>
        ) : null}

        <div className="mt-12 space-y-10">
          {current ? null : <Examples />}

          {recent.length ? (
            <section aria-labelledby="recent-heading" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 id="recent-heading" className="text-[12px] font-medium tracking-wide text-faint">
                  Recent
                </h2>
                <Link
                  href="/history"
                  className="flex items-center gap-1 rounded-md text-[12px] text-muted transition-colors hover:text-ink"
                >
                  All generations
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {recent.map((generation) => {
                  const config = MODE_CONFIG[generation.mode];
                  const thumbnail = generation.image?.url ?? generation.project?.cover?.url;
                  return (
                    <button
                      key={generation.id}
                      type="button"
                      onClick={() => {
                        openGeneration(generation);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="flex items-center gap-3 rounded-card border border-line bg-surface p-2.5 text-left transition-colors hover:border-line-strong hover:bg-surface-raised"
                    >
                      <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface-raised">
                        {thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element -- object URLs from IndexedDB
                          <img src={thumbnail} alt="" className="size-full object-cover" />
                        ) : (
                          <config.icon className="size-4" style={{ color: config.accent }} aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">
                          {generation.project?.title ?? generation.prompt}
                        </span>
                        <span className="block text-[11px] text-faint">{config.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          <CapabilityCards />
        </div>
      </div>
    </div>
  );
}
