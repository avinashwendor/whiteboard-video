/**
 * Will the model behind Omega take a picture?
 *
 * `npm run probe:vision [model]`
 *
 * The editor attaches a few frames to every planning request. When the
 * provider refuses them the harness strips them, says so, and plans from the
 * transcript — which is a real degradation and shows up in the panel as "the
 * model would not take the frames". This asks the question directly so the
 * refusal can be read rather than inferred.
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const ROOT = (process.env.OMEGA_BASE_URL ?? "https://api.omegaplusapi.com").replace(/\/+$/, "");
const KEY = process.env.OMEGA_API_KEY!;
// A 1x1 red PNG — the smallest thing that is unambiguously an image.
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function ask(label: string, payload: unknown) {
  const started = Date.now();
  for (const base of [`${ROOT}/v1`, ROOT]) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      if (res.ok) {
        console.log(`  ✓ ${label.padEnd(34)} ${res.status}  (${secs}s)`);
      } else {
        console.log(`  ✗ ${label.padEnd(34)} ${res.status}  ${text.slice(0, 220).replace(/\s+/g, " ")}`);
      }
      return res.ok;
    } catch (e) {
      if (base === ROOT) console.log(`  ✗ ${label.padEnd(34)} ${String(e).slice(0, 80)}`);
    }
  }
  return false;
}

const model = process.argv[2] ?? process.env.OMEGA_MODEL ?? "claude-opus-4-8";
console.log(`Asking ${ROOT} as model "${model}"\n`);

await ask("text only", {
  model,
  messages: [{ role: "user", content: "Reply with the single word: ok" }],
  max_tokens: 16,
});

await ask("image, detail:low", {
  model,
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "What colour is this? One word." },
      { type: "image_url", image_url: { url: PIXEL, detail: "low" } },
    ],
  }],
  max_tokens: 16,
});

await ask("image, no detail field", {
  model,
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "What colour is this? One word." },
      { type: "image_url", image_url: { url: PIXEL } },
    ],
  }],
  max_tokens: 16,
});

await ask("image + response_format json", {
  model,
  messages: [{
    role: "user",
    content: [
      { type: "text", text: 'Reply {"c":"<colour>"}' },
      { type: "image_url", image_url: { url: PIXEL, detail: "low" } },
    ],
  }],
  max_tokens: 32,
  response_format: { type: "json_object" },
});

await ask("text + response_format json", {
  model,
  messages: [{ role: "user", content: 'Reply {"c":"red"}' }],
  max_tokens: 32,
  response_format: { type: "json_object" },
});

const B64 = PIXEL.split(",")[1];

// Anthropic's own content-block shape. Omega routes to `claude-*` ids and its
// *responses* already come back as Anthropic blocks, so it is worth asking
// whether the request side speaks the same dialect.
await ask("anthropic image block", {
  model,
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "What colour is this? One word." },
      { type: "image", source: { type: "base64", media_type: "image/png", data: B64 } },
    ],
  }],
  max_tokens: 16,
});

// A hosted URL rather than a data URI, in case only inline data is refused.
await ask("image_url, http url", {
  model,
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "What is in this image? Five words." },
      { type: "image_url", image_url: { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/120px-PNG_transparency_demonstration_1.png" } },
    ],
  }],
  max_tokens: 24,
});

// Plain string content with the parts flattened, which some proxies want.
await ask("content as plain string", {
  model,
  messages: [{ role: "user", content: "Reply with the single word: ok" }],
  max_tokens: 16,
});
