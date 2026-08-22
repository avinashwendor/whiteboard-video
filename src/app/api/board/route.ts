import { NextResponse } from "next/server";
import { z } from "zod";
import { attachIconGeometry } from "@/lib/ai/icon-resolver";
import { sceneSpecSchema, type SceneSpec } from "@/lib/whiteboard/scene";
import { AppError } from "@/lib/utils/errors";
import { acquire, clientKey } from "@/lib/utils/rate-limit";
import { fail, failFrom, parseBody } from "@/lib/utils/route-helpers";

/**
 * Re-resolves the icons on one board.
 *
 * Editing a board by hand means naming an icon -- "handshake", "server" -- and
 * a name on its own draws nothing. The geometry has to be looked up the same
 * way `/api/scene` does it, on the server, where the hand-drawn set, the
 * Lucide catalogue and the model shortlist all live.
 *
 * The whole board is resolved rather than the one icon that changed, because
 * the resolver keeps a board from drawing the same picture twice and that rule
 * only works when it can see every slot at once.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  scene: sceneSpecSchema,
  model: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-zA-Z0-9._:\-\/]+$/)
    .optional(),
});

const LIMITS = { capacity: 60, windowMs: 60_000, maxConcurrent: 6 };

/**
 * An unset `glyph` is the signal for the board to draw its own colourful
 * version, so a stale one left behind by the previous icon would quietly win.
 */
function clearGlyphs(spec: SceneSpec) {
  const wipe = (items?: Array<{ glyph?: string[] }>) => {
    for (const item of items ?? []) delete item.glyph;
  };
  if ("items" in spec) wipe(spec.items as Array<{ glyph?: string[] }>);
  if ("left" in spec) wipe(spec.left.items as Array<{ glyph?: string[] }>);
  if ("right" in spec) wipe(spec.right.items as Array<{ glyph?: string[] }>);
  if (spec.layout === "stat") delete (spec as { glyph?: string[] }).glyph;
}

export async function POST(req: Request) {
  let lease;
  try {
    const body = await parseBody(req, schema);
    lease = acquire(clientKey(req, "board"), LIMITS);

    const scene = body.scene as SceneSpec;
    clearGlyphs(scene);
    await attachIconGeometry(scene, body.model, req.signal);

    return NextResponse.json({ success: true as const, scene });
  } catch (err) {
    return err instanceof AppError ? fail(err) : failFrom(err);
  } finally {
    lease?.release();
  }
}
