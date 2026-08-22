import { NextResponse } from "next/server";
import { omega, defaultModel } from "@/lib/ai/omega";
import type { ChatMessage } from "@/lib/ai/types";
import { AppError, toAppError } from "@/lib/utils/errors";
import { acquire, clientKey } from "@/lib/utils/rate-limit";
import { fail, failFrom, ndjson, parseBody } from "@/lib/utils/route-helpers";
import { generateRequestSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SYSTEM = `You are a sharp, versatile writer.

- Answer in the format the request implies: a script reads like a script, a story like a story, a list like a list.
- Open with substance. No "Sure!", no restating the prompt, no meta commentary.
- Prefer concrete detail over adjectives. Cut anything that doesn't earn its place.
- Use Markdown only where it genuinely helps (headings, short lists). Never wrap the whole answer in a code fence.`;

const LIMITS = { capacity: 20, windowMs: 60_000, maxConcurrent: 3 };

export async function POST(req: Request) {
  let lease: { release(): void } | undefined;
  try {
    const body = await parseBody(req, generateRequestSchema);
    lease = acquire(clientKey(req, "generate"), LIMITS, req.signal);

    const messages: ChatMessage[] = [
      { role: "system", content: body.systemPrompt?.trim() || DEFAULT_SYSTEM },
      { role: "user", content: body.prompt },
    ];

    const model = body.model ?? (await defaultModel());

    if (body.stream) {
      // Hand the lease to the stream: it outlives this function, so the outer
      // `finally` must not release it.
      const lease_ = lease;
      lease = undefined;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let text = "";
          try {
            for await (const delta of omega.streamText({
              messages,
              model,
              temperature: body.temperature,
              maxTokens: body.maxTokens,
            })) {
              text += delta;
              controller.enqueue(ndjson({ type: "delta", text: delta }));
            }
            controller.enqueue(ndjson({ type: "done", text, model, provider: "omega" }));
          } catch (err) {
            const appError = toAppError(err);
            if (appError.detail) console.error(`[${appError.code}] ${appError.detail}`);
            controller.enqueue(
              ndjson({ type: "error", code: appError.code, message: appError.userMessage }),
            );
          } finally {
            lease_.release();
            controller.close();
          }
        },
        cancel() {
          lease_.release();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const result = await omega.generateText({
      messages,
      model,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
    });

    return NextResponse.json({
      success: true as const,
      text: result.text,
      model: result.model,
      provider: result.provider,
      usage: result.usage ?? {},
    });
  } catch (err) {
    return err instanceof AppError ? fail(err) : failFrom(err);
  } finally {
    lease?.release();
  }
}
