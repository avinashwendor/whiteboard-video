/**
 * Tenor — GIFs and short loops.
 *
 * Google's catalogue, and the one worth having over Giphy for this: its API
 * returns real MP4 and WebM alongside the GIF, and an MP4 loop is a fraction of
 * the size and decodes far more cheaply than an animated GIF the browser has to
 * unpack frame by frame. In a compositor that seeks per output frame, that is
 * the difference between usable and not.
 *
 * Needs `TENOR_API_KEY`. Free from Google Cloud.
 *
 * ⚠️ Nothing here is Creative Commons. Tenor's content is licensed for use
 * *through Tenor*, which is fine for a social post and is not a licence to put
 * something in a client's brand video — so results are marked
 * `commercialUse: false` and the panel filters them out by default. That is
 * deliberately conservative and deliberately visible: the alternative is
 * someone shipping a Marvel reaction GIF in a corporate edit.
 */

import { fetchWithTimeout, readJson } from "@/lib/utils/http";
import type { MediaProvider, MediaResult } from "./types";

const BASE = "https://tenor.googleapis.com/v2";

interface TenorFormat {
  url: string;
  duration?: number;
  dims?: number[];
}

interface TenorItem {
  id: string;
  title?: string;
  content_description?: string;
  itemurl?: string;
  media_formats?: Record<string, TenorFormat>;
}

interface TenorResponse {
  results?: TenorItem[];
}

function apiKey(): string {
  return process.env.TENOR_API_KEY?.trim() ?? "";
}

export const tenor: MediaProvider = {
  id: "tenor",
  kinds: ["gif"],
  keyless: false,
  note: "GIFs and short loops. Licensed for social use, not for client work.",
  isConfigured: () => Boolean(apiKey()),

  async search({ query, kind, limit = 24, commercialOnly = true, signal }) {
    if (kind !== "gif" || !apiKey()) return [];
    // Nothing here clears a commercial bar, so an explicit commercial search
    // gets an honest empty answer rather than results it must not use.
    if (commercialOnly) return [];

    const params = new URLSearchParams({
      key: apiKey(),
      q: query,
      limit: String(Math.min(limit, 40)),
      // MP4 first — see the note above about decode cost in the compositor.
      media_filter: "tinymp4,mp4,gif,tinygif",
      contentfilter: "medium",
      client_key: "chalkline",
    });

    const res = await fetchWithTimeout(`${BASE}/search?${params}`, {
      headers: { Accept: "application/json" },
      timeoutMs: 12_000,
      label: "tenor search",
      signal,
    });
    if (!res.ok) return [];

    const json = await readJson<TenorResponse>(res, "tenor search");
    return (json.results ?? [])
      .map((item): MediaResult => {
        const f = item.media_formats ?? {};
        const best = f.mp4 ?? f.tinymp4 ?? f.gif ?? f.tinygif;
        return {
          id: item.id,
          provider: "tenor",
          kind: "gif",
          title: item.content_description?.trim() || item.title?.trim() || "Loop",
          artist: "Tenor",
          downloadUrl: best?.url ?? "",
          previewUrl: (f.tinygif ?? f.gif)?.url,
          duration: best?.duration,
          licence: {
            name: "Tenor terms — social use",
            attributionRequired: false,
            commercialUse: false,
          },
          pageUrl: item.itemurl,
        };
      })
      .filter((r) => r.downloadUrl)
      .slice(0, limit);
  },
};
