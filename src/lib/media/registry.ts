/**
 * Which catalogues this deployment can actually search.
 *
 * Ordered by how good the answer is, not alphabetically, and the keyless one is
 * never last — a deployment with no keys at all must still return something,
 * because a media panel that is empty the first time it is opened is a media
 * panel nobody opens twice.
 */

import { freesound } from "./freesound";
import { jamendo } from "./jamendo";
import { openverse } from "./openverse";
import { tenor } from "./tenor";
import type { MediaKind, MediaProvider, MediaResult, MediaSearch } from "./types";

/** Best answer first within each kind. */
const ALL: MediaProvider[] = [jamendo, freesound, tenor, openverse];

export function providersFor(kind: MediaKind): MediaProvider[] {
  return ALL.filter((p) => p.kinds.includes(kind) && p.isConfigured());
}

/** Everything, configured or not — for the capabilities report. */
export function allProviders(): MediaProvider[] {
  return ALL;
}

/**
 * Search every catalogue that can answer, best-first, and interleave.
 *
 * Interleaved rather than concatenated: a keyed catalogue is usually better
 * than the keyless one, but not so much better that thirty of its results
 * should bury all of Openverse's. Taking one from each in turn means the first
 * screenful is a fair sample of everything available.
 */
export async function searchMedia(
  input: MediaSearch
): Promise<{ results: MediaResult[]; searched: string[] }> {
  const providers = providersFor(input.kind);
  if (providers.length === 0) return { results: [], searched: [] };

  const settled = await Promise.allSettled(
    providers.map((p) => p.search({ ...input, limit: input.limit ?? 24 }))
  );

  const lists: MediaResult[][] = [];
  const searched: string[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status !== "fulfilled") return;
    searched.push(providers[i].id);
    if (outcome.value.length) lists.push(outcome.value);
  });

  const results: MediaResult[] = [];
  const limit = input.limit ?? 24;
  for (let row = 0; results.length < limit; row += 1) {
    let added = false;
    for (const list of lists) {
      if (row >= list.length) continue;
      results.push(list[row]);
      added = true;
      if (results.length >= limit) break;
    }
    if (!added) break;
  }

  return { results, searched };
}
