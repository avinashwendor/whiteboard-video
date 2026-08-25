"use client";

import { create } from "zustand";
import type { AgentOp } from "../overlay/ops-schema";

/**
 * The AI panel's conversation, kept per project.
 *
 * This used to live inside `AiPanel` as a `useRef` for the turns and a
 * `useState` for the log, which meant a refresh lost the whole conversation
 * while the cut, the captions and the overlays all came back. The video
 * survived and the reasoning about it did not.
 *
 * It is a third store rather than a slice of either existing one for the same
 * reason those two are separate: undo must not walk across concerns. Undoing a
 * caption cannot walk back a cut, and neither of them should be able to walk
 * back something you said.
 *
 * ⚠️ Being project-scoped, this store has to be handled everywhere the other
 * two are — `loadVideo`, `openProject`, `reset` and `writeSnapshot`. Adding
 * state here and wiring only the place that creates it is exactly how the
 * overlay store ended up showing one project's captions over another's video.
 */

export interface ChatTurn {
  instruction: string;
  summary: string;
  outcome?: string;
}

export type LogKind =
  | "you"
  | "summary"
  | "ok"
  | "fail"
  | "note"
  | "finding"
  | "look"
  | "warn";

export interface LogEntry {
  id: number;
  kind: LogKind;
  text: string;
}

export interface ProposedStep {
  title: string;
  detail: string;
  ops: AgentOp[];
}

/**
 * A proposal waiting to be accepted, in whole or in part.
 *
 * `declined` is an array rather than the `Set` the panel works with, because
 * this shape is what gets written to IndexedDB. Structured clone does handle a
 * `Set`, but a stored shape that survives a schema change and a JSON round trip
 * is worth more than the ergonomics of one lookup.
 */
export interface Proposal {
  summary: string;
  steps: ProposedStep[];
  declined: number[];
}

/** Everything about the conversation that is worth persisting. */
export interface ChatThread {
  turns: ChatTurn[];
  log: LogEntry[];
  proposal: Proposal | null;
}

/** Log lines are capped: this is a transcript of a session, not an archive. */
const MAX_LOG = 60;

/** Turns sent to the model are capped elsewhere; this is the storage cap. */
const MAX_TURNS = 40;

interface ChatState extends ChatThread {
  /** Monotonic, only used for React keys. */
  sequence: number;
  /**
   * Cancels whatever the panel currently has in flight.
   *
   * The store owns this because `reset()` is called from the editor store when
   * media changes, and an in-flight plan for the previous video must not land
   * on the next one.
   */
  abort: (() => void) | null;

  append: (kind: LogKind, text: string) => void;
  setLog: (log: LogEntry[]) => void;
  pushTurn: (turn: ChatTurn) => void;
  /** Attach the outcome to the most recent turn, once its ops have run. */
  setLastOutcome: (outcome: string) => void;
  setProposal: (proposal: Proposal | null) => void;
  setAbort: (abort: (() => void) | null) => void;
  /** Everything the autosave needs, and nothing it does not. */
  snapshot: () => ChatThread;
  hydrate: (thread: ChatThread | undefined) => void;
  reset: () => void;
}

function emptyThread(): ChatThread {
  return { turns: [], log: [], proposal: null };
}

/**
 * Accept only what we recognise out of a stored record.
 *
 * A project saved by an older build has no chat at all, and one saved by a
 * newer build may carry fields this one does not know. Neither should throw on
 * open — a conversation is worth less than the video it is about.
 */
export function parseThread(raw: unknown): ChatThread {
  if (!raw || typeof raw !== "object") return emptyThread();
  const row = raw as Partial<ChatThread>;

  const turns = Array.isArray(row.turns)
    ? row.turns
        .filter(
          (t): t is ChatTurn =>
            !!t && typeof t.instruction === "string" && typeof t.summary === "string"
        )
        .slice(-MAX_TURNS)
    : [];

  const log = Array.isArray(row.log)
    ? row.log
        .filter(
          (l): l is LogEntry =>
            !!l && typeof l.text === "string" && typeof l.kind === "string"
        )
        .slice(-MAX_LOG)
    : [];

  const proposal =
    row.proposal &&
    typeof row.proposal.summary === "string" &&
    Array.isArray(row.proposal.steps)
      ? {
          summary: row.proposal.summary,
          steps: row.proposal.steps,
          declined: Array.isArray(row.proposal.declined)
            ? row.proposal.declined
            : [],
        }
      : null;

  return { turns, log, proposal };
}

export const useChatStore = create<ChatState>((set, get) => ({
  ...emptyThread(),
  sequence: 0,
  abort: null,

  append: (kind, text) => {
    const sequence = get().sequence + 1;
    set((state) => ({
      sequence,
      log: [...state.log.slice(-(MAX_LOG - 1)), { id: sequence, kind, text }],
    }));
  },

  setLog: (log) => set({ log: log.slice(-MAX_LOG) }),

  pushTurn: (turn) =>
    set((state) => ({ turns: [...state.turns, turn].slice(-MAX_TURNS) })),

  setLastOutcome: (outcome) =>
    set((state) => {
      if (!state.turns.length) return {};
      const turns = state.turns.slice();
      turns[turns.length - 1] = { ...turns[turns.length - 1], outcome };
      return { turns };
    }),

  setProposal: (proposal) => set({ proposal }),

  setAbort: (abort) => set({ abort }),

  snapshot: () => {
    const { turns, log, proposal } = get();
    return { turns, log, proposal };
  },

  hydrate: (thread) => {
    const next = parseThread(thread);
    // Ids in a restored log came from a previous page, where the counter
    // started at zero. Continuing from the highest one keeps React keys unique
    // for anything appended after the restore.
    const sequence = next.log.reduce((max, l) => Math.max(max, l.id), 0);
    set({ ...next, sequence });
  },

  reset: () => {
    get().abort?.();
    set({ ...emptyThread(), sequence: 0, abort: null });
  },
}));
