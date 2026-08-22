"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, PenLine } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useStudio } from "@/lib/studio/use-studio";

export function TopBar() {
  const pathname = usePathname();
  const { history } = useStudio();

  const links = [
    { href: "/", label: "Studio", icon: PenLine },
    { href: "/history", label: "History", icon: History, count: history.length },
  ] as const;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-5">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg" aria-label="Chalkline home">
          <span className="grid size-7 place-items-center rounded-[9px] bg-ink text-[13px] font-bold text-[#0a0b0d]">
            C
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Chalkline</span>
        </Link>

        <nav className="ml-auto flex items-center gap-1">
          {links.map(({ href, label, icon: Icon, ...rest }) => {
            const active = pathname === href;
            const count = "count" in rest ? rest.count : undefined;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium transition-colors",
                  active ? "bg-surface-raised text-ink" : "text-muted hover:text-ink",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
                {count ? (
                  <span className="rounded-full bg-surface-hover px-1.5 text-[10px] tabular-nums text-muted">
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
