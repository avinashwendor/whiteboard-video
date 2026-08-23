"use client";

import Link from "next/link";
import { ClerkProvider, UserButton, useUser } from "@clerk/nextjs";
import { cn } from "@/lib/utils/cn";
import { authConfigured } from "@/lib/auth/config";

/**
 * Accounts, held at arm's length.
 *
 * Clerk is wired but optional in both senses. Nothing is gated behind it — the
 * studio works signed out and always will — and the whole integration is inert
 * until the keys land, because the app has to keep running on a machine that
 * has never heard of Clerk.
 */
export { authConfigured };

/**
 * Wraps the tree only when Clerk can actually run.
 *
 * `ClerkProvider` throws without a publishable key, so mounting it
 * unconditionally would replace the site with an error the moment someone
 * cloned the repo without an account.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!authConfigured) return <>{children}</>;
  return <ClerkProvider>{children}</ClerkProvider>;
}

/**
 * The nav entry.
 *
 * Signed out it is a link; signed in it is Clerk's avatar menu. With no keys
 * it falls back to the waitlist, which is the honest state of accounts today.
 *
 * The signed-in test is `useUser()` rather than `<SignedIn>` / `<SignedOut>`:
 * those still *export* from Core 3 but throw the moment they render, which
 * took every page in the app down with a 500 until the route smoke test caught
 * it. Splitting the Clerk-aware half into its own component keeps the hook out
 * of a conditional branch.
 */
export function AuthNav({ className }: { className?: string }) {
  if (!authConfigured) {
    return (
      <Link
        href="/signin"
        className={cn("border-b border-transparent pb-1 pt-0.5 transition-colors", className)}
      >
        Sign in
      </Link>
    );
  }
  return <ClerkNav className={className} />;
}

function ClerkNav({ className }: { className?: string }) {
  const { isLoaded, isSignedIn } = useUser();

  // Render the link while Clerk boots. An empty slot that pops into a link is
  // worse than a link that briefly does nothing.
  if (!isLoaded || !isSignedIn) {
    return (
      <Link
        href="/sign-in"
        className={cn("border-b border-transparent pb-1 pt-0.5 transition-colors", className)}
      >
        Sign in
      </Link>
    );
  }

  return (
    <span className="flex items-center">
      <UserButton appearance={{ elements: { avatarBox: "size-7 rounded-none" } }} />
    </span>
  );
}

/**
 * Who is signed in, for anywhere that wants to say so.
 *
 * Returns null when Clerk is not configured rather than throwing, so callers
 * do not each need their own guard.
 */
export function useAccount() {
  // `authConfigured` is a build-time constant, so this branch cannot change
  // between renders of the same build and the hook order stays stable.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const clerk = authConfigured ? useUser() : null;
  if (!clerk?.isLoaded) return null;
  return clerk.user ?? null;
}
