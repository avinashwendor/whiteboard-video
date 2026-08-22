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
    aspect: 16 / 9,
    frame: { aspect: "source", fit: "cover", zoom: 1 },
    can: { generateImage: true, photoSearch: true },
  },
});
  console.log("\n=== PLAN ===");
  console.log(JSON.stringify(plan, null, 2).slice(0, 3000));
}
await main();
