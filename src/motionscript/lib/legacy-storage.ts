/**
 * Carry a browser's existing work across the storage rename.
 *
 * The editor's persistence used to be namespaced under one prefix and now uses
 * another. Renaming the constants is a one-line change in the source and a
 * total loss in the browser: IndexedDB and `localStorage` are keyed by exact
 * name, so a rename does not move anyone's data — it hides it. Every saved
 * project, every preference, and the whole feedback history would still be sat
 * on disk under names nothing reads any more.
 *
 * So the old names are copied forward once, then removed.
 *
 * Both halves are idempotent and both fail soft. Neither is worth an error a
 * person has to read: the worst case for a browser that has never held the old
 * names — which is every browser but this developer's — is a few microseconds
 * of looking for keys that are not there.
 */

const OLD_PREFIX = "rescript.";
const NEW_PREFIX = "motionscript.";

/** IndexedDB databases to move, old name → new name. */
const DATABASES: ReadonlyArray<readonly [string, string]> = [
  ["rescript-projects", "motionscript-projects"],
  ["rescript-feedback", "motionscript-feedback"],
];

/* -------------------------------- preferences ------------------------------- */

let sweptPreferences = false;

/**
 * Move `rescript.*` preferences to `motionscript.*`.
 *
 * Synchronous, because the values it moves are read synchronously at module
 * load all over the editor — a preference restored one tick late is a theme
 * that flashes and a language selector that resets.
 *
 * An existing new-prefix value always wins. Someone who has already used the
 * renamed build has newer preferences than the stale ones left behind, and
 * clobbering them to honour a migration would be the wrong way round.
 */
export function migrateLegacyPreferences(): void {
  if (sweptPreferences || typeof window === "undefined") return;
  sweptPreferences = true;
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(OLD_PREFIX)) stale.push(key);
    }
    for (const key of stale) {
      const moved = NEW_PREFIX + key.slice(OLD_PREFIX.length);
      const value = localStorage.getItem(key);
      if (value !== null && localStorage.getItem(moved) === null) {
        localStorage.setItem(moved, value);
      }
      localStorage.removeItem(key);
    }
  } catch {
    // Private browsing, a full quota, or site data blocked outright. The
    // editor already treats every preference as optional.
  }
}

/* --------------------------------- databases -------------------------------- */

function open(name: string, version?: number): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    } catch {
      resolve(null);
      return;
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/** Every store in a database, with its rows and its key path. */
async function readAll(db: IDBDatabase): Promise<Map<string, unknown[]>> {
  const names = Array.from(db.objectStoreNames);
  const out = new Map<string, unknown[]>();
  if (!names.length) return out;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(names, "readonly");
    for (const name of names) {
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => out.set(name, req.result ?? []);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  return out;
}

/**
 * Copy one database's rows into another, then drop the original.
 *
 * The destination is opened *without* a version so this never races the
 * editor's own upgrade — whatever schema the app has already created is the
 * one the rows land in. Stores the destination does not have are skipped
 * rather than created: a row nothing knows how to read is not worth keeping,
 * and inventing a store here would fight the real `onupgradeneeded`.
 *
 * Rows are added with `put`, so a second run over a half-finished migration
 * overwrites rather than throwing on a duplicate key.
 */
async function migrateDatabase(from: string, to: string): Promise<void> {
  const source = await open(from);
  if (!source) return;

  // An empty database is the ordinary case: `indexedDB.open` *creates* one when
  // the name is unknown, so every browser that never ran the old build has just
  // been handed a blank `rescript-*`. Delete it and move on.
  if (!source.objectStoreNames.length) {
    source.close();
    indexedDB.deleteDatabase(from);
    return;
  }

  const rows = await readAll(source);
  source.close();

  const total = Array.from(rows.values()).reduce((n, list) => n + list.length, 0);
  if (!total) {
    indexedDB.deleteDatabase(from);
    return;
  }

  const target = await open(to);
  if (!target) return;
  const names = Array.from(target.objectStoreNames).filter(
    (name) => (rows.get(name)?.length ?? 0) > 0
  );
  if (!names.length) {
    target.close();
    return;
  }

  const written = await new Promise<boolean>((resolve) => {
    const tx = target.transaction(names, "readwrite");
    for (const name of names) {
      const store = tx.objectStore(name);
      for (const row of rows.get(name) ?? []) store.put(row);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
  target.close();

  // Only once the rows are safely in the new database. A failed copy leaves the
  // original where it is, and the next load tries again.
  if (written) indexedDB.deleteDatabase(from);
}

let databases: Promise<void> | null = null;

/**
 * Move the saved projects and the feedback history.
 *
 * Returns the same promise on every call, and must be awaited before the first
 * read of either database — otherwise a project list can render empty a moment
 * before the rows arrive, which reads as data loss even though it is not.
 */
export function migrateLegacyDatabases(): Promise<void> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return Promise.resolve();
  }
  databases ??= (async () => {
    for (const [from, to] of DATABASES) {
      try {
        await migrateDatabase(from, to);
      } catch {
        // Leave the original alone; the next load will try again.
      }
    }
  })();
  return databases;
}
