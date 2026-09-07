/**
 * The two tools that let the agent look at the picture.
 *
 * `frame_at` and `where_text_fits` answer from the measured survey the browser
 * sends with the request, so they can be driven end to end without a video, a
 * provider or a canvas — which is the only way to check them, because in a real
 * run the model usually does not need them (the survey is already in the brief)
 * and a probe that happens not to call a tool proves nothing about it.
 *
 * What is being defended: that a look actually reaches the survey, that the
 * answer names the position an editor would choose, that a stretch is judged on
 * its worst frame rather than its average, and that a project with no
 * measurements says so rather than inventing an answer. The last one matters
 * most — the agent is explicitly told to say nothing about composition when it
 * cannot see, and a tool that answered confidently from an empty survey would
 * be teaching it to ignore that.
 *
 * Run with `npx tsx tests/agent-vision-test.mts`.
 */

import {
  planRescriptEdit,
  type RescriptAgentContext,
} from "../src/lib/ai/rescript-agent.js";
import { readFrame, toWire } from "../src/rescript/lib/overlay/vision.js";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/* ------------------------------ synthetic footage --------------------------- */

const EDGE = 96;
const SKIN = [214, 168, 140] as const;

/**
 * A talking head that walks from the left of frame to the right, against a wall
 * whose lower half is cluttered.
 *
 * Chosen because the right answer changes over the video: the right of frame is
 * free at the start and occupied by the end, so a caption placed from a single
 * frame lands on somebody's face halfway through its own hold. That is exactly
 * the mistake `where_text_fits` exists to prevent.
 */
function frameWithSubjectAt(faceX: number, at: number, previous: ReturnType<typeof readFrame> | null) {
  const data = new Uint8ClampedArray(EDGE * EDGE * 4);
  let seed = 99;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

  for (let y = 0; y < EDGE; y += 1) {
    for (let x = 0; x < EDGE; x += 1) {
      const fx = x / EDGE;
      const fy = y / EDGE;
      const onFace = fx > faceX && fx < faceX + 0.28 && fy > 0.18 && fy < 0.86;
      const clutter = fy > 0.66 ? (rand() - 0.5) * 110 : 0;
      const p = (y * EDGE + x) * 4;
      data[p] = Math.max(0, Math.min(255, (onFace ? SKIN[0] : 48) + clutter));
      data[p + 1] = Math.max(0, Math.min(255, (onFace ? SKIN[1] : 54) + clutter));
      data[p + 2] = Math.max(0, Math.min(255, (onFace ? SKIN[2] : 70) + clutter));
      data[p + 3] = 255;
    }
  }
  return readFrame({ width: EDGE, height: EDGE, data } as ImageData, at, {
    aspect: 16 / 9,
    previous,
  });
}

function survey(count = 8, duration = 40) {
  const out = [];
  let previous = null as ReturnType<typeof readFrame> | null;
  for (let i = 0; i < count; i += 1) {
    // 0.10 at the start, 0.62 by the end: the subject crosses the frame.
    const read = frameWithSubjectAt(
      0.1 + (i / (count - 1)) * 0.52,
      ((i + 1) * duration) / (count + 1),
      previous
    );
    previous = read;
    out.push(toWire(read));
  }
  return out;
}

const base: RescriptAgentContext = {
  duration: 40,
  playhead: 0,
  boundaries: [],
  elements: [],
  subtitles: { enabled: false, cueCount: 0, position: "bottom" },
  transitions: [],
  transcript: "[0:04] We shipped it three times faster than last year.",
  aspect: 16 / 9,
  can: { generateImage: true, photoSearch: true, music: true, sfx: true, video: true },
};

const PLAN = JSON.stringify({
  thinking: "done",
  summary: "Put a caption up.",
  ops: [{ op: "addText", text: "Hello", start: 1, duration: 3 }],
});

/**
 * Run the loop with a scripted model, and hand back what the tools answered.
 *
 * The tool results are what the loop feeds back as user turns, so they are
 * captured by watching what the stub is asked next.
 */
async function ask(call: object, context: RescriptAgentContext) {
  const seen: string[] = [];
  let turn = 0;
  await planRescriptEdit({
    instruction: "put a caption somewhere sensible",
    context,
    generate: async (input) => {
      const last = input.messages[input.messages.length - 1];
      if (typeof last.content === "string") seen.push(last.content);
      turn += 1;
      return turn === 1 ? JSON.stringify(call) : PLAN;
    },
  });
  // The first entry is the brief; the answer to the tool call is the second.
  return seen[1] ?? "";
}

/* --------------------------------- frame_at --------------------------------- */

{
  const context = { ...base, vision: survey() };
  const answer = await ask({ thinking: "look", tool: "frame_at", args: { at: 4 } }, context);

  assert(answer.includes("THE FRAME AT"), `frame_at answered nothing useful:\n${answer}`);
  assert(answer.includes("subject at"), "it does not say where the subject is");
  assert(
    answer.includes("TYPE GOES HERE") || answer.includes("NOWHERE IS CLEAN"),
    "it does not answer where type can go"
  );
  assert(/an accent that will pop here: #/.test(answer), "no accent is offered");
  // Early in the video the subject is hard left, so the right of frame is the
  // answer and the left is not.
  const goes = answer.split("TYPE GOES HERE:")[1]?.split("\n")[0] ?? "";
  assert(goes.length > 0, "the safe list is empty");
  assert(
    /right/.test(goes),
    `with the subject on the left, the right of frame should be offered — got "${goes.trim()}"`
  );
  console.log("✓ frame_at reports the frame and where type can go");
}

/* --------------------------- the argument in the wrong place ---------------- */

{
  // Models put tool arguments beside `tool` as often as inside `args`, and the
  // loop is deliberately tolerant of it. That tolerance has to cover the new
  // tools too, or a look silently answers for the wrong second.
  const context = { ...base, vision: survey() };
  const loose = await ask({ thinking: "look", tool: "frame_at", at: 30 }, context);
  assert(loose.includes("THE FRAME AT"), "a loose argument was not understood");
  assert(
    /THE FRAME AT 3[0-9]\.\d/.test(loose),
    `it answered for the wrong moment:\n${loose.split("\\n")[0]}`
  );
  console.log("✓ arguments beside `tool` rather than inside `args` still work");
}

/* ----------------------------- where_text_fits ------------------------------ */

{
  const context = { ...base, vision: survey() };
  const answer = await ask(
    { thinking: "look", tool: "where_text_fits", args: { from: 0, to: 40 } },
    context
  );

  assert(answer.includes("WHERE TYPE CAN SIT"), `no answer:\n${answer}`);
  assert(
    /judged on the worst of \d+ measured frames/.test(answer),
    "it does not say it judged on the worst frame — which is the whole point"
  );

  // Across the whole video the subject crosses the middle, so nothing in the
  // middle band may be offered as safe throughout.
  const safeBlock = answer.split("Do not use:")[0];
  assert(
    !/^\s{2}center — 0\.[6-9]/m.test(safeBlock),
    `the centre cannot be safe for a whole video the subject walks across:\n${safeBlock}`
  );

  // And a short window early on, where the subject is hard left, should be
  // more permissive than the whole video.
  const early = await ask(
    { thinking: "look", tool: "where_text_fits", args: { from: 0, to: 8 } },
    context
  );
  const count = (text: string) => (text.match(/ — 0\.\d\d, (light|dark) type/g) ?? []).length;
  assert(
    count(early) >= count(answer),
    `a short early window should offer at least as many places as the whole video (${count(early)} vs ${count(answer)})`
  );
  console.log("✓ where_text_fits judges a stretch on its worst frame");
}

/* ------------------------------- many at once ------------------------------- */

{
  // The fix for the failure people actually saw: "it kept looking at the
  // footage instead of answering". The prompt asks for a placement to be
  // checked before it is made, and a plan has several placements — so asking
  // one at a time spent the whole look budget and the conversation ended
  // without a plan. One call has to answer for all of them.
  const context = { ...base, vision: survey() };
  const answer = await ask(
    {
      thinking: "check them all",
      tool: "where_text_fits",
      args: {
        spans: [
          { from: 0, to: 6 },
          { from: 14, to: 20 },
          { from: 30, to: 36 },
        ],
      },
    },
    context
  );

  const blocks = answer.match(/WHERE TYPE CAN SIT/g) ?? [];
  assert(
    blocks.length === 3,
    `three stretches should get three answers in one look, got ${blocks.length}`
  );
  assert(/0\.0–6\.0s/.test(answer), "the first stretch is named");
  assert(/30\.0–36\.0s/.test(answer), "and the last");

  // A single window still works — the shape the prompt shows for one caption.
  const one = await ask(
    { thinking: "just one", tool: "where_text_fits", args: { from: 4, to: 9 } },
    context
  );
  assert((one.match(/WHERE TYPE CAN SIT/g) ?? []).length === 1, "one window, one answer");

  // A duration instead of an end, which is how the ops are written.
  const dur = await ask(
    { thinking: "by duration", tool: "where_text_fits", args: { spans: [{ from: 4, duration: 3 }] } },
    context
  );
  assert(/4\.0–7\.0s/.test(dur), `a duration should resolve to an end: ${dur.slice(0, 80)}`);

  // Nothing usable asks for the shape rather than answering for 0–4s.
  const none = await ask(
    { thinking: "oops", tool: "where_text_fits", args: {} },
    context
  );
  assert(/Give a window/.test(none), "an empty call explains the shape");
  console.log("✓ one call answers for every stretch a plan will caption");
}

/* ------------------------------- no measurements ---------------------------- */

{
  // A project with no survey — audio, or frames that would not decode. The
  // agent is told to say nothing about composition when it cannot see, and a
  // tool that answered anyway would teach it the opposite.
  const blind = await ask({ thinking: "look", tool: "frame_at", args: { at: 4 } }, base);
  assert(
    blind.includes("not measured"),
    `a blind project must say so, not answer:\n${blind}`
  );
  assert(
    !blind.includes("TYPE GOES HERE"),
    "and must not offer a placement it cannot have measured"
  );

  const blindSpan = await ask(
    { thinking: "look", tool: "where_text_fits", args: { from: 0, to: 10 } },
    base
  );
  assert(blindSpan.includes("not measured"), "the span tool says so too");
  console.log("✓ an unmeasured project is told so rather than answered");
}

/* ------------------------------ a window with nothing ----------------------- */

{
  // Asking about a stretch shorter than the sampling interval catches no frame
  // at all. Falling back to the nearest is right — "no frames there" would send
  // the model looking again and spend a look on nothing.
  const context = { ...base, vision: survey(4, 40) };
  const answer = await ask(
    { thinking: "look", tool: "where_text_fits", args: { from: 12.0, to: 12.1 } },
    context
  );
  assert(answer.includes("WHERE TYPE CAN SIT"), `a narrow window got no answer:\n${answer}`);
  assert(
    /worst of 1 measured frame\b/.test(answer),
    "it should fall back to the single nearest frame and say so"
  );
  console.log("✓ a window narrower than the sampling interval still answers");
}

/* --------------------------- the survey reaches the brief ------------------- */

{
  // The tools are the fallback; the survey being *in the brief* is the main
  // path, and it is the one that would break silently.
  const context = { ...base, vision: survey() };
  let brief = "";
  await planRescriptEdit({
    instruction: "put a caption somewhere sensible",
    context,
    generate: async (input) => {
      const first = input.messages.find((m) => m.role === "user");
      if (typeof first?.content === "string") brief = first.content;
      return PLAN;
    },
  });

  assert(brief.includes("WHAT THE PICTURE IS ACTUALLY DOING"), "the survey is not in the brief");
  assert(brief.includes("ACROSS THE WHOLE CUT"), "nor the summary across frames");
  assert(
    /Positions that stay safe all the way through/.test(brief),
    "nor the positions that hold up throughout"
  );
  assert(
    /The footage measures:/.test(brief),
    "nor the measured grade, which is the correction it is told to apply unprompted"
  );
  console.log("✓ the survey reaches the brief, grade reading and all");
}

/* --------------------------- what the deployment can do --------------------- */

{
  // The `can` block exists so the agent never plans an operation the browser
  // cannot carry out. Sound was added without extending it, and for a while the
  // agent confidently planned autoSfx and addMusic on deployments with no
  // catalogue — they failed one at a time at execution with nothing said
  // beforehand. Both directions are checked, because "available" silently
  // becoming "not configured" is the same bug wearing the other hat.
  const brief = async (can: RescriptAgentContext["can"]) => {
    let text = "";
    await planRescriptEdit({
      instruction: "add some sound",
      context: { ...base, can },
      generate: async (input) => {
        const first = input.messages.find((m) => m.role === "user");
        if (typeof first?.content === "string") text = first.content;
        return PLAN;
      },
    });
    return text;
  };

  const off = await brief({
    generateImage: true,
    photoSearch: true,
    music: false,
    sfx: false,
    video: false,
  });
  assert(/Music \(addMusic\): NOT configured/.test(off), "the brief does not rule out music");
  assert(
    /Sound effects \(autoSfx, addSfx\): NOT configured/.test(off),
    "the brief does not rule out sound effects"
  );

  const on = await brief({
    generateImage: true,
    photoSearch: true,
    music: true,
    sfx: true,
    video: true,
  });
  assert(/Music \(addMusic\): available/.test(on), "a configured deployment is told so");
  assert(/Sound effects \(autoSfx, addSfx\): available/.test(on), "and for effects too");
  assert(
    /Moving b-roll \(addBroll\): NOT configured/.test(off),
    "the brief does not rule out moving b-roll"
  );
  assert(/Moving b-roll \(addBroll\): available/.test(on), "nor allow it when it is there");
  console.log("✓ the agent is told what this deployment can actually reach");
}

console.log("\nagent vision: all checks passed");
