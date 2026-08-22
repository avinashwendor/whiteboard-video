import { NextResponse } from "next/server";
import { z } from "zod";
import { pickIcon, LUCIDE_NAMES } from "@/lib/whiteboard/icon-picker";
import { acquire, clientKey } from "@/lib/utils/rate-limit";
import { fail, failFrom, parseBody } from "@/lib/utils/route-helpers";
import { AppError } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  name: z.string().trim().min(1).max(60),
});

const LIMITS = { capacity: 60, windowMs: 60_000, maxConcurrent: 6 };

/**
 * POST /api/icon: what a concept resolves to.
 *
 * Kept for inspection and tooling. Scenes no longer call it -- their geometry
 * is attached server-side in `/api/scene` so the board draws the icon that was
 * actually chosen.
 */
export async function POST(req: Request) {
  let lease;
  try {
    const body = await parseBody(req, schema);
    lease = acquire(clientKey(req, "icon"), LIMITS);

    const picked = pickIcon(body.name);
    if (!picked) {
      throw new AppError("invalid_request", {
        userMessage: `No icon matches "${body.name}".`,
        detail: `icon lookup miss: ${body.name}`,
      });
    }

    return NextResponse.json({
      success: true as const,
      name: picked.name,
      paths: picked.paths,
      viewBox: 24,
      catalogue: LUCIDE_NAMES.length,
    });
  } catch (err) {
    return err instanceof AppError ? fail(err) : failFrom(err);
  } finally {
    lease?.release();
  }
}
