/**
 * Normalized error surface. Provider stack traces never reach the browser --
 * routes translate everything into one of these codes plus a human sentence.
 */
export type AppErrorCode =
  | "invalid_request"
  | "missing_key"
  | "rate_limited"
  | "timeout"
  | "provider_error"
  | "malformed_response"
  | "unsupported"
  | "out_of_credit"
  | "context_overflow"
  | "busy";

const USER_MESSAGE: Record<AppErrorCode, string> = {
  invalid_request: "That request wasn't valid. Adjust it and try again.",
  missing_key: "This provider isn't configured on the server yet.",
  rate_limited: "Too many requests. Give it a few seconds and retry.",
  timeout: "The provider took too long to respond. Try again in a moment.",
  provider_error: "The provider is temporarily unavailable. Try again in a moment.",
  malformed_response: "The provider returned something we couldn't read. Try again.",
  unsupported: "That option isn't supported right now.",
  out_of_credit:
    "The provider account is out of credit, so this step can't run. Top it up or switch providers.",
  context_overflow:
    "This conversation has grown longer than the model can read. Start a new thread, or ask for a smaller change.",
  busy: "A generation is already running. Wait for it to finish.",
};

const STATUS: Record<AppErrorCode, number> = {
  invalid_request: 400,
  missing_key: 503,
  rate_limited: 429,
  timeout: 504,
  provider_error: 502,
  malformed_response: 502,
  unsupported: 400,
  out_of_credit: 402,
  // Still a rejected request as far as HTTP is concerned; the separate code
  // exists so the person is told something they can act on, rather than being
  // asked to fix a request that was not malformed.
  context_overflow: 400,
  busy: 409,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  /** Safe to show a user. */
  readonly userMessage: string;
  /** Extra context for server logs only. */
  readonly detail?: string;
  readonly status: number;

  constructor(code: AppErrorCode, opts: { userMessage?: string; detail?: string } = {}) {
    super(opts.detail ?? code);
    this.name = "AppError";
    this.code = code;
    this.userMessage = opts.userMessage ?? USER_MESSAGE[code];
    this.detail = opts.detail;
    this.status = STATUS[code];
  }
}

export function toAppError(err: unknown, fallback: AppErrorCode = "provider_error"): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof DOMException && err.name === "AbortError") {
    return new AppError("timeout");
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new AppError("timeout");
  }
  return new AppError(fallback, {
    detail: err instanceof Error ? err.message : String(err),
  });
}

/**
 * Does this provider rejection look like "too long" rather than "malformed"?
 *
 * Both arrive as a 400 and the two are indistinguishable at the UI, which is
 * why a context overflow used to read as *"That request wasn't valid. Adjust it
 * and try again"* — advice that cannot be followed. The strings are what the
 * OpenAI-compatible fleet actually says; a miss costs the old behaviour, not a
 * new one.
 */
export function looksLikeContextOverflow(detail: string | undefined): boolean {
  if (!detail) return false;
  const text = detail.toLowerCase();
  return (
    text.includes("context_length_exceeded") ||
    text.includes("context length") ||
    text.includes("context window") ||
    text.includes("maximum context") ||
    text.includes("too many tokens") ||
    text.includes("prompt is too long") ||
    (text.includes("max_tokens") && text.includes("exceed")) ||
    (text.includes("tokens") && text.includes("exceeds"))
  );
}

/** Maps a provider HTTP status onto our code space. */
export function codeFromStatus(status: number): AppErrorCode {
  // 402 is the provider saying "you have run out of money", which is not a
  // transient fault. Reporting it as one sends the user into a retry loop
  // against a wall.
  if (status === 402) return "out_of_credit";
  if (status === 401 || status === 403) return "missing_key";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status === 400 || status === 422) return "invalid_request";
  return "provider_error";
}
