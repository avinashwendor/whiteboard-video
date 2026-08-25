/**
 * What the person thought of what the agent proposed.
 *
 * Nothing anywhere recorded prompt → output → outcome. Which is the expensive
 * gap, because the signal already exists and is thrown away several times a
 * session: **propose mode makes people tick plan steps on and off before
 * anything runs.** Every one of those ticks is a labelled preference pair, made
 * by someone looking at their own footage, and it was going straight in the bin.
 *
 * So this is the collection half of a feedback loop. It is deliberately not a
 * training pipeline — the model is a hosted API and there is nothing to train.
 * What these records are *for* is retrieval: the plan the agent makes next time
 * is better if it can be shown three accepted plans for instructions like this
 * one, and told about the rejected ones. The prompt today contains zero
 * examples, which makes this the cheapest quality win available.
 *
 * Local-only, like everything else here. Media never leaves the browser and
 * neither does what someone said about it.
 */

import type { AgentOp } from "../overlay/ops-schema";

const DB_NAME = "rescript-feedback";
const DB_VERSION = 1;
const STORE = "events";

/**
 * How many events are kept.
 *
 * Generous, because they are small — an instruction, a summary and a handful of
 * operations — and because the value of the store is that it spans months of
 * someone's editing rather than this afternoon's.
 */
export const MAX_EVENTS = 2_000;

/**
 * What happened to a step.
 *
 * `undone` is a rejection with extra emphasis: the person accepted the step,
 * watched it, and took it back. Worth distinguishing from a step they declined
 * before it ran, because one is a misjudged plan and the other is a plan that
 * looked right and was not.
 */
export type Verdict = "accepted" | "declined" | "undone" | "failed";

export interface FeedbackEvent {
  id: string;
  /** Which project it happened in. Not the media — just the id. */
  projectId: string | null;
  /** What the person asked for, verbatim. */
  instruction: string;
  /** The plan's own one-line description of itself. */
  planSummary: string;
  /** The step this verdict is about. */
  stepTitle: string;
  stepDetail: string;
  /** What the step would actually have done. */
  ops: AgentOp[];
  verdict: Verdict;
  /** Set when the model named itself; useful when comparing them later. */
  model?: string;
  /** Which version of the prompt produced this. See PROMPT_VERSION. */
  promptVersion?: string;
  createdAt: number;
}

export type FeedbackWrite = Omit<FeedbackEvent, "id" | "createdAt">;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("Failed to open the feedback store."));
    };
  });
  return dbPromise;
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed."));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
  });
}

/**
 * Record what happened to one step.
 *
 * Never throws. A feedback store that can take down an edit by failing to write
 * an opinion about it has its priorities backwards — the worst case here is
 * that the agent learns nothing from this session, which is exactly where it
 * was before this existed.
 */
export async function recordFeedback(input: FeedbackWrite): Promise<string | null> {
  const id = crypto.randomUUID();
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);

    store.put({
      ...input,
      id,
      createdAt: Date.now(),
    } satisfies FeedbackEvent);

    const keys = await idbReq(
      store.index("createdAt").getAllKeys() as IDBRequest<IDBValidKey[]>
    );
    let excess = keys.length - MAX_EVENTS;
    for (const key of keys) {
      if (excess <= 0) break;
      store.delete(key);
      excess -= 1;
    }

    await txDone(tx);
    return id;
  } catch (err) {
    console.warn("Could not record feedback.", err);
    return null;
  }
}

/** Record a verdict for several steps at once. Returns the ids that stuck. */
export async function recordAll(inputs: FeedbackWrite[]): Promise<string[]> {
  const ids: string[] = [];
  for (const input of inputs) {
    const id = await recordFeedback(input);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Change the verdict on events already written.
 *
 * There is one caller and one reason: someone accepted a step, watched it run,
 * and undid it. That is a rejection with more information in it than a decline
 * — the plan looked right and was not — so it replaces the "accepted" rather
 * than sitting beside it. Two rows for one decision would make the accept rate
 * a number that counts the same step twice.
 */
export async function reviseVerdict(
  ids: string[],
  verdict: Verdict
): Promise<void> {
  if (ids.length === 0) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const id of ids) {
      const row = await idbReq(store.get(id) as IDBRequest<FeedbackEvent | undefined>);
      // Only an acceptance can be revised: a step that was declined was never
      // run, so it cannot have been taken back.
      if (row && row.verdict === "accepted") store.put({ ...row, verdict });
    }
    await txDone(tx);
  } catch (err) {
    console.warn("Could not revise a verdict.", err);
  }
}

/** Every event, newest first. */
export async function listFeedback(limit = MAX_EVENTS): Promise<FeedbackEvent[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const rows = await idbReq(
      tx.objectStore(STORE).getAll() as IDBRequest<FeedbackEvent[]>
    );
    await txDone(tx);
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  } catch {
    return [];
  }
}

export async function clearFeedback(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await txDone(tx);
  } catch {
    /* nothing worth failing an edit over */
  }
}

/* ------------------------------- summarising -------------------------------- */

export interface FeedbackTally {
  total: number;
  accepted: number;
  declined: number;
  undone: number;
  failed: number;
  /** Share of steps that were accepted and not taken back. 0..1, or null. */
  acceptRate: number | null;
}

export function tally(events: FeedbackEvent[]): FeedbackTally {
  const counts = { accepted: 0, declined: 0, undone: 0, failed: 0 };
  for (const event of events) counts[event.verdict] += 1;

  const judged = counts.accepted + counts.declined + counts.undone;
  return {
    total: events.length,
    ...counts,
    // An undone step counts against, not for: the person saw it and took it
    // back, which is a stronger no than declining it unseen.
    acceptRate: judged > 0 ? counts.accepted / judged : null,
  };
}

/* -------------------------------- exporting --------------------------------- */

/**
 * The preference log, as training data.
 *
 * Not used by anything here — the model is a hosted API and there is nothing to
 * fine-tune. It exists so the option stays open without being committed to: if
 * a tunable model ever makes sense, the data will already be months deep rather
 * than starting from zero on the day someone decides.
 *
 * One JSON object per line, the shape every DPO/SFT trainer reads.
 */
export function toJsonl(events: FeedbackEvent[]): string {
  return events
    .map((event) =>
      JSON.stringify({
        instruction: event.instruction,
        step: { title: event.stepTitle, detail: event.stepDetail, ops: event.ops },
        label: event.verdict === "accepted" ? "chosen" : "rejected",
        verdict: event.verdict,
        model: event.model ?? null,
        promptVersion: event.promptVersion ?? null,
        at: new Date(event.createdAt).toISOString(),
      })
    )
    .join("\n");
}
