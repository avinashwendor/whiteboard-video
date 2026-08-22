import { getAsset } from "@/lib/utils/asset-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves generated media from the in-process store. Same-origin by design. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const asset = getAsset(id);

  if (!asset) {
    return new Response("Not found", { status: 404 });
  }

  const body = new Uint8Array(asset.bytes);
  return new Response(body, {
    headers: {
      "Content-Type": asset.contentType,
      "Content-Length": String(asset.bytes.byteLength),
      "Content-Disposition": `inline; filename="${asset.filename}"`,
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "none",
    },
  });
}
