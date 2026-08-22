import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// Rescript's telemetry/crash reporting stamps the build version, so the client
// needs it at build time. Read from package.json rather than duplicating it in
// a constant that `npm version` would silently leave stale.
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

const nextConfig: NextConfig = {
  // Inlined into the client bundle at build time.
  env: { NEXT_PUBLIC_APP_VERSION: version },
  // parakeet.js ships as raw ESM from src/; timeline/CFB helpers ship modern
  // syntax. Transpile all three for the Next bundler.
  transpilePackages: ["@chatoctopus/timeline", "cfb", "parakeet.js"],
  async headers() {
    // SharedArrayBuffer (required by ffmpeg.wasm multi-threading and
    // onnxruntime multi-threading) is only available in cross-origin-isolated
    // contexts. It has to be "require-corp" rather than the laxer
    // "credentialless": WebKit never shipped credentialless and treats it as
    // unsafe-none, which leaves Safari users staring at "This browser can't run
    // the editor".
    //
    // Upstream applies this to `/(.*)` because Rescript is the whole app. Here
    // it is scoped to the /rescript route: the Chalkline studio pulls images
    // from Pollinations/Tavily, and cross-origin isolation would block every
    // one of them (they send no Cross-Origin-Resource-Policy). Isolation is a
    // per-document property, so scoping it this way still gives the editor
    // document everything it needs — its own wasm and workers are same-origin,
    // and model downloads are CORS-mode fetches, which COEP allows regardless.
    const isolation = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
    ];
    // A dedicated worker created from a cross-origin-isolated document
    // inherits that isolation, and the browser refuses to start it unless the
    // *worker script's own response* also carries COEP — even when the script
    // is same-origin. That is not obvious and it fails silently: the Worker
    // constructor succeeds, an empty `error` event fires, and ffmpeg.wasm's
    // load() simply never settles. So the editor's worker payloads get the
    // header too. It is inert on ordinary subresources, which is why this can
    // be applied to /_next without making the Chalkline pages isolated.
    const workerScripts = [
      { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    ];
    return [
      { source: "/rescript", headers: isolation },
      { source: "/rescript/:path*", headers: isolation },
      // ffmpeg.wasm's core, its pthread worker, and the onnxruntime binaries.
      { source: "/vendor/:path*", headers: workerScripts },
      // The bundled transcription worker, emitted here by the compiler.
      { source: "/_next/:path*", headers: workerScripts },
    ];
  },
};

export default nextConfig;
