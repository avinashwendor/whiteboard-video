"use client";

import Link from "next/link";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
} from "@clerk/nextjs";
import { cn } from "@/lib/utils/cn";
import { authConfigured } from "@/lib/auth/config";

/**
 * Accounts, held at arm's length.
 *
 * Clerk is wired but optional in both senses. Nothing is gated behind it — the
 * studio works signed out and always will — and the whole integration is inert
 * until the keys land, because the app has to keep running on a machine that
 * has never heard of Clerk.
 *
 * `NEXT_PUBLIC_` is readable in the browser by design; it is the publishable
 * key, not the secret. The secret stays server-side in the proxy.
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

  return (
    <>
      <SignedOut>
        <Link
          href="/sign-in"
          className={cn("border-b border-transparent pb-1 pt-0.5 transition-colors", className)}
        >
          Sign in
        </Link>
      </SignedOut>
      <SignedIn>
        <span className="flex items-center">
          <UserButton
            appearance={{
              elements: {
                avatarBox: "size-7 rounded-none",
              },
            }}
          />
        </span>
      </SignedIn>
    </>
  );
}

/**
 * Who is signed in, for anywhere that wants to say so.
 *
 * Returns null when Clerk is not configured rather than throwing, so callers
 * do not each need their own guard.
 */
export function useAccount() {
  // Safe: `authConfigured` is a build-time constant, so this branch never
  // changes across renders of the same build.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const clerk = authConfigured ? useUser() : null;
  if (!clerk?.isLoaded) return null;
  return clerk.user ?? null;
}
