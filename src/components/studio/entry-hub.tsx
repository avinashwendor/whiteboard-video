import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * The three ways into a production.
 *
 * Each one is a link to a real route, not a sheet over this grid: a production
 * is where you are going, so it gets a URL, a back button and a reload that
 * does not throw the choice away.
 */
export function EntryHub() {
  return (
    <section aria-label="Production modes" className="w-full">
      <div className="grid grid-cols-1 border border-line bg-surface lg:grid-cols-12">
        {/* 01: Create from Idea — Primary (approx 62% width) */}
        <Panel
          href="/new"
          className="lg:col-span-7 lg:min-h-[480px] lg:p-12"
          minHeight="min-h-[420px]"
          padding="p-8 sm:p-10"
          background="bg-[#0d0d0f] hover:bg-[#111114]"
        >
          <div>
            <span className="font-mono text-[11px] tracking-[0.14em] text-dim">01</span>

            <h3 className="mt-6 text-balance text-[34px] font-medium leading-[1.06] tracking-[-0.03em] text-ink sm:text-[42px] lg:text-[46px]">
              Start from an idea
            </h3>

            <p className="mt-4 max-w-[480px] text-pretty text-[15px] leading-relaxed text-muted sm:text-[16px]">
              Describe it in a sentence. Motionhouse writes the script, storyboards the scenes,
              narrates in natural voice, and animates the complete video.
            </p>
          </div>

          <Footing label="Start creating" arrow="→" strong />
        </Panel>

        {/* Right column — Secondary modes (approx 38% width) */}
        <div className="flex flex-col border-t border-line lg:col-span-5 lg:border-l lg:border-t-0">
          <Panel
            href="/upload"
            className="flex-1"
            minHeight="min-h-[230px]"
            padding="p-7 sm:p-8"
            background="bg-surface hover:bg-surface-raised"
          >
            <div>
              <span className="font-mono text-[11px] tracking-[0.14em] text-dim">02</span>
              <h3 className="mt-3 text-[22px] font-medium tracking-[-0.02em] text-ink sm:text-[24px]">
                Bring your own footage
              </h3>
              <p className="mt-2 text-pretty text-[13.5px] leading-relaxed text-muted">
                Upload what you already shot. Cut it, caption it, restructure it and enhance it with
                the same AI director.
              </p>
            </div>

            <Footing label="Upload footage" arrow="↑" />
          </Panel>

          <Panel
            href="/new?style=hyperframes"
            className="border-t border-line"
            minHeight="min-h-[200px]"
            padding="p-7 sm:p-8"
            background="bg-[#0a0a0b] hover:bg-surface"
          >
            <div>
              <span className="font-mono text-[11px] tracking-[0.14em] text-dim">03</span>
              <h3 className="mt-3 text-[20px] font-medium tracking-[-0.02em] text-ink sm:text-[22px]">
                Hyperframes
              </h3>
              <p className="mt-2 text-pretty text-[13px] leading-relaxed text-muted">
                Interactive visual layers built into the video — diagrams, charts and timelines a
                viewer can touch.
              </p>
            </div>

            <Footing label="Modern frames" arrow="→" />
          </Panel>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- pieces --------------------------------- */

function Panel({
  href,
  children,
  className,
  minHeight,
  padding,
  background,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  minHeight: string;
  padding: string;
  background: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col justify-between transition-colors",
        minHeight,
        padding,
        background,
        className,
      )}
    >
      {children}
    </Link>
  );
}

function Footing({ label, arrow, strong }: { label: string; arrow: string; strong?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-t border-line",
        strong ? "mt-12 pt-6" : "mt-6 pt-4",
      )}
    >
      <span
        className={cn(
          "pb-0.5 transition-colors",
          strong
            ? "border-b border-ink text-[15px] font-medium text-ink group-hover:border-white group-hover:text-white"
            : "border-b border-transparent text-[13.5px] text-[#c9c9c4] group-hover:border-ink group-hover:text-ink",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "leading-none transition-transform",
          strong ? "text-[20px] text-ink" : "text-[16px] text-muted group-hover:text-ink",
          arrow === "↑" ? "group-hover:-translate-y-0.5" : "group-hover:translate-x-1",
        )}
        aria-hidden
      >
        {arrow}
      </span>
    </div>
  );
}
