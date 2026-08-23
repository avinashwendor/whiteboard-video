import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { authConfigured } from "@/lib/auth/config";

/**
 * Sign in.
 *
 * A catch-all because Clerk routes its own steps — factor two, reset, OAuth
 * callbacks — underneath this path.
 *
 * With no keys there is nothing to sign into, so it hands over to the waitlist
 * rather than rendering a form that cannot work.
 */
export default function Page() {
  if (!authConfigured) redirect("/signin");

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-[440px] flex-col justify-center px-5 py-16">
      <p className="pb-6 font-mono text-[10px] uppercase tracking-[0.22em] text-dim">
        Sign in to Motionhouse
      </p>
      <SignIn appearance={CLERK_APPEARANCE} />
      <p className="pt-6 text-[12.5px] leading-relaxed text-faint">
        You don&rsquo;t need an account to make a video — the studio runs in your browser either
        way. Signing in is for keeping projects across devices.
      </p>
    </div>
  );
}

/**
 * Clerk's default card is rounded and light. This is the squared, near-black
 * house style, expressed through the variables Clerk exposes.
 */
export const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "#f2f2f0",
    colorBackground: "#0e0e10",
    colorText: "#f2f2f0",
    colorTextSecondary: "#8a8a85",
    colorInputBackground: "#121214",
    colorInputText: "#f2f2f0",
    borderRadius: "0px",
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-none",
    card: "bg-transparent shadow-none border border-[rgba(242,242,240,0.08)]",
    headerTitle: "text-[20px] font-medium tracking-[-0.02em]",
    formButtonPrimary:
      "bg-[#f2f2f0] text-[#0a0b0d] hover:bg-white text-[13.5px] font-medium normal-case",
    footerActionLink: "text-[#f2f2f0]",
  },
} as const;
