import { AppError, codeFromStatus, looksLikeContextOverflow } from "./errors";

export interface FetchOptions extends RequestInit {
  /** Milliseconds before the request is aborted. */
  timeoutMs?: number;
  /** Label used in server-side logs. */
  label?: string;
  /**
   * Extra attempts after a transient failure. Transient means the request
   * never produced an answer -- a dropped connection, or a gateway 5xx.
   * Anything the provider deliberately said (400, 401, 429) is not retried.
   */
  retries?: number;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);

function backoffMs(attempt: number): number {
  // 400ms, 1200ms -- long enough for a blip, short enough not to strand a user.
  return 400 * 3 ** attempt;
}

async function attemptFetch(
  url: string,
  timeoutMs: number,
  label: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Honour an upstream cancellation as well as our own timeout.
  const upstream = init.signal;
  const onAbort = () => controller.abort();
  upstream?.addEventListener("abort", onAbort, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (err) {
    if (upstream?.aborted) {
      throw new AppError("provider_error", { detail: `${label} cancelled` });
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new AppError("timeout", { detail: `${label} timed out after ${timeoutMs}ms` });
    }
    throw new AppError("provider_error", {
      detail: `${label} network failure: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener("abort", onAbort);
  }
}

/**
 * fetch with a hard timeout and transient-failure retries, which always throws
 * an AppError rather than a raw provider failure.
 */
export async function fetchWithTimeout(
  url: string,
  { timeoutMs = 30_000, label = "provider", retries = 2, ...init }: FetchOptions = {},
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (init.signal?.aborted) break;

    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt - 1)));
      if (init.signal?.aborted) break;
    }

    try {
      const res = await attemptFetch(url, timeoutMs, label, init);
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        lastError = new AppError("provider_error", { detail: `${label} returned ${res.status}` });
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      // A timeout means the provider is slow, not flaky; retrying usually just
      // burns another full timeout, so give up unless attempts remain.
      const isTimeout = err instanceof AppError && err.code === "timeout";
      if (isTimeout || attempt >= retries) throw err;
    }
  }

  throw lastError instanceof AppError
    ? lastError
    : new AppError("provider_error", { detail: `${label} failed after ${retries + 1} attempts` });
}

/** Reads a failed response body defensively and raises a mapped AppError. */
export async function raiseForStatus(res: Response, label: string): Promise<never> {
  let body = "";
  try {
    body = (await res.text()).slice(0, 600);
  } catch {
    body = "<unreadable body>";
  }
  // A context overflow and a malformed body are both a 400, so the status alone
  // cannot tell them apart — only the body can. Reading it here means every
  // caller gets the distinction, and the person gets advice they can act on
  // instead of being told to fix a request that was not actually malformed.
  const code =
    res.status === 400 && looksLikeContextOverflow(body)
      ? "context_overflow"
      : codeFromStatus(res.status);
  throw new AppError(code, {
    detail: `${label} responded ${res.status}: ${body}`,
  });
}

export async function readJson<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError("malformed_response", {
      detail: `${label} returned non-JSON: ${text.slice(0, 300)}`,
    });
  }
}
