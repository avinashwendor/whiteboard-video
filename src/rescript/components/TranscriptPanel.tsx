"use client";

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpFromLine,
  ChevronLast,
  Eye,
  EyeOff,
  Merge,
  Pencil,
  RotateCcw,
  Scissors,
  VolumeOff,
  X,
} from "lucide-react";
import { FloatingPortal } from "@floating-ui/react";
import { useEditorStore } from "@/rescript/lib/store";
import { isDisfluencyPlaceholder } from "@/rescript/lib/disfluencies";
import TranscriptToolsMenu from "./TranscriptToolsMenu";
import ProofreadButton from "./ProofreadButton";
import {
  isTranscriptFile,
  parseTranscriptFile,
  TRANSCRIPT_ACCEPT,
} from "@/rescript/lib/parseTranscript";
import type { Word } from "@/rescript/lib/types";
import TranscriptScrollIndicator from "./TranscriptScrollIndicator";
import SpeakerLabel, {
  SelectionSpeakerButton,
  SelectionSpeakerPopover,
} from "./SpeakerLabel";
import {
  getActiveSceneBoundaries,
  getKeepRanges,
  isWordCutOut,
  mapSplitsToWords,
} from "@/rescript/lib/edits";
import { useTranscriptSelection } from "@/rescript/hooks/useTranscriptSelection";
import { useTranscriptCaret } from "@/rescript/hooks/useTranscriptCaret";
import { findPauses, formatPause, type Pause } from "@/rescript/lib/pauses";
import { useTranscriptPlayheadFollow } from "@/rescript/hooks/useTranscriptPlayheadFollow";
import { useWordAnchorFloating } from "@/rescript/hooks/useWordAnchorFloating";
import { useCutRanges } from "@/rescript/hooks/useCutRanges";
import { findActiveWordId, groupWordsBySpeaker } from "@/rescript/lib/transcript";
import { isTypingTarget } from "@/rescript/lib/keyboard";
import { useI18n } from "./I18nProvider";
import { localizeRuntimeMessage } from "@/rescript/lib/i18n";

const WordSpan = memo(function WordSpan({
  word,
  cutOut,
  active,
  onClick,
}: {
  word: Word;
  /** True when the word is removed from the edited media (deleted or covered by a cut). */
  cutOut: boolean;
  active: boolean;
  /** `fraction` is where in the word's box the click landed, 0..1, for caret placement. */
  onClick: (word: Word, el: HTMLElement, fraction: number) => void;
}) {
  const { t } = useI18n();
  const placeholder = isDisfluencyPlaceholder(word.text);
  // The trailing space lives inside the span so that selection and deletion
  // highlights are continuous across words instead of breaking at each gap.
  return (
    <span
      data-wid={word.id}
      data-cut={cutOut ? "" : undefined}
      data-placeholder={placeholder ? "" : undefined}
      title={placeholder ? t("transcript.hesitation") : undefined}
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const fraction = box.width > 0 ? (e.clientX - box.left) / box.width : 0;
        onClick(word, e.currentTarget, fraction);
      }}
      className={`py-0.5 cursor-pointer transition-colors duration-75 ${cutOut
        ? "word-deleted bg-red-50 text-red-600 line-through decoration-red-300 dark:bg-red-950/40 dark:text-red-400 dark:decoration-red-800"
        : active
          ? "bg-neutral-200/80 text-zinc-900 dark:bg-neutral-700/80 dark:text-zinc-50"
          : placeholder
            ? "font-medium text-amber-700/90 hover:bg-amber-50 dark:text-amber-400/90 dark:hover:bg-amber-950/40"
            : "text-zinc-800 hover:bg-neutral-50 dark:text-zinc-200 dark:hover:bg-neutral-800/60"
        }`}
    >
      {word.text}{" "}
    </span>
  );
});

/**
 * Descript-style edit boundary: the "|" between two clips created by a split.
 * Click it to join them back together (the inverse of Split / S).
 */
/**
 * The transcript's insertion point. Purely visual — position lives in
 * {@link useTranscriptCaret}; this just draws the blinking rule at it.
 */
const Caret = memo(function Caret() {
  return (
    <span
      data-transcript-caret=""
      aria-hidden
      className="relative -mx-[1px] inline-block h-4 w-px animate-pulse bg-neutral-800 align-middle dark:bg-neutral-200"
    />
  );
});

/**
 * A silence, shown inline as something you can act on.
 *
 * Rendered between words rather than as a word, because it is derived from the
 * gap between two timings rather than stored — see lib/pauses.ts. Clicking it
 * cuts exactly its range, so removing dead air is the same operation as cutting
 * words and lands in the same undo history.
 */
const PauseChip = memo(function PauseChip({
  pause,
  onRemove,
}: {
  pause: Pause;
  onRemove: (pause: Pause) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      data-pause={pause.beforeWordId ?? "end"}
      title={t("transcript.removePause")}
      aria-label={`${t("transcript.removePause")} ${formatPause(pause.duration)}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onRemove(pause)}
      className="group mx-0.5 inline-flex cursor-pointer select-none items-center gap-1 rounded-md border border-dashed border-zinc-300 px-1.5 py-0.5 align-middle text-[11px] font-medium leading-none text-zinc-400 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-zinc-600 dark:text-zinc-500 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400"
    >
      <Scissors size={9} className="opacity-0 transition-opacity group-hover:opacity-100" />
      {formatPause(pause.duration)}
    </button>
  );
});

const SplitMarker = memo(function SplitMarker({
  boundaryId,
  onJoin,
}: {
  boundaryId: number;
  onJoin: (id: number) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      title={t("transcript.joinSplit")}
      aria-label={t("transcript.joinClips")}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onJoin(boundaryId)}
      className="group relative mx-0.5 inline-flex h-4 w-2 cursor-pointer select-none items-center justify-center align-middle"
    >
      <span className="h-4 w-0.5 rounded-full bg-zinc-300 transition-colors group-hover:bg-zinc-600 dark:bg-zinc-600 dark:group-hover:bg-zinc-300" />
      <span className="pointer-events-none absolute -top-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-zinc-100 dark:text-zinc-900">
        <Merge size={9} />
        {t("transcript.joinClips")}
      </span>
    </button>
  );
});

export default function TranscriptPanel() {
  const { t } = useI18n();
  const words = useEditorStore((s) => s.words);
  const sceneBoundaries = useEditorStore((s) => s.sceneBoundaries);
  const duration = useEditorStore((s) => s.duration);
  const status = useEditorStore((s) => s.status);
  const progress = useEditorStore((s) => s.progress);
  const partialText = useEditorStore((s) => s.partialText);
  const error = useEditorStore((s) => s.error);
  const showDeleted = useEditorStore((s) => s.showDeleted);
  const toggleShowDeleted = useEditorStore((s) => s.toggleShowDeleted);
  const deleteWords = useEditorStore((s) => s.deleteWords);
  const restoreWords = useEditorStore((s) => s.restoreWords);
  const correctWords = useEditorStore((s) => s.correctWords);
  const importWords = useEditorStore((s) => s.importWords);
  const removeSceneBoundary = useEditorStore((s) => s.removeSceneBoundary);
  const splitAt = useEditorStore((s) => s.splitAt);
  const cutRanges = useEditorStore((s) => s.cutRanges);
  const selectedWordIds = useEditorStore((s) => s.selectedWordIds);
  const playing = useEditorStore((s) => s.playing);
  const activeWordId = useEditorStore((s) => findActiveWordId(s.words, s.currentTime));

  const cuts = useCutRanges();
  const cutOutIds = useMemo(() => {
    const ids = new Set<number>();
    for (const w of words) {
      if (isWordCutOut(w, cuts)) ids.add(w.id);
    }
    return ids;
  }, [words, cuts]);

  // Splits get a joinable edit boundary in the transcript, like the timeline's
  // marker. Splits at the edge of a skipped region are inert and hidden in both.
  const splitBeforeWordId = useMemo(
    () =>
      mapSplitsToWords(
        words,
        getActiveSceneBoundaries(sceneBoundaries, getKeepRanges(cuts, duration))
      ),
    [sceneBoundaries, cuts, duration, words]
  );

  /**
   * Flat list of what is actually on screen, in order. The caret indexes into
   * this rather than `words` so arrow keys skip anything the cut hides.
   */
  const visibleWords = useMemo(
    () => (showDeleted ? words : words.filter((w) => !cutOutIds.has(w.id))),
    [words, showDeleted, cutOutIds]
  );

  /**
   * Silence between the words the viewer will actually hear. Derived from the
   * visible words, so cutting one recomputes its neighbours for free.
   */
  const pauseBeforeWordId = useMemo(() => {
    const kept = visibleWords.filter((w) => !cutOutIds.has(w.id));
    const map = new Map<number, Pause>();
    for (const pause of findPauses(kept, { duration })) {
      if (pause.beforeWordId === null) continue;
      // A pause already inside a cut is silence the viewer will never hear, so
      // there is nothing left to offer removing. Without this the chip survives
      // its own click: cutting a gap removes no *word*, so the gap between the
      // surrounding word timings is still there to be recomputed.
      const alreadyCut = cuts.some(
        (c) => c.start <= pause.start + 0.01 && c.end >= pause.end - 0.01
      );
      if (!alreadyCut) map.set(pause.beforeWordId, pause);
    }
    return map;
  }, [visibleWords, cutOutIds, duration, cuts]);

  /** Dead air after the final word — has no following word to hang off. */
  const trailingPause = useMemo(() => {
    const kept = visibleWords.filter((w) => !cutOutIds.has(w.id));
    const tail = findPauses(kept, { duration }).find((p) => p.beforeWordId === null);
    if (!tail) return null;
    const alreadyCut = cuts.some(
      (c) => c.start <= tail.start + 0.01 && c.end >= tail.end - 0.01
    );
    return alreadyCut ? null : tail;
  }, [visibleWords, cutOutIds, duration, cuts]);

  const removePause = useCallback(
    (pause: Pause) => cutRanges([{ start: pause.start, end: pause.end }]),
    [cutRanges]
  );

  const {
    caret,
    clearCaret,
    placeFromClick,
    move: moveCaretBy,
    slashOpen,
    openSlash,
    closeSlash,
    timeAtCaret,
    anchorWord: caretAnchorWord,
  } = useTranscriptCaret(visibleWords, duration);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [correcting, setCorrecting] = useState<{ ids: number[] } | null>(null);
  const [correctText, setCorrectText] = useState("");
  const [assigningSpeaker, setAssigningSpeaker] = useState<{
    ids: number[];
  } | null>(null);
  // Mirrors Correct / Speaker pickers so selection handlers freeze highlights.
  const freezeSelectionRef = useRef(false);

  const {
    selection,
    clearSelection,
    clearMarks,
    handleWordClick,
    releaseToolbar,
  } = useTranscriptSelection({
    containerRef,
    scrollRef,
    cutOutIds,
    freezeSelectionRef,
  });

  const {
    showFollowControl,
    followDirection,
    resumeFollowPlayhead,
    markUserScrollGesture,
  } = useTranscriptPlayheadFollow({
    scrollRef,
    containerRef,
    playing,
    activeWordId,
  });

  // Clicking a word seeks — resume following so playback stays in view.
  const onWordClick = useCallback(
    (word: Word, el: HTMLElement, fraction: number) => {
      resumeFollowPlayhead();
      handleWordClick(word, el);
      // Clicking also drops the insertion point, so `/` acts where you clicked.
      placeFromClick(word, fraction);
    },
    [handleWordClick, resumeFollowPlayhead, placeFromClick]
  );

  /**
   * Caret keys. Deliberately narrow: arrows move the insertion point, `/` opens
   * the command menu at it, Escape steps back out. Everything else falls through
   * to the global shortcuts (space, S, delete), which still own their keys
   * because a `role="textbox"` div is not a typing target.
   */
  const onTranscriptKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        moveCaretBy(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        moveCaretBy(1);
      } else if (e.key === "/") {
        e.preventDefault();
        e.stopPropagation();
        openSlash();
      } else if (e.key === "Escape") {
        if (slashOpen) {
          e.stopPropagation();
          closeSlash();
        } else {
          clearCaret();
        }
      }
    },
    [moveCaretBy, openSlash, closeSlash, clearCaret, slashOpen]
  );

  /**
   * `/` → Split here. The caret sits before a word, so the cut lands on that
   * word's start and it becomes the first word of the new clip. `splitAt`
   * refuses a point that is already a boundary or inside a cut, in which case
   * the menu just closes.
   */
  const insertSplitAtCaret = useCallback(() => {
    const time = timeAtCaret();
    if (time !== null) splitAt(time);
    closeSlash();
  }, [timeAtCaret, splitAt, closeSlash]);

  const toolbarOpen = !!(selection && !correcting && !assigningSpeaker);
  const { setFloating: setToolbarFloating, floatingStyles: toolbarStyles } =
    useWordAnchorFloating({
      open: toolbarOpen,
      wordIds: selection?.ids,
      containerRef,
      placement: "top",
      offsetMain: 8,
    });

  const { setFloating: setSlashFloating, floatingStyles: slashStyles } =
    useWordAnchorFloating({
      open: slashOpen,
      wordIds: caretAnchorWord ? [caretAnchorWord.id] : undefined,
      containerRef,
      placement: "bottom-start",
      offsetMain: 8,
    });

  const { setFloating: setCorrectFloating, floatingStyles: correctStyles } =
    useWordAnchorFloating({
      open: !!correcting,
      wordIds: correcting?.ids,
      containerRef,
      placement: "top",
      offsetMain: 12,
    });

  const turns = useMemo(() => groupWordsBySpeaker(words), [words]);

  const deletedCount = useMemo(() => cutOutIds.size, [cutOutIds]);
  const handleImportTranscript = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!isTranscriptFile(file)) {
        alert(t("transcript.invalidFile"));
        return;
      }
      if (
        words.length > 0 &&
        !confirm(t("transcript.replaceConfirm"))
      ) {
        return;
      }
      try {
        const imported = await parseTranscriptFile(file);
        importWords(imported.words, imported.speakers);
      } catch (err) {
        console.error(err);
        alert(
          err instanceof Error
            ? localizeRuntimeMessage(err.message, t)
            : t("error.readTranscript")
        );
      }
    },
    [words.length, importWords, t]
  );

  const cutSelection = useCallback(() => {
    if (!selection) return;
    deleteWords(selection.ids);
    clearSelection();
  }, [selection, deleteWords, clearSelection]);

  const restoreSelection = useCallback(() => {
    if (!selection) return;
    restoreWords(selection.ids);
    clearSelection();
  }, [selection, restoreWords, clearSelection]);

  const openCorrect = useCallback(() => {
    if (!selection) return;
    const idSet = new Set(selection.ids);
    const text = words
      .filter((w) => idSet.has(w.id))
      .map((w) => w.text)
      .join(" ");
    freezeSelectionRef.current = true;
    setCorrectText(text);
    setCorrecting({ ids: selection.ids });
    releaseToolbar();
  }, [selection, words, releaseToolbar]);

  const closeCorrect = useCallback(() => {
    freezeSelectionRef.current = false;
    clearMarks();
    setCorrecting(null);
  }, [clearMarks]);

  const openSpeakerAssign = useCallback(() => {
    if (!selection) return;
    freezeSelectionRef.current = true;
    setAssigningSpeaker({ ids: selection.ids });
    releaseToolbar();
  }, [selection, releaseToolbar]);

  const closeSpeakerAssign = useCallback(() => {
    freezeSelectionRef.current = false;
    clearMarks();
    setAssigningSpeaker(null);
    clearSelection();
  }, [clearMarks, clearSelection]);

  const applyCorrection = useCallback(() => {
    if (!correcting) return;
    correctWords(correcting.ids, correctText);
    closeCorrect();
  }, [correcting, correctText, correctWords, closeCorrect]);

  // Close the correction popover when clicking outside of it.
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!correcting) return;
    const handler = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) closeCorrect();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [correcting, closeCorrect]);

  // Escape clears the transcript selection chrome. Delete / Backspace are handled
  // globally in Editor (cut words restore; kept words / clips delete).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isTypingTarget(e.target)) return;
      if (selectedWordIds.length === 0) return;
      e.preventDefault();
      clearSelection();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedWordIds, clearSelection]);

  // "@" opens the speaker picker for the current selection.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "@" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (!selection || assigningSpeaker || correcting) return;
      e.preventDefault();
      openSpeakerAssign();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selection, assigningSpeaker, correcting, openSpeakerAssign]);

  const busy = status === "preparing" || status === "transcribing";

  return (
    // min-h-0 keeps this pane from growing to the transcript's full height —
    // without it the panel wrapper scrolls instead of the list below.
    <section className="relative flex min-h-0 min-w-0 overflow-y-hidden flex-1 flex-col bg-white dark:bg-zinc-900">
      {/* Floats above the scroller rather than sticking inside it, so the
          rubber-band overscroll only carries the transcript, not the bar. */}
      <div className="absolute inset-x-0 top-0 z-10 flex h-10 items-center gap-2 border-b border-zinc-100/80 bg-white/75 px-3 backdrop-blur-md sm:px-4 dark:border-zinc-800/80 dark:bg-zinc-900/75">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          {t("transcript.header")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {deletedCount > 0 && (
            <span className="rounded-md bg-red-50 px-2 py-0.5 text-[9px] font-medium text-red-600 line-clamp-1 line-through dark:bg-red-950/40 dark:text-red-400">
              {t(
                deletedCount === 1
                  ? "transcript.wordDeleted"
                  : "transcript.wordsDeleted",
                { count: deletedCount }
              )}
            </span>
          )}
          {status === "ready" && <TranscriptToolsMenu />}
          {status === "ready" && words.length > 0 && <ProofreadButton />}
          {(status === "ready" || status === "error" || status === "transcribing") && (
            <>
              <label
                title={t("transcript.replace")}
                className="flex cursor-pointer h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <ArrowUpFromLine size={14} />
                <span className="hidden sm:inline">{t("common.import")}</span>
                <input
                  ref={importInputRef}
                  type="file"
                  accept={TRANSCRIPT_ACCEPT}
                  // Keep in the layout tree — display:none can block the OS picker.
                  className="sr-only"
                  onChange={(e) => {
                    const files = e.target.files;
                    e.target.value = "";
                    void handleImportTranscript(files);
                  }}
                />
              </label>
            </>
          )}
          <button
            onClick={toggleShowDeleted}
            title={showDeleted ? t("transcript.hideDeleted") : t("transcript.showDeleted")}
            className="flex cursor-pointer h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {showDeleted ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="scrollbar-none relative min-h-0 flex-1 overflow-y-auto pt-10 scroll-pt-10"
      >
        <div ref={containerRef} className="relative mx-auto max-w-2xl px-4 py-6 sm:px-8 sm:py-8">
          {busy && (
            <div className="flex flex-col items-start gap-4">
              <div className="w-full bg-zinc-50 p-2 dark:bg-zinc-800/60">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent dark:border-neutral-400" />
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{localizeRuntimeMessage(progress.message, t)}</p>
                  {progress.value !== null && (
                    <>
                      <div className="ml-auto w-[100px] h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                        <div
                          className="h-full rounded-full bg-neutral-500 transition-[width] duration-300 dark:bg-neutral-400"
                          style={{ width: `${progress.value * 100}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                        {Math.round(progress.value * 100)}%
                      </span>
                    </>
                  )}
                </div>
              </div>
              {partialText && (
                <p className="text-[15px] leading-8 text-zinc-400 dark:text-zinc-500">
                  {partialText}
                  <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-neutral-500 align-middle" />
                </p>
              )}
            </div>
          )}

          {status === "error" && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900/30 dark:bg-red-950/30 dark:text-red-900">
              {localizeRuntimeMessage(error, t)}
            </div>
          )}

          {status === "ready" && words.length === 0 && (
              <p className="mt-2 flex items-center gap-1 text-sm font-medium text-zinc-500 dark:text-zinc-500">
                <VolumeOff size={16} /> {t("transcript.noSpeech")}
              </p>
          )}

          {status === "ready" && (
            <div
              className="transcript-words outline-none selection:bg-transparent"
              tabIndex={0}
              role="textbox"
              aria-label={t("transcript.editorLabel")}
              aria-multiline
              onKeyDown={onTranscriptKeyDown}
              onBlur={(e) => {
                // Keep the caret while focus moves into the slash menu itself.
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  clearCaret();
                }
              }}
            >
              {turns.map((turn) => {
                const visible = showDeleted
                  ? turn.words
                  : turn.words.filter((w) => !cutOutIds.has(w.id));
                if (visible.length === 0) return null;
                // First turn in the full word list has no previous speaker to borrow from.
                const canMove = turn.words[0].id !== words[0]?.id;
                return (
                  <div key={`${turn.speaker}-${turn.words[0].id}`} className="mb-7">
                    <SpeakerLabel
                      speakerId={turn.speaker}
                      turnWordIds={turn.words.map((w) => w.id)}
                      turnStartWordId={turn.words[0].id}
                      canMove={canMove}
                    />
                    <p className="select-text text-[15px] leading-8">
                      {visible.map((w) => {
                        const split = splitBeforeWordId.get(w.id);
                        return (
                          <React.Fragment key={w.id}>
                            {split && (
                              <SplitMarker boundaryId={split.id} onJoin={removeSceneBoundary} />
                            )}
                            {caret?.kind === "before" && caret.wordId === w.id && (
                              <Caret />
                            )}
                            {pauseBeforeWordId.has(w.id) && (
                              <PauseChip
                                pause={pauseBeforeWordId.get(w.id)!}
                                onRemove={removePause}
                              />
                            )}
                            <WordSpan
                              word={w}
                              cutOut={cutOutIds.has(w.id)}
                              active={w.id === activeWordId}
                              onClick={onWordClick}
                            />
                          </React.Fragment>
                        );
                      })}
                      {/* End-of-transcript caret sits after the final word. */}
                      {caret?.kind === "end" &&
                        visible[visible.length - 1]?.id ===
                          visibleWords[visibleWords.length - 1]?.id && <Caret />}
                      {trailingPause &&
                        visible[visible.length - 1]?.id ===
                          visibleWords[visibleWords.length - 1]?.id && (
                          <PauseChip pause={trailingPause} onRemove={removePause} />
                        )}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {slashOpen && caretAnchorWord && (
            <FloatingPortal>
              <div
                ref={setSlashFloating}
                data-transcript-slash
                role="menu"
                aria-label={t("transcript.slashTitle")}
                className="z-40 w-60 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-800 dark:shadow-black/30"
                style={slashStyles}
                onMouseDown={(e) => e.preventDefault()}
              >
                <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
                  {t("transcript.slashTitle")}
                </p>
                <button
                  type="button"
                  role="menuitem"
                  onClick={insertSplitAtCaret}
                  className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-700/60"
                >
                  <Scissors size={13} className="mt-0.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-tight text-zinc-800 dark:text-zinc-100">
                      {t("transcript.slashSplit")}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
                      {t("transcript.slashSplitHint")}
                    </span>
                  </span>
                </button>
              </div>
            </FloatingPortal>
          )}

          {toolbarOpen && selection && (
            <FloatingPortal>
              <div
                ref={setToolbarFloating}
                data-transcript-toolbar
                className="z-40 flex items-center gap-0.5 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-800 dark:shadow-black/30"
                style={toolbarStyles}
                onMouseDown={(e) => e.preventDefault()}
              >
                {selection.anyKept && (
                  <button
                    onClick={cutSelection}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-zinc-700 transition hover:bg-red-50 hover:text-red-600 dark:text-zinc-200 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                  >
                    <Scissors size={13} />
                    {t("transcript.cut")}
                  </button>
                )}
                {selection.anyDeleted && (
                  <button
                    onClick={restoreSelection}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-zinc-700 transition hover:bg-emerald-50 hover:text-emerald-600 dark:text-zinc-200 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-400"
                  >
                    <RotateCcw size={13} />
                    {t("common.restore")}
                  </button>
                )}
                <button
                  onClick={openCorrect}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  <Pencil size={13} />
                  {t("transcript.correct")}
                </button>
                <SelectionSpeakerButton onClick={openSpeakerAssign} />
              </div>
            </FloatingPortal>
          )}

          {assigningSpeaker && (
            <SelectionSpeakerPopover
              wordIds={assigningSpeaker.ids}
              containerRef={containerRef}
              onClose={closeSpeakerAssign}
            />
          )}

          {correcting && (
            <FloatingPortal>
              <div
                ref={(node: HTMLDivElement | null) => {
                  popoverRef.current = node;
                  setCorrectFloating(node);
                }}
                className="z-40 w-80 max-w-[calc(100vw-16px)] rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-800 dark:shadow-black/40"
                style={correctStyles}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">{t("transcript.correct")}</span>
                  <button
                    onClick={closeCorrect}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                  >
                    <X size={13} />
                  </button>
                </div>
                <input
                  autoFocus
                  value={correctText}
                  onChange={(e) => setCorrectText(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyCorrection();
                    else if (e.key === "Escape") closeCorrect();
                  }}
                  className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-800 outline-none focus:border-zinc-500 focus:bg-white dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:bg-zinc-950"
                />
                <div className="mt-2.5 flex justify-end">
                  <button
                    onClick={applyCorrection}
                    disabled={correctText.trim().length === 0}
                    className="cursor-pointer flex h-8 items-center rounded-full bg-zinc-900 px-4 text-[13px] font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    {t("transcript.correct")}
                  </button>
                </div>
              </div>
            </FloatingPortal>
          )}
        </div>
      </div>
      {/* Gradient overlay — must match the transcript panel surface */}
      <div className="absolute z-10 pointer-events-none inset-x-0 bottom-0 w-full h-20 bg-gradient-to-t from-white to-transparent dark:from-zinc-900" />
      {showFollowControl && (
        <button
          type="button"
          onClick={resumeFollowPlayhead}
          title={t("transcript.scrollWithPlayhead")}
          className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-zinc-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-zinc-700 backdrop-blur-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/95 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          {followDirection === "up" && <ArrowUp size={13} />}
          {followDirection === "down" && <ArrowDown size={13} />}
          {followDirection === null && <ChevronLast size={13} />}
          {t("transcript.follow")}
        </button>
      )}
      <TranscriptScrollIndicator
        scrollRef={scrollRef}
        contentRef={containerRef}
        onUserScroll={markUserScrollGesture}
      />
    </section>
  );
}
