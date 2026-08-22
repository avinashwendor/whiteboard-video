"use client";

import { useCallback, useState } from "react";
import { Check, Copy, Download, PenLine, RefreshCw, Share2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/studio/use-studio";
import type { Generation } from "@/lib/studio/types";

function filenameFor(generation: Generation, extension: string): string {
  const base =
    generation.project?.title ??
    generation.prompt
      .slice(0, 48)
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `${(base || "chalkline").toLowerCase()}.${extension}`;
}

async function downloadUrl(url: string, filename: string) {
  const response = await fetch(url);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ResultActions({ generation }: { generation: Generation }) {
  const { run, reuse, setPrompt, setMode, running } = useStudio();
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const projectTitle = generation.project?.title;
  const scriptText =
    generation.text ??
    (generation.project
      ? [
          `# ${generation.project.title}`,
          "",
          generation.project.description,
          "",
          ...generation.project.scenes.flatMap((scene) => [
            `## ${scene.heading}`,
            ...scene.bullets.map((bullet) => `- ${bullet}`),
            "",
            scene.narration,
            "",
          ]),
        ].join("\n")
      : undefined);

  const copy = useCallback(async () => {
    if (!scriptText) return;
    try {
      await navigator.clipboard.writeText(scriptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_800);
    } catch {
      /* clipboard blocked -- the text is still on screen */
    }
  }, [scriptText]);

  const share = useCallback(async () => {
    const summary = [
      projectTitle ?? generation.prompt,
      "",
      scriptText ?? generation.prompt,
    ].join("\n");

    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: projectTitle ?? "Chalkline", text: summary });
        return;
      }
      await navigator.clipboard.writeText(summary);
      setShared(true);
      setTimeout(() => setShared(false), 1_800);
    } catch {
      /* user dismissed the sheet */
    }
  }, [projectTitle, generation.prompt, scriptText]);

  const download = useCallback(async () => {
    if (generation.image) {
      const extension = generation.image.url.includes(".png") ? "png" : "jpg";
      await downloadUrl(generation.image.url, filenameFor(generation, extension));
      return;
    }
    if (generation.audio) {
      await downloadUrl(generation.audio.url, filenameFor(generation, "mp3"));
      return;
    }
    if (scriptText) downloadText(scriptText, filenameFor(generation, "md"));
  }, [generation, scriptText]);

  const canDownload = Boolean(generation.image || generation.audio || scriptText);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {scriptText ? (
        <Button size="sm" variant="ghost" onClick={copy}>
          {copied ? <Check className="size-3.5 text-create" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      ) : null}

      {canDownload ? (
        <Button size="sm" variant="ghost" onClick={download}>
          <Download className="size-3.5" />
          Download
        </Button>
      ) : null}

      <Button
        size="sm"
        variant="ghost"
        disabled={running}
        onClick={() => void run({ prompt: generation.prompt, mode: generation.mode })}
      >
        <RefreshCw className="size-3.5" />
        Regenerate
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          reuse(generation);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      >
        <PenLine className="size-3.5" />
        Edit prompt
      </Button>

      {scriptText && generation.mode !== "voice" ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setPrompt(scriptText.slice(0, 2_000));
            setMode("voice");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <Volume2 className="size-3.5" />
          Narrate this
        </Button>
      ) : null}

      <Button size="sm" variant="ghost" onClick={share}>
        {shared ? <Check className="size-3.5 text-create" /> : <Share2 className="size-3.5" />}
        {shared ? "Copied" : "Share"}
      </Button>
    </div>
  );
}
