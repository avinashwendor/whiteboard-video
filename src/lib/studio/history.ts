"use client";

import { cacheMedia, deleteMedia, mediaKey, resolveMedia } from "./media-store";
import type { Generation, ImageAsset, AudioAsset } from "./types";

/**
 * Generation history.
 *
 * Metadata lives in localStorage (small, synchronous, survives everything);
 * the actual bitmaps and audio live in IndexedDB via `media-store`. That split
 * is what lets the gallery keep working after the dev server restarts and the
 * in-process asset store is gone.
 */

const KEY = "whiteboard-studio:history:v1";
const MAX_RECORDS = 40;

export function loadHistory(): Generation[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Generation[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && typeof entry.id === "string");
  } catch {
    return [];
  }
}

function persist(records: Generation[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
  } catch {
    // Quota exhausted: drop the oldest half rather than lose the session.
    try {
      localStorage.setItem(KEY, JSON.stringify(records.slice(0, Math.floor(MAX_RECORDS / 2))));
    } catch {
      /* give up silently -- history is a convenience, not the product */
    }
  }
}

function keysFor(generation: Generation): string[] {
  const keys: string[] = [];
  const push = (asset?: { cacheKey?: string }) => {
    if (asset?.cacheKey) keys.push(asset.cacheKey);
  };
  push(generation.image);
  push(generation.audio);
  push(generation.project?.cover);
  for (const scene of generation.project?.scenes ?? []) {
    push(scene.image);
    push(scene.audio);
  }
  return keys;
}

/** Copies every asset in a finished generation into IndexedDB. */
export async function cacheGeneration(generation: Generation): Promise<Generation> {
  const copy: Generation = structuredClone(generation);

  const cacheAsset = async <T extends ImageAsset | AudioAsset>(
    asset: T | undefined,
    slot: string,
  ): Promise<T | undefined> => {
    if (!asset?.url || asset.cacheKey) return asset;
    const key = mediaKey(generation.id, slot);
    const local = await cacheMedia(key, asset.url);
    return { ...asset, url: local, cacheKey: key };
  };

  copy.image = await cacheAsset(copy.image, "image");
  copy.audio = await cacheAsset(copy.audio, "audio");

  if (copy.project) {
    copy.project.cover = await cacheAsset(copy.project.cover, "cover");
    for (let index = 0; index < copy.project.scenes.length; index += 1) {
      const scene = copy.project.scenes[index];
      scene.image = await cacheAsset(scene.image, `scene-${index}-image`);
      scene.audio = await cacheAsset(scene.audio, `scene-${index}-audio`);
    }
  }

  return copy;
}

/** Re-points cached assets at fresh object URLs after a reload. */
export async function hydrateGeneration(generation: Generation): Promise<Generation> {
  const copy: Generation = structuredClone(generation);

  const rehydrate = async <T extends ImageAsset | AudioAsset>(asset: T | undefined): Promise<T | undefined> => {
    if (!asset?.cacheKey) return asset;
    const local = await resolveMedia(asset.cacheKey);
    return local ? ({ ...asset, url: local } as T) : asset;
  };

  copy.image = await rehydrate(copy.image);
  copy.audio = await rehydrate(copy.audio);

  if (copy.project) {
    copy.project.cover = await rehydrate(copy.project.cover);
    for (const scene of copy.project.scenes) {
      scene.image = await rehydrate(scene.image);
      scene.audio = await rehydrate(scene.audio);
    }
  }

  return copy;
}

export function saveGeneration(generation: Generation): Generation[] {
  const existing = loadHistory().filter((entry) => entry.id !== generation.id);
  const next = [generation, ...existing].slice(0, MAX_RECORDS);

  // Anything pushed off the end takes its blobs with it.
  const dropped = existing.slice(MAX_RECORDS - 1);
  if (dropped.length) void deleteMedia(dropped.flatMap(keysFor));

  persist(next);
  return next;
}

export function removeGeneration(id: string): Generation[] {
  const all = loadHistory();
  const target = all.find((entry) => entry.id === id);
  if (target) void deleteMedia(keysFor(target));
  const next = all.filter((entry) => entry.id !== id);
  persist(next);
  return next;
}

export function clearHistory(): void {
  const all = loadHistory();
  void deleteMedia(all.flatMap(keysFor));
  persist([]);
}
