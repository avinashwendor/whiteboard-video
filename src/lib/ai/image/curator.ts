import { omega } from "../omega";
import type { ChatMessage, ContentPart } from "../types";
import { fetchWithTimeout } from "@/lib/utils/http";
import { readImageSize } from "@/lib/utils/image-size";
import { isConfigured as tavilyConfigured, searchImages, type ImageCandidate } from "./tavily";
import { openverse } from "@/lib/media/openverse";

/**
 * Picking the photograph.
 *
 * Search gives you six pictures that match some words. That is not the same as
 * a frame that belongs in a film, and the difference is exactly the stuff a
 * URL cannot tell you: whether there is a stock watermark across it, whether
 * it is a screenshot of a website, whether it is a product on a white
 * background, whether the subject is actually what the scene is about.
 *
 * So the model looks at them. Omega is multimodal, and it is already the model
 * that wrote the script -- it knows what the scene is trying to say. Cheap
 * checks run first (content type, size, dimensions, aspect) because there is no
 * reason to spend a vision call on a 90x90 favicon.
 */

const FETCH_TIMEOUT_MS = 12_000;
/** Anything larger is a print-resolution file we do not need and will not wait for. */
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_BYTES = 24 * 1024;
const MIN_WIDTH = 820;
const MIN_HEIGHT = 460;

export interface CurationStats {
  /** Candidates the search returned after the URL filters. */
  found: number;
  /** Of those, how many downloaded as a usable landscape image. */
  downloaded: number;
  /** Why the mechanical checks dropped the rest. */
  dropped: string[];
  /** Which catalogues actually answered, best first. */
  sources: string[];
}

/**
 * Where the candidates come from.
 *
 * Tavily first when it is configured: it searches the open web, so it finds
 * the specific thing a script is about rather than the nearest stock concept.
 * Openverse tops the shortlist up and, on a deployment with no keys at all, is
 * the whole shortlist -- which is the point. A fresh clone with an empty
 * `.env.local` used to fall straight through to generated artwork for every
 * scene, and generated artwork is exactly what makes an explainer look like it
 * was made by a machine. A real, openly-licensed photograph of the real thing
 * beats a rendered impression of it every time.
 */
async function gatherCandidates(
  query: string,
  signal?: AbortSignal,
): Promise<{ candidates: ImageCandidate[]; sources: string[] }> {
  const sources: string[] = [];
  const candidates: ImageCandidate[] = [];
  const seen = new Set<string>();

  const add = (entry: ImageCandidate) => {
    if (!entry.url || seen.has(entry.url)) return;
    seen.add(entry.url);
    candidates.push(entry);
  };

  if (tavilyConfigured()) {
    try {
      const found = await searchImages(query, { limit: 6, signal });
      if (found.length) sources.push("tavily");
      found.forEach(add);
    } catch {
      // A search that fails is a thinner shortlist, never a failed scene.
    }
  }

  // Topped up rather than replaced: two catalogues give the model a genuine
  // choice, and Openverse's licensing is the one that is unambiguous.
  if (candidates.length < 5) {
    try {
      const found = await openverse.search({ query, kind: "image", limit: 8, signal });
      if (found.length) sources.push("openverse");
      for (const item of found) {
        add({
          url: item.downloadUrl,
          title: item.title,
          description: item.tags?.join(", "),
        });
      }
    } catch {
      /* same again */
    }
  }

  return { candidates: candidates.slice(0, 8), sources };
}

/** True when at least one catalogue can be searched at all. */
export function canCurate(): boolean {
  return tavilyConfigured() || openverse.isConfigured();
}

export interface CuratedImage {
  bytes: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  sourceUrl: string;
  /** Why the model kept this one. Shown on the result card. */
  reason: string;
}

interface FetchedCandidate extends ImageCandidate {
  bytes: Uint8Array;
  contentType: string;
  width: number;
  height: number;
}

/** Downloads one candidate, rejecting anything a scene could not use. */
async function fetchCandidate(
  candidate: ImageCandidate,
  dropped: string[],
  signal?: AbortSignal,
): Promise<FetchedCandidate | null> {
  const drop = (why: string): null => {
    dropped.push(`${why}: ${candidate.url.slice(0, 80)}`);
    return null;
  };

  try {
    const res = await fetchWithTimeout(candidate.url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      label: "photo fetch",
      signal,
      headers: {
        // Deliberately no AVIF. Unsplash and Pexels honour Accept, and an AVIF
        // is a format whose dimensions we cannot read from the header -- which
        // would send every one of their photographs to the reject pile.
        Accept: "image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.5",
        // Some CDNs serve a placeholder to clients that look automated.
        "User-Agent": "Mozilla/5.0 (compatible; Chalkline/1.0)",
      },
    });
    if (!res.ok) return drop(`http ${res.status}`);

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!contentType.startsWith("image/") || contentType === "image/svg+xml") {
      return drop(`type ${contentType || "unknown"}`);
    }

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) return drop("too large");

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < MIN_BYTES) return drop(`only ${Math.round(buffer.byteLength / 1024)}kb`);
    if (buffer.byteLength > MAX_BYTES) return drop("too large");

    const bytes = new Uint8Array(buffer);
    const size = readImageSize(bytes);
    if (!size) return drop("unreadable header");
    if (size.width < MIN_WIDTH || size.height < MIN_HEIGHT) {
      return drop(`${size.width}x${size.height} too small`);
    }

    // A frame is 16:9. A tall portrait or a square crop cannot fill it without
    // either bars or throwing most of the subject away.
    const aspect = size.width / size.height;
    if (aspect < 1.1 || aspect > 2.6) return drop(`aspect ${aspect.toFixed(2)}`);

    return { ...candidate, bytes, contentType, width: size.width, height: size.height };
  } catch (err) {
    return drop(err instanceof Error ? err.name : "fetch failed");
  }
}

function toDataUrl(candidate: FetchedCandidate): string {
  return `data:${candidate.contentType};base64,${Buffer.from(candidate.bytes).toString("base64")}`;
}

const SYSTEM = `You are a picture editor for a short documentary-style explainer video. You are shown numbered candidate photographs and must choose the one frame that belongs in the film.

REJECT a candidate outright if it has any of these:
- a stock-agency watermark, tiled logo, or "sample"/"preview" overlay
- burnt-in text, captions, labels, arrows, callouts, or a headline
- a website screenshot, app UI, dashboard, slide, chart, diagram or infographic
- a product-listing photo (object isolated on flat white), packaging, or a book cover
- a collage, grid, split-screen, or picture-in-picture
- clip art, a 3D-render icon, a cartoon, or an AI image with mangled hands or nonsense text
- a visible border, frame, rounded corners, or letterboxing
- heavy compression, blur, or an obviously upscaled low-resolution source

PREFER, among what survives:
- real photography of the subject the scene is about
- a clear single subject, with quiet space where a headline could sit
- natural or cinematic light, real depth of field
- a frame that would still read at a glance, at speed, behind text

HOW STRICT TO BE ABOUT SUBJECT
The picture sits beside the scene, it does not have to prove it. Judge whether it shows the SUBJECT -- the place, the object, the kind of work -- not whether it demonstrates the argument. A photograph of a factory floor is right for a scene about coordinating factory shifts, even though no photograph could show "coordination". Reject for the defects listed above; do not reject for being a general view of the right subject.

Only answer -1 when every candidate is defective or genuinely shows something else.

Reply with JSON only: {"choice": <index, or -1 if every candidate must be rejected>, "reason": "<at most 12 words>"}`;

function stripFence(value: string): string {
  return value.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

function firstJsonObject(value: string): string | null {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return value.slice(start, end + 1);
}

export interface CurateOptions {
  /** What the scene is about, in the script's own words. */
  brief: string;
  /** Search phrase. Usually narrower than the brief. */
  query: string;
  model?: string;
  signal?: AbortSignal;
}

/**
 * Searches, downloads, and has the model choose.
 *
 * Returns null rather than a poor picture: a scene renders perfectly well on
 * its gradient backdrop, and a watermarked stock photo behind the headline
 * costs more than an empty one.
 */
export async function curateImage(
  options: CurateOptions,
): Promise<{ image: CuratedImage | null; stats: CurationStats; reason: string }> {
  const dropped: string[] = [];
  const { candidates, sources } = await gatherCandidates(options.query, options.signal);
  const stats: CurationStats = { found: candidates.length, downloaded: 0, dropped, sources };

  if (!candidates.length) return { image: null, stats, reason: "search returned nothing" };

  // Downloads run together; the cheap rejections cost nothing to parallelise.
  const settled = await Promise.all(
    candidates.map((candidate) => fetchCandidate(candidate, dropped, options.signal)),
  );
  const usable = settled.filter((entry): entry is FetchedCandidate => entry !== null).slice(0, 4);
  stats.downloaded = usable.length;
  if (!usable.length) return { image: null, stats, reason: "nothing downloaded cleanly" };

  const parts: ContentPart[] = [
    {
      type: "text",
      text: `SCENE: ${options.brief}\n\nCandidates follow, numbered from 0.`,
    },
  ];
  usable.forEach((candidate, index) => {
    parts.push({
      type: "text",
      text: `Candidate ${index}: ${candidate.width}x${candidate.height}${
        candidate.description ? ` — ${candidate.description}` : ""
      }`,
    });
    parts.push({ type: "image_url", image_url: { url: toDataUrl(candidate), detail: "low" } });
  });

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: parts },
  ];

  let choice = -1;
  let reason = "no verdict";

  try {
    const result = await omega.generateText({
      messages,
      model: options.model,
      temperature: 0.1,
      maxTokens: 200,
      json: true,
      signal: options.signal,
    });

    const candidateJson = firstJsonObject(stripFence(result.text));
    if (candidateJson) {
      const parsed = JSON.parse(candidateJson) as { choice?: unknown; reason?: unknown };
      if (typeof parsed.choice === "number") choice = parsed.choice;
      if (typeof parsed.reason === "string") reason = parsed.reason;
    }
  } catch {
    // A vision call that fails should not cost us the scene. The first
    // candidate already passed every mechanical check.
    choice = 0;
    reason = "verification unavailable";
  }

  if (choice < 0 || choice >= usable.length) {
    return { image: null, stats, reason: `rejected — ${reason}` };
  }

  const picked = usable[choice];
  return {
    image: {
      bytes: picked.bytes,
      contentType: picked.contentType,
      width: picked.width,
      height: picked.height,
      sourceUrl: picked.url,
      reason,
    },
    stats,
    reason,
  };
}
