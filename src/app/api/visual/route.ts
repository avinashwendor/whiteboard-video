import { NextResponse } from "next/server";
import { canCurate, curateImage } from "@/lib/ai/image/curator";
import { assetUrl, putAsset } from "@/lib/utils/asset-store";
import { AppError } from "@/lib/utils/errors";
import { acquire, clientKey } from "@/lib/utils/rate-limit";
import { fail, failFrom, parseBody } from "@/lib/utils/route-helpers";
import { visualRequestSchema } from "@/lib/validation/schemas";

/**
 * A real photograph for one scene.
 *
 * Search, download, and let the model that wrote the script look at what came
 * back. The chosen bytes are re-served from our own origin: a remote URL would
 * taint the canvas and make the video impossible to export.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LIMITS = { capacity: 30, windowMs: 60_000, maxConcurrent: 4 };

export async function POST(req: Request) {
  let lease;
  try {
    const body = await parseBody(req, visualRequestSchema);
    lease = acquire(clientKey(req, "visual"), LIMITS, req.signal);

    // Only a genuine dead end is an error. Tavily searches the open web and
    // finds the specific thing; Openverse needs no key and always answers. A
    // deployment with neither is the only case where a scene truly cannot have
    // a photograph.
    if (!canCurate()) {
      throw new AppError("missing_key", {
        userMessage: "Photo search isn't available. Add TAVILY_API_KEY to .env.local.",
        detail: "no image catalogue is reachable",
      });
    }

    const { image: curated, stats, reason } = await curateImage({
      brief: body.brief,
      query: body.query,
      model: body.model,
    });

    if (!curated) {
      return NextResponse.json({
        success: true as const,
        image: null,
        reason,
        stats,
      });
    }

    const asset = putAsset(curated.bytes, curated.contentType, `scene-${Date.now()}`);

    return NextResponse.json({
      success: true as const,
      image: {
        url: assetUrl(asset),
        provider: "tavily" as const,
        model: stats.sources.includes("tavily")
          ? "web photography, verified"
          : "openly-licensed photography, verified",
        width: curated.width,
        height: curated.height,
        canvasSafe: true,
      },
      sourceUrl: curated.sourceUrl,
      reason: curated.reason,
      stats,
    });
  } catch (err) {
    return err instanceof AppError ? fail(err) : failFrom(err);
  } finally {
    lease?.release();
  }
}
