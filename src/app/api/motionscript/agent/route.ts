import { NextResponse } from "next/server";
import { planMotionScriptEdit } from "@/lib/ai/motionscript-agent";
import { AppError } from "@/lib/utils/errors";
import { acquire, clientKey } from "@/lib/utils/rate-limit";
import { fail, failFrom, parseBody } from "@/lib/utils/route-helpers";
import { motionscriptAgentRequestSchema } from "@/lib/validation/schemas";

/**
 * Plans an edit for the transcript editor's AI sidebar. It does not perform one.
 *
 * The reply is a list of validated operations the browser then runs against the
 * composition store and the image routes it already owns, so nothing here
 * touches media, an asset or a provider quota beyond the one text call.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LIMITS = { capacity: 30, windowMs: 60_000, maxConcurrent: 4 };

export async function POST(req: Request) {
  let lease;
  try {
    const body = await parseBody(req, motionscriptAgentRequestSchema);
    lease = acquire(clientKey(req, "motionscript-agent"), LIMITS, req.signal);

    const plan = await planMotionScriptEdit({
      instruction: body.instruction,
      context: body.context,
      mode: body.mode,
      model: body.model,
      signal: req.signal,
    });

    return NextResponse.json({ success: true as const, ...plan });
  } catch (err) {
    return err instanceof AppError ? fail(err) : failFrom(err);
  } finally {
    lease?.release();
  }
}
