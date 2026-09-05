/**
 * Does the model bucket actually serve the weights?
 *
 * The route that streams them (src/app/models/[...path]/route.ts) never runs in
 * development — public/models/ shadows it — so a broken bucket, a rotated key,
 * or a half-finished upload is invisible until production tries to transcribe.
 * This calls the route directly with the credentials from the environment.
 *
 *   railway run npx tsx scripts/probe-models.mts
 *
 * `railway run` is what supplies MODEL_BUCKET_*; without them the route 404s,
 * which is the same "not installed" the UI shows, and this reports it as such.
 */
import { GET, HEAD } from "../src/app/models/[...path]/route";

const MODEL = process.argv[2] ?? "whisper-telugu-small";

const params = (path: string[]) => ({ params: Promise.resolve({ path }) });
const request = (headers?: HeadersInit) => new Request("http://probe/", { headers });

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label.padEnd(26)} ${detail}`);
  if (!ok) failures++;
}

if (!process.env.MODEL_BUCKET_NAME) {
  console.error("MODEL_BUCKET_* is unset — run this under `railway run`.");
  process.exit(1);
}

// The HEAD probe localModelPresent() makes before offering the model at all.
const head = await HEAD(request(), params([MODEL, "config.json"]));
check("HEAD config.json", head.status === 200, `${head.status} ${head.headers.get("content-length")}B`);

const config = await GET(request(), params([MODEL, "config.json"]));
const text = config.status === 200 ? await config.text() : "";
check("GET config.json", text.includes("\"model_type\""), `${config.status}, ${text.length}B`);
check("immutable caching", (config.headers.get("cache-control") ?? "").includes("immutable"), config.headers.get("cache-control") ?? "(none)");

// onnxruntime pulls the decoder in ranges rather than whole, every session.
const range = await GET(request({ range: "bytes=0-15" }), params([MODEL, "onnx", "decoder_model_merged_q4.onnx"]));
const bytes = range.status === 206 ? (await range.arrayBuffer()).byteLength : -1;
check("range request", range.status === 206 && bytes === 16, `${range.status} ${range.headers.get("content-range")}`);

check("missing object 404s", (await GET(request(), params([MODEL, "nope.json"]))).status === 404, "");
check("traversal refused", (await GET(request(), params(["..", "secret"]))).status === 404, "");

console.log(failures === 0 ? "\nALL MODEL BUCKET CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
