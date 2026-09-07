/**
 * The one place Omega is not OpenAI-shaped.
 *
 * Everything else about this provider is the OpenAI dialect — the path, the
 * auth header, `response_format`, streaming — so the whole codebase carries
 * `image_url` parts and nothing translated them. Probed directly against the
 * live API: an identical request answers 200 as text and 400 `invalid_request`
 * the moment an `image_url` part is attached, with an error naming no
 * parameter. The same picture as an Anthropic `{type:"image", source:{…}}`
 * block answers 200 and the model describes it correctly.
 *
 * The cost of getting this wrong was invisible in a build and loud in the app:
 * every planning request had its frames refused, the harness stripped them and
 * carried on from the transcript, and the panel said "the model would not take
 * the frames" on every single edit. The agent has a whole vision layer and it
 * was never once given a picture.
 *
 * Run with `npx tsx tests/omega-vision-test.ts`.
 */

import { toProviderContent } from "../src/lib/ai/omega";
import type { ChatMessage } from "../src/lib/ai/types";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

/* -------------------------------- plain text -------------------------------- */

{
  assert(
    toProviderContent("hello") === "hello",
    "a plain string message must pass through untouched"
  );
  console.log("✓ string content is left alone");
}

/* ------------------------------ the translation ----------------------------- */

{
  const content: ChatMessage["content"] = [
    { type: "text", text: "what is this" },
    { type: "image_url", image_url: { url: JPEG, detail: "low" } },
  ];
  const out = toProviderContent(content) as Array<Record<string, unknown>>;

  assert(Array.isArray(out) && out.length === 2, `expected 2 parts, got ${JSON.stringify(out)}`);
  assert(out[0].type === "text", "the text part keeps its shape");

  const image = out[1] as { type: string; source?: Record<string, string> };
  assert(image.type === "image", `image part is "${image.type}", not "image" — Omega rejects image_url`);
  assert(image.source?.type === "base64", "the source must declare base64");
  assert(
    image.source?.media_type === "image/jpeg",
    `media_type came out as "${image.source?.media_type}"`
  );
  assert(
    image.source?.data === "/9j/4AAQSkZJRg==",
    "the payload must be the bare base64, with the data: prefix stripped"
  );
  assert(
    !JSON.stringify(out).includes("image_url"),
    "no image_url may survive into the request — that is the exact 400"
  );
  assert(
    !JSON.stringify(out).includes("detail"),
    "the OpenAI-only detail hint must not be forwarded"
  );
  console.log("✓ an image_url part becomes an Anthropic image block");
}

/* --------------------------------- png too ---------------------------------- */

{
  const out = toProviderContent([
    { type: "image_url", image_url: { url: PNG } },
  ]) as Array<{ source?: Record<string, string> }>;
  assert(out[0].source?.media_type === "image/png", "the media type comes from the data URI");
  console.log("✓ the media type is read from the URI, not assumed");
}

/* ------------------------------ what cannot go ------------------------------ */

{
  // A hosted URL is refused by Omega in either dialect, so sending it just
  // buys a 400. Dropping it leaves the text part, which already says what the
  // picture was.
  const out = toProviderContent([
    { type: "text", text: "a frame at 3.0s" },
    { type: "image_url", image_url: { url: "https://example.com/frame.jpg" } },
  ]) as unknown[];
  assert(out.length === 1, "a hosted URL is dropped rather than sent to be rejected");

  const malformed = toProviderContent([
    { type: "image_url", image_url: { url: "data:image/jpeg,notbase64" } },
  ]) as unknown[];
  assert(malformed.length === 0, "a data URI that is not base64 is dropped");

  const empty = toProviderContent([
    { type: "text", text: "only words" },
  ]) as unknown[];
  assert(empty.length === 1, "a message with no images is unchanged in length");
  console.log("✓ anything Omega would reject is dropped, not forwarded");
}

/* -------------------------------- many frames ------------------------------- */

{
  // The editor attaches three at once; order has to survive, because the text
  // beside them names each frame's timestamp in order.
  const parts: ChatMessage["content"] = [
    { type: "text", text: "frames" },
    { type: "image_url", image_url: { url: JPEG } },
    { type: "image_url", image_url: { url: PNG } },
    { type: "image_url", image_url: { url: JPEG } },
  ];
  const out = toProviderContent(parts) as Array<{ type: string; source?: { media_type?: string } }>;
  assert(out.length === 4, `all four parts survive, got ${out.length}`);
  assert(
    out.map((p) => p.source?.media_type).join(",") === ",image/jpeg,image/png,image/jpeg",
    "the frames keep their order — the prose beside them is ordered too"
  );
  console.log("✓ several frames keep their order");
}

console.log("\nomega vision: all checks passed");
