import { NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/ai/deepgram";
import { acquire, clientKey } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  } catch (err: any) {
    console.error("Transcription error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to transcribe audio" },
      { status: err.status || 500 }
    );
  }
}
