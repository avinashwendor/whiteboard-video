/**
 * Does every catalogue and generator this deployment claims actually answer?
 *
 * `npm run probe:media`
 *
 * A key that is present but wrong, expired or on the wrong plan looks exactly
 * like a key that is absent from inside the app: `providersFor` comes back
 * empty, the agent is told the capability is unavailable, and it quietly plans
 * something else. That is the correct behaviour and it is indistinguishable
 * from a typo in `.env.local`, so this asks each provider a real question and
 * prints what came back.
 *
 * Costs a few small requests, one of which generates about a second of audio.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { providersFor } = await import("../src/lib/media/registry.js");
const { ttsProviders } = await import("../src/lib/ai/tts.js");

console.log("CATALOGUES CONFIGURED");
for (const kind of ["music", "sfx", "image", "gif", "video"] as const) {
  const ids = providersFor(kind).map((p) => p.id);
  console.log(`  ${kind.padEnd(6)} ${ids.join(", ") || "— none —"}`);
}

console.log("\nVOICE ENGINES");
for (const p of ttsProviders()) {
  console.log(`  ${p.id.padEnd(11)} ${p.configured ? "configured" : "— no key —"}`);
}

console.log("\nDO THEY ANSWER?");

async function check(label: string, run: () => Promise<string>) {
  const started = Date.now();
  try {
    const answer = await run();
    console.log(`  ✓ ${label.padEnd(22)} ${answer}  (${Date.now() - started}ms)`);
  } catch (err) {
    console.log(`  ✗ ${label.padEnd(22)} ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

const { pexels } = await import("../src/lib/media/pexels.js");
await check("pexels · video", async () => {
  const hits = await pexels.search({ query: "city traffic at night", kind: "video", limit: 3 });
  if (!hits.length) throw new Error("no clips came back");
  return `${hits.length} clips, first is ${hits[0].title}, ${hits[0].licence.name}`;
});

const { freesound } = await import("../src/lib/media/freesound.js");
await check("freesound · sfx", async () => {
  const hits = await freesound.search({ query: "whoosh transition", kind: "sfx", limit: 3 });
  if (!hits.length) throw new Error("no effects came back");
  return `${hits.length} results, first is “${hits[0].title.slice(0, 30)}”`;
});

const { openverse } = await import("../src/lib/media/openverse.js");
await check("openverse · music", async () => {
  const hits = await openverse.search({ query: "calm piano", kind: "music", limit: 3 });
  if (!hits.length) throw new Error("no tracks came back");
  return `${hits.length} results`;
});

const { generateSfx, generateMusic, elevenlabs } = await import("../src/lib/ai/elevenlabs.js");
await check("elevenlabs · sfx gen", async () => {
  const made = await generateSfx("short whoosh transition", 1.5);
  if (made.bytes.byteLength < 1000) throw new Error("came back empty");
  return `${Math.round(made.bytes.byteLength / 1024)}KB of ${made.contentType}`;
});

if (process.env.PROBE_MUSIC === "1") {
  await check("elevenlabs · music gen", async () => {
    const made = await generateMusic("calm ambient piano bed", 10);
    return `${Math.round(made.bytes.byteLength / 1024)}KB of ${made.contentType}`;
  });
} else {
  console.log("  · elevenlabs · music gen  skipped (PROBE_MUSIC=1 to include — it is the slow one)");
}

await check("elevenlabs · speech", async () => {
  const out = await elevenlabs.generateSpeech({
    transcript: "We shipped it three times faster.",
    voiceId: "",
  });
  // The word timings are the whole reason to prefer this over a cheaper
  // engine, so a run that produces audio without them is a half-pass.
  if (!out.words?.length) throw new Error("audio but NO word timings");
  return `${Math.round(out.audio.byteLength / 1024)}KB, ${out.words.length} word timings, ends ${out.words[out.words.length - 1].end.toFixed(2)}s`;
});
