"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignVerticalSpaceAround,
  AudioLines,
  Captions,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  Eraser,
  Film,
  Image as ImageIcon,
  Loader2,
  Mic,
  MoveUpRight,
  Music,
  Scissors,
  Sparkles,
  StickyNote,
  TrendingUp,
  Type,
  Volume2,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import {
  SLASH_GROUP_LABELS,
  hintFor,
  slashCommandsFor,
  type SlashCommand,
  type SlashContext,
  type SlashGroup,
  type SlashResult,
} from "@/motionscript/lib/slash";

/**
 * The `/` menu, rendered.
 *
 * Two panes rather than a form: pick the command, then say the one thing it
 * needs. A single pane with an input per command turns a menu you can run
 * blind into a page you have to read, and the whole value of a slash menu is
 * that after the third use you are typing "/sfx⏎" without looking.
 *
 * Everything about *which* commands exist lives in `lib/slash.ts`, which is
 * pure and tested. This file is the keyboard and the pixels.
 */

const ICONS: Record<string, LucideIcon> = {
  scissors: Scissors,
  "chevrons-left": ChevronsLeft,
  "chevrons-right": ChevronsRight,
  "audio-lines": AudioLines,
  eraser: Eraser,
  "align-vertical-space-around": AlignVerticalSpaceAround,
  type: Type,
  "trending-up": TrendingUp,
  "credit-card": CreditCard,
  captions: Captions,
  "sticky-note": StickyNote,
  image: ImageIcon,
  film: Film,
  "move-up-right": MoveUpRight,
  "zoom-in": ZoomIn,
  "volume-2": Volume2,
  music: Music,
  mic: Mic,
  sparkles: Sparkles,
};

export interface SlashMenuProps {
  context: SlashContext;
  /**
   * Runs the command. Resolves to what went wrong, or null when it worked.
   *
   * The menu stays open on a failure and says so. Closing on one would leave
   * the person looking at the video wondering whether they had missed the
   * click — and the reasons here are all actionable ("no stock catalogue is
   * configured", "that phrase is not in the transcript"), which is exactly the
   * kind of thing that must not be reported somewhere else.
   */
  onRun: (result: SlashResult) => Promise<string | null>;
  onClose: () => void;
}

/** Why the last command did not work, said where it was asked for. */
function Problem({ text }: { text: string }) {
  return (
    <p className="mx-2 mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] leading-tight text-red-700 dark:bg-red-950/40 dark:text-red-300">
      {text}
    </p>
  );
}

export default function TranscriptSlashMenu({
  context,
  onRun,
  onClose,
}: SlashMenuProps) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<SlashCommand | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [rawCursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo(
    () => slashCommandsFor(context, query),
    [context, query]
  );

  /** The option list for a `pick`, filtered by whatever has been typed. */
  const options = useMemo(() => {
    if (chosen?.arg?.kind !== "pick") return [];
    const q = value.trim().toLowerCase();
    if (!q) return chosen.arg.options;
    return chosen.arg.options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        (o.hint ?? "").toLowerCase().includes(q)
    );
  }, [chosen, value]);

  /**
   * Clamped rather than stored clamped: the visible list changes as you type,
   * and a cursor left pointing past the end of a shorter list highlights
   * nothing, so Enter appears to do nothing at all.
   */
  const length = chosen?.arg?.kind === "pick" ? options.length : commands.length;
  const cursor = length ? Math.min(rawCursor, length - 1) : 0;

  useEffect(() => {
    if (chosen) valueRef.current?.focus();
    else searchRef.current?.focus();
  }, [chosen]);

  // Keep the highlighted row in view when the keyboard is what is moving it.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor, query, chosen]);

  const run = useCallback(
    async (command: SlashCommand, arg: string) => {
      setBusy(true);
      setFailed(null);
      let problem: string | null = null;
      try {
        problem = await onRun(command.run(context, arg));
      } catch (err) {
        problem = err instanceof Error ? err.message : "That didn't work.";
      } finally {
        setBusy(false);
      }
      if (problem) setFailed(problem);
      else onClose();
    },
    [context, onRun, onClose]
  );

  const choose = useCallback(
    (command: SlashCommand) => {
      if (!command.arg || command.arg.kind === "none") {
        void run(command, "");
        return;
      }
      setChosen(command);
      setCursor(0);
      setValue(
        command.arg.kind === "text" ? (command.arg.prefill?.(context) ?? "") : ""
      );
    },
    [context, run]
  );

  const back = useCallback(() => {
    setChosen(null);
    setValue("");
    setCursor(0);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // The menu owns its keys entirely: the transcript below is listening for
      // arrows and Delete, and the editor above for space.
      e.stopPropagation();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((i) => (length ? (i + 1) % length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((i) => (length ? (i - 1 + length) % length : 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (busy) return;
        if (!chosen) {
          const command = commands[cursor];
          if (command) choose(command);
          return;
        }
        if (chosen.arg?.kind === "pick") {
          const option = options[cursor];
          if (option) void run(chosen, option.id);
          return;
        }
        if (value.trim()) void run(chosen, value.trim());
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (chosen) back();
        else onClose();
      } else if (e.key === "Backspace" && chosen && !value) {
        e.preventDefault();
        back();
      }
    },
    [busy, chosen, choose, commands, cursor, length, onClose, options, run, value, back]
  );

  /* ------------------------------- second pane ------------------------------ */

  if (chosen && chosen.arg && chosen.arg.kind !== "none") {
    const Icon = ICONS[chosen.icon] ?? Sparkles;
    return (
      <div
        className="w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-800 dark:shadow-black/40"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-700/70">
          <Icon size={13} className="shrink-0 text-indigo-500" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-800 dark:text-zinc-100">
            {chosen.title}
          </span>
          {busy && <Loader2 size={13} className="shrink-0 animate-spin text-zinc-400" />}
        </div>

        <div className="p-2">
          <input
            ref={valueRef}
            value={value}
            disabled={busy}
            onChange={(e) => {
              setValue(e.target.value);
              setCursor(0);
            }}
            placeholder={
              chosen.arg.kind === "text" ? chosen.arg.placeholder : "Search…"
            }
            className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-indigo-400 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>

        {failed && <Problem text={failed} />}

        {chosen.arg.kind === "pick" ? (
          <div ref={listRef} className="scrollbar-thin max-h-64 overflow-y-auto px-1 pb-1">
            {options.length === 0 ? (
              <p className="px-2.5 py-3 text-[12px] text-zinc-400">Nothing matches.</p>
            ) : (
              options.map((option, i) => (
                <button
                  key={option.id}
                  type="button"
                  data-active={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => void run(chosen, option.id)}
                  className={`flex w-full cursor-pointer items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                    i === cursor ? "bg-indigo-50 dark:bg-indigo-950/40" : ""
                  }`}
                >
                  <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                    {option.label}
                  </span>
                  {option.hint && (
                    <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                      {option.hint}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
              {hintFor(chosen, context)}
            </span>
            <button
              type="button"
              disabled={busy || !value.trim()}
              onClick={() => void run(chosen, value.trim())}
              className="shrink-0 cursor-pointer rounded-lg bg-zinc-900 px-2.5 py-1 text-[12px] font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Add
            </button>
          </div>
        )}
      </div>
    );
  }

  /* -------------------------------- first pane ------------------------------ */

  let lastGroup: SlashGroup | null = null;

  return (
    <div
      className="w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-800 dark:shadow-black/40"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-700/70">
        <span className="shrink-0 rounded bg-zinc-100 px-1 py-0.5 font-mono text-[10px] leading-none text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">
          /
        </span>
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          placeholder="Cut, caption, picture, sound…"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
        {busy && <Loader2 size={13} className="shrink-0 animate-spin text-zinc-400" />}
      </div>

      {failed && <Problem text={failed} />}

      <div ref={listRef} className="scrollbar-thin max-h-80 overflow-y-auto p-1">
        {commands.length === 0 ? (
          <p className="px-2.5 py-3 text-[12px] text-zinc-400">
            Nothing matches. Try “ask”.
          </p>
        ) : (
          commands.map((command, i) => {
            const Icon = ICONS[command.icon] ?? Sparkles;
            const header = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            const active = i === cursor;
            return (
              <div key={command.id}>
                {header && (
                  <p className="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wide text-zinc-400 uppercase dark:text-zinc-500">
                    {SLASH_GROUP_LABELS[header]}
                  </p>
                )}
                <button
                  type="button"
                  data-active={active}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(command)}
                  className={`flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition ${
                    active ? "bg-indigo-50 dark:bg-indigo-950/40" : ""
                  }`}
                >
                  <Icon
                    size={13}
                    className={`mt-0.5 shrink-0 ${
                      command.destructive
                        ? "text-red-500"
                        : "text-zinc-400 dark:text-zinc-500"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] leading-tight font-medium text-zinc-800 dark:text-zinc-100">
                      {command.title}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
                      {hintFor(command, context)}
                    </span>
                  </span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
