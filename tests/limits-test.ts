/**
 * The rate limiter, and the ways it stops limiting.
 *
 * A limiter fails open, which is the quiet direction. Nothing errors, no test
 * goes red, and the only symptom is a provider bill or a queue of generations
 * that should never have started together. Both bugs found here were of that
 * shape.
 *
 * The clock is injected by replacing `Date.now`, because every rule in the
 * limiter is about elapsed time and waiting sixty real seconds in a test suite
 * is how a suite stops being run.
 *
 * Run with `npx tsx tests/limits-test.ts`.
 */

import { acquire } from "../src/lib/utils/rate-limit";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${message}`);
}

const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
/** Moves every clock the limiter can see. */
const advance = (seconds: number) => {
  offset += seconds * 1000;
};

/** Takes leases until one is refused; returns how many were granted. */
function drain(key: string, options: Parameters<typeof acquire>[1], max = 50) {
  const leases: Array<{ release(): void }> = [];
  for (let i = 0; i < max; i += 1) {
    try {
      leases.push(acquire(key, options));
    } catch {
      break;
    }
  }
  return leases;
}

/* --------------------------- concurrency, and time -------------------------- */

/**
 * The real limits on `/api/create`: two at a time, and a lease long enough to
 * cover a request that may legitimately run for two minutes.
 */
const CREATE = { capacity: 12, windowMs: 60_000, maxConcurrent: 2, leaseTtlMs: 75_000 };

{
  const held = drain("t1:create", CREATE, 5);
  assert(held.length === 2, `two creates run at once, got ${held.length}`);

  // The bug: the sweeper used a global 60s default rather than the 75s this
  // route asked for, so a create still running at 65s had its slot handed
  // back and a third could start alongside it.
  advance(65);
  let slippedThrough = false;
  try {
    acquire("t1:create", CREATE).release();
    slippedThrough = true;
  } catch {
    /* correctly refused */
  }
  assert(!slippedThrough, "a lease still inside its TTL keeps holding its slot at 65s");

  // Past its own TTL, a lease is genuinely stale and must be reclaimed --
  // otherwise a crashed request locks a client out until the process restarts.
  advance(20);
  let reclaimed = false;
  try {
    acquire("t1:create", CREATE).release();
    reclaimed = true;
  } catch {
    /* still held */
  }
  assert(reclaimed, "a lease past its TTL is reclaimed at 85s");

  held.forEach((lease) => lease.release());
}

{
  // Releasing frees the slot immediately; that is the normal path.
  const first = acquire("t2:create", CREATE);
  drain("t2:create", CREATE, 1);
  first.release();
  const after = drain("t2:create", CREATE, 3);
  assert(after.length >= 1, "releasing a lease frees the slot at once");
  after.forEach((lease) => lease.release());
}

/* ------------------------------- the token bucket ------------------------------ */

const BURST = { capacity: 4, windowMs: 60_000, maxConcurrent: 20 };

{
  const taken = drain("t3:burst", BURST);
  assert(taken.length === 4, `the bucket holds exactly its capacity, got ${taken.length}`);
  taken.forEach((lease) => lease.release());

  // A quarter of the window refills roughly a quarter of the allowance. The
  // bucket must *not* be handed back whole simply because the sweeper tidied
  // it away -- forgetting a client and forgiving one are the same thing to
  // the client, and only one of them was intended.
  advance(31);
  acquire("t3:other", BURST).release(); // any call runs the global sweep
  const after = drain("t3:burst", BURST);
  assert(
    after.length <= 2,
    `31s of a 60s window refills about half, not the lot (got ${after.length})`,
  );
  after.forEach((lease) => lease.release());

  // Left alone for a whole window, it is full again -- so dropping the bucket
  // at that point is genuinely free, which is what makes it safe to do.
  advance(61);
  acquire("t3:other", BURST).release();
  const refilled = drain("t3:burst", BURST);
  assert(refilled.length === 4, `a full window restores the whole allowance, got ${refilled.length}`);
  refilled.forEach((lease) => lease.release());
}

/* --------------------------------- cancellation -------------------------------- */

{
  // A client that disconnects must not hold a generation slot until the TTL.
  const controller = new AbortController();
  acquire("t4:create", CREATE, controller.signal);
  acquire("t4:create", CREATE);
  controller.abort();

  let freed = false;
  try {
    acquire("t4:create", CREATE).release();
    freed = true;
  } catch {
    /* still held */
  }
  assert(freed, "aborting a request gives its slot back straight away");
}

{
  // Releasing twice must not free someone else's slot.
  const lease = acquire("t5:create", CREATE);
  lease.release();
  lease.release();
  const held = drain("t5:create", CREATE, 5);
  assert(held.length === 2, `a double release does not inflate the allowance, got ${held.length}`);
  held.forEach((entry) => entry.release());
}

Date.now = realNow;

if (failures) {
  console.error(`\n${failures} limit assertion(s) failed`);
  process.exit(1);
}
console.log("ALL LIMIT TESTS PASSED");
