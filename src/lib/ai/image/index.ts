import { pollinations } from "./pollinations";
import type { ImageGenerationInput, ImageGenerationResult, ImageProvider, ImageProviderId } from "../types";

/**
 * Server-side image registry.
 *
 * Puter is intentionally absent here: it is a browser-only, user-pays SDK, so
 * the Puter -> Pollinations fallback chain is driven from the client (see
 * `./client.ts`). Anything that can run on a server lives in this map.
 */
export const serverImageProviders: Record<string, ImageProvider> = {
  pollinations,
};

export const SERVER_IMAGE_PROVIDER_IDS = Object.keys(serverImageProviders) as ImageProviderId[];

export function getServerImageProvider(id: string): ImageProvider | undefined {
  return serverImageProviders[id];
}

export async function generateServerImage(
  id: ImageProviderId,
  input: ImageGenerationInput,
): Promise<ImageGenerationResult> {
  const provider = serverImageProviders[id] ?? pollinations;
  return provider.generateImage(input);
}

export { pollinations };
