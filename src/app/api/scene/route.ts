import { NextResponse } from "next/server";
import { z } from "zod";
import { attachIconGeometry } from "@/lib/ai/icon-resolver";
import { writeScene } from "@/lib/ai/scene-writer";
import { SCENE_LAYOUTS } from "@/lib/whiteboard/scene";
import { AppError } from "@/lib/utils/errors";
import { acquire, clientKey } from "@/lib/utils/rate-limit";
import { fail, failFrom, parseBody } from "@/lib/utils/route-helpers";
import { promptField } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  brief: promptField,
  usedLayouts: z.array(z.enum(SCENE_LAYOUTS)).max(6).optional(),
  /** Set when a photograph will share the board, so the layout stays narrow. */
  hasPhoto: z.boolean().optional(),
  model: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-zA-Z0-9._:\-\/]+$/)
    .optional(),
});

const LIMITS = { capacity: 30, windowMs: 60_000, maxConcurrent: 4 };

export async function POST(req: Request) {
  let lease;
  try {
    const body = await parseBody(req, schema);
    lease = acquire(clientKey(req, "scene"), LIMITS, req.signal);

    const scene = await writeScene({
      brief: body.brief,
      usedLayouts: body.usedLayouts,
      hasPhoto: body.hasPhoto,
      model: body.model,
    });

    // The board is drawn in the browser, so the icons it needs have to travel
    // with it. Resolving here also means the catalogue never reaches a bundle.
    await attachIconGeometry(scene, body.model);

    return NextResponse.json({ success: true as const, scene });
  } catch (err) {
    return err instanceof AppError ? fail(err) : failFrom(err);
  } finally {
    lease?.release();
  }
}
