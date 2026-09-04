/**
 * Whether a locally-served model is actually present in this build.
 *
 * Models flagged `local` live in public/models/<id>/ and are gitignored —
 * hundreds of megabytes of weights that are rebuilt rather than committed. A
 * deployment therefore ships the *option* without the files, and the row would
 * otherwise fail only once the user picks it and waits.
 *
 * Probing config.json is enough: it is the first file transformers.js asks for,
 * so if it is missing the load cannot succeed either.
 */
const LOCAL_MODEL_PATH = "/models/";

/** Cached per id — the answer cannot change without a redeploy. */
const cache = new Map<string, Promise<boolean>>();

export function localModelPresent(id: string): Promise<boolean> {
  const hit = cache.get(id);
  if (hit) return hit;

  const probe = (async () => {
    try {
      const res = await fetch(`${LOCAL_MODEL_PATH}${id}/config.json`, {
        method: "HEAD",
      });
      return res.ok;
    } catch {
      // Offline, or the fetch was blocked. Treat as absent rather than
      // reporting the model as available and failing later.
      return false;
    }
  })();

  cache.set(id, probe);
  return probe;
}
