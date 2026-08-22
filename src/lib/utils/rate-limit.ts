import { AppError } from "./errors";

interface Bucket {
  tokens: number;
  updatedAt: number;
  inFlight: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

const SWEEP_INTERVAL_MS = 5 * 60_000;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.inFlight === 0 && now - bucket.updatedAt > SWEEP_INTERVAL_MS) {
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
}

export interface RateLimitLease {
  release(): void;
}

/**
 * In-memory token bucket + concurrency guard. Per-process only, which is the
 * right trade for a single-instance hackathon deploy; swap for Redis if this
 * ever runs multi-region.
 */
export function acquire(key: string, options: RateLimitOptions): RateLimitLease {
  const now = Date.now();
  sweep(now);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: options.capacity, updatedAt: now, inFlight: 0 };
    buckets.set(key, bucket);
  }

  const refill = ((now - bucket.updatedAt) / options.windowMs) * options.capacity;
  bucket.tokens = Math.min(options.capacity, bucket.tokens + refill);
  bucket.updatedAt = now;

  if (bucket.inFlight >= options.maxConcurrent) {
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

  bucket.tokens -= 1;
  bucket.inFlight += 1;

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      const current = buckets.get(key);
      if (current) current.inFlight = Math.max(0, current.inFlight - 1);
    },
  };
}

/** Best-effort client identity from proxy headers. */
export function clientKey(req: Request, scope: string): string {
  const headers = req.headers;
  const forwarded = headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    "local";
  return `${scope}:${ip}`;
}
