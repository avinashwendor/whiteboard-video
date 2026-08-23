/**
 * Voice casting.
 *
 * The failure this guards against is silent and expensive: a voice is chosen,
 * a two-minute generation runs, and the narration comes back in a different
 * voice — or a different language — with nothing anywhere saying why.
 *
 * Run with `npx tsx tests/casting-test.ts`.
 */

import { castVoice } from "../src/lib/studio/casting";
import type { VoiceInfo } from "../src/lib/ai/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

// The incumbent is deliberately NOT first. The scoring loop keeps whichever
// candidate it saw first on a tie, so a catalogue that happens to list the
// default at the top would pass whether or not the incumbent is scored at all —
// which is exactly how the first version of this test passed against the bug.
const catalogue: VoiceInfo[] = [
  {
    id: "other-f",
    name: "Other",
    description: "expressive",
    gender: "feminine",
    languages: ["en"],
  },
  {
    id: "siya",
    name: "Siya",
    description: "gentle expressive heartfelt narrative",
    gender: "feminine",
    languages: ["en"],
  },
  {
    id: "male-en",
    name: "Male",
    description: "deep authoritative",
    gender: "masculine",
    languages: ["en"],
  },
  {
    id: "es-f",
    name: "Spanish",
    description: "warm calm confident engaging expressive",
    gender: "feminine",
    languages: ["es"],
  },
] as VoiceInfo[];

/* --------------------------- the default survives --------------------------- */

{
  // The incumbent matches the brief as well as anything else does, so it keeps
  // the job. Before it was scored at all, "other-f" took it on a tie.
  const kept = castVoice({
    brief: { qualities: ["expressive"], gender: "feminine" },
    catalogue,
    language: "en",
    current: "siya",
  });
  assert(kept === "siya", `a default that ties should be kept, got ${kept}`);

  // A brief the incumbent genuinely does not fit still recasts.
  const recast = castVoice({
    brief: { qualities: ["deep", "authoritative"], gender: "masculine" },
    catalogue,
    language: "en",
    current: "siya",
  });
  assert(recast === "male-en", `a brief it cannot fit should recast, got ${recast}`);

  // Picking by hand ends casting outright.
  const pinned = castVoice({
    brief: { qualities: ["deep"], gender: "masculine" },
    catalogue,
    language: "en",
    current: "siya",
    pinned: true,
  });
  assert(pinned === "siya", `a pinned voice must never be recast, got ${pinned}`);
}

/* ------------------------------- language wins ------------------------------ */

{
  // The Spanish voice matches every quality in the brief and would outscore
  // both English ones. Language is a filter, not a preference.
  const chosen = castVoice({
    brief: {
      qualities: ["warm", "calm", "confident", "engaging"],
      gender: "feminine",
    },
    catalogue,
    language: "en",
    current: "siya",
  });
  assert(
    chosen !== "es-f",
    "an English script must never be cast to a Spanish voice"
  );
}

/* ------------------------------- no brief ----------------------------------- */

{
  const unchanged = castVoice({
    catalogue,
    language: "en",
    current: "siya",
  });
  assert(unchanged === "siya", "with no brief the current voice stands");
}

console.log("ALL CASTING TESTS PASSED");
