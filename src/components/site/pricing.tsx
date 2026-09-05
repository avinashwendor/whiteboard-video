import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * Pricing.
 *
 * Three columns, and the first one is a door rather than a plan: a trial that
 * runs the paid product for a fortnight so the decision is made on the real
 * thing. After that the two shapes are genuinely different — someone making a
 * video a week wants a flat bill, and someone making thirty in a burst before
 * a launch wants to pay for the burst.
 */

interface Plan {
  name: string;
  price: string;
  cadence?: string;
  line: string;
  features: string[];
  cta: string;
  href: string;
  featured?: boolean;
  note?: string;
}

const PLANS: Plan[] = [
  {
    name: "Trial",
    price: "Free",
    cadence: "for 14 days",
    line: "The full Studio plan, for two weeks. No card, no invoice at the end.",
    features: [
      "5 videos to spend however you like",
      "Every voice and language",
      "Full editor, timeline and Ask",
      "MP4 export, no watermark",
    ],
    cta: "Start free trial",
    href: "/sign-up",
    note: "Ends on its own. Nothing to cancel.",
  },
  {
    name: "Studio",
    price: "₹1,499",
    cadence: "/month",
    line: "For a steady drip of videos. Everything set up, nothing to configure.",
    features: [
      "60 videos a month",
      "Every voice and language",
      "Priority generation queue",
      "Project history synced across devices",
    ],
    cta: "Join the waitlist",
    href: "/sign-up",
    featured: true,
  },
  {
    name: "Credits",
    price: "₹399",
    cadence: "/100 credits",
    line: "Pay for the burst. Credits do not expire.",
    features: [
      "≈1 credit a scene, ≈8 a video",
      "Same models as Studio",
      "Top up whenever",
      "Good for launches and one-offs",
    ],
    cta: "Join the waitlist",
    href: "/sign-up",
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="w-full scroll-mt-20 border-t border-line pt-14 sm:pt-16">
      <div className="flex flex-col justify-between gap-4 border-b border-line pb-8 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">Pricing</p>
          <h2 className="mt-3 max-w-[15ch] text-balance text-[30px] font-medium leading-[1.08] tracking-[-0.03em] text-ink sm:text-[36px]">
            Pay for videos, not seats.
          </h2>
        </div>
        <p className="max-w-[340px] text-pretty text-[13.5px] leading-relaxed text-muted sm:text-right">
          One price covers the whole pipeline — script, voice, scenes and export. Nothing is
          licensed from a stock library, so nothing is passed on to you.
        </p>
      </div>

      <div className="grid grid-cols-1 border-x border-b border-line lg:grid-cols-3">
        {PLANS.map((plan, index) => (
          <div
            key={plan.name}
            className={cn(
              "flex flex-col p-7 sm:p-8",
              index < PLANS.length - 1 && "border-b border-line lg:border-b-0 lg:border-r",
              plan.featured && "bg-surface",
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[17px] font-medium tracking-[-0.015em] text-ink">{plan.name}</h3>
              {plan.featured ? (
                <span className="border border-line-strong px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
                  Most people
                </span>
              ) : null}
            </div>

            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="text-[34px] font-medium tracking-[-0.03em] text-ink">
                {plan.price}
              </span>
              {plan.cadence ? (
                <span className="text-[13px] text-faint">{plan.cadence}</span>
              ) : null}
            </p>

            <p className="mt-3 text-pretty text-[13.5px] leading-relaxed text-muted">{plan.line}</p>

            <ul className="mt-6 space-y-2.5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex gap-2.5 text-[13.5px] leading-relaxed text-[#c9c9c4]">
                  <span className="mt-[7px] size-1 shrink-0 bg-create" aria-hidden />
                  {feature}
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-8">
              <Link
                href={plan.href}
                className={cn(
                  "flex h-11 w-full items-center justify-center text-[13.5px] font-medium transition-colors",
                  plan.featured
                    ? "bg-ink text-[#0a0b0d] hover:bg-white"
                    : "border border-line-strong text-ink hover:bg-surface-hover",
                )}
              >
                {plan.cta}
              </Link>
              {plan.note ? (
                <p className="pt-3 text-center text-[12px] text-faint">{plan.note}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <p className="pt-5 text-[12.5px] leading-relaxed text-faint">
        Billing is not switched on yet. The trial and the waitlist are real; cards come with
        launch, and nobody is charged before then.
      </p>
    </section>
  );
}
