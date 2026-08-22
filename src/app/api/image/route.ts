import { NextResponse } from "next/server";
import { pollinations } from "@/lib/ai/image";
import { decorateWithStyle, enhanceImagePrompt } from "@/lib/ai/prompt-engineering";
import { AppError } from "@/lib/utils/errors";
import { acquire, clientKey } from "@/lib/utils/rate-limit";
import { fail, failFrom, parseBody } from "@/lib/utils/route-helpers";
import { imageRequestSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LIMITS = { capacity: 60, windowMs: 60_000, maxConcurrent: 8 };

export async function POST(req: Request) {
  let lease;
  try {
    const body = await parseBody(req, imageRequestSchema);
    lease = acquire(clientKey(req, "image"), LIMITS);

    const width = body.width ?? 1024;
    const height = body.height ?? 1024;

    // Vague requests make weak images, so the prompt is rewritten before it
    // reaches the model unless the caller explicitly opted out.
    const enhancement =
      body.enhance === false
        ? {
            prompt: body.style ? decorateWithStyle(body.prompt, body.style) : body.prompt,
            style: body.style,
          }
        : await enhanceImagePrompt({ request: body.prompt, style: body.style });

    const result = await pollinations.generateImage({
      prompt: enhancement.prompt,
      model: body.model,
      width,
      height,
      quality: body.quality,
      seed: body.seed,
      transparent: body.transparent,
    });

    return NextResponse.json({
      success: true as const,
      image: {
        ...result,
        canvasSafe: true,
        fallbackFrom: body.fallbackFrom,
        fallbackReason: body.fallbackFrom ? body.fallbackReason : undefined,
      },
      prompt: { original: body.prompt, used: enhancement.prompt, style: enhancement.style },
    });
  } catch (err) {
    return err instanceof AppError ? fail(err) : failFrom(err);
  } finally {
    lease?.release();
  }
}
