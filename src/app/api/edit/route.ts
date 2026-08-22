import { NextResponse } from "next/server";
import { planEdit } from "@/lib/ai/editor-agent";
import { AppError } from "@/lib/utils/errors";
import { acquire, clientKey } from "@/lib/utils/rate-limit";
import { fail, failFrom, parseBody } from "@/lib/utils/route-helpers";
import { editRequestSchema } from "@/lib/validation/schemas";

/**
 * Plans an edit. It does not perform one.
 *
 * The reply is a list of operations the browser then runs against the pipelines
 * it already owns, so nothing here touches an asset, a provider quota or the
 * project itself.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LIMITS = { capacity: 30, windowMs: 60_000, maxConcurrent: 4 };

export async function POST(req: Request) {
  let lease;
  try {
    const body = await parseBody(req, editRequestSchema);
    lease = acquire(clientKey(req, "edit"), LIMITS);

    const plan = await planEdit({
      instruction: body.instruction,
      project: body.project,
      sceneNumber: body.sceneNumber,
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
