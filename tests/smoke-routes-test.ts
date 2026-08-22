/**
 * Route smoke test.
 *
 * Not a substitute for clicking through the studio, but it catches the class
 * of failure that actually bit us during this cycle: a page that throws on
 * render because something it indexes into has gone away. Retiring the
 * storyboard mode took the History page down exactly that way, and nothing
 * told us until a human opened it.
 *
 * Run against a dev or preview server:
 *   npx tsx tests/smoke-routes-test.ts
 *   BASE=http://localhost:3000 npx tsx tests/smoke-routes-test.ts
 */

const BASE = process.env.BASE ?? "http://localhost:3000";

interface Check {
  path: string;
  /** Fragments that must appear in the HTML. */
  expect?: string[];
  /** Fragments that must not. */
  reject?: string[];
}

const ROUTES: Check[] = [
  {
    path: "/",
    expect: ["IDEAS INTO MOTION", "Production modes", "Pricing", "motionhouse"],
    reject: ["Storyboard"],
  },
  { path: "/new", expect: ["Motionhouse"] },
  { path: "/upload", expect: ["Start with footage", "Drop a video here"] },
  { path: "/history", expect: ["History"] },
  { path: "/signin", expect: ["waitlist"] },
  { path: "/rescript", expect: ["<!DOCTYPE html>"] },
];

const API: Check[] = [{ path: "/api/capabilities" }, { path: "/api/models" }];

let failures = 0;

function fail(where: string, why: string) {
  failures += 1;
  console.error(`  FAIL  ${where} — ${why}`);
}

async function checkRoute({ path, expect = [], reject = [] }: Check) {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { redirect: "follow" });
  } catch (err) {
    fail(path, `unreachable: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (!res.ok) {
    fail(path, `HTTP ${res.status}`);
    return;
  }

  const html = await res.text();

  // Next renders its error overlay into the page rather than a 500, so a
  // status check alone would pass a route that is visibly broken.
  for (const marker of ["Application error", "This page couldn’t load", "__next_error__"]) {
    if (html.includes(marker)) {
      fail(path, `rendered an error page (${marker})`);
      return;
    }
  }

  for (const needle of expect) {
    if (!html.includes(needle)) fail(path, `missing ${JSON.stringify(needle)}`);
  }
  for (const needle of reject) {
    if (html.includes(needle)) fail(path, `should not contain ${JSON.stringify(needle)}`);
  }

  if (!failures) console.log(`  ok    ${path}`);
}

async function checkApi({ path }: Check) {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) return fail(path, `HTTP ${res.status}`);
    await res.json();
    console.log(`  ok    ${path}`);
  } catch (err) {
    fail(path, err instanceof Error ? err.message : String(err));
  }
}

async function main() {
  console.log(`Smoke test against ${BASE}`);

  console.log("\nPages");
  for (const route of ROUTES) await checkRoute(route);

  console.log("\nAPI");
  for (const route of API) await checkApi(route);

  if (failures) {
    console.error(`\n${failures} failure${failures === 1 ? "" : "s"}`);
    process.exit(1);
  }
  console.log("\nAll routes render.");
}

void main();
