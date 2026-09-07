/**
 * Three speech engines behind one contract, and the seams between them.
 *
 * The engines are interchangeable by design — the director describes a voice
 * ("warm", feminine) rather than naming one, so swapping the whole provider is
 * meant to be invisible. Everything that breaks that promise breaks it
 * silently, with a 200 and audio that is simply the wrong voice:
 *
 *  · A request schema that names the engines by hand rejects the third one.
 *  · A default voice id belonging to one engine resolves to nothing in another.
 *  · A gender vocabulary that differs by one word inverts the casting.
 *
 * The last one was live: ElevenLabs labels voices "male"/"female" while this
 * app says "masculine"/"feminine", and `castVoice` compares with `===`, so a
 * feminine brief scored −4 against every feminine voice and cast "Roger".
 *
 * Run with `npx tsx tests/voice-engines-test.ts`.
 */

import { ttsProviders, TTS_PROVIDER_IDS, resolveTts } from "../src/lib/ai/tts";
import { castVoice, speaksLanguage } from "../src/lib/studio/casting";
import { ttsRequestSchema } from "../src/lib/validation/schemas";
import { DEFAULT_SETTINGS } from "../src/lib/studio/types";
import type { VoiceInfo } from "../src/lib/ai/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/* ------------------------------- the registry ------------------------------- */

{
  const ids = ttsProviders().map((p) => p.id);
  assert(ids.includes("elevenlabs"), "ElevenLabs is not in the registry");
  assert(ids.includes("deepgram") && ids.includes("cartesia"), "an engine went missing");
  assert(
    TTS_PROVIDER_IDS.length === ids.length,
    "the id tuple and the registry disagree"
  );
  for (const p of ttsProviders()) {
    assert(p.label && p.label !== p.id, `${p.id}: no human label`);
  }
  console.log(`✓ ${ids.length} engines registered: ${ids.join(", ")}`);
}

/* -------------------------------- the schema -------------------------------- */

{
  // Every engine must be nameable. This is the check that was missing: the
  // enum was hand-written as ["deepgram","cartesia"], so a third engine was
  // refused at the one layer nobody looks at, because it resolves fine when
  // nothing asks for it by name.
  for (const id of TTS_PROVIDER_IDS) {
    const parsed = ttsRequestSchema.safeParse({
      provider: id,
      transcript: "hello",
      voiceId: "someid",
    });
    assert(parsed.success, `the TTS schema rejects the real engine "${id}"`);
  }
  assert(
    !ttsRequestSchema.safeParse({ provider: "nope", transcript: "hi", voiceId: "x" }).success,
    "an invented engine is still refused"
  );
  assert(
    ttsRequestSchema.safeParse({ transcript: "hello", voiceId: "someid" }).success,
    "omitting the engine is allowed — it means 'whichever is configured'"
  );
  console.log("✓ the schema accepts exactly the engines that exist");
}

/* -------------------------------- resolution -------------------------------- */

{
  for (const { id, configured } of ttsProviders()) {
    if (!configured) continue;
    assert(
      resolveTts(id).id === id,
      `asking for "${id}" resolved to something else`
    );
  }
  // An unknown name falls back rather than throwing: a saved setting from an
  // engine that has since been removed must not break the page.
  assert(resolveTts("gone").id !== undefined, "an unknown engine falls back");
  console.log("✓ naming an engine gets that engine");
}

/* ------------------------------ no engine ids in defaults ------------------- */

{
  // A default voice id belongs to exactly one engine, so hardcoding one is a
  // default that stops resolving the moment the preference order changes —
  // which is what happened.
  assert(
    DEFAULT_SETTINGS.voiceId === "",
    `the default voice is hardcoded to "${DEFAULT_SETTINGS.voiceId}", which belongs to one engine`
  );
  assert(
    DEFAULT_SETTINGS.voiceProvider === "",
    "the default engine should be 'whichever is configured'"
  );
  console.log("✓ no engine-specific id is baked into the defaults");
}

/* --------------------------------- casting ---------------------------------- */

{
  // One vocabulary for gender, across every engine. The comparison is `===`,
  // so a synonym does not soften the match — it reverses it.
  const catalogue: VoiceInfo[] = [
    { id: "f1", name: "Sarah", gender: "feminine", language: "en", description: "warm and clear" },
    { id: "m1", name: "Roger", gender: "masculine", language: "en", description: "warm and clear" },
  ];

  const feminine = castVoice({
    brief: { gender: "feminine", qualities: ["warm"] },
    catalogue,
    language: "en",
    current: "m1",
  });
  assert(feminine === "f1", `a feminine brief cast ${feminine}, not the feminine voice`);

  const masculine = castVoice({
    brief: { gender: "masculine", qualities: ["warm"] },
    catalogue,
    language: "en",
    current: "f1",
  });
  assert(masculine === "m1", `a masculine brief cast ${masculine}`);

  // The exact failure that shipped: "male"/"female" never match, and because
  // the mismatch costs −4 the wrong voice wins outright.
  const raw: VoiceInfo[] = [
    { id: "f2", name: "Sarah", gender: "female", language: "en", description: "warm" },
    { id: "m2", name: "Roger", gender: "male", language: "en", description: "warm" },
  ];
  const wrong = castVoice({
    brief: { gender: "feminine", qualities: ["warm"] },
    catalogue: raw,
    language: "en",
    current: "m2",
  });
  assert(
    wrong !== "f2",
    "this asserts the BUG still exists for un-normalised labels — if it now passes, casting stopped using ===, and normalising at the provider may be redundant"
  );

  // Pinning ends casting entirely: once somebody picks a voice by hand, the
  // director does not get to overrule them.
  assert(
    castVoice({
      brief: { gender: "masculine" },
      catalogue,
      language: "en",
      current: "f1",
      pinned: true,
    }) === "f1",
    "a pinned voice must survive casting"
  );
  console.log("✓ casting honours gender, and one pinned by hand");
}

/* -------------------------------- language ---------------------------------- */

{
  const hindi: VoiceInfo = { id: "h", name: "Rahul", language: "hi-IN" };
  assert(speaksLanguage(hindi, "hi"), "hi-IN speaks hi");
  assert(!speaksLanguage(hindi, "en"), "hi-IN does not speak en");
  const multi: VoiceInfo = { id: "m", name: "Multi", languages: ["en-US", "fr"] };
  assert(speaksLanguage(multi, "en"), "a languages array is honoured");
  console.log("✓ language matching is by base tag");
}

console.log("\nvoice engines: all checks passed");
