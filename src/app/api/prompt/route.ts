import { NextResponse } from "next/server";
import { enhanceImagePrompt, IMAGE_STYLES } from "@/lib/ai/prompt-engineering";
import { z } from "zod";
import { AppError } from "@/lib/utils/errors";
import { acquire, clientKey } from "@/lib/utils/rate-limit";
import { fail, failFrom, parseBody } from "@/lib/utils/route-helpers";
import { promptField } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** An LLM round trip; the platform default is too short for one. */
export const maxDuration = 60;

/**
 * Prompt rewriting on its own route, because the browser-side Puter provider
 * needs the same upgraded prompt that `/api/image` builds internally.
 */
const schema = z.object({
  prompt: promptField,
  style: z.enum(IMAGE_STYLES).optional(),
  model: z.string().trim().max(80).optional(),
});

const LIMITS = { capacity: 30, windowMs: 60_000, maxConcurrent: 4 };

export async function POST(req: Request) {
  let lease;
  try {
    const body = await parseBody(req, schema);
    lease = acquire(clientKey(req, "prompt"), LIMITS, req.signal);

    const enhancement = await enhanceImagePrompt({
      request: body.prompt,
      style: body.style,
      model: body.model,
    });

    return NextResponse.json({
      success: true as const,
      original: body.prompt,
      used: enhancement.prompt,
      style: enhancement.style,
    });
  } catch (err) {
    return err instanceof AppError ? fail(err) : failFrom(err);
  } finally {
    lease?.release();
  }
}
