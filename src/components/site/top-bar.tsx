"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { useStudio } from "@/lib/studio/use-studio";

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { history } = useStudio();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-5 sm:px-7">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Motionhouse home">
          <span className="grid size-[22px] place-items-center bg-ink font-mono text-[12px] font-medium text-bg">
            M
          </span>
          <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">Motionhouse</span>
        </Link>

        <nav className="flex items-center gap-6 text-[13px]" aria-label="Primary navigation">
          {/*
            Studio is where you make something, so it goes to the composer.
            The landing page is still one click away on the wordmark, which is
            where people look for it anyway.
          */}
          <Link
            href="/new"
            className={cn(
              "border-b pb-1 pt-0.5 transition-colors",
              pathname === "/new" || pathname === "/upload"
                ? "border-ink text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            Studio
          </Link>

          <Link
            href="/history"
            className={cn(
              "border-b pb-1 pt-0.5 transition-colors",
              pathname === "/history"
                ? "border-ink text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            History
            {history.length ? (
              <span className="ml-1.5 font-mono text-[11px] text-faint">{history.length}</span>
            ) : null}
          </Link>

          {/*
            Rescript lives under its own root layout, so Next falls back to a
            full page load here rather than a client-side transition. That is
            intended: the editor owns the whole viewport and its own appearance
            toggle. Plain <a> for the same reason.
          */}
          <a
            href="/rescript"
            className="border-b border-transparent pb-1 pt-0.5 text-muted transition-colors hover:text-ink"
          >
            Edit video
          </a>

          <Link
            href="/signin"
            className={cn(
              "border-b pb-1 pt-0.5 transition-colors",
              pathname === "/signin"
                ? "border-ink text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            Sign in
          </Link>

          {/*
            A standing way out of whatever you are looking at. The timestamp
            remounts the composer, so this opens an empty thread even when you
            are already standing on /new with a result on screen.
          */}
          <button
            type="button"
            onClick={() => router.push(`/new?fresh=${Date.now()}`)}
            className="bg-ink px-3 py-1.5 text-[12.5px] font-medium text-[#0a0b0d] transition-colors hover:bg-white"
          >
            New
          </button>
        </nav>
      </div>
    </header>
  );
}
