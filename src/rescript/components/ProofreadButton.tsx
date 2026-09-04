"use client";

import { useCallback, useState } from "react";
import { Check, Loader2, SpellCheck, X } from "lucide-react";
import { useEditorStore } from "@/rescript/lib/store";
import { TRANSCRIPT_LANGUAGES } from "@/rescript/lib/languages";
import Popover, { PopoverContent, PopoverTrigger } from "./Popover";
import { useI18n } from "./I18nProvider";

/** One proposed single-word substitution, plus whether the user still wants it. */
interface Suggestion {
  wordId: number;
  from: string;
  to: string;
  accepted: boolean;
}

/**
 * Ask a language model to proof-read the transcript, then let the user decide.
 *
 * Reviewed rather than applied, on purpose. Measured on real Telugu output the
 * model fixed a genuine mis-recognition and, in the same reply, "corrected" a
 * word that was already right — so silently rewriting the transcript would make
 * it worse as often as better. The same reasoning the app already applies to
 * fillers: propose, never assume.
 *
 * Each suggestion replaces exactly one word with one word, so accepting any
 * subset leaves every timestamp untouched and the timeline in sync.
 */
export default function ProofreadButton() {
  const { t } = useI18n();
  const words = useEditorStore((s) => s.words);
  const language = useEditorStore((s) => s.transcriptLanguage);
  const correctWords = useEditorStore((s) => s.correctWords);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  const run = useCallback(async () => {
    // Only proof-read what is actually in the cut; a suggestion on a word the
    // viewer will never hear is noise.
    const kept = words.filter((w) => !w.deleted);
    if (kept.length === 0) return;

    setBusy(true);
    setError(null);
    setSuggestions(null);
    try {
      const res = await fetch("/api/transcript/correct", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          words: kept.map((w) => w.text),
          language: TRANSCRIPT_LANGUAGES[language]?.label ?? "",
        }),
      });
      const json = (await res.json()) as {
        edits?: Array<{ index: number; text: string }>;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || t("proofread.failed"));

      const proposed = (json.edits ?? [])
        // The index is into what was sent, so it must be resolved against the
        // same list — never against `words`, which includes deleted entries.
        .filter((e) => e.index >= 0 && e.index < kept.length)
        .map((e) => ({
          wordId: kept[e.index].id,
          from: kept[e.index].text,
          to: e.text,
          accepted: true,
        }));
      setSuggestions(proposed);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("proofread.failed"));
    } finally {
      setBusy(false);
    }
  }, [words, language, t]);

  const apply = useCallback(() => {
    if (!suggestions) return;
    for (const s of suggestions) {
      if (s.accepted) correctWords([s.wordId], s.to);
    }
    setSuggestions(null);
    setOpen(false);
  }, [suggestions, correctWords]);

  const acceptedCount = suggestions?.filter((s) => s.accepted).length ?? 0;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reset on close so the next open re-checks. An empty result is still
        // an array, and an array is truthy — guarding the re-run on
        // "no suggestions yet" alone wedges it: once it found nothing it would
        // never look again, even after the transcript changed.
        if (!next) {
          setError(null);
          setSuggestions(null);
        }
      }}
      placement="bottom-end"
      offsetMain={6}
    >
      <PopoverTrigger>
        <button
          type="button"
          title={t("proofread.title")}
          aria-haspopup="menu"
          aria-expanded={open}
          // PopoverTrigger only supplies the positioning ref — opening is the
          // caller's job, the same way the language submenu does it.
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (!next) {
              setError(null);
              setSuggestions(null);
              return;
            }
            if (!busy) void run();
          }}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          {busy ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <SpellCheck size={13} />
          )}
          <span className="hidden sm:inline">{t("proofread.action")}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="z-50 w-72 p-1" aria-label={t("proofread.title")}>
        <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
          {t("proofread.title")}
        </p>

        {busy && (
          <p className="px-2.5 py-3 text-[12px] text-zinc-500 dark:text-zinc-400">
            {t("proofread.checking")}
          </p>
        )}

        {error && (
          <p className="px-2.5 py-3 text-[12px] text-red-600 dark:text-red-400">{error}</p>
        )}

        {!busy && !error && suggestions?.length === 0 && (
          <p className="px-2.5 py-3 text-[12px] text-zinc-500 dark:text-zinc-400">
            {t("proofread.none")}
          </p>
        )}

        {!busy && suggestions && suggestions.length > 0 && (
          <>
            <ul className="max-h-64 overflow-y-auto">
              {suggestions.map((s, i) => (
                <li key={s.wordId}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={s.accepted}
                    onClick={() =>
                      setSuggestions((prev) =>
                        prev
                          ? prev.map((p, j) =>
                              j === i ? { ...p, accepted: !p.accepted } : p
                            )
                          : prev
                      )
                    }
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        s.accepted
                          ? "border-zinc-800 bg-zinc-800 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900"
                          : "border-zinc-300 dark:border-zinc-600"
                      }`}
                    >
                      {s.accepted && <Check size={9} />}
                    </span>
                    <span className="min-w-0 flex-1 text-[12px] leading-tight">
                      <span className="text-zinc-400 line-through dark:text-zinc-500">
                        {s.from}
                      </span>
                      <span className="mx-1 text-zinc-300 dark:text-zinc-600">→</span>
                      <span className="font-medium text-zinc-800 dark:text-zinc-100">
                        {s.to}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-1 flex items-center gap-1 border-t border-zinc-100 p-1 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <X size={12} />
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={acceptedCount === 0}
                className="ml-auto flex cursor-pointer items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {t("proofread.apply", { count: acceptedCount })}
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
