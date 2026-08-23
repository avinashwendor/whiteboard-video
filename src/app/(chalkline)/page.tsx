"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { EntryHub } from "@/components/studio/entry-hub";
import { SiteFooter } from "@/components/site/site-footer";
import { Economics, EditorFeatures, VideoStyles } from "@/components/site/value-sections";
import { Pricing } from "@/components/site/pricing";

const Dither = dynamic(() => import("@/components/ui/dither"), {
  ssr: false,
});

export default function StudioPage() {
  const router = useRouter();

  /**
   * The hero CTA shows the three modes before it commits to one.
   *
   * Jumping straight to /new hides the fact that starting from an idea is a
   * choice among three, so the page scrolls the hub to the centre of the
   * viewport first, holds it long enough to register, then follows the link.
   * It stays a real anchor: middle-click, ⌘-click and keyboard activation all
   * still open /new directly, and the scroll only runs on a plain click.
   */
  const handleStartCreating = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

    const hub = document.getElementById("production-entry-hub");
    if (!hub) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    event.preventDefault();
    hub.scrollIntoView({ behavior: "smooth", block: "center" });

    // Long enough for the section to land and be seen, short enough that it
    // does not feel like the click was ignored.
    window.setTimeout(() => router.push("/new"), 900);
  };

  return (
    <div className="relative w-full overflow-hidden bg-bg">
      {/* ----------------- 01 HERO: DITHER BACKGROUND (85–94vh) ----------------- */}
      <section
        aria-label="Motionhouse introduction"
        className="relative flex min-h-[85vh] w-full flex-col items-center justify-center overflow-hidden px-6 pt-16 pb-12 sm:min-h-[88vh] sm:pt-20 lg:min-h-[92vh]"
      >
        {/* Full-bleed living Dither background with smooth fade-in */}
        <div className="animate-bg-fade absolute inset-0 z-0 h-full w-full pointer-events-none select-none" aria-hidden>
          <Dither
            waveColor={[0.5, 0.5, 0.5]}
            disableAnimation={false}
            enableMouseInteraction={false}
            mouseRadius={0.3}
            colorNum={3.7}
            waveAmplitude={0.25}
            waveFrequency={3.2}
            waveSpeed={0.06}
          />
        </div>

        {/*
          The dither runs bright in patches, which leaves the graphite subcopy
          unreadable wherever a light band lands under it. A radial scrim gives
          the copy its own ground without flattening the field around it.
        */}
        <div className="hero-scrim pointer-events-none absolute inset-0 z-[1]" aria-hidden />
        <div className="hero-vignette pointer-events-none absolute inset-0 z-[1]" aria-hidden />

        {/* Hero Editorial Content with Staggered Entrance Animations */}
        <div className="relative z-10 mx-auto flex w-full max-w-[880px] flex-col items-center px-4 text-center">
          <p className="animate-slide-up-1 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[#b4b4ae]">
            MOTIONHOUSE
          </p>

          <h1 className="animate-slide-up-2 mt-5 text-balance text-[52px] font-medium leading-[0.92] tracking-[-0.04em] text-ink sm:text-[76px] lg:text-[96px]">
            IDEAS INTO MOTION.
          </h1>

          <p className="animate-slide-up-3 mt-5 max-w-[520px] text-pretty text-[16px] leading-relaxed text-[#c9c9c4] sm:text-[18px]">
            Turn an idea into a visual story.
          </p>

          <div className="animate-slide-up-4 mt-9">
            <Link
              href="/new"
              onClick={handleStartCreating}
              className="group relative flex items-center gap-2 pb-1.5 text-[15px] font-medium text-ink transition-colors hover:text-white sm:text-[16px]"
            >
              <span className="hover-underline">
                Start creating
              </span>
              <span className="text-[18px] leading-none transition-transform duration-300 group-hover:translate-x-1" aria-hidden>
                →
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* Subtle Studio Divider */}
      <div className="studio-hairline w-full" aria-hidden />

      {/* ----------------- 02 PRODUCTION MODES & STUDIO COMPOSER ----------------- */}
      <div className="relative mx-auto flex max-w-[1160px] flex-col px-5 pb-24 pt-16 sm:px-8 sm:pt-20 lg:pb-32">
        <section className="w-full">
          {/* Editorial Section Introduction */}
          <div className="flex flex-col justify-between gap-4 border-b border-line pb-8 sm:flex-row sm:items-end">
            <div>
              <p className="text-[13px] font-medium text-muted">
                Production modes
              </p>
              <h2 className="mt-2 text-balance text-[30px] font-medium leading-[1.08] tracking-[-0.03em] text-ink sm:text-[38px]">
                Create, edit and enhance video.
              </h2>
            </div>
            <p className="text-[13.5px] text-muted sm:text-right">
              A creative production studio
            </p>
          </div>

          {/* Asymmetric 3-part production entry point hub */}
          <div id="production-entry-hub" className="mt-8 sm:mt-10">
            <EntryHub />
          </div>

          <div className="mt-16 sm:mt-20">
            <VideoStyles />
          </div>

          <div className="mt-16 sm:mt-20">
            <EditorFeatures />
          </div>

          <div className="mt-16 sm:mt-20">
            <Economics />
          </div>

          <div className="mt-16 sm:mt-20">
            <Pricing />
          </div>
        </section>

      </div>

      <SiteFooter />
    </div>
  );
}
