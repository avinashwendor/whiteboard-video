/**
 * Serve the locally-exported ONNX speech models in production.
 *
 * In development the weights sit in public/models/, and Next's static handler
 * answers /models/* before this route ever runs. They are gitignored — the
 * Telugu export alone is 315 MB, and its decoder is 260 MB, past what GitHub
 * accepts in a repository at all — so a deployment built from the repository
 * has an empty public/models/ and every request falls through to here.
 *
 * The weights therefore live in object storage, and this streams them back on
 * the app's own origin. Same-origin is the point: it means the model id in
 * MODELS stays a plain path, `localModelPresent` keeps probing the same URL,
 * the editor's cross-origin isolation has nothing to negotiate, and the bucket
 * stays private with its keys server-side.
 *
 * With no bucket configured this 404s, which is exactly what the transcription
 * UI already reads as "not installed" — the model row disables itself instead
 * of failing after the user picks it and waits.
 */
import { AwsClient } from "aws4fetch";

/** Weights never change under a given id, so cache them as hard as possible. */
const IMMUTABLE = "public, max-age=31536000, immutable";

interface Bucket {
  client: AwsClient;
  origin: string;
}

let cached: Bucket | null | undefined;

function bucket(): Bucket | null {
  if (cached !== undefined) return cached;

  const endpoint = process.env.MODEL_BUCKET_ENDPOINT;
  const name = process.env.MODEL_BUCKET_NAME;
  const accessKeyId = process.env.MODEL_BUCKET_ACCESS_KEY_ID;
  const secretAccessKey = process.env.MODEL_BUCKET_SECRET_ACCESS_KEY;

  if (!endpoint || !name || !accessKeyId || !secretAccessKey) {
    cached = null;
    return cached;
  }

  // Virtual-host style: the bucket is a subdomain of the endpoint. Tigris (what
  // Railway's buckets are) rejects path style for signed requests.
  const url = new URL(endpoint);
  url.hostname = `${name}.${url.hostname}`;

  cached = {
    client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }),
    origin: url.origin,
  };
  return cached;
}

/**
 * A request for a file inside a model directory, or null if it is anything
 * else. Rejects traversal and empty segments rather than trusting the router to
 * have normalised them.
 */
function objectKey(segments: string[]): string | null {
  if (segments.length < 2) return null;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return null;
  }
  return segments.join("/");
}

async function serve(request: Request, segments: string[], body: boolean) {
  const store = bucket();
  const key = objectKey(segments);
  if (!store || !key) return new Response(null, { status: 404 });

  // Pass the conditional and range headers through: onnxruntime asks for byte
  // ranges of a 260 MB decoder rather than pulling it whole every time.
  const forwarded = new Headers();
  for (const header of ["range", "if-none-match", "if-modified-since"]) {
    const value = request.headers.get(header);
    if (value) forwarded.set(header, value);
  }

  const upstream = await store.client.fetch(
    `${store.origin}/${key.split("/").map(encodeURIComponent).join("/")}`,
    { method: body ? "GET" : "HEAD", headers: forwarded }
  );

  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
    // Don't leak the storage error; absent is the only distinction that matters.
    return new Response(null, { status: upstream.status === 404 ? 404 : 502 });
  }

  const headers = new Headers({
    "cache-control": IMMUTABLE,
    // Same-origin already, but the editor document is cross-origin isolated and
    // stating it costs nothing.
    "cross-origin-resource-policy": "same-origin",
    "accept-ranges": "bytes",
  });
  for (const header of ["content-type", "content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }
  if (key.endsWith(".json")) headers.set("content-type", "application/json");
  if (key.endsWith(".onnx")) headers.set("content-type", "application/octet-stream");

  return new Response(body && upstream.status !== 304 ? upstream.body : null, {
    status: upstream.status,
    headers,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return serve(request, (await params).path, true);
}

export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return serve(request, (await params).path, false);
}
