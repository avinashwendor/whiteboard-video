import { randomUUID } from "node:crypto";

export interface StoredAsset {
  id: string;
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  createdAt: number;
}

/**
 * Short-lived in-process store for generated media.
 *
 * Everything the browser renders is served back from our own origin, which
 * keeps provider keys out of URLs and -- importantly -- keeps the whiteboard
 * canvas untainted so it can be recorded and exported.
 *
 * Single-instance only, and deliberately so: a hackathon deploy does not need
 * object storage, and the browser keeps its own copy in history.
 */
const MAX_BYTES = 256 * 1024 * 1024;
const TTL_MS = 6 * 60 * 60_000;

const assets = new Map<string, StoredAsset>();
let totalBytes = 0;

function evict() {
  const now = Date.now();
  for (const [id, asset] of assets) {
    if (now - asset.createdAt > TTL_MS) {
      assets.delete(id);
      totalBytes -= asset.bytes.byteLength;
    }
  }
  // Oldest-first eviction until we are back under the cap.
  while (totalBytes > MAX_BYTES) {
    const oldest = assets.keys().next();
    if (oldest.done) break;
    const asset = assets.get(oldest.value);
    assets.delete(oldest.value);
    if (asset) totalBytes -= asset.bytes.byteLength;
  }
}

export function putAsset(
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
  filename: string,
): StoredAsset {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const asset: StoredAsset = {
    id: randomUUID(),
    bytes: view,
    contentType,
    filename,
    createdAt: Date.now(),
  };
  assets.set(asset.id, asset);
  totalBytes += view.byteLength;
  evict();
  return asset;
}

export function getAsset(id: string): StoredAsset | undefined {
  const asset = assets.get(id);
  if (!asset) return undefined;
  if (Date.now() - asset.createdAt > TTL_MS) {
    assets.delete(id);
    totalBytes -= asset.bytes.byteLength;
    return undefined;
  }
  return asset;
}

export function assetUrl(asset: StoredAsset): string {
  return `/api/asset/${asset.id}`;
}
