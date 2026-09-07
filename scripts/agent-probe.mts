/**
 * Exercise the edit agent without the editor.
 *
 * `npm run probe:agent -- "<instruction>" [propose|execute]`
 *
 * Calls the planner directly against a synthetic project, so the tool loop, the
 * verifier and the repair round can be watched end to end without a video, a
 * transcription pass or a browser. Set RESCRIPT_AGENT_DEBUG (this sets it to
 * stderr) to see the model's raw replies — which is the only way the two
 * harness bugs found this way were ever going to be visible, since the route
 * answers 200 either way.
 *
 * Reads .env.local for OMEGA_API_KEY, so it costs a real request.
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}
process.env.RESCRIPT_AGENT_DEBUG = "/dev/stderr";

const { planRescriptEdit } = await import("../src/lib/ai/rescript-agent.js");
const { readFrame, toWire } = await import("../src/rescript/lib/overlay/vision.js");

/**
 * A measured survey, synthesised.
 *
 * The probe's whole value is that it exercises the harness without a browser,
 * and the measurements are the newest and largest thing the harness carries —
 * a prompt block, two tools, and a grade recommendation, none of which the
 * probe touched. So the frames are painted here instead: a person left of
 * centre against a wall that gets busy in the lower half, which is the ordinary
 * case and the one where the right answer (put type upper-right, not in the
 * lower third) differs from the default instinct.
 */
function syntheticVision(duration: number, count = 8) {
  const EDGE = 96;
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

  const reads = [];
  let previous = null;
  for (let i = 0; i < count; i += 1) {
    const data = new Uint8ClampedArray(EDGE * EDGE * 4);
    // The subject drifts slowly rightward across the video, so a position that
    // is safe at the start is not safe at the end — which is the case
    // where_text_fits exists for.
    const faceX = 0.16 + (i / count) * 0.22;
    for (let y = 0; y < EDGE; y += 1) {
      for (let x = 0; x < EDGE; x += 1) {
        const fx = x / EDGE;
        const fy = y / EDGE;
        const onFace = fx > faceX && fx < faceX + 0.3 && fy > 0.2 && fy < 0.85;
        // Busy shelving across the bottom third; flat wall above it.
        const busy = fy > 0.62 ? (rand() - 0.5) * 90 : 0;
        const p = (y * EDGE + x) * 4;
        data[p] = Math.max(0, Math.min(255, (onFace ? 208 : 54) + busy));
        data[p + 1] = Math.max(0, Math.min(255, (onFace ? 162 : 60) + busy));
        data[p + 2] = Math.max(0, Math.min(255, (onFace ? 134 : 78) + busy));
        data[p + 3] = 255;
      }
    }
    const read = readFrame(
      { width: EDGE, height: EDGE, data } as ImageData,
      ((i + 1) * duration) / (count + 1),
      { aspect: 16 / 9, previous }
    );
    previous = read;
    reads.push(toWire(read));
  }
  return reads;
}

const SENTENCES = [
  "So the first thing we did was rip out the old pipeline entirely.",
  "It was costing us about forty minutes on every single build.",
  "And nobody, um, nobody actually wanted to touch it.",
  "We moved the whole thing onto a content-addressed cache.",
  "That took the build down to about four minutes.",
  "Which is, you know, roughly ten times faster than where we started.",
  "The tricky part was invalidation, as it always is.",
  "I spent two weeks just drawing the dependency graph on a whiteboard.",
  "The team shipped four features in the following sprint.",
  "Nobody puts it on a roadmap but everybody feels it.",
];
const lines: string[] = [];
let t = 0;
for (let i = 0; i < Number(process.env.LINES ?? 600); i++) {
  const s = SENTENCES[i % SENTENCES.length];
  lines.push(`[${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}] ${s}`);
  t += 3 + (i % 4);
}

async function main() {
  const plan = await planRescriptEdit({
  instruction: process.argv[2] ?? "Analyse this and propose an edit for a vertical short",
  /**
   * GLANCES=1 attaches a frame, which is what the editor does and the probe
   * never did — the gap that hid a provider rejecting image parts outright.
   */
  ...(process.env.GLANCES
    ? {
        glances: [
          {
            at: 1,
            dataUrl:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          },
        ],
      }
    : {}),
  mode: (process.argv[3] as "propose" | "execute") ?? "propose",
  context: {
    duration: t,
    playhead: 0,
    boundaries: [],
    elements: [],
    subtitles: { enabled: false, cueCount: 0, position: "bottom" },
    transitions: [],
    transcript: lines.join("\n"),
    analysis: {
      wordCount: 1450, wordsPerMinute: 148, speakerCount: 1,
      fillerCount: 37, fillerSeconds: 9.4, silenceCount: 22, silenceSeconds: 18.2,
      longestPauses: [{ at: 212, seconds: 2.4 }], clipCount: 1, runsLong: true,
    },
    // VISION=0 turns it off, for comparing against the blind behaviour.
    ...(process.env.VISION === "0" ? {} : { vision: syntheticVision(t) }),
    aspect: 16 / 9,
    frame: { aspect: "source", fit: "cover", zoom: 1 },
    can: { generateImage: true, photoSearch: true, music: true, sfx: true },
  },
});
  console.log("\n=== PLAN ===");
  console.log(JSON.stringify(plan, null, 2));
}
await main();
