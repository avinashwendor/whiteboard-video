/**
 * The eval harness.
 *
 * "Did that prompt edit help?" had no answer. The only way to find out was to
 * open the editor, type something, and form an impression — which is not a
 * method, and which is why a prompt change that quietly regressed three cases
 * looked exactly like one that fixed two.
 *
 * This runs the real planner against fixed synthetic projects and scores what
 * comes back three ways:
 *
 *   1. **`verifyPlan`** — already exists, already simulates a plan against a
 *      world, and is the only deterministic grader worth having. It was built
 *      to catch a model's mistakes before they run; it turns out to be a
 *      ready-made scorer, so it is used rather than reimplemented.
 *   2. **The craft rules** (`overlay/craft.ts`) — the checkable half of the
 *      style guide the prompt already states in prose.
 *   3. **Shape expectations** — which operations a competent answer must reach
 *      for, per fixture. Deliberately about kinds and not arguments: asserting
 *      the numbers a model picks makes the suite fail on answers that are
 *      merely different, which is how a harness stops being run.
 *
 * There is no LLM judge. One would add coverage of the subjective half and a
 * second source of nondeterminism, and until the deterministic rules stop
 * finding things it is not where the next finding comes from.
 *
 *   npm run eval                 # every fixture
 *   npm run eval -- tidy-up      # one
 *   npm run eval -- --save       # write the result as the new baseline
 *
 * ⚠️ Every run costs real Omega requests — one per fixture, sometimes more if
 * the agent needs a look. It is not a pre-commit hook.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { planRescriptEdit } from "../src/lib/ai/rescript-agent";
import { PROMPT_VERSION } from "../src/lib/ai/prompt-version";
import { checkCraft, craftScore } from "../src/rescript/lib/overlay/craft";
import { verifyPlan, type PlanWorld } from "../src/rescript/lib/overlay/verify";
import type { AgentOp } from "../src/rescript/lib/overlay/ops-schema";

interface Fixture {
  name: string;
  instruction: string;
  duration: number;
  boundaryCount: number;
  transcript: string;
  expect: {
    ops?: string[];
    forbid?: string[];
    maxSteps?: number;
    note?: string;
  };
}

interface Result {
  name: string;
  ok: boolean;
  score: number;
  steps: number;
  problems: string[];
  craft: string[];
  missing: string[];
  forbidden: string[];
  error?: string;
}

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES = path.join(HERE, "fixtures");
const BASELINE = path.join(HERE, "baseline.json");

function loadFixtures(filter: string | null): Fixture[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(FIXTURES, f), "utf8")) as Fixture)
    .filter((f) => !filter || f.name === filter)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function worldFor(fixture: Fixture): PlanWorld {
  return {
    duration: fixture.duration,
    boundaryCount: fixture.boundaryCount,
    elementCount: 0,
    subtitlesOn: false,
    subtitlePosition: "bottom",
    transcript: fixture.transcript,
    // Both on, so a fixture never fails because a key is missing from the
    // environment rather than because the plan was wrong.
    can: { generateImage: true, photoSearch: true },
  };
}

async function runOne(fixture: Fixture): Promise<Result> {
  const base: Result = {
    name: fixture.name,
    ok: false,
    score: 0,
    steps: 0,
    problems: [],
    craft: [],
    missing: [],
    forbidden: [],
  };

  let ops: AgentOp[] = [];
  let steps = 0;

  try {
    const plan = await planRescriptEdit({
      instruction: fixture.instruction,
      mode: "propose",
      context: {
        duration: fixture.duration,
        elements: [],
        subtitles: { enabled: false, cueCount: 0, position: "bottom" },
        transitions: [],
        boundaries: Array.from({ length: fixture.boundaryCount }, (_, i) => ({
          number: i + 1,
          at: ((i + 1) * fixture.duration) / (fixture.boundaryCount + 1),
        })),
        transcript: fixture.transcript,
        aspect: 16 / 9,
        // Where the playhead happens to be is not part of what a fixture is
        // testing, so it is pinned rather than varied — an operation that
        // defaults to "here" must land in the same place on every run or the
        // score moves for a reason nobody changed.
        playhead: 0,
        can: { generateImage: true, photoSearch: true },
      },
    });

    steps = plan.steps?.length ?? 0;
    ops = plan.steps?.flatMap((s) => s.ops) ?? plan.ops ?? [];
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }

  const problems = verifyPlan(ops, worldFor(fixture));
  const craft = checkCraft(ops, { duration: fixture.duration });

  const kinds = new Set(ops.map((op) => op.op));
  const missing = (fixture.expect.ops ?? []).filter((op) => !kinds.has(op as AgentOp["op"]));
  const forbidden = (fixture.expect.forbid ?? []).filter((op) =>
    kinds.has(op as AgentOp["op"])
  );

  const overLong =
    fixture.expect.maxSteps !== undefined && steps > fixture.expect.maxSteps;

  // One number, so runs can be compared. The weights say what is worth what:
  // a plan that would not run is worth less than one that runs and is ugly.
  let score = craftScore(craft);
  score -= problems.length * 0.2;
  score -= missing.length * 0.3;
  score -= forbidden.length * 0.3;
  if (overLong) score -= 0.1;
  score = Math.max(0, Math.min(1, score));

  return {
    name: fixture.name,
    ok:
      problems.length === 0 &&
      missing.length === 0 &&
      forbidden.length === 0 &&
      craft.every((c) => c.severity !== "error"),
    score,
    steps,
    problems,
    craft: craft.map((c) => `${c.severity === "error" ? "✗" : "!"} ${c.rule}: ${c.message}`),
    missing,
    forbidden,
  };
}

function compare(now: Result[], before: { results: Result[] } | null) {
  if (!before) return;
  const previous = new Map(before.results.map((r) => [r.name, r]));
  console.log("\nAgainst the baseline:");
  for (const result of now) {
    const was = previous.get(result.name);
    if (!was) {
      console.log(`  ${result.name}: new`);
      continue;
    }
    const delta = result.score - was.score;
    if (Math.abs(delta) < 0.001) {
      console.log(`  ${result.name}: unchanged (${result.score.toFixed(2)})`);
    } else {
      const arrow = delta > 0 ? "▲" : "▼";
      console.log(
        `  ${result.name}: ${arrow} ${was.score.toFixed(2)} → ${result.score.toFixed(2)}`
      );
    }
  }
  const gone = before.results.filter((r) => !now.some((n) => n.name === r.name));
  for (const r of gone) console.log(`  ${r.name}: no longer run`);
}

async function main() {
  const args = process.argv.slice(2);
  const save = args.includes("--save");
  const filter = args.find((a) => !a.startsWith("--")) ?? null;

  const fixtures = loadFixtures(filter);
  if (fixtures.length === 0) {
    console.error(filter ? `No fixture called "${filter}".` : "No fixtures.");
    process.exit(1);
  }

  console.log(`prompt ${PROMPT_VERSION} · ${fixtures.length} fixture(s)\n`);

  const results: Result[] = [];
  for (const fixture of fixtures) {
    process.stdout.write(`  ${fixture.name.padEnd(18)}`);
    const result = await runOne(fixture);
    results.push(result);

    if (result.error) {
      console.log(`ERROR  ${result.error}`);
      continue;
    }
    console.log(
      `${result.ok ? "pass" : "FAIL"}  ${result.score.toFixed(2)}  ${result.steps} step(s)`
    );
    for (const p of result.problems) console.log(`      ✗ verify: ${p}`);
    for (const c of result.craft) console.log(`      ${c}`);
    for (const m of result.missing) console.log(`      ✗ never used ${m}`);
    for (const f of result.forbidden) console.log(`      ✗ should not have used ${f}`);
  }

  const mean = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed · mean ${mean.toFixed(2)}`);

  const before = existsSync(BASELINE)
    ? (JSON.parse(readFileSync(BASELINE, "utf8")) as { results: Result[] })
    : null;
  compare(results, before);

  if (save) {
    writeFileSync(
      BASELINE,
      JSON.stringify(
        { promptVersion: PROMPT_VERSION, at: new Date().toISOString(), results },
        null,
        2
      ) + "\n"
    );
    console.log(`\nSaved as the baseline for ${PROMPT_VERSION}.`);
  }

  // A non-zero exit on failure, so this can gate something later if that ever
  // becomes worth the cost of the requests.
  process.exit(passed === results.length ? 0 : 1);
}

void main();
