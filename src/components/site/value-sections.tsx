import Link from "next/link";

/**
 * What the studio makes, and what it costs to run.
 *
 * The mode hub says how to start. These say why the result is different from
 * every other "AI video" tool — it is drawn rather than assembled, it stays
 * editable after it is made, and almost nothing about it costs money per
 * video. All three are claims about how it is built, so they belong next to
 * the product rather than in a deck.
 */

/* --------------------------------- styles --------------------------------- */

const STYLES = [
  {
    name: "Drawn whiteboard",
    line: "A marker lays the scene down stroke by stroke, timed to the narration.",
    best: "Explainers, teaching, anything with a process",
    accent: "var(--accent-create)",
  },
  {
    name: "Modern frames",
    line: "Kinetic type, stat cards and callouts on a graded, cinematic plate.",
    best: "Launches, metrics, keynote openers",
    accent: "var(--accent-write)",
  },
];

export function VideoStyles() {
  return (
    <section className="w-full border-t border-line pt-14 sm:pt-16">
      <div className="flex flex-col justify-between gap-4 border-b border-line pb-8 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">Two engines</p>
          <h2 className="mt-3 text-balance text-[30px] font-medium leading-[1.08] tracking-[-0.03em] text-ink sm:text-[36px]">
            It draws. It doesn&rsquo;t assemble.
          </h2>
        </div>
        <p className="max-w-[340px] text-pretty text-[13.5px] leading-relaxed text-muted sm:text-right">
          Nothing is picked from a stock library. Every scene is composed and rendered, which is
          why it works for subjects no stock footage covers.
        </p>
      </div>

      <div className="grid grid-cols-1 border-x border-b border-line md:grid-cols-2">
        {STYLES.map((style, index) => (
          <div
            key={style.name}
            className={index === 0 ? "border-b border-line md:border-b-0 md:border-r" : ""}
          >
            <div className="flex h-full flex-col p-7 sm:p-9">
              <span className="size-2" style={{ background: style.accent }} aria-hidden />
              <h3 className="mt-5 text-[22px] font-medium tracking-[-0.02em] text-ink">
                {style.name}
              </h3>
              <p className="mt-2.5 text-pretty text-[14.5px] leading-relaxed text-muted">
                {style.line}
              </p>
              <div className="mt-auto pt-7">
                <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#4e4e4a]">
                  Best for
                </p>
                <p className="mt-1.5 text-[13.5px] text-[#c9c9c4]">{style.best}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------- editor --------------------------------- */

const EDITOR_FEATURES = [
  {
    title: "Direct it in sentences",
    line: "“Make scene 3 shorter.” “Give scene 2 a real photo of a server rack.” It re-plans that scene — not the whole video.",
  },
  {
    title: "A timeline that shows the shape",
    line: "Every scene is a lane sized by its real duration, so a closing block that drags is visible before you watch it.",
  },
  {
    title: "Narration you can read",
    line: "Clips come back with per-word timings. The transcript is the scrubber — click a word, land on it.",
  },
  {
    title: "The project is data",
    line: "Scenes, script, prompts and timings are one object. Edit the fields, edit the JSON, or just ask.",
  },
];

export function EditorFeatures() {
  return (
    <section className="w-full border-t border-line pt-14 sm:pt-16">
      <div className="flex flex-col justify-between gap-4 border-b border-line pb-8 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">The editor</p>
          <h2 className="mt-3 text-balance text-[30px] font-medium leading-[1.08] tracking-[-0.03em] text-ink sm:text-[36px]">
            A video you can direct, not just receive.
          </h2>
        </div>
        <p className="max-w-[340px] text-pretty text-[13.5px] leading-relaxed text-muted sm:text-right">
          Most tools are one-shot: prompt in, video out, regenerate if it is wrong. Iteration is
          what makes anything good.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-px bg-[var(--border)] sm:grid-cols-2">
        {EDITOR_FEATURES.map((feature, index) => (
          <div key={feature.title} className="bg-bg p-7">
            <span className="font-mono text-[10px] tracking-[0.16em] text-[#4e4e4a]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-4 text-[17px] font-medium tracking-[-0.015em] text-ink">
              {feature.title}
            </h3>
            <p className="mt-2 text-pretty text-[13.5px] leading-relaxed text-muted">
              {feature.line}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------- economics ------------------------------- */

const FREE_LINES = [
  ["Rendering", "Your browser, frame by frame"],
  ["Storage", "Stays in your browser"],
  ["Music", "Synthesised, nothing to license"],
  ["Sound effects", "Synthesised, sample-accurate"],
  ["Stock footage", "None — every scene is drawn"],
];

export function Economics() {
  return (
    <section className="w-full border-t border-line pt-14 sm:pt-16">
      <div className="flex flex-col justify-between gap-4 border-b border-line pb-8 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">Economics</p>
          <h2 className="mt-3 text-balance text-[30px] font-medium leading-[1.08] tracking-[-0.03em] text-ink sm:text-[36px]">
            No render farm, because none is needed.
          </h2>
        </div>
        <p className="max-w-[380px] text-pretty text-[13.5px] leading-relaxed text-muted sm:text-right">
          The two things that cost money in this category — rendering and storage — are the two
          things we don&rsquo;t pay for. What is left per video is some tokens and some speech.
        </p>
      </div>

      <div className="border-x border-b border-line">
        {FREE_LINES.map(([label, detail]) => (
          <div
            key={label}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-6 py-4 last:border-b-0"
          >
            <span className="text-[15px] text-ink">{label}</span>
            <span className="flex-1 text-[13.5px] text-muted sm:text-right">{detail}</span>
            <span className="w-16 shrink-0 text-right font-mono text-[11px] uppercase tracking-[0.16em] text-create">
              Free
            </span>
          </div>
        ))}
      </div>

      <p className="pt-5 text-[13px] leading-relaxed text-faint">
        Pricing is being finalised — a subscription and a credit-based plan.{" "}
        <Link href="/new" className="border-b border-line-strong text-muted hover:text-ink">
          Try it first
        </Link>
        , it runs without an account.
      </p>
    </section>
  );
}
