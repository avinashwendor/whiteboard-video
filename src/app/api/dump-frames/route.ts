import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Temporary inspection sink. Not part of the product. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DIR =
  "/private/tmp/claude-501/-Users-apple-Desktop-ai-tools-website/c97b37b7-61dc-4170-b6a5-c7577544a79d/scratchpad/e2e";

export async function POST(req: Request) {
  const { name, dataUrl } = (await req.json()) as { name: string; dataUrl: string };
  await mkdir(DIR, { recursive: true });
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  const ext = dataUrl.startsWith("data:video") ? "mp4" : dataUrl.startsWith("data:audio") ? "wav" : "png";
  await writeFile(path.join(DIR, `${name.replace(/[^a-z0-9.=-]+/gi, "_")}.${ext}`), bytes);
  return NextResponse.json({ ok: true, bytes: bytes.length });
}
