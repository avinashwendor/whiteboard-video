/**
 * Whether accounts are switched on.
 *
 * Deliberately in a module with no `"use client"` directive. Anything exported
 * from a client module becomes a *client reference* when a server component
 * imports it — an object, therefore always truthy — so a guard like
 * `if (!authConfigured)` silently stopped working on the server and rendered
 * Clerk's components with no provider above them.
 *
 * `NEXT_PUBLIC_` so the same answer is available on both sides. It is the
 * publishable key; the secret never leaves the server.
 */
export const authConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
