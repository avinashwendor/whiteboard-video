import { AppError } from "./errors";

interface ActiveLease {
  id: string;
  createdAt: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
  leases: Map<string, ActiveLease>;
  /**
   * The window and lease TTL this bucket was configured with.
   *
   * Carried on the bucket because the sweeper runs across *every* bucket and
   * has no idea which route each one belongs to. Without them it fell back to
   * a global default, which quietly expired the long leases that the slow
   * routes had deliberately asked for.
   */
  windowMs: number;
  ttl: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

const SWEEP_INTERVAL_MS = 30_000;
const DEFAULT_LEASE_TTL_MS = 60_000;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    // Purge expired in-flight leases, at the TTL the route actually asked for.
    // Generation routes run for well over a minute and set a longer lease to
    // say so; expiring those on a global default hands their concurrency slot
    // back while the work is still running, and the guard stops guarding.
    for (const [leaseId, lease] of bucket.leases) {
      if (now - lease.createdAt > bucket.ttl) {
        bucket.leases.delete(leaseId);
      }
    }
    // Only forget a bucket once it would have refilled anyway. Dropping one
    // earlier is not memory hygiene, it is handing back a full allowance --
    // the difference between "we stopped tracking you" and "you may start
    // again", which are the same thing to a caller.
    if (bucket.leases.size === 0 && now - bucket.updatedAt > bucket.windowMs) {
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

  const ttl = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      tokens: options.capacity,
      updatedAt: now,
      leases: new Map(),
      windowMs: options.windowMs,
      ttl,
    };
    buckets.set(key, bucket);
  } else {
    // A route's limits can change on a deploy; the live bucket follows.
    bucket.windowMs = options.windowMs;
    bucket.ttl = ttl;
  }

  // Prune any stale leases in this bucket
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
