import { NextResponse } from "next/server";
import { resolveTts } from "@/lib/ai/tts";
import { pollinations } from "@/lib/ai/image";
import { omega } from "@/lib/ai/omega";
import type { ModelInfo } from "@/lib/ai/types";
import { toAppError } from "@/lib/utils/errors";
import { fetchWithTimeout, readJson } from "@/lib/utils/http";
import { failFrom } from "@/lib/utils/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Catalogue discovery. Nothing in the UI hardcodes a model id -- every picker
 * is filled from whatever the provider says it supports right now.
 *
 * A provider that is down or unconfigured returns 200 with an empty list and a
 * `notice`, so the settings panel degrades instead of exploding.
 */

const PUTER_MODELS_URL = "https://api.puter.com/puterai/image/models";

/** `togetherai:black-forest-labs/flux.2-pro` -> `FLUX.2 Pro · togetherai`. */
function labelPuterModel(id: string): { label: string; description?: string } {
  const [host, rest] = id.includes(":") ? [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)] : ["", id];
  const name = rest.includes("/") ? rest.slice(rest.lastIndexOf("/") + 1) : rest;
  const pretty = name
    .replace(/[-_]/g, " ")
    .replace(/\b(flux|gpt|sdxl)\b/gi, (m) => m.toUpperCase())
    .replace(/\b\w/g, (m) => m.toUpperCase());
  return { label: pretty, description: host || undefined };
}

async function puterModels(): Promise<ModelInfo[]> {
  const res = await fetchWithTimeout(PUTER_MODELS_URL, {
    timeoutMs: 15_000,
    label: "puter models",
  });
  if (!res.ok) return [];
  const json = await readJson<{ models?: string[] }>(res, "puter models");
  return (json.models ?? [])
    .filter((id) => typeof id === "string" && id.length > 0)
    .map((id) => ({ id, ...labelPuterModel(id) }));
}

export async function GET(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider") ?? "omega";

  try {
    switch (provider) {
      case "omega": {
        if (!omega.isConfigured()) {
          return NextResponse.json({
            success: true as const,
            provider,
            models: [],
            notice: "Add OMEGA_API_KEY to .env.local to enable text generation.",
          });
        }
        return NextResponse.json({ success: true as const, provider, models: await omega.listModels() });
      }

      case "pollinations": {
        return NextResponse.json({
          success: true as const,
          provider,
          models: await pollinations.listModels(),
          notice: process.env.POLLINATIONS_API_KEY?.trim()
            ? undefined
            : "Free tier: add POLLINATIONS_API_KEY to unlock the premium catalogue.",
        });
      }

      case "puter": {
        return NextResponse.json({ success: true as const, provider, models: await puterModels() });
      }

      // `voice` asks for whichever engine is configured; the older provider
      // names still work so a saved setting keeps resolving.
      case "voice":
      case "deepgram":
      case "cartesia": {
        const engine = resolveTts(provider === "voice" ? undefined : provider);
        if (!engine.isConfigured()) {
          return NextResponse.json({
            success: true as const,
            provider: engine.id,
            voices: [],
            languages: [],
            models: [],
            notice: "Add DEEPGRAM_API_KEY to .env.local to enable narration.",
          });
        }
        const voices = await engine.listVoices();
        const languages = await engine.listLanguages();
        return NextResponse.json({
          success: true as const,
          provider: engine.id,
          voices,
          languages,
          models: voices.map((voice) => ({ id: voice.id, label: voice.name })),
        });
      }

      default:
        return NextResponse.json(
          { success: false as const, error: { code: "unsupported", message: "Unknown provider." } },
          { status: 400 },
        );
    }
  } catch (err) {
    const appError = toAppError(err);
    // A catalogue miss should never break the page -- report it as a notice.
    if (appError.code !== "missing_key") {
      if (appError.detail) console.error(`[${appError.code}] ${appError.detail}`);
      return NextResponse.json({
        success: true as const,
        provider,
        models: [],
        voices: [],
        languages: [],
        notice: appError.userMessage,
      });
    }
    return failFrom(err);
  }
}
