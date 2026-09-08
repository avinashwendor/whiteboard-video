import type { Metadata } from "next";
import Link from "next/link";

/**
 * Third-party notices.
 *
 * Not decoration and not a courtesy. Four of the licences this app is built on
 * require that a notice reaches the people who receive the software, and this
 * is a client-side app — the code, the icon geometry and the media engine are
 * downloaded by every visitor, which is distribution in the plainest sense.
 *
 * PolyForm Noncommercial requires its Required Notice to travel with any copy
 * of the software it covers. The GPL requires the licence and an offer of
 * source for the binary that is served. CC-BY requires attribution by name.
 * ISC requires its copyright line to be kept. None of that was anywhere a user
 * could see it before this page existed.
 *
 * It states what is used and under what terms. It deliberately makes no claim
 * about whether any particular use of this software complies with those terms —
 * that is not a question a page can answer.
 */

export const metadata: Metadata = {
  title: "Third-party notices · Motionhouse",
  description:
    "The open-source software, models, icons and typefaces Motionhouse is built on, and the notices their licences require.",
};

interface Entry {
  name: string;
  href?: string;
  licence: string;
  note?: string;
}

/** Runtime dependencies, read from package.json and each package's own manifest. */
const PACKAGES: Entry[] = [
  { name: "@chatoctopus/timeline", licence: "MIT" },
  { name: "@clerk/nextjs", licence: "MIT" },
  {
    name: "@ffmpeg/core-mt",
    href: "https://github.com/ffmpegwasm/ffmpeg.wasm",
    licence: "GPL-2.0-or-later",
    note: "See the notice above — this is the media engine served to your browser.",
  },
  { name: "@ffmpeg/ffmpeg", licence: "MIT" },
  { name: "@ffmpeg/util", licence: "MIT" },
  { name: "@floating-ui/react", licence: "MIT" },
  { name: "@huggingface/transformers", licence: "Apache-2.0" },
  { name: "@indic-transliteration/sanscript", licence: "MIT" },
  { name: "@react-three/fiber", licence: "MIT" },
  { name: "@react-three/postprocessing", licence: "MIT" },
  { name: "@sentry/react", licence: "MIT" },
  { name: "aws4fetch", licence: "MIT" },
  { name: "cfb", licence: "Apache-2.0" },
  { name: "clsx", licence: "MIT" },
  {
    name: "lucide-react",
    href: "https://lucide.dev",
    licence: "ISC",
    note: "Icon geometry is also compiled into the board renderer.",
  },
  { name: "mp4-muxer", licence: "MIT" },
  { name: "next", licence: "MIT" },
  { name: "parakeet.js", licence: "MIT" },
  { name: "postprocessing", licence: "Zlib" },
  { name: "react", licence: "MIT" },
  { name: "react-dom", licence: "MIT" },
  { name: "react-resizable-panels", licence: "MIT" },
  { name: "tailwind-merge", licence: "MIT" },
  { name: "three", licence: "MIT" },
  { name: "weightlift", licence: "MIT" },
  { name: "zod", licence: "MIT" },
  { name: "zustand", licence: "MIT" },
];

/** Weights fetched to your browser on demand, never bundled. */
const MODELS: Entry[] = [
  {
    name: "Whisper (ONNX)",
    href: "https://huggingface.co/onnx-community",
    licence: "MIT (OpenAI Whisper)",
    note: "Speech recognition, run entirely on your device.",
  },
  {
    name: "NVIDIA Parakeet TDT 0.6B v3",
    href: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3",
    licence: "CC-BY-4.0",
    note: "Speech recognition. Attribution required, and given here.",
  },
  {
    name: "facebook/wav2vec2-base-960h",
    href: "https://huggingface.co/facebook/wav2vec2-base-960h",
    licence: "Apache-2.0",
    note: "Forced alignment for English.",
  },
  {
    name: "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn",
    href: "https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn",
    licence: "Apache-2.0",
    note: "Forced alignment for Chinese.",
  },
  {
    name: "MMS 300m forced aligner",
    href: "https://huggingface.co/MahmoudAshraf/mms-300m-1130-forced-aligner",
    licence: "CC-BY-NC-4.0",
    note:
      "Forced alignment for Spanish, French, German, Telugu and Hindi. Noncommercial licence.",
  },
];

const TYPEFACES: Entry[] = [
  { name: "Geist and Geist Mono", href: "https://vercel.com/font", licence: "SIL Open Font Licence 1.1" },
  { name: "Google Fonts families", href: "https://fonts.google.com", licence: "SIL Open Font Licence 1.1 / Apache-2.0" },
];

function Table({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <section className="mt-14">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">{title}</h2>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {entries.map((entry) => (
          <li key={entry.name} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4">
            <span className="min-w-0 flex-1 text-[14px] text-ink">
              {entry.href ? (
                <a
                  href={entry.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
                >
                  {entry.name}
                </a>
              ) : (
                entry.name
              )}
              {entry.note && (
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{entry.note}</span>
              )}
            </span>
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-dim">
              {entry.licence}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function NoticesPage() {
  return (
    <main className="mx-auto w-full max-w-[880px] px-6 py-20 sm:px-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">Legal</p>
      <h1 className="mt-3 text-[38px] font-medium leading-[1.06] tracking-[-0.03em] text-ink sm:text-[46px]">
        Third-party notices
      </h1>
      <p className="mt-5 max-w-[62ch] text-[15px] leading-relaxed text-muted">
        Motionhouse runs in your browser, so most of what follows is downloaded to your
        device and runs there. These are the projects it is built on and the notices
        their licences require us to pass on to you.
      </p>

      {/* The two notices that are obligations rather than acknowledgements. */}
      <section className="mt-12 border border-line p-6">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
          Required notice · transcript editor
        </h2>
        <p className="mt-4 text-[14px] leading-relaxed text-ink">
          The transcript editor is ported from{" "}
          <a
            href="https://github.com/wassgha/rescript"
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
          >
            Rescript
          </a>{" "}
          by Wassim Gharbi, used under the{" "}
          <a
            href="https://polyformproject.org/licenses/noncommercial/1.0.0"
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
          >
            PolyForm Noncommercial License 1.0.0
          </a>
          .
        </p>
        <p className="mt-4 border-l-2 border-line pl-4 font-mono text-[12.5px] leading-relaxed text-muted">
          Required Notice: Copyright (c) 2026 Wassim Gharbi and Rescript contributors
          (https://github.com/wassgha/rescript)
        </p>
      </section>

      <section className="mt-6 border border-line p-6">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
          Required notice · media engine
        </h2>
        <p className="mt-4 text-[14px] leading-relaxed text-ink">
          Cutting, re-encoding and audio extraction run in your browser on{" "}
          <a
            href="https://github.com/ffmpegwasm/ffmpeg.wasm"
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
          >
            ffmpeg.wasm
          </a>{" "}
          (<span className="font-mono text-[12.5px]">@ffmpeg/core-mt</span>), a build of{" "}
          <a
            href="https://ffmpeg.org"
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
          >
            FFmpeg
          </a>{" "}
          that includes x264 and is distributed under the{" "}
          <a
            href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.html"
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
          >
            GNU General Public License, version 2 or later
          </a>
          . That binary is served to your browser from this site unmodified.
        </p>
        <p className="mt-4 text-[14px] leading-relaxed text-muted">
          The corresponding source is published by the ffmpeg.wasm project at the link
          above, and is available from us on request.
        </p>
      </section>

      <Table title="Models run on your device" entries={MODELS} />
      <Table title="Typefaces" entries={TYPEFACES} />
      <Table title="Software" entries={PACKAGES} />

      <section className="mt-14">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
          Music, sound and pictures
        </h2>
        <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-muted">
          Stock audio, video and photography come from Openverse, Freesound and Pexels.
          Every result carries its own licence, only results usable commercially are
          offered, and anything whose licence requires a credit is listed in the credits
          panel of the project it is used in — so the attribution travels with the video
          rather than stopping here.
        </p>
      </section>

      <p className="mt-16 text-[13px] text-faint">
        <Link href="/" className="underline decoration-line underline-offset-4 transition-colors hover:decoration-ink">
          Back to Motionhouse
        </Link>
      </p>
    </main>
  );
}
