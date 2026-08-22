"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, ImageOff, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton, TextSkeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/lib/utils/markdown";
import { cn } from "@/lib/utils/cn";
import { useStudio } from "@/lib/studio/use-studio";
import type { Generation } from "@/lib/studio/types";
import { AudioPlayer } from "./audio-player";
import { MODE_CONFIG } from "./mode-config";
import { ResultActions } from "./result-actions";

export function ResultPanel({ generation }: { generation: Generation }) {
  const config = MODE_CONFIG[generation.mode];

  return (
    <Card className="animate-rise overflow-hidden">
      <CardHeader>
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg border border-line"
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
  const running = generation.status === "running";

  switch (generation.mode) {
    case "write":
      return generation.text ? (
        <div className="prose-generated">
          <Markdown text={generation.text} />
          {running ? <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-ink align-middle" /> : null}
        </div>
      ) : (
        <TextSkeleton lines={6} />
      );

    case "image":
      return generation.image ? (
        <ImageResult generation={generation} />
      ) : (
        <div className="space-y-3">
          <Skeleton className="aspect-video w-full" />
          <p className="flex items-center gap-2 text-[12px] text-faint">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {generation.stage ?? "Generating"}
          </p>
        </div>
      );

    case "voice":
      return (
        <div className="space-y-4">
          {generation.text ? (
            <div className="prose-generated text-muted">
              <Markdown text={generation.text} />
            </div>
          ) : null}
          {generation.audio ? (
            <AudioPlayer key={generation.audio.url} src={generation.audio.url} />
          ) : (
            <Skeleton className="h-[58px] w-full" />
          )}
        </div>
      );

    case "create":
      return <ProjectResult generation={generation} />;
  }
}

function ImageResult({ generation }: { generation: Generation }) {
  const [failed, setFailed] = useState(false);
  const image = generation.image!;

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line py-12 text-center">
        <ImageOff className="size-5 text-faint" aria-hidden />
        <p className="text-[13px] text-muted">This image is no longer available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {image.fallbackFrom ? <FallbackNotice image={image} /> : null}
      <div className="overflow-hidden rounded-card border border-line bg-surface-raised">
        {/* eslint-disable-next-line @next/next/no-img-element -- blob and object URLs bypass the optimiser */}
        <img
          src={image.url}
          alt={generation.prompt}
          width={image.width}
          height={image.height}
          onError={() => setFailed(true)}
          className="block w-full animate-fade"
        />
      </div>
      {image.promptUsed && image.promptUsed !== generation.prompt ? (
        <details className="group">
          <summary className="cursor-pointer list-none text-[12px] text-faint transition-colors hover:text-muted">
            <Sparkles className="mr-1.5 inline size-3" aria-hidden />
            See the prompt that was actually used
          </summary>
          <p className="mt-2 rounded-card border border-line bg-surface-raised px-3 py-2.5 text-[12px] leading-relaxed text-muted">
            {image.promptUsed}
          </p>
        </details>
      ) : null}
    </div>
  );
}

function FallbackNotice({ image }: { image: NonNullable<Generation["image"]> }) {
  return (
    <p className="flex items-start gap-2 rounded-card border border-voice/25 bg-voice/8 px-3 py-2.5 text-[12px] leading-relaxed text-voice">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-medium">Puter couldn&apos;t run</strong> — {image.fallbackReason}
        {" "}Generated with Pollinations ({image.model}) instead.
      </span>
    </p>
  );
}

function ProjectResult({ generation }: { generation: Generation }) {
  const project = generation.project;

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

  // A finished video is handed to the editor as it lands. Coming back here
  // afterwards, this card is the way in again -- the video itself lives on its
  // own page now, not under the composer.
  if (done) {
    const runtime = project.scenes.reduce(
      (total, scene) => total + (scene.audio?.duration ?? Math.max(4.5, scene.narration.split(/\s+/).length / 2.5)),
      project.introDuration ?? 3,
    );

    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {project.cover ? (
          <span className="w-full shrink-0 overflow-hidden rounded-card border border-line sm:w-40">
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
          className="flex shrink-0 items-center gap-1.5 rounded-card bg-ink px-3.5 py-2 text-[12px] font-medium text-[#0a0b0d] transition-colors hover:bg-white"
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
              "rounded-card border border-line bg-surface-raised p-3 transition-opacity",
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
    <div className="flex flex-col items-start gap-3 rounded-card border border-danger/25 bg-danger/6 p-4">
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
