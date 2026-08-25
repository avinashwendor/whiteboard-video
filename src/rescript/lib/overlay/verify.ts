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

/**
 * How many pictures each layout is actually asking for.
 *
 * `grid` is the exception — its region count follows its contents — so it is
 * not checked against a fixed number.
 */
const SHOT_PLATES: Record<string, number> = {
  full: 1,
  card: 1,
  grid: 1,
  splitLeft: 2,
  splitRight: 2,
  splitTop: 2,
  splitBottom: 2,
  stack: 2,
  pip: 2,
};

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
  /**
   * Which clock the window is on.
   *
   * A captionPhrase is timed at runtime from the word timings, so the only
   * position available here is the transcript's own stamp — which is on the
   * clock *before* this plan's cuts. Comparing that against an addText time
   * written for the clock after them would manufacture collisions that do not
   * happen, so the two are only ever compared with their own kind.
   */
  clock: "plan" | "transcript";
}

/**
 * Roughly when a phrase is said, from the stamped transcript.
 *
 * Only used to tell two kinetic captions apart, so a whole line's precision is
 * enough — and a line is the smallest thing the transcript is stamped at.
 */
function saidAt(transcript: string, phrase: string): number | null {
  const needle = normalise(phrase);
  if (!needle) return null;
  for (const raw of transcript.split("\n")) {
    const match = /^\[(\d+):(\d\d(?:\.\d+)?)\]\s*(.*)$/.exec(raw.trim());
    if (!match) continue;
    if (!normalise(match[3]).includes(needle)) continue;
    return Number(match[1]) * 60 + Number(match[2]);
  }
  return null;
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
  const placed: Placed[] = [];
  /** Shot windows the plan lays down, so overlaps between them can be caught. */
  const shotWindows: { op: string; start: number; end: number }[] = [];
  let autoPunches = 0;
  /** Whole-video grades. A second one silently replaces the first. */
  let gradeCount = 0;
  /** Music beds the plan lays down. More than one is never meant. */
  let beds = 0;

  /**
   * How long the video is by this point in the plan — as an upper bound.
   *
   * Cuts only ever shorten, so a time past this is wrong however imprecise the
   * bound is. `keepOnly` and `deleteRange` are exact; removing fillers and
   * silences takes off an amount nobody can predict, so they leave the bound
   * where it was rather than inventing a number to be wrong about. This is the
   * check that catches the real mistake of the format: a plan that cuts a nine
   * minute recording down to thirty seconds and then puts a caption at 4:20.
   */
  let remaining = world.duration;

  const addPlaced = (
    start: number | undefined,
    end: number | undefined,
    duration: number | undefined,
    position: PositionName | { x: number; y: number } | undefined,
    label: string
  ) => {
    const from = start ?? 0;
    const to = end ?? from + (duration ?? 3);
    placed.push({ start: from, end: to, band: band(position), label, clock: "plan" });
  };

  for (const op of ops) {
    switch (op.op) {
      case "addText": {
        elements += 1;
        if (op.start !== undefined && op.start > remaining) {
          problems.push(
            cutSeen
              ? `addText "${op.text.slice(0, 30)}" starts at ${op.start.toFixed(1)}s, but after the cuts in this plan the video is at most ${remaining.toFixed(1)}s long.`
              : `addText "${op.text.slice(0, 30)}" starts at ${op.start.toFixed(1)}s but the video is ${remaining.toFixed(1)}s long.`
          );
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
        // Timed at runtime from the word timings. The transcript stamp is the
        // best available stand-in, and it is enough to catch two kinetic
        // captions landing on the same words in the same part of the frame.
        const at = saidAt(world.transcript, op.phrase);
        placed.push({
          start: at ?? -1,
          end: at === null ? -1 : at + 2 + (op.hold ?? 0.6),
          band: band(op.position ?? "upper-third"),
          label: `caption "${op.phrase.slice(0, 24)}"`,
          clock: "transcript",
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

      case "deleteRange": {
        cutSeen = true;
        if (op.to <= op.from) {
          problems.push(`deleteRange ${op.from}–${op.to} ends before it starts.`);
          break;
        }
        if (op.from >= remaining) {
          problems.push(
            `deleteRange starts at ${op.from.toFixed(1)}s but the video is ${remaining.toFixed(1)}s long${cutSeen ? " by this point in the plan" : ""}.`
          );
          break;
        }
        const cut = Math.min(op.to, remaining) - op.from;
        remaining = Math.max(0, remaining - cut);
        break;
      }

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
          if (range.from >= remaining) {
            problems.push(
              `keepOnly asks for ${range.from.toFixed(1)}s, past the end of a ${remaining.toFixed(1)}s video.`
            );
          }
          previousEnd = range.to;
        }
        // Everything after this is written against the kept spans, and nothing
        // else. This is the single biggest shift of the clock a plan can make.
        remaining = op.ranges.reduce(
          (n, r) => n + Math.max(0, Math.min(r.to, remaining) - r.from),
          0
        );
        break;
      }

      case "splitAt":
        cutSeen = true;
        boundaries += 1;
        if (op.at <= 0 || op.at >= remaining) {
          problems.push(
            `splitAt ${op.at.toFixed(1)}s is outside the video, which runs 0–${remaining.toFixed(1)}s${cutSeen ? " after the cuts already in this plan" : ""}.`
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

      case "addMusic":
        if (op.start !== undefined && op.start >= remaining) {
          problems.push(
            `addMusic at ${op.start.toFixed(1)}s is past the end of the finished video.`
          );
          break;
        }
        // Two beds play at once. Nobody means that, and it is inaudible as a
        // mistake — it sounds like one badly-mixed track rather than two.
        if (op.kind !== "sfx") {
          if (beds > 0) {
            problems.push(
              "The video already has a music bed in this plan; a second one would play over the first."
            );
          }
          beds += 1;
        }
        break;

      case "setMusicLevel":
      case "removeMusic":
        break;

      case "setGrade":
        // A look on a stretch with no shot on it would silently do nothing, and
        // "I graded that cutaway" with an ungraded cutaway on screen is a plan
        // that lied about what it did.
        if (op.at !== undefined && op.at >= remaining) {
          problems.push(
            `setGrade at ${op.at.toFixed(1)}s is past the end of the finished video.`
          );
        }
        if (gradeCount > 0 && op.at === undefined) {
          problems.push(
            "The whole video is graded more than once; only the last one would survive."
          );
        }
        if (op.at === undefined) gradeCount += 1;
        break;

      case "addShot":
      case "setCamera": {
        // A shot placed past where the cut ends never plays. This is the same
        // check the caption times get, and it matters more here: a caption that
        // never appears is a missing caption, while a shot that never plays
        // leaves the person looking at a plan that claims to have reframed
        // something and a video that is unchanged.
        if (op.start >= remaining) {
          problems.push(
            `${op.op} at ${op.start.toFixed(1)}s is past the end of the finished video (${remaining.toFixed(1)}s).`
          );
          break;
        }
        if (op.end <= op.start) {
          problems.push(`${op.op} ends at or before it starts (${op.start}–${op.end}).`);
          break;
        }
        if (op.end - op.start < 0.4) {
          problems.push(
            `${op.op} covers ${(op.end - op.start).toFixed(2)}s — too short to read as anything but a glitch.`
          );
          break;
        }

        if (op.op === "addShot") {
          // A layout with more regions than plates would draw the footage into
          // the empty ones, which is not what anyone asking for a split screen
          // means — they are describing two different pictures.
          const wanted = SHOT_PLATES[op.layout];
          const given = op.plates?.length ?? 1;
          if (wanted > 1 && given < wanted) {
            problems.push(
              `${op.layout} divides the frame into ${wanted}, but only ${given} plate${given === 1 ? " was" : "s were"} given — say what goes in each.`
            );
          }
        }

        shotWindows.push({ op: op.op, start: op.start, end: op.end });
        break;
      }

      case "removeShot":
        if (op.at >= remaining) {
          problems.push(
            `removeShot at ${op.at.toFixed(1)}s is past the end of the finished video.`
          );
        }
        break;

      case "autoPunchIns":
        // Placement enforces its own spacing, so there is nothing here that can
        // be wrong about the ask — only about asking for it twice.
        if (autoPunches > 0) {
          problems.push(
            "autoPunchIns is in the plan more than once; the second pass would land on top of the first."
          );
        }
        autoPunches += 1;
        break;

      default:
        break;
    }
  }

  // There is deliberately no complaint about "a caption timed after a cut".
  // The prompt asks for exactly that — cutting operations first, later times
  // written for the clock they leave behind — so flagging the shape of it would
  // send the model back to undo what it was told to do. What matters is whether
  // the time is *reachable*, and `remaining` above already answers that.

  // Two shots claiming the same second. The store resolves this by clipping the
  // earlier one, so nothing breaks — but the plan said it would do two things
  // and will only do one and a half, and that is worth saying before it runs.
  for (let i = 0; i < shotWindows.length; i += 1) {
    for (let j = i + 1; j < shotWindows.length; j += 1) {
      const a = shotWindows[i];
      const b = shotWindows[j];
      if (a.start < b.end && b.start < a.end) {
        problems.push(
          `Two shots cover the same moment (${a.op} ${a.start.toFixed(1)}–${a.end.toFixed(1)}s and ${b.op} ${b.start.toFixed(1)}–${b.end.toFixed(1)}s); the later one wins and the first is cut short.`
        );
      }
    }
  }

  // Two things in the same band at the same moment is the single most visible
  // sign of an automatic edit, and it is cheap to catch here.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.band !== b.band) continue;
      if (a.clock !== b.clock) continue;
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

  // Density is judged against the video that comes out, not the one that went
  // in: four captions is restraint across nine minutes and a slideshow across
  // thirty seconds, and a plan that makes a Short does both in one breath.
  const added = placed.length;
  if (remaining > 0 && added > Math.max(4, remaining / 12)) {
    problems.push(
      `${added} things are added to a ${Math.round(remaining)}s video. That reads as a slideshow — one title, three or four kinetic captions and two or three pictures is a produced edit.`
    );
  }

  // Duplicates help nobody; the same fault found twice is still one fault.
  return [...new Set(problems)];
}
