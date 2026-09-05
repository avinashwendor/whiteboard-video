"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * The middle of the landing page.
 *
 * The hero is a wall of type over a moving field and the footer is a dense
 * directory over a cut-out wordmark. Between them the page used to go quiet —
 * four bordered card grids in a row, all the same weight, none of them saying
 * anything the others didn't. These three replace that: a statement, a
 * sequence you scroll through, and a spec list. Different shapes, so the page
 * has a rhythm instead of a texture.
 *
 * One accent runs through all three, and it is the single green the studio
 * already uses for "this worked" — the active step in the pipeline, the
 * cursor in the editor. It shows up here exactly once per section, doing one
 * job each time, rather than as a colour-per-item legend.
 */

/* -------------------------------- statement ------------------------------- */

const ENGINES = [
  {
    name: "Drawn whiteboard",
    line: "A marker lays the scene down stroke by stroke, timed so the drawing lands on the word it illustrates.",
    best: "Explainers, teaching, process",
  },
  {
    name: "Modern frames",
    line: "Kinetic type, stat cards and callouts on a graded plate, cut to the beat of the script.",
    best: "Launches, metrics, keynote opens",
  },
];

/**
 * The claim, at the size of a claim — then a spec sheet, not a card grid.
 *
 * This was two feature cards, which is the wrong container for the one thing
 * that actually separates this from every other AI video tool. The claim gets
 * set as a sentence, hero-adjacent scale, no box around it. The two engines
 * underneath run as rows in a manifest — a giant ghost ordinal, the name, the
 * line, what it's for — because that is how a considered product describes
 * its own internals: a spec, not a pitch.
 */
export function EngineStatement() {
  return (
    <section className="w-full border-t border-line pt-16 sm:pt-20">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">Two engines</p>

      <h2 className="mt-6 max-w-[18ch] text-balance text-[40px] font-medium leading-[0.98] tracking-[-0.04em] text-ink sm:text-[62px] lg:text-[76px]">
        It draws.
        <br />
        It doesn&rsquo;t assemble.
      </h2>

      <p className="mt-7 max-w-[46ch] text-pretty text-[15px] leading-relaxed text-muted sm:text-[16px]">
        Nothing is picked from a stock library. Every scene is composed and rendered from scratch,
        which is why it works for subjects no stock footage covers.
      </p>

      <div className="mt-16 border-t border-line">
        {ENGINES.map((engine, index) => (
          <div
            key={engine.name}
            className="group relative overflow-hidden border-b border-line py-10 first:pt-12 sm:py-12"
          >
            {/*
              The rail — a hairline at rest, three pixels of the house green
              on hover. Same gesture as the editor rows below it, so the two
              sections read as one system rather than two separate designs.
            */}
            <span
              className="absolute inset-y-0 left-0 w-px bg-[var(--border-strong)] transition-[width,background-color] duration-300 ease-out group-hover:w-[3px] group-hover:bg-create"
              aria-hidden
            />

            {/*
              The ordinal, oversized and nearly invisible, sat behind the copy
              rather than beside it. It is the same trick a spec sheet or a
              type foundry's own site uses — scale doing the work colour would
              otherwise have to.
            */}
            <span
              className="pointer-events-none absolute -top-6 right-0 select-none font-mono text-[120px] font-medium leading-none tracking-tighter text-white/[0.035] sm:-top-8 sm:text-[160px]"
              aria-hidden
            >
              {String(index + 1).padStart(2, "0")}
            </span>

            <div className="relative grid grid-cols-1 gap-3 pl-6 sm:grid-cols-12 sm:items-baseline sm:gap-8 sm:pl-8">
              <h3 className="text-[26px] font-medium tracking-[-0.025em] text-ink sm:col-span-4 sm:text-[30px]">
                {engine.name}
              </h3>
              <p className="max-w-[42ch] text-pretty text-[14.5px] leading-relaxed text-muted sm:col-span-6">
                {engine.line}
              </p>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint sm:col-span-2 sm:text-right">
                {engine.best}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------- pipeline -------------------------------- */

/**
 * Four cards, each proving its step rather than describing it.
 *
 * A changelog card doesn't tell you what shipped, it shows you a terminal or a
 * list mid-run — the demo is the evidence. Every step here gets the same
 * treatment: a small mono panel doing the thing the heading claims, built from
 * copy that could plausibly be a real prompt, a real scene table, a real
 * transcript. The single green is the same one the studio itself uses for
 * "this worked" — a finished checklist line, an active caption word — so nothing
 * new is introduced, only reused.
 */
const PIPELINE: Array<{ title: string; line: string; demo: ReactNode }> = [
  {
    title: "Say what it is about",
    line: "A sentence, a full script, or footage you already have. All three land in the same place.",
    demo: (
      <div className="flex h-full flex-col justify-end gap-2">
        <p className="text-[#8a8a85]">
          <span className="text-faint">{"> "}</span>
          Explain compound interest in 45 seconds, whiteboard style
        </p>
        <p aria-hidden className="animate-fade text-ink">
          █
        </p>
      </div>
    ),
  },
  {
    title: "It writes the plan",
    line: "Scenes, narration and timings come back as fields you can read — and change — before a frame is made.",
    demo: (
      <dl className="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1.5">
        {[
          ["scene_01", "hook", "4.2s"],
          ["scene_02", "compound_growth", "9.8s"],
          ["scene_03", "chart_reveal", "6.1s"],
          ["scene_04", "cta", "3.4s"],
        ].map(([id, label, dur]) => (
          <Fragment key={id}>
            <dt className="text-faint">{id}</dt>
            <dd className="text-[#8a8a85]">{label}</dd>
            <dd className="text-right text-faint">{dur}</dd>
          </Fragment>
        ))}
      </dl>
    ),
  },
  {
    title: "Voice and motion",
    line: "Narration is generated with per-word timings, and every scene is drawn or composed against them.",
    demo: (
      <div className="space-y-1.5">
        {[
          ["00:04.12", "and", false],
          ["00:04.34", "that's", true],
          ["00:04.61", "how", false],
          ["00:04.79", "compounding", false],
        ].map(([time, word, isActive]) => (
          <p key={time as string} className="flex gap-3">
            <span className="text-faint">{time}</span>
            <span className={isActive ? "text-create" : "text-[#8a8a85]"}>{word}</span>
          </p>
        ))}
      </div>
    ),
  },
  {
    title: "Export, or keep going",
    line: "MP4 when it is done. The project stays open, so the next version is an edit rather than a re-prompt.",
    demo: (
      <div className="space-y-1.5">
        <p className="text-[#8a8a85]">
          <span className="text-faint">{"▲ "}</span>
          motionhouse export
        </p>
        <p className="text-create">✓ Rendered 4 scenes</p>
        <p className="text-create">✓ Mixed narration + score</p>
        <p className="text-create">✓ Encoded H.264, 1080p</p>
        <p className="pt-1 text-faint">
          Ready: <span className="text-[#8a8a85]">my-video.mp4</span>
        </p>
      </div>
    ),
  },
];

/**
 * A card per step, revealed as you scroll to it.
 *
 * Each card holds its own `IntersectionObserver` rather than sharing one, so
 * the reveal is purely local — a card animates in once, the first time it
 * crosses the bottom third of the viewport, and never again. That is the scroll
 * motion this section needs; nothing else on the page depends on which card is
 * "active", so there is no shared state left to keep in sync.
 */
function StepCard({ title, line, demo, index }: { title: string; line: string; demo: ReactNode; index: number }) {
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -15% 0px", threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={[
        "step-card group flex flex-col overflow-hidden border border-line bg-surface transition-colors duration-300 hover:border-line-strong",
        seen ? "step-card--seen" : "",
      ].join(" ")}
      style={{ transitionDelay: seen ? `${index * 60}ms` : "0ms" }}
    >
      <div className="relative min-h-[168px] flex-1 border-b border-line bg-[#0a0a0b] p-6 font-mono text-[12px] leading-relaxed sm:p-7">
        <span className="absolute left-6 top-6 font-mono text-[10px] tracking-[0.16em] text-[#4e4e4a] sm:left-7 sm:top-7">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="flex h-full items-center pt-6">{demo}</div>
      </div>
      <div className="p-6 sm:p-7">
        <h3 className="text-[19px] font-medium tracking-[-0.02em] text-ink sm:text-[21px]">
          {title}
        </h3>
        <p className="mt-2 max-w-[40ch] text-pretty text-[13.5px] leading-relaxed text-muted">
          {line}
        </p>
      </div>
    </div>
  );
}

export function Pipeline() {
  return (
    <section className="w-full border-t border-line pt-14 sm:pt-16">
      <div className="flex flex-col justify-between gap-4 border-b border-line pb-8 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">
            How it works
          </p>
          <h2 className="mt-3 max-w-[15ch] text-balance text-[30px] font-medium leading-[1.08] tracking-[-0.03em] text-ink sm:text-[36px]">
            Four steps, and you can stop at any of them.
          </h2>
        </div>
        <p className="max-w-[340px] text-pretty text-[13.5px] leading-relaxed text-muted sm:text-right">
          The plan is a document before it is a video. Read it, rewrite a line, then let the rest
          of it run.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
        {PIPELINE.map((step, index) => (
          <StepCard key={step.title} index={index} {...step} />
        ))}
      </div>

      <p className="pt-8 text-[13px] leading-relaxed text-faint">
        Every step is optional except the first.{" "}
        <Link href="/new" className="border-b border-line-strong text-muted hover:text-ink">
          Start with a sentence
        </Link>{" "}
        and stop wherever it is good enough.
      </p>
    </section>
  );
}

/* --------------------------------- editor --------------------------------- */

const EDITOR_FEATURES = [
  {
    title: "Direct it in sentences",
    line: "“Make scene 3 shorter.” “Give scene 2 a real photo of a server rack.” It re-plans that scene — not the whole video.",
    tag: "Direction",
  },
  {
    title: "A timeline that shows the shape",
    line: "Every scene is a lane sized by its real duration, so a closing block that drags is visible before you watch it.",
    tag: "Timeline",
  },
  {
    title: "Narration you can read",
    line: "Clips come back with per-word timings. The transcript is the scrubber — click a word, land on it.",
    tag: "Transcript",
  },
  {
    title: "The project is data",
    line: "Scenes, script, prompts and timings are one object. Edit the fields, edit the JSON, or just ask.",
    tag: "Data model",
  },
];

export function EditorFeatures() {
  return (
    <section className="w-full border-t border-line pt-14 sm:pt-16">
      <div className="flex flex-col justify-between gap-4 border-b border-line pb-8 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">The editor</p>
          <h2 className="mt-3 max-w-[15ch] text-balance text-[30px] font-medium leading-[1.08] tracking-[-0.03em] text-ink sm:text-[36px]">
            A video you can direct, not just receive.
          </h2>
        </div>
        <p className="max-w-[340px] text-pretty text-[13.5px] leading-relaxed text-muted sm:text-right">
          Most tools are one-shot: prompt in, video out, regenerate if it is wrong. Iteration is
          what makes anything good.
        </p>
      </div>

      {/*
        A manifest, not a card grid — four capabilities of one editor, not
        four separate products. Each row carries its own accent rail, the same
        legend the studio itself uses for these surfaces, so the row you are
        reading tells you which part of the editor it belongs to before you
        read a word.
      */}
      <div className="border-x border-b border-line">
        {EDITOR_FEATURES.map((feature, index) => (
          <div
            key={feature.title}
            className="group relative flex flex-col gap-2 border-b border-line py-7 pl-7 pr-6 transition-colors duration-300 last:border-b-0 hover:bg-surface sm:flex-row sm:items-baseline sm:gap-8 sm:py-8 sm:pl-9 sm:pr-8"
          >
            <span
              className="absolute inset-y-0 left-0 w-px bg-[var(--border-strong)] transition-[width,background-color] duration-300 ease-out group-hover:w-[3px] group-hover:bg-create"
              aria-hidden
            />

            <span className="font-mono text-[10px] tracking-[0.16em] text-[#4e4e4a] sm:w-10 sm:shrink-0">
              {String(index + 1).padStart(2, "0")}
            </span>

            <div className="sm:w-[15rem] sm:shrink-0">
              <h3 className="text-[17px] font-medium tracking-[-0.015em] text-ink">
                {feature.title}
              </h3>
              <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
                {feature.tag}
              </p>
            </div>

            <p className="max-w-[52ch] text-pretty text-[13.5px] leading-relaxed text-muted">
              {feature.line}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
