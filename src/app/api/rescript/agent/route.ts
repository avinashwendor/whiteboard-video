import { planRescriptEdit, type AgentEvent } from "@/lib/ai/rescript-agent";
import { AppError, toAppError } from "@/lib/utils/errors";
import { acquire, clientKey } from "@/lib/utils/rate-limit";
import { failFrom, parseBody } from "@/lib/utils/route-helpers";
import { rescriptAgentRequestSchema } from "@/lib/validation/schemas";

/**
 * Plans an edit for the transcript editor's AI sidebar. It does not perform one.
 *
 * The reply is a list of validated operations the browser then runs against the
 * composition store and the image routes it already owns, so nothing here
 * touches media, an asset or a provider quota beyond the text calls.
 *
 * It answers as a stream of newline-delimited JSON rather than one object at
 * the end. The agent takes several model turns to reach a plan — reading the
 * transcript, checking a phrase, verifying itself, repairing — and a minute and
 * a half of silence is indistinguishable from a hang. Each line is one event;
 * the last is the plan, or an error. NDJSON rather than SSE because the client
 * is a `fetch` reader either way, and this needs no framing beyond a newline.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LIMITS = { capacity: 30, windowMs: 60_000, maxConcurrent: 4 };

export async function POST(req: Request) {
  let lease;
  let body;
  try {
    body = await parseBody(req, rescriptAgentRequestSchema);
    lease = acquire(clientKey(req, "rescript-agent"), LIMITS, req.signal);
  } catch (err) {
    // A bad request or a full queue is answered the ordinary way: the stream
    // has not started, so there is nothing to stream an error into.
    lease?.release();
    return err instanceof AppError ? failFrom(err) : failFrom(err);
  }

  const held = lease;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (value: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        } catch {
          // The reader went away mid-plan. Stop writing; the abort signal
          // below is what actually stops the work.
          open = false;
        }
      };

      try {
        const plan = await planRescriptEdit({
          instruction: body.instruction,
          context: body.context,
          mode: body.mode,
          history: body.history,
          exemplars: body.exemplars,
          preferences: body.preferences,
          model: body.model,
          signal: req.signal,
          onEvent: (event: AgentEvent) => send(event),
        });
        send({ type: "plan", success: true as const, ...plan });
      } catch (err) {
        const appError = toAppError(err);
        // Detail is for us, not the browser — provider text never leaves the
        // server. Same contract as `fail`, which cannot be used mid-stream
        // because the status line is long gone.
        if (appError.detail) console.error(`[${appError.code}] ${appError.detail}`);
        send({
          type: "error",
          success: false as const,
          error: { code: appError.code, message: appError.userMessage },
        });
      } finally {
        held?.release();
        open = false;
        controller.close();
      }
    },
    cancel() {
      held?.release();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Both matter for a stream that must arrive in pieces: a proxy that
      // buffers or compresses it would hand the browser everything at once,
      // which is the behaviour this route exists to stop.
      "Cache-Control": "no-cache, no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
