import { NextResponse } from "next/server";
import { resolveTts } from "@/lib/ai/tts";
import { assetUrl, putAsset } from "@/lib/utils/asset-store";
import { AppError } from "@/lib/utils/errors";
import { acquire, clientKey } from "@/lib/utils/rate-limit";
import { fail, failFrom, parseBody } from "@/lib/utils/route-helpers";
import { ttsRequestSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LIMITS = { capacity: 60, windowMs: 60_000, maxConcurrent: 8 };

export async function POST(req: Request) {
  let lease;
  try {
    const body = await parseBody(req, ttsRequestSchema);
    lease = acquire(clientKey(req, "tts"), LIMITS);

    const provider = resolveTts(body.provider);

    const result = await provider.generateSpeech({
      transcript: body.transcript,
      voiceId: body.voiceId,
      modelId: body.modelId,
      language: body.language,
      speed: body.speed,
    });

    // Audio is served back from our own origin so the Cartesia key never has to
    // travel anywhere near the browser.
    const extension = result.contentType.includes("wav") ? "wav" : "mp3";
    const asset = putAsset(result.audio, result.contentType, `narration-${Date.now()}.${extension}`);

    return NextResponse.json({
      success: true as const,
      audioUrl: assetUrl(asset),
      provider: result.provider,
      model: result.model,
      voiceId: result.voiceId,
      contentType: result.contentType,
      bytes: result.audio.byteLength,
      // Word timings are the video's clock: the renderer animates against
      // these rather than against a linear ramp through the scene.
      duration: result.duration,
      words: result.words,
    });
  } catch (err) {
    return err instanceof AppError ? fail(err) : failFrom(err);
  } finally {
    lease?.release();
  }
}
