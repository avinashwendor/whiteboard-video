import { AppError } from "@/lib/utils/errors";
import { fetchWithTimeout, readJson } from "@/lib/utils/http";

/**
 * Tavily image search.
 *
 * Generated art is fine for a diagram and wrong for a documentary. When a
 * scene wants a real place, a real object or a real moment, the honest answer
 * is a photograph that already exists -- so the scene brief becomes a search
 * query and the web supplies the plate.
 *
 * What comes back is unfiltered, though: product listings, watermarked stock,
 * screenshots and clip art all arrive looking like results. Nothing here is
 * trusted on its own; `curator.ts` is what decides.
 */

const BASE = "https://api.tavily.com";
const TIMEOUT_MS = 20_000;

export interface ImageCandidate {
  url: string;
  /** Page title the image was found on. Weak signal, but a signal. */
  title?: string;
  /** Tavily's own description of the picture. */
  description?: string;
}

export function isConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) {
    throw new AppError("missing_key", {
      userMessage: "Photo search isn't configured. Add TAVILY_API_KEY to .env.local.",
      detail: "TAVILY_API_KEY missing",
    });
  }
  return key;
}

/** Hosts that only ever return watermarked comps or listing photography. */
const BLOCKED_HOSTS = [
  "dreamstime.com",
  "shutterstock.com",
  "alamy.com",
  "gettyimages.",
  "istockphoto.com",
  "123rf.com",
  "depositphotos.com",
  "canstockphoto.",
  "media-amazon.com",
  "ebayimg.com",
  "aliexpress",
  "walmartimages",
  "lookaside.fbsbx.com",
];

/** Extensions a canvas cannot draw, or that are never real photography. */
const BLOCKED_PATTERNS = [
  /\.svg(\?|$)/i,
  /\.gif(\?|$)/i,
  /sprite/i,
  /logo/i,
  /favicon/i,
  /_tiny\./i,
  /\/video\//i,
];

/**
 * Sources that publish free, full-resolution, watermark-free photography.
 *
 * Searched separately and ranked first. The open web returns better *matches*;
 * these return better *frames*, and a frame is what a scene needs.
 */
const PHOTO_DOMAINS = [
  "unsplash.com",
  "pexels.com",
  "pixabay.com",
  "stocksnap.io",
  "burst.shopify.com",
];

/**
 * Asks the big photo CDNs for a large landscape render.
 *
 * They serve whatever width the found page happened to embed -- often 500px,
 * which is useless behind a 1280-wide frame -- but the size lives in the query
 * string, so a better version is one rewrite away.
 */
function upscale(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host.includes("images.unsplash.com")) {
      parsed.searchParams.set("fm", "jpg");
      parsed.searchParams.set("q", "80");
      parsed.searchParams.set("w", "1600");
      parsed.searchParams.set("fit", "max");
      parsed.searchParams.delete("h");
      return parsed.toString();
    }
    if (host.includes("images.pexels.com")) {
      parsed.searchParams.set("auto", "compress");
      parsed.searchParams.set("cs", "tinysrgb");
      parsed.searchParams.set("w", "1600");
      parsed.searchParams.delete("h");
      parsed.searchParams.delete("dpr");
      parsed.searchParams.delete("fit");
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

function plausible(url: string): boolean {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (BLOCKED_HOSTS.some((blocked) => host.includes(blocked))) return false;
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(url))) return false;
  return url.startsWith("https://");
}

export interface SearchOptions {
  /** How many candidates to bring back before verification. */
  limit?: number;
  signal?: AbortSignal;
}

export async function searchImages(
  query: string,
  options: SearchOptions = {},
): Promise<ImageCandidate[]> {
  // Two passes. The free-photo sources reliably return usable frames; the open
  // web returns better subject matches. Running both and ranking the clean
  // sources first gets more of each than either query alone.
  const [curated, open] = await Promise.all([
    runSearch(query, PHOTO_DOMAINS, options.signal),
    runSearch(query, null, options.signal),
  ]);

  const seen = new Set<string>();
  const candidates: ImageCandidate[] = [];

  for (const entry of [...curated, ...open]) {
    const url = upscale(entry.url);
    let key = url;
    try {
      const parsed = new URL(url);
      key = `${parsed.hostname}${parsed.pathname}`;
    } catch {
      /* fall back to the whole string */
    }
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ ...entry, url });
  }

  return candidates.slice(0, options.limit ?? 6);
}

async function runSearch(
  query: string,
  domains: string[] | null,
  signal?: AbortSignal,
): Promise<ImageCandidate[]> {
  try {
    const res = await fetchWithTimeout(`${BASE}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify({
        query,
        // Photographs, not pages: the text results are ignored entirely.
        include_images: true,
        include_image_descriptions: true,
        search_depth: "basic",
        max_results: 8,
        ...(domains ? { include_domains: domains } : {}),
      }),
      timeoutMs: TIMEOUT_MS,
      label: "tavily search",
      signal,
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new AppError("provider_error", {
          userMessage: "Photo search rejected the configured key.",
          detail: `tavily search ${res.status}`,
        });
      }
      return [];
    }

    const json = await readJson<{
      images?: Array<string | { url?: string; description?: string; title?: string }>;
    }>(res, "tavily search");

    const found: ImageCandidate[] = [];
    for (const entry of json.images ?? []) {
      const url = typeof entry === "string" ? entry : entry?.url;
      if (!url || !plausible(url)) continue;
      found.push({
        url,
        title: typeof entry === "string" ? undefined : entry.title,
        description: typeof entry === "string" ? undefined : entry.description,
      });
    }
    return found;
  } catch (err) {
    if (err instanceof AppError) throw err;
    // One failed pass should not cost us the other.
    return [];
  }
}
