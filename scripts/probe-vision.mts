/**
 * Does the text provider accept an image part?
 *
 * The edit agent attaches frames of the cut ("glances") as `image_url` content
 * when the browser can grab them. The agent probe never sends any — it has no
 * video — which is why a plan that works there can still fail from the editor.
 *
 * Sends the same request twice, once text-only and once with a 1x1 PNG, so the
 * difference is only the image part.
 *
 * `npx tsx scripts/probe-vision.mts`
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}

const { omega, defaultModel } = await import("../src/lib/ai/omega.js");

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const model = await defaultModel();
console.log("model:", model, "\n");

async function attempt(label: string, content: unknown) {
  try {
    const res = await omega.generateText({
      model,
      maxTokens: 32,
      messages: [{ role: "user", content }] as never,
    });
    console.log(`${label}: OK -> ${res.text.slice(0, 60).replace(/\n/g, " ")}`);
  } catch (err) {
    const e = err as { code?: string; detail?: string; message?: string };
    console.log(`${label}: FAILED [${e.code ?? "?"}] ${(e.detail ?? e.message ?? "").slice(0, 160)}`);
  }
}

await attempt("text only     ", "Reply with the single word: fine.");
await attempt("text + image  ", [
  { type: "text", text: "Reply with the single word: fine." },
  { type: "image_url", image_url: { url: PNG, detail: "low" } },
]);
