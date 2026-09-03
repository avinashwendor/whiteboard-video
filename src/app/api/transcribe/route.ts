import { NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/ai/deepgram";
import { acquire, clientKey } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Uploads audio and waits on a provider; comfortably past any short default. */
export const maxDuration = 120;

const LIMITS = { capacity: 50, windowMs: 60_000, maxConcurrent: 5 };

export async function POST(req: Request) {
  try {
    const permit = acquire(clientKey(req, "transcribe"), LIMITS);
    
    try {
      const contentType = req.headers.get("content-type") || "audio/webm";
      const audio = await req.arrayBuffer();
      
      if (!audio || audio.byteLength === 0) {
        return NextResponse.json({ error: "Empty audio buffer" }, { status: 400 });
      }

      const transcript = await transcribeAudio(audio, contentType);
      return NextResponse.json({ transcript });
    } finally {
      permit.release();
    }
  } catch (err) {
    console.error("Transcription error:", err);
    // A thrown value is not necessarily an Error, and a provider's own error
    // often carries the status worth passing on. Both are read defensively
    // rather than asserted, which is what the `any` here was standing in for.
    const detail = err as { message?: unknown; status?: unknown };
    const message =
      typeof detail?.message === "string" ? detail.message : "Failed to transcribe audio";
    const status =
      typeof detail?.status === "number" && detail.status >= 400 && detail.status <= 599
        ? detail.status
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
