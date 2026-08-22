import { AppError } from "@/lib/utils/errors";
import { fetchWithTimeout, raiseForStatus, readJson } from "@/lib/utils/http";
import { assetUrl, putAsset } from "@/lib/utils/asset-store";
import { readImageSize } from "@/lib/utils/image-size";
import type {
  ImageGenerationInput,
  ImageGenerationResult,
  ImageProvider,
  ModelInfo,
} from "../types";

/**
 * Pollinations.
 *
 * Two surfaces, and which one we use depends on whether a key is present:
 *
 *  - keyless: GET https://image.pollinations.ai/prompt/<prompt> -- returns
 *    image bytes directly, no account needed. This is the hackathon default.
 *  - with POLLINATIONS_API_KEY: POST https://gen.pollinations.ai/v1/images/generations,
 *    the OpenAI-shaped route, which unlocks the paid model catalogue.
 *
 * Either way the bytes land in our own asset store, so no provider URL (and no
 * key) ever reaches the browser.
 */

const GEN_BASE = "https://gen.pollinations.ai";
const IMAGE_BASE = "https://image.pollinations.ai";
const TIMEOUT_MS = 120_000;

/** Verified free-tier default; `flux` is the widest-available keyless model. */
const FREE_MODEL_PREFERENCE = ["flux", "zimage", "gptimage", "klein", "nova-canvas"];

interface PollinationsModel {
  name?: string;
  title?: string;
  description?: string;
  category?: string;
  output_modalities?: string[];
  paid_only?: boolean;
}

function apiKey(): string | undefined {
  return process.env.POLLINATIONS_API_KEY?.trim() || undefined;
}

let modelCache: { at: number; models: ModelInfo[]; keyed: boolean } | null = null;
const MODEL_TTL_MS = 15 * 60_000;

async function catalogue(): Promise<ModelInfo[]> {
  const keyed = Boolean(apiKey());
  if (modelCache && modelCache.keyed === keyed && Date.now() - modelCache.at < MODEL_TTL_MS) {
    return modelCache.models;
  }

  const res = await fetchWithTimeout(`${GEN_BASE}/image/models`, {
    timeoutMs: 20_000,
    label: "pollinations models",
  });
  if (!res.ok) await raiseForStatus(res, "pollinations models");

  const raw = await readJson<PollinationsModel[]>(res, "pollinations models");
  const models = raw
    .filter((m) => typeof m.name === "string")
    .filter((m) => m.output_modalities?.includes("image") ?? m.category === "image")
    // Community forks are unpredictable; keep the first-party catalogue.
    .filter((m) => !m.name!.includes("/"))
    // Without a key only the free tier will actually render.
    .filter((m) => (keyed ? true : !m.paid_only))
    .map<ModelInfo>((m) => ({
      id: m.name!,
      label: m.title ?? m.name!,
      description: m.description,
    }));

  if (!models.length) {
    throw new AppError("provider_error", {
      userMessage: "No image models are available right now.",
      detail: "pollinations returned an empty image catalogue",
    });
  }

  const ranked = models.sort((a, b) => rank(a.id) - rank(b.id));
  modelCache = { at: Date.now(), models: ranked, keyed };
  return ranked;
}

function rank(id: string): number {
  const index = FREE_MODEL_PREFERENCE.indexOf(id);
  return index === -1 ? FREE_MODEL_PREFERENCE.length + 1 : index;
}

async function resolveModel(requested?: string): Promise<string> {
  const models = await catalogue();
  if (requested && models.some((m) => m.id === requested)) return requested;
  if (requested) {
    throw new AppError("unsupported", {
      userMessage: `"${requested}" isn't an available image model.`,
      detail: `unknown pollinations model ${requested}`,
    });
  }
  for (const preferred of FREE_MODEL_PREFERENCE) {
    if (models.some((m) => m.id === preferred)) return preferred;
  }
  return models[0].id;
}

function decodeDataUrl(value: string): { bytes: Uint8Array; contentType: string } | null {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value);
  if (!match) return null;
  return { contentType: match[1], bytes: Uint8Array.from(Buffer.from(match[2], "base64")) };
}

async function viaKeyedApi(
  input: ImageGenerationInput,
  model: string,
  key: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetchWithTimeout(`${GEN_BASE}/v1/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      n: 1,
      size: `${input.width}x${input.height}`,
      ...(input.quality === "high" ? { quality: "high" } : {}),
      ...(input.transparent ? { background: "transparent" } : {}),
    }),
    timeoutMs: TIMEOUT_MS,
    label: "pollinations generations",
    signal: input.signal,
  });

  if (!res.ok) await raiseForStatus(res, "pollinations generations");

  const json = await readJson<{ data?: Array<{ url?: string; b64_json?: string }> }>(
    res,
    "pollinations generations",
  );
  const entry = json.data?.[0];

  if (entry?.b64_json) {
    return {
      bytes: Uint8Array.from(Buffer.from(entry.b64_json, "base64")),
      contentType: "image/png",
    };
  }
  if (entry?.url) {
    const decoded = decodeDataUrl(entry.url);
    if (decoded) return decoded;
    const download = await fetchWithTimeout(entry.url, {
      timeoutMs: TIMEOUT_MS,
      label: "pollinations asset",
    });
    if (!download.ok) await raiseForStatus(download, "pollinations asset");
    return {
      bytes: new Uint8Array(await download.arrayBuffer()),
      contentType: download.headers.get("content-type") ?? "image/jpeg",
    };
  }

  throw new AppError("malformed_response", {
    detail: "pollinations generations returned no image payload",
  });
}

async function viaKeylessUrl(
  input: ImageGenerationInput,
  model: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const params = new URLSearchParams({
    model,
    width: String(input.width),
    height: String(input.height),
    nologo: "true",
    referrer: "whiteboard-studio",
  });
  if (typeof input.seed === "number") params.set("seed", String(input.seed));
  if (input.transparent) params.set("transparent", "true");

  const url = `${IMAGE_BASE}/prompt/${encodeURIComponent(input.prompt)}?${params}`;
  const res = await fetchWithTimeout(url, {
    timeoutMs: TIMEOUT_MS,
    label: "pollinations image",
    signal: input.signal,
  });

  if (!res.ok) await raiseForStatus(res, "pollinations image");

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new AppError("malformed_response", {
      detail: `pollinations image returned ${contentType || "no content-type"}`,
    });
  }

  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType };
}

export const pollinations: ImageProvider = {
  id: "pollinations",
  runsOn: "server",

  /**
   * True when a key unlocks the real model catalogue.
   *
   * The keyless tier resolves every request to `sana` whatever model is asked
   * for, and sana answers "black marker line art" with a photograph of a
   * meeting room. Line-art styles are therefore only offered with a key.
   */
  hasPremiumModels(): boolean {
    return Boolean(process.env.POLLINATIONS_API_KEY?.trim());
  },
  isConfigured() {
    // The keyless route needs no credentials at all.
    return true;
  },

  listModels: catalogue,

  async generateImage(input) {
    const model = await resolveModel(input.model);
    const width = input.width ?? 1024;
    const height = input.height ?? 1024;
    const key = apiKey();

    const payload = key
      ? await viaKeyedApi({ ...input, width, height }, model, key)
      : await viaKeylessUrl({ ...input, width, height }, model);

    if (payload.bytes.byteLength < 1024) {
      throw new AppError("malformed_response", {
        detail: `pollinations returned ${payload.bytes.byteLength} bytes`,
      });
    }

    const asset = putAsset(
      payload.bytes,
      payload.contentType,
      `image-${Date.now()}.${payload.contentType.includes("png") ? "png" : "jpg"}`,
    );

    // What we asked for and what came back are not always the same.
    const actual = readImageSize(payload.bytes);

    return {
      url: assetUrl(asset),
      provider: "pollinations",
      model,
      width: actual?.width ?? width,
      height: actual?.height ?? height,
    } satisfies ImageGenerationResult;
  },
};
