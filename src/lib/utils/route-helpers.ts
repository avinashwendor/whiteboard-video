import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toAppError } from "./errors";
import { firstIssue } from "@/lib/validation/schemas";

export interface ApiFailure {
  success: false;
  error: { code: string; message: string };
}

export function fail(error: AppError): NextResponse<ApiFailure> {
  // Detail is for us, not the browser -- provider text never leaves the server.
  if (error.detail) console.error(`[${error.code}] ${error.detail}`);
  return NextResponse.json(
    { success: false as const, error: { code: error.code, message: error.userMessage } },
    { status: error.status },
  );
}

export function failFrom(err: unknown): NextResponse<ApiFailure> {
  return fail(toAppError(err));
}

/** Parses a JSON body against a schema, raising a clean AppError on any problem. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError("invalid_request", { userMessage: "Expected a JSON body." });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("invalid_request", { userMessage: firstIssue(parsed.error) });
  }
  return parsed.data;
}

/** NDJSON frame writer used by the streaming text route. */
export function ndjson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}
