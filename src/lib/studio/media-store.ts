"use client";

/**
 * IndexedDB blob cache.
 *
 * Generated media is served from an in-process store on the server, so those
 * URLs die when the server restarts. Copying each blob into IndexedDB the
 * moment it arrives is what makes the history page survive a restart -- and it
 * keeps object URLs same-origin, so the whiteboard canvas stays exportable.
 */

const DB_NAME = "whiteboard-studio";
const DB_VERSION = 1;
const STORE = "media";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const transaction = db.transaction(STORE, mode);
          const request = run(transaction.objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

const objectUrls = new Map<string, string>();

/** Downloads `url` and keeps the bytes under `key`. Returns a stable local URL. */
export async function cacheMedia(key: string, url: string): Promise<string> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return url;
    const blob = await res.blob();
    await tx("readwrite", (store) => store.put(blob, key));
    const local = URL.createObjectURL(blob);
    objectUrls.set(key, local);
    return local;
  } catch {
    return url;
  }
}

/** Resolves a cached blob to an object URL, or null when it is gone. */
export async function resolveMedia(key: string): Promise<string | null> {
  const existing = objectUrls.get(key);
  if (existing) return existing;

  const blob = await tx<Blob>("readonly", (store) => store.get(key));
  if (!blob) return null;

  const local = URL.createObjectURL(blob);
  objectUrls.set(key, local);
  return local;
}

export async function deleteMedia(keys: string[]): Promise<void> {
  for (const key of keys) {
    const url = objectUrls.get(key);
    if (url) {
      URL.revokeObjectURL(url);
      objectUrls.delete(key);
    }
    await tx("readwrite", (store) => store.delete(key));
  }
}

export async function clearMedia(): Promise<void> {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
  await tx("readwrite", (store) => store.clear());
}

export function mediaKey(generationId: string, slot: string): string {
  return `${generationId}:${slot}`;
}
