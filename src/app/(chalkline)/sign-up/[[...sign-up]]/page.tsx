import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { authConfigured } from "@/lib/auth/config";
import { CLERK_APPEARANCE } from "../../sign-in/[[...sign-in]]/page";

/** Sign up. Catch-all for the same reason sign-in is. */
export default function Page() {
  if (!authConfigured) redirect("/signin");

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-[440px] flex-col justify-center px-5 py-16">
      <p className="pb-6 font-mono text-[10px] uppercase tracking-[0.22em] text-dim">
        Create an account
      </p>
      <SignUp appearance={CLERK_APPEARANCE} />
      <p className="pt-6 text-[12.5px] leading-relaxed text-faint">
        Nothing you have already made is lost — local projects stay in this browser whether you
        sign up or not.
      </p>
    </div>
  );
}
