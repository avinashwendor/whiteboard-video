"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Copy, Download, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatProjectJson, parseProjectJson } from "@/lib/studio/project-schema";
import type { ProjectAsset } from "@/lib/studio/types";

/**
 * The project itself, as text.
 *
 * Everything the generator produced is here and editable -- headings, prompts,
 * search queries, the composed board spec, the word timings the animation is
 * scheduled against. Applying re-validates before anything reaches the
 * renderer, so a mistyped brace costs you nothing.
 */

/** Collapses the long numeric arrays so the shape of a project is readable. */
function compact(project: ProjectAsset): string {
  const clone = structuredClone(project) as unknown as Record<string, unknown>;
  const scenes = (clone.scenes ?? []) as Array<Record<string, unknown>>;
  for (const scene of scenes) {
    const audio = scene.audio as { words?: unknown[] } | undefined;
    if (audio?.words) audio.words = [`… ${audio.words.length} word timings`];
    const spec = scene.scene as { items?: Array<{ glyph?: unknown[] }>; glyph?: unknown[] } | undefined;
    if (spec?.glyph) spec.glyph = [`… ${spec.glyph.length} paths`];
    for (const item of spec?.items ?? []) {
      if (item.glyph) item.glyph = [`… ${item.glyph.length} paths`];
    }
  }
  return JSON.stringify(clone, null, 2);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "video-project";
}

export function JsonPanel({
  project,
  onApply,
}: {
  project: ProjectAsset;
  onApply: (next: ProjectAsset) => void;
}) {
  const full = useMemo(() => formatProjectJson(project), [project]);
  const [draft, setDraft] = useState(full);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readable, setReadable] = useState(false);
  const [copied, setCopied] = useState(false);

  // An edit made elsewhere -- the ask panel, the inspector -- shows up here,
  // unless there are unsaved keystrokes that would be thrown away.
  useEffect(() => {
    if (dirty) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirroring a prop that only changes on commit
    setDraft(full);
  }, [full, dirty]);

  const apply = () => {
    const result = parseProjectJson(draft);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setDirty(false);
    onApply(result.project);
  };

  const revert = () => {
    setDraft(full);
    setDirty(false);
    setError(null);
  };

  const download = () => {
    const blob = new Blob([full], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(project.title)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col gap-2.5 pb-6">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setReadable((value) => !value)}
          className={cn(
            "rounded-md border px-2 py-1 text-[10px] font-medium transition-colors",
            readable
              ? "border-line-strong bg-surface-hover text-ink"
              : "border-line bg-surface-raised text-muted hover:text-ink",
          )}
        >
          {readable ? "Readable view" : "Full JSON"}
        </button>

        <div className="flex items-center gap-1">
          <IconButton
            label="Copy"
            icon={copied ? Check : Copy}
            onClick={() => {
              navigator.clipboard.writeText(full).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1_800);
            }}
          />
          <IconButton label="Download" icon={Download} onClick={download} />
          <IconButton label="Revert" icon={RotateCcw} onClick={revert} disabled={!dirty} />
        </div>
      </div>

      {readable ? (
        <>
          <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface-raised p-3 font-mono text-[10.5px] leading-relaxed text-muted studio-scrollbar">
            {compact(project)}
          </pre>
          <p className="text-[10px] leading-relaxed text-faint">
            Word timings and icon geometry are collapsed here. Switch to Full JSON to edit.
          </p>
        </>
      ) : (
        <>
          <textarea
            spellCheck={false}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setDirty(true);
              setError(null);
            }}
            className="min-h-0 flex-1 resize-none rounded-lg border border-line bg-surface-raised p-3 font-mono text-[10.5px] leading-relaxed text-ink outline-none transition-colors hover:border-line-strong focus:border-line-strong studio-scrollbar"
          />

          {error ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-danger/25 bg-danger/8 px-2.5 py-2 text-[11px] leading-relaxed text-danger">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={apply}
            disabled={!dirty}
            className="rounded-lg bg-ink px-3 py-2 text-[11px] font-medium text-[#0a0b0d] transition-colors hover:bg-white disabled:pointer-events-none disabled:opacity-45"
          >
            {dirty ? "Apply changes" : "No changes"}
          </button>
        </>
      )}
    </div>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof Copy;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md border border-line bg-surface-raised text-muted transition-colors hover:border-line-strong hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}
