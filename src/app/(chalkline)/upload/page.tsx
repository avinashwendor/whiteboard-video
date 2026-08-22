"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FootageIntake } from "@/components/studio/footage-intake";
import { useStudio } from "@/lib/studio/use-studio";

const RECENT_FOOTAGE = [
  { title: "Product walkthrough — raw cut", quality: "1080p", duration: "04:12" },
  { title: "Founder interview, camera A", quality: "4K", duration: "18:40" },
  { title: "Conference keynote, screen capture", quality: "1440p", duration: "42:05" },
];

/**
 * Starting from footage you already have.
 *
 * Accepting a clip hands the description to the composer rather than starting
 * a run here — what to do with the footage is still an open question, and the
 * composer is where that question gets answered.
 */
export default function UploadPage() {
  const { setMode, setPrompt } = useStudio();
  const router = useRouter();

  return (
    <div className="mx-auto w-full max-w-[1120px] px-5 pb-24 pt-14 sm:px-8 sm:pt-20">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-8">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">
            02 · Start with footage
          </p>
          <h1 className="mt-4 text-[34px] font-medium leading-[1.04] tracking-[-0.035em] text-ink sm:text-[40px]">
            Start with footage
          </h1>
          <p className="mt-3 max-w-[560px] text-pretty text-[14.5px] leading-relaxed text-muted">
            Drop in what you already shot. Motionhouse reads it, cuts it and can rebuild any part
            of it.
          </p>
        </div>
        <Link href="/new" className="text-[13.5px] text-muted transition-colors hover:text-ink">
          Start with an idea instead
        </Link>
      </div>

      <div className="border border-line bg-surface">
        <FootageIntake
          recent={RECENT_FOOTAGE}
          onAccept={(source) => {
            setMode("create");
            setPrompt(
              source.kind === "file"
                ? `Edit and enhance uploaded footage: ${source.file.name}`
                : `Edit and enhance the video at ${source.url}`,
            );
            router.push("/new");
          }}
        />
      </div>
    </div>
  );
}
