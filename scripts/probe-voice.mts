/**
 * Can the studio actually narrate with each engine?
 *
 * `npm run probe:voice`
 *
 * The studio picks a voice from a live catalogue and then asks the TTS route to
 * speak with it. Those are two calls to two different places, and the failure
 * that matters is the one between them: the engines share no voice ids, so a
 * voice chosen from one catalogue and spoken by another resolves to that
 * engine's default and the narration comes back in the wrong voice — with a
 * 200, and nothing in any log.
 *
 * So this walks the real chain per engine: list the catalogue, cast a voice out
 * of it the way the studio does, speak one line with it, and check that what
 * came back is the engine and the voice that were asked for.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { ttsProviders, resolveTts } = await import("../src/lib/ai/tts.js");
const { castVoice } = await import("../src/lib/studio/casting.js");
const { ttsRequestSchema } = await import("../src/lib/validation/schemas.js");

const LINE = "We shipped it three times faster than last year.";

for (const { id, label, configured } of ttsProviders()) {
  if (!configured) {
    console.log(`✗ ${label.padEnd(11)} no key — skipped`);
    continue;
  }

  // The schema is the first thing that can refuse an engine by name, and it
  // did: it was a hardcoded pair and rejected the third one.
  const parsed = ttsRequestSchema.safeParse({
    provider: id,
    transcript: LINE,
    voiceId: "placeholder",
  });
  if (!parsed.success) {
    console.log(`✗ ${label.padEnd(11)} the request schema rejects "${id}"`);
    process.exitCode = 1;
    continue;
  }

  const engine = resolveTts(id);
  if (engine.id !== id) {
    console.log(`✗ ${label.padEnd(11)} asked for "${id}", resolved to "${engine.id}"`);
    process.exitCode = 1;
    continue;
  }

  const catalogue = await engine.listVoices();
  if (!catalogue.length) {
    console.log(`✗ ${label.padEnd(11)} empty voice catalogue`);
    process.exitCode = 1;
    continue;
  }

  // Cast the way the studio does, from a brief rather than by naming an id.
  const voiceId = castVoice({
    brief: { gender: "feminine", qualities: ["warm", "clear"] },
    catalogue,
    language: "en",
    current: catalogue[0].id,
  });
  const cast = catalogue.find((v) => v.id === voiceId);

  const started = Date.now();
  const out = await engine.generateSpeech({ transcript: LINE, voiceId });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  const wrongEngine = out.provider !== id;
  const wrongVoice = out.voiceId !== voiceId;
  const mark = wrongEngine || wrongVoice ? "✗" : "✓";
  if (wrongEngine || wrongVoice) process.exitCode = 1;

  console.log(
    `${mark} ${label.padEnd(11)} ${String(catalogue.length).padStart(4)} voices | cast "${(cast?.name ?? voiceId).slice(0, 18)}" | ` +
      `${Math.round(out.audio.byteLength / 1024)}KB ${out.contentType.replace("audio/", "")} | ` +
      `${out.words?.length ?? 0} word timings | ${secs}s` +
      (wrongEngine ? `  ← ANSWERED AS ${out.provider}` : "") +
      (wrongVoice ? `  ← SPOKE AS ${out.voiceId}` : "")
  );
}
