"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { useStudio } from "@/lib/studio/use-studio";

export function TopBar() {
  const pathname = usePathname();
  const { history } = useStudio();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-5 sm:px-7">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Motionhouse home">
          <span className="grid size-[22px] place-items-center bg-ink font-mono text-[12px] font-medium text-bg">M</span>
          <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">Motionhouse</span>
        </Link>

        <nav className="flex items-center gap-6 text-[13px]" aria-label="Primary navigation">
          <Link
            href="/"
            className={cn(
              "border-b pb-1 pt-0.5 transition-colors",
              pathname === "/" ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            Studio
          </Link>
          <Link
            href="/history"
            className={cn(
              "border-b pb-1 pt-0.5 transition-colors",
              pathname === "/history" ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            History{history.length ? <span className="ml-1.5 font-mono text-[11px] text-faint">{history.length}</span> : null}
          </Link>
        </nav>
      </div>
    </header>
  );
}
