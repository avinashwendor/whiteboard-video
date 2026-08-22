"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { ProjectEditor } from "@/components/studio/editor/project-editor";
import { useStudio } from "@/lib/studio/use-studio";

/**
 * The editor's own address.
 *
 * The project is read back out of history rather than handed over in memory,
 * which is what makes this page survive a refresh, a shared link between tabs,
 * and a dev-server restart -- history keeps its metadata in localStorage and
 * its blobs in IndexedDB.
 */
export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { history, historyLoaded, current, openGeneration } = useStudio();

  const generation = history.find((entry) => entry.id === id);

  // Keeps the rest of the studio pointed at what is being edited, so the
  // composer's recent strip and the top bar agree with this page.
  useEffect(() => {
    if (generation && current?.id !== generation.id) openGeneration(generation);
  }, [current?.id, generation, openGeneration]);

  if (!historyLoaded) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Opening the project
        </p>
      </div>
    );
  }

  if (!generation?.project) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <h1 className="text-[15px] font-medium text-ink">That project isn&apos;t here</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Projects live in this browser only, so a link from another device or a cleared history won&apos;t
          resolve.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link
            href="/history"
            className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-[12px] font-medium text-ink transition-colors hover:border-line-strong"
          >
            Browse history
          </Link>
          <Link
            href="/"
            className="rounded-lg bg-ink px-3 py-2 text-[12px] font-medium text-[#0a0b0d] transition-colors hover:bg-white"
          >
            Make a new one
          </Link>
        </div>
      </div>
    );
  }

  return <ProjectEditor key={generation.id} generation={generation} />;
}
