import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";

/**
 * Request proxy.
 *
 * Next 16 renamed the `middleware` convention to `proxy`; Clerk's own docs are
 * still written against `middleware.ts`, but the contract is the same — a
 * single default export — so `clerkMiddleware()` drops straight in.
 *
 * Two deliberate choices about how auth sits in this app.
 *
 * **Nothing is protected.** The studio is the product and it runs entirely in
 * your browser with no account. Signing in adds an identity for the things
 * that will eventually need one (paid plans, synced history); it is not a gate
 * in front of making a video. `auth.protect()` belongs here later, on the
 * routes that actually hold someone's data — not on the front door.
 *
 * **It no-ops without keys.** `clerkMiddleware()` throws on every request when
 * the publishable key is missing, which would take down the whole site
 * including the Rescript editor. Keys arrive from the Clerk dashboard into
 * Railway's environment, so until they do, this passes requests through
 * untouched rather than failing closed on a feature nobody is using yet.
 */
const configured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

/**
 * Built on first use, not at import.
 *
 * If a future version of `clerkMiddleware()` validates keys when it is
 * constructed rather than when it runs, building it at module scope would
 * throw before the guard below ever got a chance — and a proxy that throws at
 * import takes every route with it.
 */
let handler: NextMiddleware | null = null;

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!configured) return NextResponse.next();
  handler ??= clerkMiddleware();
  return handler(request, event);
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|avif|wasm|mp3|mp4|json)).*)",
    "/(api|trpc)(.*)",
  ],
};
