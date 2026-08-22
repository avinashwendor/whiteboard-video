"use client";

import type { ImageGenerationInput, ImageGenerationResult, ModelInfo } from "../types";

/**
 * Puter -- the primary image provider.
 *
 * Puter is deliberately keyless: the SDK runs in the browser and bills the end
 * user's own Puter account, so there is nothing to put in .env and nothing to
 * proxy.
 *
 * The catch, confirmed against the live SDK: an unconnected visitor who calls
 * `txt2img` gets a Puter consent modal, and if they dismiss it the promise
 * never settles -- it hangs rather than rejecting. So we never call `txt2img`
 * speculatively. Connection is checked first, and connecting is an explicit
 * button the person presses (see `connect`). Unconnected simply means we fall
 * through to Pollinations with a visible reason.
 *
 * Because it is browser-only, this module never runs on the server.
 */

const SDK_URL = "https://js.puter.com/v2/";
const SDK_TIMEOUT_MS = 15_000;
const GENERATE_TIMEOUT_MS = 90_000;

interface PuterGlobal {
  ai?: {
    txt2img?: (
      prompt: string,
      options?: Record<string, unknown>,
    ) => Promise<HTMLImageElement | string | { url?: string }>;
  };
  auth?: {
    isSignedIn?: () => boolean;
    signIn?: () => Promise<unknown>;
  };
}

declare global {
  interface Window {
    puter?: PuterGlobal;
  }
}

export class PuterUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "PuterUnavailableError";
    this.reason = reason;
  }
}

let sdkPromise: Promise<PuterGlobal> | null = null;

function loadSdk(): Promise<PuterGlobal> {
  if (typeof window === "undefined") {
    return Promise.reject(new PuterUnavailableError("Puter only runs in the browser."));
  }
  if (window.puter?.ai?.txt2img) return Promise.resolve(window.puter);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<PuterGlobal>((resolve, reject) => {
    const fail = (reason: string) => {
      sdkPromise = null;
      reject(new PuterUnavailableError(reason));
    };

    const timer = setTimeout(() => fail("The Puter SDK took too long to load."), SDK_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      if (window.puter?.ai?.txt2img) resolve(window.puter);
      else fail("The Puter SDK loaded without an image API.");
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    if (existing) {
      existing.addEventListener("load", done, { once: true });
      existing.addEventListener("error", () => fail("The Puter SDK failed to load."), {
        once: true,
      });
      if (window.puter) done();
      return;
    }

    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", () => fail("The Puter SDK failed to load."), { once: true });
    document.head.appendChild(script);
  });

  return sdkPromise;
}

/**
 * True when the visitor has already connected a Puter account, meaning a
 * generation will run straight through with no modal.
 */
export async function isConnected(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const puter = await loadSdk();
    return Boolean(puter.auth?.isSignedIn?.());
  } catch {
    return false;
  }
}

/**
 * Opens Puter's own sign-in flow. Must only ever be called straight from a
 * click: it shows a third-party consent dialog, and that is the person's
 * decision to make, not ours to trigger mid-generation.
 */
export async function connect(): Promise<boolean> {
  const puter = await loadSdk();
  if (!puter.auth?.signIn) throw new PuterUnavailableError("Puter sign-in isn't available.");
  try {
    await puter.auth.signIn();
  } catch {
    return false;
  }
  return Boolean(puter.auth.isSignedIn?.());
}

/**
 * Model IDs are read from Puter's live catalogue through our own route, which
 * avoids both a CORS hop and any assumption about what is available today.
 */
export async function listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  const res = await fetch("/api/models?provider=puter", { signal, cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { models?: ModelInfo[] };
  return json.models ?? [];
}

/** Reads the generated bitmap in a form the whiteboard canvas can record. */
async function normalise(
  result: HTMLImageElement | string | { url?: string },
): Promise<{ url: string; canvasSafe: boolean; width: number; height: number }> {
  const src =
    typeof result === "string"
      ? result
      : result instanceof HTMLImageElement
        ? result.src
        : (result?.url ?? "");

  if (!src) throw new PuterUnavailableError("Puter returned an empty image.");

  const measured =
    result instanceof HTMLImageElement && result.naturalWidth
      ? { width: result.naturalWidth, height: result.naturalHeight }
      : null;

  if (src.startsWith("data:") || src.startsWith("blob:")) {
    return { url: src, canvasSafe: true, width: measured?.width ?? 0, height: measured?.height ?? 0 };
  }

  // Remote URL: pull it through a canvas so export stays possible. If the host
  // refuses CORS we still show the image, just flagged as export-unsafe.
  try {
    const img = result instanceof HTMLImageElement ? result : new Image();
    img.crossOrigin = "anonymous";
    if (!(result instanceof HTMLImageElement) || !img.complete) {
      img.src = src;
      await img.decode();
    }
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")?.drawImage(img, 0, 0);
    return {
      url: canvas.toDataURL("image/png"),
      canvasSafe: true,
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    return { url: src, canvasSafe: false, width: measured?.width ?? 0, height: measured?.height ?? 0 };
  }
}

export async function generateImage(
  input: ImageGenerationInput,
): Promise<ImageGenerationResult> {
  const puter = await loadSdk();
  const txt2img = puter.ai?.txt2img;
  if (!txt2img) throw new PuterUnavailableError("Puter's image API isn't available.");

  // Calling txt2img while disconnected pops Puter's consent dialog and then
  // hangs forever if it is dismissed. Bail out early instead.
  if (!puter.auth?.isSignedIn?.()) {
    throw new PuterUnavailableError("Puter isn't connected in this browser.");
  }

  const width = input.width ?? 1024;
  const height = input.height ?? 1024;

  const options: Record<string, unknown> = {};
  if (input.model) options.model = input.model;
  if (input.quality) options.quality = input.quality === "high" ? "high" : "medium";
  if (width && height) options.size = `${width}x${height}`;

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new PuterUnavailableError("Puter took too long to respond.")),
      GENERATE_TIMEOUT_MS,
    );
  });

  let raw: HTMLImageElement | string | { url?: string };
  try {
    raw = await Promise.race([txt2img(input.prompt, options), timeout]);
  } catch (err) {
    if (err instanceof PuterUnavailableError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new PuterUnavailableError(
      /auth|sign|login|permission|401|403/i.test(message)
        ? "Puter needs you to sign in to your own Puter account."
        : message || "Puter couldn't generate that image.",
    );
  }

  const normalised = await normalise(raw);

  return {
    url: normalised.url,
    provider: "puter",
    model: input.model ?? "puter-default",
    width: normalised.width || width,
    height: normalised.height || height,
    canvasSafe: normalised.canvasSafe,
  };
}

export const puterProvider = {
  id: "puter" as const,
  runsOn: "browser" as const,
  isConfigured: () => typeof window !== "undefined",
  isConnected,
  connect,
  listModels,
  generateImage,
};
