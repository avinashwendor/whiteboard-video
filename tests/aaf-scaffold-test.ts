/**
 * The AAF scaffold and the constant that rewrites it must agree.
 *
 * `patchAaf` does not build an AAF file — it opens a pre-built one and
 * overwrites a reserved placeholder with the real media name. That placeholder
 * is a fixed-width UTF-16 field baked into a 500 KB structured-storage binary,
 * so the source constant and the committed bytes are two halves of one
 * contract, and nothing in the type system connects them.
 *
 * Both ways of breaking it are silent. Rename the constant and the exporter
 * searches for a string the scaffold does not contain — the export succeeds and
 * produces an AAF pointing at a placeholder no NLE can resolve. Change the
 * width and the substitution runs off the end of the field, corrupting the
 * stream around it while the file still opens.
 *
 * So this checks the scaffold the way the exporter reads it — parsed as CFB,
 * looking inside the streams — rather than grepping the raw file, because a
 * byte-level edit that broke the container would still leave the string findable
 * in the bytes.
 *
 * Run with `npx tsx tests/aaf-scaffold-test.ts`.
 */

import { readFileSync } from "node:fs";
import * as CFB from "cfb";
import { AAF_MAX_CLIPS, fitAafMediaName } from "../src/motionscript/lib/aaf/patchAaf";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/**
 * The placeholder, restated rather than imported.
 *
 * `patchAaf` keeps `MARKER_NAME` private, and exporting it so a test can read
 * it would make the test agree with the source by construction — which is the
 * one thing it must not do. Stating it here means a rename has to be made in
 * both places deliberately.
 */
const MARKER_NAME = "MOTIONSCRIPT_MEDIA_PLCHLDR";
const MARKER_WIDTH = 26;

function utf16(value: string): Buffer {
  return Buffer.from(value, "utf16le");
}

function countIn(haystack: Buffer, needle: Buffer): number {
  let found = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    found += 1;
    at = haystack.indexOf(needle, at + 1);
  }
  return found;
}

/* ------------------------------- the width -------------------------------- */

{
  assert(
    MARKER_NAME.length === MARKER_WIDTH,
    `the marker is ${MARKER_NAME.length} characters; the scaffold reserves ${MARKER_WIDTH}`
  );

  // `fitAafMediaName` is the function that has to respect the reservation, and
  // it is the one place a too-long filename could overrun the field.
  assert(
    fitAafMediaName("short.mov").length === MARKER_WIDTH,
    "a short name is padded to the reserved width"
  );
  assert(
    fitAafMediaName("a-very-long-recording-name-that-runs-on.mov").length === MARKER_WIDTH,
    "a long name is truncated to it"
  );
  assert(
    fitAafMediaName("a-very-long-recording-name-that-runs-on.mov").endsWith(".mov"),
    "and keeps its extension, or the NLE cannot guess the format"
  );
  assert(fitAafMediaName("").length === MARKER_WIDTH, "an empty name still fills the field");
  console.log(`✓ every fitted name is exactly ${MARKER_WIDTH} characters`);
}

/* ------------------------------ the scaffold ------------------------------- */

// Both copies: the committed source of truth, and the one copy-assets.mjs
// publishes for the browser to fetch. They drift if a patch touches one only.
for (const path of ["assets/aaf/scaffold.aaf", "public/vendor/aaf/scaffold.aaf"]) {
  const bytes = readFileSync(path);
  const container = CFB.read(bytes, { type: "buffer" });
  assert(container.FileIndex.length > 0, `${path} parsed to an empty container`);

  let inStreams = 0;
  let asUrl = 0;
  for (const entry of container.FileIndex) {
    if (!entry.content) continue;
    const buf = Buffer.from(entry.content as Uint8Array);
    inStreams += countIn(buf, utf16(MARKER_NAME));
    asUrl += countIn(buf, utf16(`file:///${MARKER_NAME}`));
  }

  assert(
    inStreams > 0,
    `${path} contains no ${MARKER_NAME} — the exporter would rewrite nothing`
  );
  assert(asUrl > 0, `${path} has no file:/// locator holding the marker`);
  console.log(
    `✓ ${path}: ${container.FileIndex.length} CFB entries, marker in ${inStreams} stream(s), ${asUrl} locator(s)`
  );
}

/* ------------------------------- the clip cap ------------------------------ */

{
  // The scaffold reserves a fixed number of clip slots; the constant that tells
  // the exporter how many to fill has to match what was generated.
  assert(AAF_MAX_CLIPS === 64, `AAF_MAX_CLIPS is ${AAF_MAX_CLIPS}, the scaffold was built for 64`);
  console.log("✓ the clip cap matches the generated scaffold");
}

console.log("\naaf scaffold: all checks passed");
