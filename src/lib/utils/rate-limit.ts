import { AppError } from "./errors";

interface ActiveLease {
  id: string;
  createdAt: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
  leases: Map<string, ActiveLease>;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

const SWEEP_INTERVAL_MS = 30_000;
const DEFAULT_LEASE_TTL_MS = 60_000;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    // Purge expired in-flight leases
    for (const [leaseId, lease] of bucket.leases) {
      if (now - lease.createdAt > DEFAULT_LEASE_TTL_MS) {
        bucket.leases.delete(leaseId);
      }
    }
    if (bucket.leases.size === 0 && now - bucket.updatedAt > SWEEP_INTERVAL_MS) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitOptions {
  /** Sustained requests allowed per window. */
  capacity: number;
  /** Window the capacity refills over. */
  windowMs: number;
  /** Simultaneous in-flight generations allowed per client. */
  maxConcurrent: number;
  /** Maximum time an in-flight lease is valid before auto-expiring. */
  leaseTtlMs?: number;
}

export interface RateLimitLease {
  release(): void;
}

/**
 * In-memory token bucket + concurrency guard with automatic TTL expiration
 * and AbortSignal cancellation support.
 */
export function acquire(
  key: string,
  options: RateLimitOptions,
  signal?: AbortSignal,
): RateLimitLease {
  const now = Date.now();
  sweep(now);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: options.capacity, updatedAt: now, leases: new Map() };
    buckets.set(key, bucket);
  }

  // Prune any stale leases in this bucket
  const ttl = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  for (const [leaseId, lease] of bucket.leases) {
    if (now - lease.createdAt > ttl) {
      bucket.leases.delete(leaseId);
    }
  }

  const refill = ((now - bucket.updatedAt) / options.windowMs) * options.capacity;
  bucket.tokens = Math.min(options.capacity, bucket.tokens + refill);
  bucket.updatedAt = now;

  if (bucket.leases.size >= options.maxConcurrent) {
    throw new AppError("busy", {
      userMessage: "You already have a generation running. Let it finish first.",
    });
  }
  if (bucket.tokens < 1) {
    const waitMs = Math.ceil((1 - bucket.tokens) * (options.windowMs / options.capacity));
    throw new AppError("rate_limited", {
      userMessage: `Rate limit reached. Try again in ${Math.ceil(waitMs / 1000)}s.`,
    });
  }

  const leaseId = `${now}-${Math.random().toString(36).slice(2, 9)}`;
  bucket.tokens -= 1;
  bucket.leases.set(leaseId, { id: leaseId, createdAt: now });

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const current = buckets.get(key);
    if (current) current.leases.delete(leaseId);
  };

  if (signal) {
    if (signal.aborted) {
      release();
    } else {
      signal.addEventListener("abort", release, { once: true });
    }
  }

  return { release };
}

/** Clear any stuck leases for a key or prefix. */
export function forceRelease(key: string): void {
  buckets.delete(key);
}

/** Best-effort client identity from proxy headers and optional session tokens. */
export function clientKey(req: Request, scope: string): string {
  const headers = req.headers;
  const sessionId = headers.get("x-session-id")?.trim();
  const forwarded = headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    "local";
  return sessionId ? `${scope}:${ip}:${sessionId}` : `${scope}:${ip}`;
}
