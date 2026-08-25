/**
 * Openverse — the one that works with no key.
 *
 * Run by the WordPress Foundation over ~700 million openly-licensed images and
 * audio files aggregated from Flickr, Wikimedia, Jamendo, Freesound and others.
 * Anonymous requests are rate-limited but free, which makes it the only
 * catalogue here that answers on a fresh clone with an empty `.env.local`.
 *
 * That matters more than raw catalogue quality. A media panel whose every
 * provider needs a key is a media panel that is empty the first time anyone
 * opens it, and "get four API keys before you can add music" is where most
 * people stop.
 */

import { fetchWithTimeout, readJson } from "@/lib/utils/http";
import {
  readCcLicence,
  type MediaProvider,
  type MediaResult,
} from "./types";

const BASE = "https://api.openverse.org/v1";

interface OpenverseItem {
  id: string;
  title?: string;
  creator?: string;
  url: string;
  thumbnail?: string;
  duration?: number;
  license: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  tags?: { name: string }[];
}

interface OpenverseResponse {
  results?: OpenverseItem[];
}

function toResult(item: OpenverseItem, kind: "image" | "music"): MediaResult {
  const licence = readCcLicence(item.license, item.license_version ?? "");
  return {
    id: item.id,
    provider: "openverse",
    kind,
    title: item.title?.trim() || "Untitled",
    // Openverse leaves the creator blank more often than you would expect, and
    // "Unknown" in a credit line is better than an empty pair of quotes.
    artist: item.creator?.trim() || "Unknown",
    downloadUrl: item.url,
    previewUrl: item.thumbnail,
    // Openverse reports audio length in milliseconds.
    duration: item.duration ? item.duration / 1000 : undefined,
    licence: { ...licence, url: item.license_url },
    pageUrl: item.foreign_landing_url,
    tags: item.tags?.map((t) => t.name).slice(0, 8),
  };
}

export const openverse: MediaProvider = {
  id: "openverse",
  kinds: ["image", "music"],
  keyless: true,
  note: "Openly-licensed images and audio. No key needed.",
  isConfigured: () => true,

  async search({ query, kind, limit = 24, commercialOnly = true, signal }) {
    if (kind !== "image" && kind !== "music") return [];
    const endpoint = kind === "image" ? "images" : "audio";

    const params = new URLSearchParams({
      q: query,
      page_size: String(Math.min(limit, 40)),
    });
    // Asked for at the source rather than filtered afterwards: a page of
    // twenty results that becomes three after filtering looks broken, and
    // Openverse can do this properly.
    if (commercialOnly) params.set("license_type", "commercial,modification");

    const res = await fetchWithTimeout(`${BASE}/${endpoint}/?${params}`, {
      headers: { Accept: "application/json" },
      timeoutMs: 12_000,
      label: "openverse search",
      signal,
    });

    // A rate-limited anonymous request is a normal outcome here, not an
    // incident. An empty shelf beats an error dialog over a search someone can
    // simply run again.
    if (!res.ok) return [];

    const json = await readJson<OpenverseResponse>(res, "openverse search");
    return (json.results ?? [])
      .map((item) => toResult(item, kind))
      // Belt and braces: the licence filter above is the provider's, and this
      // is ours. A non-commercial track reaching someone's client video because
      // a query parameter was silently ignored is not a failure worth risking.
      .filter((r) => !commercialOnly || r.licence.commercialUse)
      .slice(0, limit);
  },
};
