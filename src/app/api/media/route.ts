/**
 * Stock media search, and the proxy that makes a result usable.
 *
 * Two operations on one route because they are two halves of one thing: you
 * search, you pick, and the bytes have to arrive on **our** origin before
 * anything can be done with them.
 *
 * That proxy is not a nicety. The editor page is cross-origin isolated, so a
 * cross-origin picture taints the canvas and makes the export throw at the
 * first `VideoFrame`, and cross-origin audio cannot be read into the mix at
 * all. Every other media path in this app already works this way — generated
 * art, searched photos — and this is the same rule applied to a fourth source.
 *
 * It also keeps provider keys out of the browser, which is the reason the
 * search half is here rather than being called directly from the panel.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { searchMedia } from "@/lib/media/registry";
import { fetchWithTimeout } from "@/lib/utils/http";
import {
  generateMusic,
  generateSfx,
  isConfigured as elevenLabsConfigured,
} from "@/lib/ai/elevenlabs";
import { assetUrl, putAsset } from "@/lib/utils/asset-store";
import { toAppError } from "@/lib/utils/errors";
import {
  acquire,
  clientKey,
  type RateLimitLease,
} from "@/lib/utils/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const searchSchema = z.object({
  query: z.string().trim().min(1).max(120),
  kind: z.enum(["music", "sfx", "image", "gif", "video"]),
  limit: z.number().int().min(1).max(40).optional(),
  /**
   * Opt *out* of the commercial filter, never in.
   *
   * Someone editing a client video should not have to know a licence filter
   * exists in order to avoid using something they are not allowed to. Making it
   * opt-out means the failure mode is "fewer results" rather than "a legal
   * problem discovered after publication".
   */
  allowNonCommercial: z.boolean().optional(),
});

const fetchSchema = z.object({
  url: z.string().url().max(2_000),
  /** Carried through so the stored file has a sensible name. */
  filename: z.string().trim().max(120).optional(),
});

/**
 * Hosts the proxy will fetch from.
 *
 * An open proxy that will fetch any URL a client names is a server-side request
 * forgery hole and a bandwidth bill. The only URLs that need to work here are
 * the ones our own providers just returned, so the allowlist is exactly their
 * download hosts and their CDNs.
 */
const ALLOWED_HOSTS = [
  // Openverse aggregates, so the bytes live at the original source.
  "openverse.org",
  "api.openverse.org",
  "upload.wikimedia.org",
  "live.staticflickr.com",
  "farm1.staticflickr.com",
  "farm2.staticflickr.com",
  "farm3.staticflickr.com",
  "farm4.staticflickr.com",
  "farm5.staticflickr.com",
  // Jamendo
  "prod-1.storage.jamendo.com",
  "storage.jamendo.com",
  "usercontent.jamendo.com",
  "mp3l.jamendo.com",
  // Freesound
  "freesound.org",
  "cdn.freesound.org",
  // Tenor
  "media.tenor.com",
  "c.tenor.com",
  // Pexels. Video files are served from videos.pexels.com and its numbered
  // shards (player.vimeo.com is *not* used for the direct file links this
  // provider returns, so it is deliberately not here).
  "videos.pexels.com",
  "images.pexels.com",
];

function hostAllowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // https only: a proxy that will follow http is a proxy that can be
  // man-in-the-middled into serving something else entirely.
  if (url.protocol !== "https:") return false;
  return ALLOWED_HOSTS.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
  );
}

/** Media is media. A proxy that will return HTML is a proxy for anything. */
const ALLOWED_TYPES = ["audio/", "image/", "video/"];

/** 40MB. A music bed is a few; nothing legitimate here is larger. */
const MAX_BYTES = 40 * 1024 * 1024;

/**
 * Generate audio rather than search for it.
 *
 * A catalogue answers "what is the closest whoosh somebody has uploaded";
 * this answers "make me a whoosh". For sound effects that is strictly better —
 * the effect matches its description exactly, and a generated sound carries no
 * licence, which is the one thing that makes catalogue audio awkward in a
 * client's video.
 *
 * Deliberately its own action rather than a provider in the registry. Every
 * provider there answers a *search*, returning results to choose between; this
 * returns one thing that did not exist a second ago, and pretending that is a
 * search would mean a result list of one and a Place button that regenerates.
 */
const generateSchema = z.object({
  action: z.literal("generate"),
  kind: z.enum(["sfx", "music"]),
  prompt: z.string().trim().min(2).max(400),
  /** Seconds. Clamped by the provider to what it will actually produce. */
  seconds: z.number().min(0.5).max(300).optional(),
  filename: z.string().trim().max(60).optional(),
});

export async function POST(req: Request) {
  // `acquire` throws when the bucket is empty rather than returning a status,
  // which is the convention every other route here follows.
  let gate: RateLimitLease;
  try {
    gate = acquire(
      clientKey(req, "media"),
      { capacity: 40, windowMs: 60_000, maxConcurrent: 6 },
      req.signal
    );
  } catch (err) {
    const appError = toAppError(err, "busy");
    return NextResponse.json(
      { success: false as const, error: { code: appError.code, message: appError.userMessage } },
      { status: appError.status }
    );
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;

    if (body.action === "generate") {
      const input = generateSchema.parse(body);
      if (!elevenLabsConfigured()) {
        return NextResponse.json(
          {
            success: false as const,
            error: {
              code: "missing_key",
              message: "Generated audio needs ELEVENLABS_API_KEY on the server.",
            },
          },
          { status: 400 }
        );
      }

      const made =
        input.kind === "sfx"
          ? await generateSfx(input.prompt, input.seconds ?? 2, req.signal)
          : await generateMusic(input.prompt, input.seconds ?? 30, req.signal);

      const bytes = new Uint8Array(made.bytes);
      if (bytes.byteLength > MAX_BYTES) {
        return NextResponse.json(
          {
            success: false as const,
            error: { code: "provider_error", message: "That came back too large to use." },
          },
          { status: 502 }
        );
      }

      const asset = putAsset(
        bytes,
        made.contentType,
        input.filename || input.prompt.slice(0, 40)
      );
      return NextResponse.json({
        success: true as const,
        url: assetUrl(asset),
        contentType: made.contentType,
        // Named so the log line and the credit block can say where it came
        // from. A generated sound owes no attribution, and saying so is more
        // use than saying nothing.
        generated: true as const,
        provider: "elevenlabs",
      });
    }

    if (body.action === "fetch") {
      const input = fetchSchema.parse(body);
      if (!hostAllowed(input.url)) {
        return NextResponse.json(
          {
            success: false as const,
            error: {
              code: "invalid_request",
              message: "That file is not from a catalogue this app searches.",
            },
          },
          { status: 400 }
        );
      }

      const res = await fetchWithTimeout(input.url, {
        timeoutMs: 30_000,
        label: "media fetch",
        signal: req.signal,
        // Redirects are followed by default and the destination is not checked
        // again, so they are refused instead — a permitted host redirecting to
        // an arbitrary one is the same hole with an extra step.
        redirect: "error",
      });
      if (!res.ok) {
        return NextResponse.json(
          {
            success: false as const,
            error: { code: "provider_error", message: "That file could not be fetched." },
          },
          { status: 502 }
        );
      }

      const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
      if (!ALLOWED_TYPES.some((prefix) => contentType.startsWith(prefix))) {
        return NextResponse.json(
          {
            success: false as const,
            error: { code: "invalid_request", message: `Not a media file (${contentType}).` },
          },
          { status: 400 }
        );
      }

      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > MAX_BYTES) {
        return NextResponse.json(
          { success: false as const, error: { code: "invalid_request", message: "That file is too large." } },
          { status: 413 }
        );
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      // Checked again after reading: `content-length` is a claim, not a fact,
      // and a server that lies about it is exactly the one to worry about.
      if (bytes.byteLength > MAX_BYTES) {
        return NextResponse.json(
          { success: false as const, error: { code: "invalid_request", message: "That file is too large." } },
          { status: 413 }
        );
      }

      const asset = putAsset(bytes, contentType, input.filename || "media");
      return NextResponse.json({
        success: true as const,
        url: assetUrl(asset),
        contentType,
        bytes: bytes.byteLength,
      });
    }

    const input = searchSchema.parse(body);
    const { results, searched } = await searchMedia({
      query: input.query,
      kind: input.kind,
      limit: input.limit,
      commercialOnly: !input.allowNonCommercial,
      signal: req.signal,
    });

    return NextResponse.json({ success: true as const, results, searched });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false as const, error: { code: "invalid_request", message: "That search wasn't valid." } },
        { status: 400 }
      );
    }
    const appError = toAppError(err);
    // Provider text never reaches the browser; the detail is for our logs.
    console.error("media route:", appError.detail ?? appError.message);
    return NextResponse.json(
      { success: false as const, error: { code: appError.code, message: appError.userMessage } },
      { status: appError.status }
    );
  } finally {
    gate.release();
  }
}
