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
 * names — which is every browser but the one this was developed on — is a few
 * microseconds of looking for keys that are not there.
 */

const OLD_PREFIX = "rescript.";
const NEW_PREFIX = "motionscript.";

/* -------------------------------- preferences ------------------------------- */

let sweptPreferences = false;

/**
 * Move `rescript.*` preferences to `motionscript.*`.
 *
 * Synchronous, because the values it moves are read synchronously the first
 * time each module is asked for one, and several of those reads happen while
 * the editor is still initialising. A preference restored one tick late is a
 * theme that flashes and a language selector that resets.
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

/**
 * Copy an old database's rows into an already-open new one, then drop the old.
 *
 * The destination is passed in *open* rather than opened here, and that is the
 * whole design. Opening it here would mean opening it before the app has had a
 * chance to run its own `onupgradeneeded` — and `indexedDB.open` on an unknown
 * name does not fail, it silently creates an empty database. The migration
 * would then find no object stores to write into, give up, and leave behind a
 * database sitting at the version the app expects with none of the stores the
 * app requires, which every later transaction would throw on.
 *
 * Taking the open handle means the schema already exists, exactly as the app
 * defines it, and this function never has to know what that schema is.
 *
 * Rows go in with `put`, so re-running over a half-finished copy overwrites
 * rather than throwing on a duplicate key.
 */
async function copyInto(target: IDBDatabase, from: string): Promise<void> {
  const source = await new Promise<IDBDatabase | null>((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(from);
    } catch {
      resolve(null);
      return;
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  if (!source) return;

  // An empty source is the ordinary case: the open above *created* it, because
  // this browser never ran the old build. Delete it and move on.
  const shared = Array.from(source.objectStoreNames).filter((name) =>
    target.objectStoreNames.contains(name)
  );
  if (!shared.length) {
    source.close();
    indexedDB.deleteDatabase(from);
    return;
  }

  const rows = new Map<string, unknown[]>();
  await new Promise<void>((resolve) => {
    const tx = source.transaction(shared, "readonly");
    for (const name of shared) {
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => rows.set(name, req.result ?? []);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  source.close();

  const names = shared.filter((name) => (rows.get(name)?.length ?? 0) > 0);
  if (!names.length) {
    indexedDB.deleteDatabase(from);
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

  // Only once the rows are safely in the new database. A failed copy leaves the
  // original where it is, and the next load tries again.
  if (written) indexedDB.deleteDatabase(from);
}

const done = new Map<string, Promise<void>>();

/**
 * Move everything held under `from` into the open database `target`.
 *
 * Must be awaited before the first read of `target`, or a project list can
 * render empty a moment before the rows arrive — which reads as data loss even
 * though it is not. Runs at most once per source name per page.
 */
export function migrateLegacyInto(target: IDBDatabase, from: string): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  let run = done.get(from);
  if (!run) {
    run = copyInto(target, from).catch(() => {
      // Leave the original alone; the next load will try again.
    });
    done.set(from, run);
  }
  return run;
}
