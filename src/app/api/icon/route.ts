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
  /** A single concept, kept for tooling and inspection. */
  name: z.string().trim().min(1).max(60).optional(),
  /**
   * A batch, for a whole video at once.
   *
   * The modern engine wants one line icon per bullet across every scene, and
   * asking for them one at a time would be a dozen round trips before the
   * first frame can be drawn. Resolved in order, with each answer excluded
   * from the next lookup so a film does not put the same drawing on six
   * frames -- the fastest way to make a set of icons look automatic.
   */
  names: z.array(z.string().trim().min(1).max(60)).max(48).optional(),
});

const LIMITS = { capacity: 60, windowMs: 60_000, maxConcurrent: 6 };

/**
 * POST /api/icon: what a concept resolves to.
 *
 * Two shapes. `{name}` answers one lookup, for inspection and tooling.
 * `{names}` answers a batch and is what the modern engine calls once per
 * video, because its frames are built from line icons and the catalogue they
 * come from has no business in a browser bundle.
 *
 * Whiteboard scenes still get their geometry attached inside `/api/scene`, so
 * the board draws the icon that was actually chosen for it.
 */
export async function POST(req: Request) {
  let lease;
  try {
    const body = await parseBody(req, schema);
    lease = acquire(clientKey(req, "icon"), LIMITS, req.signal);

    if (body.names?.length) {
      const taken = new Set<string>();
      const icons = body.names.map((query) => {
        const found = pickIcon(query, taken);
        if (!found) return null;
        taken.add(found.name);
        return { query, name: found.name, paths: found.paths };
      });
      return NextResponse.json({
        success: true as const,
        icons,
        viewBox: 24,
        catalogue: LUCIDE_NAMES.length,
      });
    }

    if (!body.name) {
      throw new AppError("invalid_request", {
        userMessage: "Ask for an icon by name.",
        detail: "icon request had neither name nor names",
      });
    }

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
