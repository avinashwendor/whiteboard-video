/**
 * Freesound — sound effects.
 *
 * Half a million CC-licensed sounds. The one catalogue here that is genuinely
 * good at the small stuff an edit actually needs: a whoosh under a transition,
 * a click on a caption, room tone to cover a hard cut.
 *
 * Needs `FREESOUND_API_KEY`.
 *
 * ⚠️ Freesound's search does not return a usable download URL for anonymous
 * keys — the full-quality file needs OAuth. What a token key *does* give is the
 * transcoded previews, which are 128kbps MP3 and completely adequate for a
 * sound effect sitting under speech. So the preview is what gets used, and the
 * licence still applies to it.
 */

import { fetchWithTimeout, readJson } from "@/lib/utils/http";
import {
  readCcLicence,
  type MediaProvider,
  type MediaResult,
} from "./types";

const BASE = "https://freesound.org/apiv2";

interface FreesoundItem {
  id: number;
  name?: string;
  username?: string;
  duration?: number;
  license?: string;
  url?: string;
  tags?: string[];
  previews?: { "preview-hq-mp3"?: string; "preview-lq-mp3"?: string };
  images?: { waveform_m?: string };
}

interface FreesoundResponse {
  results?: FreesoundItem[];
}

function apiKey(): string {
  return process.env.FREESOUND_API_KEY?.trim() ?? "";
}

/** Freesound names licences by URL; the code is the path segment. */
function licenceFrom(url: string | undefined) {
  const match = /licenses\/([a-z-]+)\/([\d.]+)/.exec(url ?? "");
  if (/publicdomain\/zero/.test(url ?? "")) {
    return { name: "CC0", attributionRequired: false, commercialUse: true, url };
  }
  if (!match) {
    return {
      name: "Freesound (see sound page)",
      attributionRequired: true,
      commercialUse: false,
      url,
    };
  }
  return { ...readCcLicence(match[1], match[2]), url };
}

export const freesound: MediaProvider = {
  id: "freesound",
  kinds: ["sfx"],
  keyless: false,
  note: "Creative Commons sound effects. Needs FREESOUND_API_KEY.",
  isConfigured: () => Boolean(apiKey()),

  async search({ query, kind, limit = 24, commercialOnly = true, signal }) {
    if (kind !== "sfx" || !apiKey()) return [];

    const params = new URLSearchParams({
      query,
      page_size: String(Math.min(limit, 40)),
      fields: "id,name,username,duration,license,url,tags,previews,images",
      // Effects, not songs. Without this the results are full of eight-minute
      // ambient pieces that happen to be tagged "click".
      filter: "duration:[0.1 TO 30]",
      sort: "score",
    });

    const res = await fetchWithTimeout(`${BASE}/search/text/?${params}`, {
      headers: { Accept: "application/json", Authorization: `Token ${apiKey()}` },
      timeoutMs: 12_000,
      label: "freesound search",
      signal,
    });
    if (!res.ok) return [];

    const json = await readJson<FreesoundResponse>(res, "freesound search");
    return (json.results ?? [])
      .map((item): MediaResult => ({
        id: String(item.id),
        provider: "freesound",
        kind: "sfx",
        title: item.name?.trim() || "Untitled",
        artist: item.username?.trim() || "Unknown",
        // The transcoded preview, deliberately: the full file needs OAuth, and
        // 128kbps is past adequate for a sound effect under speech.
        downloadUrl:
          item.previews?.["preview-hq-mp3"] ?? item.previews?.["preview-lq-mp3"] ?? "",
        previewUrl: item.images?.waveform_m,
        duration: item.duration,
        licence: licenceFrom(item.license),
        pageUrl: item.url,
        tags: item.tags?.slice(0, 8),
      }))
      .filter((r) => r.downloadUrl && (!commercialOnly || r.licence.commercialUse))
      .slice(0, limit);
  },
};
