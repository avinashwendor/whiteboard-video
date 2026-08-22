import { NextResponse } from "next/server";
import { resolveTts } from "@/lib/ai/tts";
import { omega } from "@/lib/ai/omega";
import { isConfigured as tavilyConfigured } from "@/lib/ai/image/tavily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What this deployment can actually do. Booleans only -- never key values, key
 * prefixes, or anything derived from them.
 */
export function GET() {
  return NextResponse.json({
    success: true as const,
    text: { provider: "omega", configured: omega.isConfigured() },
    image: {
      providers: [
        { id: "puter", configured: true, note: "Runs in your browser, billed to your Puter account." },
        {
          id: "pollinations",
          configured: true,
          // Line art needs a key: the free tier resolves every model to sana,
          // which renders "marker sketch" as a photo of a meeting room.
          lineArt: Boolean(process.env.POLLINATIONS_API_KEY?.trim()),
          note: process.env.POLLINATIONS_API_KEY?.trim()
            ? "Keyed access to the full catalogue."
            : "Free tier: photographic only. Add POLLINATIONS_API_KEY for marker artwork.",
        },
      ],
    },
    // Real-photo search, so a client can tell whether to offer it at all
    // rather than finding out from a failed request.
    visual: { provider: "tavily", configured: tavilyConfigured() },
    voice: (() => {
      const engine = resolveTts();
      return { provider: engine.id, configured: engine.isConfigured() };
    })(),
  });
}
