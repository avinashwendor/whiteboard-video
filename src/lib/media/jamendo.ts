/**
 * Jamendo — music you are actually allowed to publish.
 *
 * The catalogue most worth having behind a key. Around 600,000 tracks, all
 * Creative Commons, with a licensing arm for commercial use — so unlike a
 * general CC search it is *curated as music*: real recordings by people who
 * intended them to be used, rather than field recordings and lecture audio that
 * happen to match a search term.
 *
 * Needs `JAMENDO_CLIENT_ID`. Registration is free.
 */

import { fetchWithTimeout, readJson } from "@/lib/utils/http";
import {
  readCcLicence,
  type MediaProvider,
  type MediaResult,
} from "./types";

const BASE = "https://api.jamendo.com/v3.0";

interface JamendoTrack {
  id: string;
  name?: string;
  artist_name?: string;
  duration?: number;
  audio?: string;
  audiodownload?: string;
  image?: string;
  shareurl?: string;
  license_ccurl?: string;
  musicinfo?: { tags?: { genres?: string[]; vartags?: string[] } };
}

interface JamendoResponse {
  headers?: { status?: string; error_message?: string };
  results?: JamendoTrack[];
}

function clientId(): string {
  return process.env.JAMENDO_CLIENT_ID?.trim() ?? "";
}

/**
 * Read the licence out of the URL Jamendo returns.
 *
 * It gives a link rather than a code — `creativecommons.org/licenses/by-nc-nd/3.0/`
 * — so the code is the path segment. Anything unparseable is treated as the
 * most restrictive thing it could be, because guessing generously here means
 * offering someone a track they cannot use.
 */
function licenceFrom(url: string | undefined) {
  const match = /licenses\/([a-z-]+)\/([\d.]+)/.exec(url ?? "");
  if (!match) {
    return {
      name: "Jamendo (see track page)",
      attributionRequired: true,
      commercialUse: false,
      url,
    };
  }
  return { ...readCcLicence(match[1], match[2]), url };
}

export const jamendo: MediaProvider = {
  id: "jamendo",
  kinds: ["music"],
  keyless: false,
  note: "Creative Commons music, curated as music. Needs JAMENDO_CLIENT_ID.",
  isConfigured: () => Boolean(clientId()),

  async search({ query, kind, limit = 24, commercialOnly = true, signal }) {
    if (kind !== "music" || !clientId()) return [];

    const params = new URLSearchParams({
      client_id: clientId(),
      format: "json",
      limit: String(Math.min(limit, 40)),
      search: query,
      // Full tracks only; the API will otherwise return 30-second previews that
      // run out halfway through a video.
      audioformat: "mp32",
      include: "musicinfo licenses",
      // Instrumental first: a bed with a vocal in it fights the narration, and
      // that is the single most common way an otherwise good edit is ruined.
      vocalinstrumental: "instrumental",
    });
    if (commercialOnly) params.set("ccnc", "false");

    const res = await fetchWithTimeout(`${BASE}/tracks/?${params}`, {
      headers: { Accept: "application/json" },
      timeoutMs: 12_000,
      label: "jamendo search",
      signal,
    });
    if (!res.ok) return [];

    const json = await readJson<JamendoResponse>(res, "jamendo search");
    if (json.headers?.status && json.headers.status !== "success") return [];

    return (json.results ?? [])
      .map((track): MediaResult => {
        const licence = licenceFrom(track.license_ccurl);
        return {
          id: track.id,
          provider: "jamendo",
          kind: "music",
          title: track.name?.trim() || "Untitled",
          artist: track.artist_name?.trim() || "Unknown",
          downloadUrl: track.audiodownload || track.audio || "",
          previewUrl: track.image,
          duration: track.duration,
          licence,
          pageUrl: track.shareurl,
          tags: [
            ...(track.musicinfo?.tags?.genres ?? []),
            ...(track.musicinfo?.tags?.vartags ?? []),
          ].slice(0, 8),
        };
      })
      .filter((r) => r.downloadUrl && (!commercialOnly || r.licence.commercialUse))
      .slice(0, limit);
  },
};
