/**
 * Reads a plan before it runs and says what is wrong with it.
 *
 * The schema already refuses anything malformed, but a plan can be perfectly
 * well-formed and still be nonsense against *this* project: a caption on a
 * phrase nobody says, a transition on a boundary that does not exist, a title
 * sitting on top of the subtitles. Those used to surface one red line at a time
 * in the log after the edit had half happened.
 *
 * So the plan is simulated first. Nothing here touches a store — it walks the
 * operations against a description of the project, keeping track of what each
 * one would create, and returns problems in the model's own vocabulary so they
 * can be handed straight back for a second attempt. It runs on the server,
 * before the browser is asked to do any of it, which is why this file has no
 * "use client" and imports nothing from a store.
 */

import type { AgentOp, PositionName } from "./ops-schema";

export interface PlanWorld {
  /** Length of the finished video, in output-clock seconds. */
  duration: number;
  /** Clip boundaries available to `setTransition`. */
  boundaryCount: number;
  /** Overlay elements already on screen, numbered from 1. */
  elementCount: number;
  subtitlesOn: boolean;
  /** Where the burned-in subtitles sit, when they are on. */
  subtitlePosition: "top" | "center" | "bottom";
  /** The transcript of the current cut, for phrase checks. */
  transcript: string;
  can: { generateImage: boolean; photoSearch: boolean };
}

/** Which third of the frame a named position lands in. */
function band(position: PositionName | { x: number; y: number } | undefined):
  | "top"
  | "center"
  | "bottom" {
  if (!position) return "bottom";
  if (typeof position !== "string") {
    return position.y < 0.34 ? "top" : position.y > 0.6 ? "bottom" : "center";
  }
  if (position === "upper-third" || position.startsWith("top")) return "top";
  if (position === "lower-third" || position.startsWith("bottom")) return "bottom";
  return "center";
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does the transcript contain this phrase, ignoring case and punctuation? */
function saysIt(transcript: string, phrase: string): boolean {
  const haystack = normalise(transcript);
  const needle = normalise(phrase);
  if (!needle) return false;
  return haystack.includes(needle);
}

interface Placed {
  start: number;
  end: number;
  band: "top" | "center" | "bottom";
  label: string;
}

/**
 * Problems found in a plan, worst first, phrased for the model.
 *
 * Everything returned is a genuine defect in the finished video, not a matter
 * of taste — a warning the model cannot act on is worse than no warning, since
 * it spends a repair turn arguing with it.
 */
export function verifyPlan(ops: AgentOp[], world: PlanWorld): string[] {
  const problems: string[] = [];

  // The plan's own idea of the project, updated as it goes.
  let elements = world.elementCount;
  let boundaries = world.boundaryCount;
  let subtitlesOn = world.subtitlesOn;
  let subtitlePosition = world.subtitlePosition;
  let cutSeen = false;
  let timedAfterCut = false;
  const placed: Placed[] = [];

  const addPlaced = (
    start: number | undefined,
    end: number | undefined,
    duration: number | undefined,
    position: PositionName | { x: number; y: number } | undefined,
    label: string
  ) => {
    const from = start ?? 0;
    const to = end ?? from + (duration ?? 3);
    placed.push({ start: from, end: to, band: band(position), label });
  };

  for (const op of ops) {
    switch (op.op) {
      case "addText": {
        elements += 1;
        if (op.start !== undefined && op.start > world.duration) {
          problems.push(
            `addText "${op.text.slice(0, 30)}" starts at ${op.start.toFixed(1)}s but the video is ${world.duration.toFixed(1)}s long.`
          );
        }
        // Only a time that a cut actually moves. The start of the video does
        // not move, and the prompt tells the model to anchor there for exactly
        // that reason — flagging it would send it back to fix the thing it was
        // asked to do.
        if (cutSeen && op.start !== undefined && op.start > 1) {
          timedAfterCut = true;
        }
        const words = op.text.trim().split(/\s+/).length;
        const life =
          (op.end ?? (op.start ?? 0) + (op.duration ?? 3)) - (op.start ?? 0);
        if (words > 3 && life < 2) {
          problems.push(
            `addText "${op.text.slice(0, 30)}" is ${words} words held for ${life.toFixed(1)}s — too fast to read. Two seconds minimum, plus half a second per word beyond three.`
          );
        }
        addPlaced(op.start, op.end, op.duration, op.position, `text "${op.text.slice(0, 24)}"`);
        break;
      }

      case "captionPhrase": {
        elements += 1;
        if (!saysIt(world.transcript, op.phrase)) {
          problems.push(
            `captionPhrase "${op.phrase}" — those words are not in the transcript, so there is nothing to time it to. Quote the transcript exactly, or use addText with a time.`
          );
        }
        // Its window comes from the word timings, so it cannot be checked
        // against the clock here; only its band matters for collisions.
        placed.push({
          start: -1,
          end: -1,
          band: band(op.position ?? "upper-third"),
          label: `caption "${op.phrase.slice(0, 24)}"`,
        });
        break;
      }

      case "addImage": {
        elements += 1;
        if (!op.prompt && !op.query) {
          problems.push("addImage needs either a prompt (to generate) or a query (to search), and has neither.");
        }
        if (op.prompt && op.query) {
          problems.push(
            `addImage for "${op.prompt.slice(0, 30)}" has both a prompt and a query. Pick one: prompt generates artwork, query finds a photograph.`
          );
        }
        if (op.prompt && !world.can.generateImage) {
          problems.push("addImage with a prompt was planned, but image generation is not configured in this deployment.");
        }
        if (op.query && !world.can.photoSearch) {
          problems.push("addImage with a query was planned, but photo search is not configured in this deployment.");
        }
        addPlaced(op.start, op.end, op.duration, op.position, "image");
        break;
      }

      case "addShape":
        elements += 1;
        break;

      case "updateElement":
      case "moveElement":
      case "resizeElement":
      case "timeElement":
      case "animateElement":
        if (op.element > elements) {
          problems.push(
            `${op.op} addresses element ${op.element}, but this plan only ever has ${elements}. Elements are numbered from 1 in the order they were listed to you, and ones you add in this plan come after those.`
          );
        }
        break;

      case "removeElement":
        if (op.element === "all") elements = 0;
        else if (op.element > elements) {
          problems.push(
            `removeElement addresses element ${op.element}, but there are only ${elements}.`
          );
        } else elements -= 1;
        break;

      case "setTransition":
        if (op.between > boundaries) {
          problems.push(
            boundaries === 0
              ? "setTransition was planned but the video is a single clip — there is no boundary to put one on. Cut something first, or splitAt a time."
              : `setTransition on boundary ${op.between}, but the video has ${boundaries}.`
          );
        }
        break;

      case "setAllTransitions":
        if (boundaries === 0 && op.kind !== "none") {
          problems.push(
            "setAllTransitions was planned but the video has no cuts yet, so there is nowhere to put one. Put the cutting operations first — they are what creates the boundaries."
          );
        }
        break;

      case "subtitles":
        if (op.action === "off") subtitlesOn = false;
        else if (op.action !== "style") subtitlesOn = true;
        if (op.position) subtitlePosition = op.position;
        break;

      case "deletePhrase":
        cutSeen = true;
        if (!saysIt(world.transcript, op.text)) {
          problems.push(
            `deletePhrase "${op.text}" — those words are not in the transcript, so nothing would be cut.`
          );
        }
        break;

      case "deleteRange":
        cutSeen = true;
        if (op.to <= op.from) {
          problems.push(`deleteRange ${op.from}–${op.to} ends before it starts.`);
        } else if (op.from >= world.duration) {
          problems.push(
            `deleteRange starts at ${op.from.toFixed(1)}s but the video is ${world.duration.toFixed(1)}s long.`
          );
        }
        break;

      case "keepOnly": {
        cutSeen = true;
        let previousEnd = -1;
        for (const range of op.ranges) {
          if (range.to <= range.from) {
            problems.push(`keepOnly has a span ${range.from}–${range.to} that ends before it starts.`);
          }
          if (range.from < previousEnd) {
            problems.push("keepOnly spans overlap or are out of order. List them in ascending time, without overlaps.");
          }
          if (range.from >= world.duration) {
            problems.push(
              `keepOnly asks for ${range.from.toFixed(1)}s, past the end of a ${world.duration.toFixed(1)}s video.`
            );
          }
          previousEnd = range.to;
        }
        break;
      }

      case "splitAt":
        cutSeen = true;
        boundaries += 1;
        if (op.at <= 0 || op.at >= world.duration) {
          problems.push(
            `splitAt ${op.at.toFixed(1)}s is outside the video, which runs 0–${world.duration.toFixed(1)}s.`
          );
        }
        break;

      case "removeFillers":
      case "removeSilences":
        cutSeen = true;
        // Both leave jump cuts, and a jump cut is a boundary.
        boundaries = Math.max(boundaries, 1);
        break;

      case "setFrame":
        break;

      default:
        break;
    }
  }

  if (timedAfterCut) {
    problems.push(
      "A caption with an explicit start comes after a cutting operation in this plan. Cuts shorten the video and move everything after them, so either put the cutting operations first and write the later times as they will be afterwards, or drop the explicit start."
    );
  }

  // Two things in the same band at the same moment is the single most visible
  // sign of an automatic edit, and it is cheap to catch here.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.band !== b.band) continue;
      if (a.start < 0 || b.start < 0) continue;
      if (a.start < b.end && b.start < a.end) {
        problems.push(
          `${a.label} and ${b.label} are both in the ${a.band} of the frame at the same time. Move one, or hold them apart.`
        );
      }
    }
  }

  if (subtitlesOn) {
    for (const item of placed) {
      if (item.band === subtitlePosition) {
        problems.push(
          `${item.label} sits in the ${item.band} of the frame, which is where the burned-in subtitles are. Put it somewhere else.`
        );
      }
    }
  }

  const added = placed.length;
  if (world.duration > 0 && added > Math.max(4, world.duration / 12)) {
    problems.push(
      `${added} things are added to a ${Math.round(world.duration)}s video. That reads as a slideshow — one title, three or four kinetic captions and two or three pictures is a produced edit.`
    );
  }

  // Duplicates help nobody; the same fault found twice is still one fault.
  return [...new Set(problems)];
}
