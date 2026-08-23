import Link from "next/link";

/**
 * The closing plate.
 *
 * A dense link directory over a wordmark cut out of footage — the mark is the
 * only place on the page where the product's own material shows through the
 * type, which is the point: the studio is what the letters are made of.
 */

/**
 * Where to find the project.
 *
 * The repository is real. The two handles are not claimed yet — swap the hrefs
 * when they are, rather than leaving text that looks like a link and is not.
 */
const SOCIALS = [
  { name: "GitHub", href: "https://github.com/avinashwendor/whiteboard-video" },
  { name: "X", href: "https://x.com/motionhouse_ai" },
  { name: "Discord", href: "https://discord.gg/motionhouse" },
];

const COLUMNS: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Produce",
    links: [
      { label: "Start from an idea", href: "/#production-entry-hub" },
      { label: "Bring your own footage", href: "/#production-entry-hub" },
      { label: "Hyperframes", href: "/#production-entry-hub" },
      { label: "Drawn whiteboard", href: "/#production-entry-hub" },
      { label: "Modern frames", href: "/#production-entry-hub" },
    ],
  },
  {
    title: "Studio",
    links: [
      { label: "Editor", href: "/history" },
      { label: "Scene inspector", href: "/history" },
      { label: "Ask Motionhouse", href: "/history" },
      { label: "Timeline", href: "/history" },
      { label: "Export MP4", href: "/history" },
    ],
  },
  {
    title: "Engines",
    links: [
      { label: "Script writer", href: "/#production-entry-hub" },
      { label: "Narration", href: "/#production-entry-hub" },
      { label: "Image curation", href: "/#production-entry-hub" },
      { label: "Board renderer", href: "/#production-entry-hub" },
      { label: "Scoring", href: "/#production-entry-hub" },
    ],
  },
  {
    title: "Library",
    links: [
      { label: "History", href: "/history" },
      { label: "Examples", href: "/#production-entry-hub" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Sign in", href: "/signin" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative w-full overflow-hidden border-t border-line bg-bg">
      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-y-12 px-6 pb-16 pt-16 sm:px-10 lg:grid-cols-12 lg:gap-x-8 lg:pt-20">
        {/* ── brand block ── */}
        <div className="lg:col-span-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-6 shrink-0 place-items-center bg-ink font-mono text-[13px] font-medium text-bg">
              M
            </span>
            <span className="text-[22px] font-medium tracking-[-0.03em] text-ink">Motionhouse</span>
          </div>
          <p className="mt-3 text-[13.5px] text-muted">Ideas into motion.</p>

          <div className="mt-7 flex gap-2">
            {["MP4 · 1080p", "WEBM", "24 FPS"].map((badge) => (
              <span
                key={badge}
                className="border border-line px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim"
              >
                {badge}
              </span>
            ))}
          </div>

          <p className="mt-9 text-[13px] text-muted">Find us at</p>
          <div className="mt-3 flex gap-4 font-mono text-[11px] uppercase tracking-[0.14em] text-dim">
            {SOCIALS.map((social) => (
              <a
                key={social.name}
                href={social.href}
                target="_blank"
                rel="noreferrer noopener"
                className="transition-colors hover:text-ink"
              >
                {social.name}
              </a>
            ))}
          </div>

          <div className="mt-9 max-w-[280px] border border-line p-4 text-[12.5px] leading-relaxed text-faint">
            <p>© {new Date().getFullYear()} Motionhouse. All rights reserved.</p>
            <p className="mt-3">
              Text, images and voice generated in this session are kept in this browser.
            </p>
          </div>
        </div>

        {/* ── link directory ── */}
        {COLUMNS.map((column) => (
          <nav key={column.title} className="lg:col-span-2" aria-label={column.title}>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
              {column.title}
            </p>
            <ul className="mt-5 space-y-3">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-[14.5px] text-muted transition-colors hover:text-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      {/* ── the wordmark, cut out of footage ── */}
      <div className="relative w-full select-none overflow-hidden pb-2" aria-hidden>
        <div className="footer-wordmark">motionhouse</div>
      </div>
    </footer>
  );
}
