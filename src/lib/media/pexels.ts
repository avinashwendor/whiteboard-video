/**
 * Pexels — stock video, for B-roll that moves.
 *
 * The editor could already put a *photograph* over the footage, and that is the
 * right answer more often than people expect. It is not the right answer for a
 * line about traffic, or rain, or a factory floor: a still of moving things
 * reads as a slide, and the whole reason b-roll works is that the second
 * picture is alive.
 *
 * Pexels rather than the alternatives, for two reasons that matter here and not
 * in general. Its licence permits commercial use with no attribution required,
 * which is the only kind of result this app can offer without turning every
 * export into a credits problem — see the note in `types.ts` about why that is
 * enforced rather than documented. And its API hands back several encodings of
 * each clip with dimensions attached, so a 640-wide file can be chosen for an
 * insert that occupies a third of the frame instead of downloading 4K to draw
 * it at 300 pixels.
 *
 * Needs `PEXELS_API_KEY`. Free, instant, no card: https://www.pexels.com/api/
 *
 * Without it this provider reports itself unconfigured, `providersFor("video")`
 * comes back empty, `can.video` is false, and the agent is told not to plan
 * b-roll clips at all. That is the whole failure mode — nothing throws, and
 * nothing is planned that cannot be delivered.
 */

import { fetchWithTimeout, readJson } from "@/lib/utils/http";
import type { MediaProvider, MediaResult } from "./types";

const BASE = "https://api.pexels.com/videos";

interface PexelsFile {
  id: number;
  quality?: string;
  file_type?: string;
  width?: number | null;
  height?: number | null;
  link: string;
}

interface PexelsPicture {
  picture: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  url?: string;
  user?: { name?: string; url?: string };
  video_files?: PexelsFile[];
  video_pictures?: PexelsPicture[];
}

interface PexelsResponse {
  videos?: PexelsVideo[];
}

function apiKey(): string {
  return process.env.PEXELS_API_KEY?.trim() ?? "";
}

/**
 * The smallest encoding that is still big enough.
 *
 * A b-roll insert covers a third of the frame at most, so a 1280-wide file is
 * already more resolution than anything will show — and the compositor seeks
 * this clip once per exported frame, where file size is decode time. Picking
 * the largest available, which is the obvious implementation, means downloading
 * 4K to draw it at 300 pixels and an export that takes minutes longer for a
 * result nobody can distinguish.
 *
 * MP4 only: `video_files` also carries WebM, and Safari will not decode VP9 in
 * a `<video>` it is asked to seek frame by frame.
 */
function bestFile(files: PexelsFile[] | undefined): PexelsFile | null {
  const usable = (files ?? []).filter(
    (f) => f.file_type === "video/mp4" && typeof f.link === "string" && f.link
  );
  if (!usable.length) return null;

  const wideEnough = usable
    .filter((f) => (f.width ?? 0) >= 960)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  if (wideEnough.length) return wideEnough[0];

  // Nothing reaches 960: take the largest there is rather than nothing.
  return usable.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
}

function toResult(video: PexelsVideo): MediaResult | null {
  const file = bestFile(video.video_files);
  if (!file) return null;

  const artist = video.user?.name?.trim() || "Pexels";
  return {
    id: String(video.id),
    provider: "pexels",
    kind: "video",
    // Pexels clips have no titles, only a page. The contributor's name plus the
    // shape of the clip is more use in a list than "Video 12345678".
    title: `${video.width}×${video.height} · ${Math.round(video.duration)}s`,
    artist,
    downloadUrl: file.link,
    previewUrl: video.video_pictures?.[0]?.picture,
    duration: video.duration,
    licence: {
      name: "Pexels Licence",
      // Not required — and that is exactly why this catalogue is the one worth
      // wiring up. A b-roll insert that obliges a credit line obliges it on
      // every video it ever appears in.
      attributionRequired: false,
      commercialUse: true,
      url: "https://www.pexels.com/license/",
    },
    pageUrl: video.url,
  };
}

export const pexels: MediaProvider = {
  id: "pexels",
  kinds: ["video"],
  keyless: false,
  note: "Stock video for b-roll. Free commercial use, no credit required. Needs PEXELS_API_KEY.",
  isConfigured: () => Boolean(apiKey()),

  async search({ query, kind, limit = 24, signal }) {
    if (kind !== "video" || !apiKey()) return [];

    const params = new URLSearchParams({
      query,
      per_page: String(Math.min(limit, 40)),
      // Landscape by default: an insert sits in a rectangle wider than it is
      // tall, and a portrait clip letterboxed into one is the thing that makes
      // b-roll look pasted on.
      orientation: "landscape",
      // Under a minute. A b-roll insert is three seconds; a two-minute clip is
      // a two-minute download for three seconds of use.
      size: "medium",
    });

    const res = await fetchWithTimeout(`${BASE}/search?${params}`, {
      headers: { Authorization: apiKey() },
      signal,
    });
    if (!res.ok) return [];

    const json = await readJson<PexelsResponse>(res, "Pexels");
    return (json?.videos ?? [])
      .map(toResult)
      .filter((r): r is MediaResult => r !== null);
  },
};
