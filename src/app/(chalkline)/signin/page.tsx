"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

/**
 * The waitlist, not a login.
 *
 * Accounts are not wired to anything yet, and a form that takes a password and
 * silently does nothing is worse than no form: it teaches people to hand
 * credentials to a page that cannot protect them. So this collects an email
 * for the waitlist and says plainly that the studio needs no account today.
 *
 * When auth lands this page becomes the real sign-in; the shape is already
 * right.
 */
export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(false);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-[440px] flex-col justify-center px-5 py-16 sm:px-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">Accounts</p>
      <h1 className="mt-4 text-[32px] font-medium leading-[1.06] tracking-[-0.035em] text-ink">
        {joined ? "You're on the list." : "Sign in is coming."}
      </h1>

      {joined ? (
        <>
          <p className="mt-3 text-pretty text-[14.5px] leading-relaxed text-muted">
            We&rsquo;ll write to <span className="text-ink">{email.trim()}</span> when accounts and
            paid plans go live. Nothing else will be sent there.
          </p>
          <Link
            href="/new"
            className="mt-8 flex h-11 w-full items-center justify-center gap-2 bg-ink text-[13.5px] font-medium text-[#0a0b0d] transition-colors hover:bg-white"
          >
            Make something
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </>
      ) : (
        <>
          <p className="mt-3 text-pretty text-[14.5px] leading-relaxed text-muted">
            The studio doesn&rsquo;t need one. Every project lives in this browser and nothing is
            uploaded, so you can make a whole video right now without signing anything.
          </p>

          <form
            className="mt-8"
            onSubmit={(event) => {
              event.preventDefault();
              if (valid) setJoined(true);
            }}
          >
            <label
              htmlFor="waitlist-email"
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim"
            >
              Tell me when accounts land
            </label>
            <input
              id="waitlist-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="mt-2.5 h-11 w-full border border-line bg-surface px-3.5 text-[14.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-line-strong"
            />
            <button
              type="submit"
              disabled={!valid}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 bg-ink text-[13.5px] font-medium text-[#0a0b0d] transition-colors hover:bg-white disabled:pointer-events-none disabled:opacity-35"
            >
              <Check className="size-4" aria-hidden />
              Join the waitlist
            </button>
          </form>

          <div className="mt-8 border-t border-line pt-6">
            <Link
              href="/new"
              className="flex items-center justify-between text-[14px] text-muted transition-colors hover:text-ink"
            >
              Skip it and start making a video
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
