"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { useStudio } from "@/lib/studio/use-studio";
import type { Generation } from "@/lib/studio/types";
import { MODE_CONFIG } from "./mode-config";
import { ScriptResult, StillResult, StoryboardResult, VoiceoverResult } from "./results";
import { ResultActions } from "./result-actions";

export function ResultPanel({ generation }: { generation: Generation }) {
  const config = MODE_CONFIG[generation.mode];

  return (
    <Card className="animate-rise overflow-hidden">
      <CardHeader>
        <span
          className="grid size-7 shrink-0 place-items-center rounded-none border border-line"
          style={{ color: config.accent }}
        >
          <config.icon className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">
            {generation.project?.title ?? generation.prompt}
          </p>
          <p className="truncate text-[11px] text-faint">
            {config.label}
            {generation.status === "running" && generation.stage ? ` · ${generation.stage}` : ""}
          </p>
        </div>
        {generation.status === "done" ? <ResultActions generation={generation} /> : null}
      </CardHeader>

      {generation.status === "running" ? <ProgressBar value={generation.progress ?? 0} /> : null}

      <CardBody className="space-y-4">
        {generation.status === "error" ? (
          <ErrorState generation={generation} />
        ) : (
          <ResultBody generation={generation} />
        )}
      </CardBody>

      {generation.status === "done" ? <MetaFooter generation={generation} /> : null}
    </Card>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-0.5 w-full bg-surface-raised" role="progressbar" aria-valuenow={Math.round(value * 100)}>
      <div
        className="h-full bg-ink transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(4, value * 100)}%` }}
      />
    </div>
  );
}

function ResultBody({ generation }: { generation: Generation }) {
  switch (generation.mode) {
    case "write":
      return <ScriptResult generation={generation} />;
    case "image":
      return <StillResult generation={generation} />;
    case "storyboard":
      return <StoryboardResult generation={generation} />;
    case "voice":
      return <VoiceoverResult generation={generation} />;
    case "create":
      return (
        <div className="p-4 sm:p-5">
          <ProjectResult generation={generation} />
        </div>
      );
  }
}

function ProjectResult({ generation }: { generation: Generation }) {
  const project = generation.project!;

  if (!project) {
    return (
      <div className="space-y-3">
        <Skeleton className="aspect-video w-full" />
        <p className="flex items-center gap-2 text-[12px] text-faint">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {generation.stage ?? "Planning"}
        </p>
      </div>
    );
  }

  const done = generation.status === "done";
  const readyScenes = project.scenes.filter(
    (scene) => scene.scene || scene.image || scene.audio,
  ).length;

  if (done) {
    const runtime = project.scenes.reduce(
      (total, scene) => total + (scene.audio?.duration ?? Math.max(4.5, scene.narration.split(/\s+/).length / 2.5)),
      project.introDuration ?? 3,
    );

    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {project.cover ? (
          <span className="w-full shrink-0 overflow-hidden rounded-none border border-line sm:w-40">
            {/* eslint-disable-next-line @next/next/no-img-element -- object URLs from IndexedDB */}
            <img src={project.cover.url} alt="" className="block w-full" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">{project.description}</p>
          <p className="mt-1.5 text-[11px] text-faint">
            {project.scenes.length} scenes · ~{Math.round(runtime)}s ·{" "}
            {project.videoStyle === "hyperframes" ? "Modern frames" : "Whiteboard"}
          </p>
        </div>
        <Link
          href={`/editor/${generation.id}`}
          className="flex shrink-0 items-center gap-1.5 rounded-none bg-ink px-3.5 py-2 text-[12px] font-medium text-[#0a0b0d] transition-colors hover:bg-white"
        >
          Open in editor
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-muted">{project.description}</p>
      <div className="space-y-3">
        <Skeleton className="aspect-video w-full" />
        <p className="flex items-center gap-2 text-[12px] text-faint">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {generation.stage ?? "Building"} · {readyScenes}/{project.scenes.length} scenes ready
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {project.scenes.map((scene, index) => (
          <div
            key={`${scene.heading}-${index}`}
            className={cn(
              "rounded-none border border-line bg-surface-raised p-3 transition-opacity",
              scene.status === "pending" && "opacity-50",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-faint">{String(index + 1).padStart(2, "0")}</span>
              <p className="truncate text-[13px] font-medium text-ink">{scene.heading}</p>
              {scene.status === "running" ? (
                <Loader2 className="ml-auto size-3 animate-spin text-faint" aria-hidden />
              ) : null}
            </div>
            <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted">{scene.narration}</p>
            {scene.error ? <p className="mt-1.5 text-[11px] text-danger">{scene.error}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ generation }: { generation: Generation }) {
  const { run, running, resetSession, cancel } = useStudio();
  const isBusy =
    generation.error?.code === "busy" ||
    generation.error?.message?.includes("already have a generation running");

  return (
    <div className="flex flex-col items-start gap-3 rounded-none border border-danger/25 bg-danger/6 p-4">
      <p className="flex items-start gap-2 text-[13px] leading-relaxed text-danger">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {isBusy
          ? "A generation was already in-flight or was interrupted by a page refresh. You can unlock and start fresh."
          : (generation.error?.message ?? "Something went wrong.")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={running}
          onClick={() => {
            if (isBusy) resetSession();
            void run({ prompt: generation.prompt, mode: generation.mode });
          }}
        >
          <RefreshCw className="size-3.5" />
          {isBusy ? "Unlock & Retry" : "Retry"}
        </Button>
        {isBusy ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => resetSession()}
          >
            Reset Session
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => cancel()}
          >
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}

function MetaFooter({ generation }: { generation: Generation }) {
  const { meta } = generation;
  const items: Array<[string, string]> = [];

  if (meta.model) items.push(["Model", meta.model]);
  if (meta.imageModel) items.push(["Image", meta.imageModel]);
  if (generation.image) items.push(["Provider", generation.image.provider]);
  if (meta.voiceId) items.push(["Voice", meta.voiceId.slice(0, 8)]);
  if (meta.language) items.push(["Language", meta.language]);
  if (meta.usage?.totalTokens) items.push(["Tokens", String(meta.usage.totalTokens)]);
  if (meta.durationMs) items.push(["Took", `${(meta.durationMs / 1000).toFixed(1)}s`]);

  if (!items.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-3 sm:px-5">
      {items.map(([label, value]) => (
        <Badge key={label}>
          <span className="text-faint">{label}</span>
          <span className="font-mono text-ink">{value}</span>
        </Badge>
      ))}
    </div>
  );
}
