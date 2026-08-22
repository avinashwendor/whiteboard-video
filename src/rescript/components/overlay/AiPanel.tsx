"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CornerDownLeft,
  ListChecks,
  Loader2,
  Sparkles,
  Square,
  Wand2,
} from "lucide-react";
import { useEditorStore } from "@/rescript/lib/store";
import { isWordCutOut, originalToEdited } from "@/rescript/lib/edits";
import { useCutRanges } from "@/rescript/hooks/useCutRanges";
import {
  useOutputTime,
  useOutputTimeline,
} from "@/rescript/hooks/useOverlayTimeline";
import { useOverlayStore } from "@/rescript/lib/overlay/store";
import { runPlan, type OpResult } from "@/rescript/lib/overlay/ops";
import { analyseFootage } from "@/rescript/lib/overlay/analysis";
import { buildTimeline } from "@/rescript/lib/overlay/timeline";
import type { AgentOp } from "@/rescript/lib/overlay/ops-schema";
import { Button, Empty, formatSeconds } from "./ui";

/**
 * The prompt surface.
 *
 * It sends a *description* of the project, never the media and never the word
 * timings: a numbered element list, the boundary times, and a plain transcript
 * with coarse timestamps. What comes back is a list of operations that are
 * validated on the server, validated again here, and then run one at a time
 * with every step reported. Nothing is applied that the schema did not accept,
 * and a step that fails says so instead of failing silently.
 */

interface LogEntry {
  id: number;
  kind: "you" | "summary" | "ok" | "fail" | "note" | "finding";
  text: string;
}

interface ProposedStep {
  title: string;
  detail: string;
  ops: AgentOp[];
}

/** A proposal waiting to be accepted, in whole or in part. */
interface Proposal {
  summary: string;
  steps: ProposedStep[];
  /** Titles the person has unticked. */
  declined: Set<number>;
}

/**
 * One click that does the whole job. Phrased as a sentence rather than wired to
 * a special code path on purpose: it goes through the same planner as anything
 * typed, so what it does is inspectable and editable rather than hidden.
 */
const AUTO_EDIT =
  "Edit this for me end to end: cut the filler words and the dead air, " +
  "drop anything that rambles, put a transition on every cut, burn in " +
  "subtitles, and add a title card at the start based on what it is about.";

const SUGGESTIONS = [
  "Make this a 30 second short — keep only the best parts",
  "Cut every um, uh and long pause",
  "Burn in subtitles, big and centred like a Short",
  "Put a dissolve on every cut and a title card at the start",
  "Add a lower third with my name for the first five seconds",
  "Generate a hand-drawn rocket in the top right at 5s",
];

/** Roughly what fits in the model's window without crowding out the prompt. */
const TRANSCRIPT_BUDGET = 9_000;

let logSequence = 0;

export default function AiPanel() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const words = useEditorStore((s) => s.words);
  const duration = useEditorStore((s) => s.duration);
  const status = useEditorStore((s) => s.status);
  const cuts = useCutRanges();
  const timeline = useOutputTimeline();
  const playhead = useOutputTime();
  const aspect = useOverlayStore((s) => s.aspect);
  const manualCuts = useEditorStore((s) => s.manualCuts);
  const sceneBoundaries = useEditorStore((s) => s.sceneBoundaries);

  // Counts, not impressions: the proposal quotes these back, so they are
  // measured with the same functions the Tools menu uses.
  const analysis = useMemo(
    () => analyseFootage(words, duration, manualCuts, sceneBoundaries),
    [words, duration, manualCuts, sceneBoundaries]
  );

  const [can, setCan] = useState({ generateImage: true, photoSearch: false });

  // What this deployment can actually do decides what the model is allowed to
  // plan, so it is read once rather than guessed at per request.
  useEffect(() => {
    let alive = true;
    fetch("/api/capabilities")
      .then((r) => r.json())
      .then((json: {
        image?: { providers?: Array<{ id: string; configured?: boolean }> };
        visual?: { configured?: boolean };
      }) => {
        if (!alive) return;
        const providers = json.image?.providers ?? [];
        setCan({
          generateImage: providers.some((p) => p.configured !== false),
          photoSearch: json.visual?.configured ?? true,
        });
      })
      .catch(() => {
        // Leaving the defaults is right: a failed probe should not disable the
        // feature, it should let the actual request report the actual problem.
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const append = useCallback((kind: LogEntry["kind"], text: string) => {
    logSequence += 1;
    setLog((prev) => [...prev.slice(-60), { id: logSequence, kind, text }]);
  }, []);

  const buildTranscript = useCallback(() => {
    const kept = words.filter((w) => !w.deleted && !isWordCutOut(w, cuts));
    if (!kept.length) return undefined;

    // Stamped per sentence, not per fixed interval. Choosing where to cut means
    // choosing between whole thoughts, so the model needs a time against each
    // one — and a stamp every ten seconds lands mid-sentence and invites a cut
    // that clips someone off mid-word.
    const lines: string[] = [];
    let line: string[] = [];
    let lineStart = 0;
    let previousEnd = 0;

    const flush = () => {
      if (!line.length) return;
      lines.push(`[${formatSeconds(lineStart)}] ${line.join(" ")}`);
      line = [];
    };

    for (const word of kept) {
      const outStart = originalToEdited(word.start, cuts);
      if (!line.length) lineStart = outStart;
      line.push(word.text);
      // Break on sentence punctuation, on a real pause, or when a line has run
      // long enough that a cut point inside it would be hard to address.
      const sentenceEnd = /[.!?…]["')\]]?$/.test(word.text);
      const pause = originalToEdited(word.end, cuts);
      const nextGap = pause - previousEnd;
      previousEnd = pause;
      if (sentenceEnd || nextGap > 1.2 || line.length >= 40) flush();
    }
    flush();

    const text = lines.join("\n");
    return text.length > TRANSCRIPT_BUDGET
      ? `${text.slice(0, TRANSCRIPT_BUDGET)}\n…(transcript truncated)`
      : text;
  }, [words, cuts]);

  /** Send an instruction. Defaults to whatever is typed in the box. */
  const submitText = useCallback(async (
    text?: string,
    mode: "propose" | "execute" = "execute"
  ) => {
    const instruction = (text ?? prompt).trim();
    if (!instruction || busy) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setPrompt("");
    setProposal(null);
    append("you", instruction);

    try {
      const overlay = useOverlayStore.getState();
      const ordered = [...overlay.elements].sort((a, b) => a.z - b.z);

      const body = {
        instruction,
        context: {
          duration: timeline.duration || duration,
          playhead,
          boundaries: timeline.boundaries.map((b) => ({
            number: b.index,
            at: b.outTime,
          })),
          elements: ordered.map((element, i) => ({
            number: i + 1,
            kind: element.kind,
            name: element.name,
            text: element.kind === "text" ? element.text : undefined,
            start: element.start,
            end: element.end,
            position: { x: element.rect.x, y: element.rect.y },
          })),
          subtitles: {
            enabled: overlay.subtitles.enabled,
            cueCount: overlay.subtitles.cues.length,
          },
          transitions: overlay.transitions.map((t) => ({
            between: t.index,
            kind: t.kind,
            duration: t.duration,
          })),
          transcript: buildTranscript(),
          analysis: {
            wordCount: analysis.wordCount,
            wordsPerMinute: analysis.wordsPerMinute,
            speakerCount: analysis.speakerCount,
            fillerCount: analysis.fillerCount,
            fillerSeconds: analysis.fillerSeconds,
            silenceCount: analysis.silenceCount,
            silenceSeconds: analysis.silenceSeconds,
            longestPauses: analysis.longestPauses,
            clipCount: analysis.clipCount,
            runsLong: analysis.runsLong,
          },
          aspect,
          can,
        },
        mode,
      };

      const res = await fetch("/api/rescript/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await res.json()) as {
        success?: boolean;
        summary?: string;
        findings?: string[];
        steps?: ProposedStep[];
        ops?: AgentOp[];
        rejected?: string[];
        error?: { message?: string };
      };

      if (!res.ok || !json.success) {
        append("fail", json.error?.message ?? "That request didn't get through.");
        return;
      }

      if (json.summary) append("summary", json.summary);
      for (const finding of json.findings ?? []) append("finding", finding);
      for (const reason of json.rejected ?? []) {
        append("note", `Skipped — ${reason}`);
      }

      // A proposal is shown and waited on; only an execution runs immediately.
      // If the model answered a proposal request with a flat list anyway — it
      // sometimes does — that is still a proposal, not permission to run. It
      // gets wrapped into one step rather than executed behind the person's
      // back, because "show me the plan" must never turn into "did it".
      const steps = json.steps ?? [];
      if (mode === "propose") {
        const grouped =
          steps.length > 0
            ? steps
            : (json.ops ?? []).length > 0
              ? [
                  {
                    title: "The whole edit",
                    detail: json.summary ?? "",
                    ops: json.ops!,
                  },
                ]
              : [];

        if (grouped.length) {
          setProposal({
            summary: json.summary ?? "",
            steps: grouped,
            declined: new Set(),
          });
          return;
        }
        append("note", "Nothing worth changing was found.");
        return;
      }

      const ops = json.ops ?? [];
      if (!ops.length) {
        if (!json.summary) append("note", "Nothing to do for that one.");
        return;
      }

      const results: OpResult[] = await runPlan(
        ops,
        {
          playhead,
          duration: timeline.duration || duration,
          timeline,
          aspect,
        },
        (result) => append(result.ok ? "ok" : "fail", result.message),
        controller.signal
      );

      const failed = results.filter((r) => !r.ok).length;
      if (failed && failed === results.length) {
        append("note", "Nothing landed. Try saying it a different way.");
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") append("note", "Stopped.");
      else
        append(
          "fail",
          err instanceof Error ? err.message : "Something went wrong."
        );
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [
    prompt,
    busy,
    append,
    timeline,
    duration,
    playhead,
    aspect,
    analysis,
    can,
    buildTranscript,
  ]);

  /** Run the steps the person kept, in order, reporting each one. */
  const applyProposal = useCallback(async () => {
    const current = proposal;
    if (!current || busy) return;
    const accepted = current.steps.filter((_, i) => !current.declined.has(i));
    if (!accepted.length) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProposal(null);

    try {
      for (const step of accepted) {
        if (controller.signal.aborted) break;
        append("summary", step.title);
        // Rebuilt per step: an earlier step may have re-cut the video, and the
        // next one has to be planned against the clock that leaves behind.
        const editor = useEditorStore.getState();
        const fresh = buildTimeline(
          editor.words,
          editor.duration,
          editor.manualCuts,
          editor.sceneBoundaries
        );
        await runPlan(
          step.ops,
          {
            playhead: Math.min(playhead, Math.max(0, fresh.duration - 0.2)),
            duration: fresh.duration,
            timeline: fresh,
            aspect,
          },
          (result) => append(result.ok ? "ok" : "fail", result.message),
          controller.signal
        );
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") append("note", "Stopped.");
      else append("fail", err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [proposal, busy, append, playhead, aspect]);

  const ready = status === "ready";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={logRef}
        className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3"
      >
        {log.length === 0 ? (
          <div className="space-y-3 pt-2">
            <p className="px-1 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Describe the change. It reads the transcript, the clips and what is
              already on screen, then makes the edit.
            </p>

            <button
              type="button"
              disabled={!ready || busy}
              onClick={() => void submitText(AUTO_EDIT, "propose")}
              className="flex w-full cursor-pointer items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2.5 text-left transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:hover:bg-white"
            >
              <Wand2 size={15} className="shrink-0 text-white dark:text-zinc-900" />
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-white dark:text-zinc-900">
                  Analyse and propose an edit
                </span>
                <span className="block text-[10px] leading-tight text-zinc-300 dark:text-zinc-600">
                  Reads the footage, then shows you the plan before it runs
                </span>
              </span>
            </button>
            <div className="space-y-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setPrompt(suggestion)}
                  className="w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-left text-[12px] text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          log.map((entry) => <LogLine key={entry.id} entry={entry} />)
        )}
      </div>

      {proposal && (
        <div className="border-t border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-950/60">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            <ListChecks size={12} /> Proposed edit
          </p>

          <ul className="mb-2.5 space-y-1">
            {proposal.steps.map((step, i) => {
              const on = !proposal.declined.has(i);
              return (
                <li key={`${step.title}-${i}`}>
                  <button
                    type="button"
                    onClick={() =>
                      setProposal((prev) => {
                        if (!prev) return prev;
                        const declined = new Set(prev.declined);
                        if (declined.has(i)) declined.delete(i);
                        else declined.add(i);
                        return { ...prev, declined };
                      })
                    }
                    className={`flex w-full cursor-pointer items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
                      on
                        ? "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"
                        : "border-transparent bg-transparent opacity-50"
                    }`}
                  >
                    <span
                      className={`mt-px flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border text-[9px] ${
                        on
                          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                          : "border-zinc-400 text-transparent dark:border-zinc-600"
                      }`}
                    >
                      ✓
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px] font-medium text-zinc-800 dark:text-zinc-100">
                        {step.title}
                      </span>
                      {step.detail && (
                        <span className="block text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                          {step.detail}
                        </span>
                      )}
                      <span className="mt-0.5 block text-[10px] text-zinc-400 dark:text-zinc-500">
                        {step.ops.length} operation{step.ops.length === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex gap-1.5">
            <Button
              variant="solid"
              className="flex-1"
              disabled={busy || proposal.declined.size === proposal.steps.length}
              onClick={() => void applyProposal()}
            >
              <Check size={12} />
              Apply{" "}
              {proposal.declined.size
                ? `${proposal.steps.length - proposal.declined.size} of ${proposal.steps.length}`
                : "all"}
            </Button>
            <Button onClick={() => setProposal(null)} disabled={busy}>
              Discard
            </Button>
          </div>
        </div>
      )}

      <div className="border-t border-zinc-200 p-2.5 dark:border-zinc-800">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submitText();
              }
            }}
            rows={3}
            disabled={!ready}
            placeholder={
              ready
                ? "Add a caption, cut the fillers, put a dissolve on every cut…"
                : "Waiting for the transcript…"
            }
            className="scrollbar-thin w-full resize-none rounded-xl border border-zinc-200 bg-white py-2 pr-9 pl-2.5 text-[12px] leading-relaxed text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-500"
          />
          <div className="absolute right-1.5 bottom-1.5">
            {busy ? (
              <Button
                variant="ghost"
                onClick={() => abortRef.current?.abort()}
                title="Stop"
              >
                <Square size={12} />
              </Button>
            ) : (
              <Button
                variant="solid"
                onClick={() => void submitText()}
                disabled={!prompt.trim() || !ready}
                title="Send (Enter)"
              >
                <CornerDownLeft size={12} />
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-zinc-400 dark:text-zinc-600">
          {busy ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={10} className="animate-spin" /> Working…
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Sparkles size={10} /> Enter to send · Shift+Enter for a new line
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  if (entry.kind === "you") {
    return (
      <p className="ml-6 rounded-xl rounded-br-sm bg-zinc-900 px-2.5 py-1.5 text-[12px] leading-relaxed text-white dark:bg-zinc-100 dark:text-zinc-900">
        {entry.text}
      </p>
    );
  }
  if (entry.kind === "summary") {
    return (
      <p className="text-[12px] leading-relaxed font-medium text-zinc-800 dark:text-zinc-100">
        {entry.text}
      </p>
    );
  }
  const tone = {
    ok: "text-emerald-600 dark:text-emerald-400",
    fail: "text-red-600 dark:text-red-400",
    note: "text-amber-600 dark:text-amber-500",
    finding: "text-zinc-500 dark:text-zinc-400",
  }[entry.kind];
  const mark = { ok: "✓", fail: "✕", note: "!", finding: "·" }[entry.kind];
  return (
    <p className={`flex gap-1.5 pl-1 text-[11px] leading-relaxed ${tone}`}>
      <span aria-hidden className="shrink-0">
        {mark}
      </span>
      <span className="min-w-0">{entry.text}</span>
    </p>
  );
}

/** Empty state used when the sidebar renders before a project is open. */
export function AiPanelPlaceholder() {
  return <Empty>Load a video to start editing with prompts.</Empty>;
}
