import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const whiteboardVideo = service("whiteboard-video", {
    source: github("avinashwendor/whiteboard-video", { checkSuites: false }),
    build: { builder: "NIXPACKS", buildCommand: "npm run build" },
    start: "npm run start",
    healthcheck: "/api/capabilities",
    healthcheckTimeout: 30,
    replicas: { "sfo": 1 },
    deploy: { restartPolicyMaxRetries: 5 },
    env: {
      CARTESIA_API_KEY: preserve(),
      DEEPGRAM_API_KEY: preserve(),
      OMEGA_API_KEY: preserve(),
      TAVILY_API_KEY: preserve(),

      // Clerk. The keys stay in Railway — `preserve()` reads whatever is set
      // there without writing it here, which is also what lets production hold
      // a pk_live_/sk_live_ pair while this file stays the same.
      CLERK_SECRET_KEY: preserve(),
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: preserve(),

      // The rest is routing, not secrets, so it belongs in source where a
      // change to it is reviewable. NEXT_PUBLIC_* is inlined at build time, so
      // these have to be present for `npm run build`, not just at runtime.
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
      NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
      NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/",
      NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/",

      // Clerk's keyless mode writes stub sign-in pages into the app when no
      // publishable key is found. Turning it off is what stops a deploy that
      // briefly lacks a key from serving those stubs instead of the real pages.
      CLERK_KEYLESS_DISABLED: "1",
      NEXT_PUBLIC_CLERK_KEYLESS_DISABLED: "1",
    },
  });

  return project("whiteboard-video", {
    resources: [whiteboardVideo],
  });
});
