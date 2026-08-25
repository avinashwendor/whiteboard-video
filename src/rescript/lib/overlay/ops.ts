"use client";

/**
 * Runs a plan.
 *
 * The server decides *what* to do; this decides *how*, against the pipelines
 * the browser already owns — the composition store, the image routes, and the
 * transcript store's own cut operations. Every step reports a line, and a step
 * that fails reports why and does not stop the ones after it: a plan is a list
 * of independent edits, not a transaction.
 */

import { useEditorStore } from "../store";
import { findFillerWordIds } from "../fillers";
import { findSilenceRanges, MIN_SILENCE_DURATION } from "../silences";
import { getCutRanges, originalToEdited } from "../edits";
import { currentComposition, useOverlayStore } from "./store";
import { cameraFor, fitCamera } from "./camera";
import { findBeats, placePunchIns } from "./emphasis";
import { shotAt } from "./shots";
import { gradePreset, NEUTRAL_GRADE } from "./grade";
import { textTemplate } from "./templates";
import { cuesFromStyle, SUBTITLE_PRESETS } from "./subtitles";
import {
  IMAGE_SIZE,
  isWidePosition,
  rectAt,
  SHAPE_SIZE,
  TEXT_SIZE,
  startAtPlayhead,
  textBoxHeight,
  textStyleFields,
  textStyleScale,
} from "./presets";
import { loadImage } from "./render";
import type { AgentOp, PositionName, SizeName } from "./ops-schema";
import {
  primaryPlate,
  regionCount,
  SHOT_LAYOUT_LABELS,
  type AnimationKind,
  type AnimationSpec,
  type OverlayElement,
  type Plate,
  type Rect,
  type SubtitleStyle,
  type TextElement,
  type Transition,
  type TransitionKind,
} from "./types";
import {
  buildTimeline,
  complementToSource,
  outputRangeToSource,
  type OutputTimeline,
} from "./timeline";

export interface OpsContext {
  /** Output-clock second the playhead sits on. */
  playhead: number;
  /** Length of the finished video. */
  duration: number;
  timeline: OutputTimeline;
  /** Frame aspect ratio (w/h), for sizing images correctly. */
  aspect: number;
}

export interface OpResult {
  ok: boolean;
  message: string;
}

const DEFAULT_ELEMENT_SECONDS = 3;

/* --------------------------------- helpers --------------------------------- */

function resolveWindow(
  op: { start?: number; end?: number; duration?: number },
  ctx: OpsContext
): { start: number; end: number } {
  // An explicit time is honoured exactly; "here" gets the entrance lead.
  const start = op.start ?? startAtPlayhead(ctx.playhead);
  const end =
    op.end ??
    start + (op.duration ?? DEFAULT_ELEMENT_SECONDS);
  const clampedStart = Math.max(0, Math.min(start, Math.max(0, ctx.duration - 0.2)));
  return {
    start: clampedStart,
    end: Math.max(clampedStart + 0.2, Math.min(end, ctx.duration || end)),
  };
}

function resolveRect(
  position: PositionName | { x: number; y: number } | undefined,
  w: number,
  h: number,
  fallback: PositionName
): Rect {
  if (!position) return rectAt(fallback, w, h);
  if (typeof position === "string") return rectAt(position, w, h);
  // An explicit point addresses the element's top-left corner, kept on screen.
  return {
    x: Math.max(-0.1, Math.min(position.x, 1 - w * 0.2)),
    y: Math.max(-0.1, Math.min(position.y, 1 - h * 0.2)),
    w,
    h,
  };
}

function textWidthFor(
  position: PositionName | { x: number; y: number } | undefined
): number {
  if (!position || typeof position !== "string") return 0.8;
  return isWidePosition(position) ? 0.8 : 0.44;
}

/** Numbered as the model sees them: paint order, 1-based. */
function orderedElements(): OverlayElement[] {
  return [...useOverlayStore.getState().elements].sort((a, b) => a.z - b.z);
}

/**
 * Resolve a template into the fields that build a text element.
 *
 * A template supplies the look, the motion, the size and the placement; every
 * one of those is still overridable by the operation, so a template can be
 * nudged rather than rebuilt. Falls through to the old style-name path when no
 * template is named, or when the name is not one we have — an invented template
 * should produce a plain caption rather than nothing at all.
 */
type Placement = PositionName | { x: number; y: number } | undefined;

function resolveTextLook(op: {
  template?: string;
  style?: Parameters<typeof textStyleFields>[0];
  size?: SizeName;
  position?: Placement;
  enter?: AnimationKind;
  exit?: AnimationKind;
}): {
  fields: ReturnType<typeof textStyleFields>;
  scale: number;
  size: SizeName;
  position: Placement;
  enter: AnimationSpec;
  exit: AnimationSpec;
} {
  const template = op.template ? textTemplate(op.template) : null;

  if (!template) {
    const styleName = op.style ?? "plain";
    return {
      fields: textStyleFields(styleName),
      scale: textStyleScale(styleName),
      size: op.size ?? "l",
      position: op.position,
      enter: animation(op.enter, "slideUp"),
      exit: animation(op.exit, "fade"),
    };
  }

  const { sizeScale, ...look } = template.style;
  return {
    fields: look as ReturnType<typeof textStyleFields>,
    scale: sizeScale ?? 1,
    size: op.size ?? template.size,
    position: op.position ?? template.position,
    // An explicit kind wins, but the template's timing is kept: a template
    // whose reveal is 0.7s per word does not become a 0.4s fade because
    // someone named a different kind.
    enter: op.enter ? animation(op.enter, "slideUp") : template.enter,
    exit: op.exit ? animation(op.exit, "fade") : template.exit,
  };
}

function elementByNumber(n: number): OverlayElement | null {
  return orderedElements()[n - 1] ?? null;
}

function animation(kind: AnimationKind | undefined, fallback: AnimationKind) {
  const k = kind ?? fallback;
  return {
    kind: k,
    duration: k === "typewriter" ? 1.2 : 0.4,
    easing: k === "pop" ? ("backOut" as const) : ("easeOut" as const),
  };
}

/**
 * Correct an image element's height to its true aspect once it has decoded.
 * Placing it square first and fixing it up beats blocking the whole plan on a
 * network fetch, and the correction lands before the next paint.
 */
async function fitImageHeight(id: string, src: string, aspect: number) {
  try {
    const img = await loadImage(src);
    if (!img.naturalWidth || !img.naturalHeight) return;
    const store = useOverlayStore.getState();
    const element = store.elements.find((e) => e.id === id);
    if (!element) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    const h = Math.min(0.82, (element.rect.w * aspect) / ratio);
    store.updateElement(id, {
      rect: { ...element.rect, h, y: Math.min(element.rect.y, 1 - h - 0.04) },
    });
  } catch {
    // The placeholder already tells the person the picture did not arrive.
  }
}

/* ------------------------------- image fetch ------------------------------- */

interface FetchedImage {
  url: string;
  width?: number;
  height?: number;
}

async function requestImage(
  body: unknown,
  path: string,
  signal?: AbortSignal
): Promise<FetchedImage> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = (await res.json()) as {
    success?: boolean;
    image?: { url?: string; width?: number; height?: number } | null;
    error?: { message?: string };
    reason?: string;
  };
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message ?? `Request to ${path} failed.`);
  }
  if (!json.image?.url) {
    throw new Error(json.reason ?? "Nothing usable came back.");
  }
  return { url: json.image.url, width: json.image.width, height: json.image.height };
}

export function generateImage(
  prompt: string,
  signal?: AbortSignal
): Promise<FetchedImage> {
  return requestImage(
    { prompt, width: 1024, height: 1024, transparent: false },
    "/api/image",
    signal
  );
}

export function searchPhoto(
  query: string,
  brief: string,
  signal?: AbortSignal
): Promise<FetchedImage> {
  return requestImage({ query, brief: brief || query }, "/api/visual", signal);
}

/* ------------------------------ subtitle style ----------------------------- */

function subtitleSize(size: SizeName | undefined, current: number): number {
  if (!size) return current;
  return { xs: 0.034, s: 0.044, m: 0.055, l: 0.068, xl: 0.086 }[size];
}

export function regenerateCues(style?: Partial<SubtitleStyle>) {
  const editor = useEditorStore.getState();
  const overlay = useOverlayStore.getState();
  const merged = { ...overlay.subtitles.style, ...style };
  const cuts = getCutRanges(editor.words, editor.duration, editor.manualCuts);
  const cues = cuesFromStyle(editor.words, cuts, merged, overlay.aspect);
  overlay.setCues(cues);
  return cues.length;
}

/* -------------------------------- execution -------------------------------- */

async function runOne(
  op: AgentOp,
  ctx: OpsContext,
  signal?: AbortSignal
): Promise<OpResult> {
  const overlay = useOverlayStore.getState();

  switch (op.op) {
    case "addText": {
      const { start, end } = resolveWindow(op, ctx);
      const look = resolveTextLook(op);
      const fontSize = TEXT_SIZE[look.size] * look.scale;
      const w = textWidthFor(look.position);
      const h = textBoxHeight(fontSize);
      const rect = resolveRect(look.position, w, h, "lower-third");

      overlay.addText({
        text: op.text,
        name: op.text.slice(0, 28),
        start,
        end,
        rect,
        fontSize,
        ...look.fields,
        ...(op.color ? { color: op.color } : {}),
        ...(op.background !== undefined ? { background: op.background } : {}),
        ...(op.align ? { align: op.align } : {}),
        ...(op.uppercase !== undefined ? { uppercase: op.uppercase } : {}),
        enter: look.enter,
        exit: look.exit,
      });
      const named = op.template ? ` (${op.template})` : "";
      return { ok: true, message: `Added text “${op.text.slice(0, 40)}”${named}` };
    }

    case "addImage": {
      if (!op.prompt && !op.query) {
        return { ok: false, message: "addImage needs either a prompt or a query." };
      }
      const { start, end } = resolveWindow(op, ctx);
      const w = IMAGE_SIZE[op.size ?? "m"];
      const rect = resolveRect(op.position, w, w, "right");

      let image: FetchedImage;
      try {
        image = op.prompt
          ? await generateImage(op.prompt, signal)
          : await searchPhoto(op.query!, op.prompt ?? op.query!, signal);
      } catch (err) {
        return {
          ok: false,
          message: `Couldn't get that picture — ${err instanceof Error ? err.message : "the request failed"}`,
        };
      }

      const id = overlay.addImage(image.url, {
        name: (op.prompt ?? op.query ?? "Image").slice(0, 28),
        start,
        end,
        rect,
        prompt: op.prompt,
        origin: op.prompt ? "generated" : "search",
        enter: animation(op.enter, "pop"),
        exit: animation(op.exit, "fade"),
      });
      void fitImageHeight(id, image.url, ctx.aspect);
      return {
        ok: true,
        message: op.prompt
          ? `Generated “${op.prompt.slice(0, 40)}”`
          : `Found a photo of “${op.query!.slice(0, 40)}”`,
      };
    }

    case "addShape": {
      const { start, end } = resolveWindow(op, ctx);
      const { w, h } = SHAPE_SIZE[op.size ?? "l"];
      overlay.addShape({
        start,
        end,
        rect: resolveRect(op.position, w, h, "bottom"),
        shape: op.shape,
        ...(op.fill !== undefined ? { fill: op.fill } : {}),
        ...(op.strokeColor !== undefined ? { strokeColor: op.strokeColor } : {}),
      });
      return { ok: true, message: `Added a ${op.shape}` };
    }

    case "updateElement": {
      const element = elementByNumber(op.element);
      if (!element) return { ok: false, message: `There is no element ${op.element}.` };

      const patch: Record<string, unknown> = {};
      if (op.opacity !== undefined) patch.opacity = op.opacity;
      if (op.rotation !== undefined) patch.rotation = op.rotation;

      if (element.kind === "text") {
        if (op.text !== undefined) {
          patch.text = op.text;
          patch.name = op.text.slice(0, 28);
        }
        if (op.color) patch.color = op.color;
        if (op.background !== undefined) patch.background = op.background;
        if (op.align) patch.align = op.align;
        if (op.uppercase !== undefined) patch.uppercase = op.uppercase;
        if (op.bold !== undefined) patch.fontWeight = op.bold ? 800 : 500;
        if (op.italic !== undefined) patch.italic = op.italic;
        if (op.style) {
          Object.assign(patch, textStyleFields(op.style));
          const scale = textStyleScale(op.style);
          if (scale !== 1) {
            patch.fontSize = (element as TextElement).fontSize * scale;
          }
        }
        if (op.size) {
          patch.fontSize =
            TEXT_SIZE[op.size] * (op.style ? textStyleScale(op.style) : 1);
        }
      } else if (op.text !== undefined) {
        return {
          ok: false,
          message: `Element ${op.element} is a ${element.kind}, so it has no text.`,
        };
      }

      if (!Object.keys(patch).length) {
        return { ok: false, message: `Nothing to change on element ${op.element}.` };
      }
      overlay.updateElement(element.id, patch as Partial<OverlayElement>);
      return { ok: true, message: `Updated element ${op.element}` };
    }

    case "moveElement": {
      const element = elementByNumber(op.element);
      if (!element) return { ok: false, message: `There is no element ${op.element}.` };
      const rect = resolveRect(
        op.position,
        element.rect.w,
        element.rect.h,
        "center"
      );
      overlay.updateElement(element.id, { rect });
      return { ok: true, message: `Moved element ${op.element}` };
    }

    case "resizeElement": {
      const element = elementByNumber(op.element);
      if (!element) return { ok: false, message: `There is no element ${op.element}.` };
      if (element.kind === "text") {
        const fontSize = TEXT_SIZE[op.size];
        overlay.updateElement(element.id, {
          fontSize,
          rect: { ...element.rect, h: textBoxHeight(fontSize) },
        });
      } else {
        // Keep the element's own proportions and its centre while scaling.
        const w = element.kind === "image" ? IMAGE_SIZE[op.size] : SHAPE_SIZE[op.size].w;
        const ratio = element.rect.h / Math.max(0.001, element.rect.w);
        const h = w * ratio;
        overlay.updateElement(element.id, {
          rect: {
            x: element.rect.x + (element.rect.w - w) / 2,
            y: element.rect.y + (element.rect.h - h) / 2,
            w,
            h,
          },
        });
      }
      return { ok: true, message: `Resized element ${op.element}` };
    }

    case "timeElement": {
      const element = elementByNumber(op.element);
      if (!element) return { ok: false, message: `There is no element ${op.element}.` };
      const { start, end } = resolveWindow(
        {
          start: op.start ?? element.start,
          end: op.duration === undefined ? op.end ?? element.end : undefined,
          duration: op.duration,
        },
        ctx
      );
      overlay.updateElement(element.id, { start, end });
      return {
        ok: true,
        message: `Element ${op.element} now runs ${start.toFixed(1)}s–${end.toFixed(1)}s`,
      };
    }

    case "animateElement": {
      const element = elementByNumber(op.element);
      if (!element) return { ok: false, message: `There is no element ${op.element}.` };
      const patch: Partial<OverlayElement> = {};
      if (op.enter) {
        patch.enter = { ...animation(op.enter, "fade"), ...(op.duration ? { duration: op.duration } : {}) };
      }
      if (op.exit) {
        patch.exit = { ...animation(op.exit, "fade"), ...(op.duration ? { duration: op.duration } : {}) };
      }
      if (!op.enter && !op.exit && op.duration) {
        patch.enter = { ...element.enter, duration: op.duration };
        patch.exit = { ...element.exit, duration: op.duration };
      }
      overlay.updateElement(element.id, patch);
      return { ok: true, message: `Animated element ${op.element}` };
    }

    case "removeElement": {
      if (op.element === "all") {
        const count = overlay.elements.length;
        for (const element of [...overlay.elements]) {
          useOverlayStore.getState().removeElement(element.id);
        }
        return { ok: true, message: `Removed ${count} element${count === 1 ? "" : "s"}` };
      }
      const element = elementByNumber(op.element);
      if (!element) return { ok: false, message: `There is no element ${op.element}.` };
      overlay.removeElement(element.id);
      return { ok: true, message: `Removed element ${op.element}` };
    }

    case "setTransition": {
      const boundary = ctx.timeline.boundaries.find((b) => b.index === op.between);
      if (!boundary) {
        return {
          ok: false,
          message: `There is no boundary ${op.between} — the video has ${ctx.timeline.boundaries.length} of them.`,
        };
      }
      overlay.setTransition(op.between, op.kind, op.duration ?? 0.5);
      return {
        ok: true,
        message: `Boundary ${op.between} is now ${op.kind === "none" ? "a straight cut" : op.kind}`,
      };
    }

    case "setAllTransitions": {
      const boundaries = ctx.timeline.boundaries;
      if (!boundaries.length) {
        return { ok: false, message: "The video is a single clip — there is nowhere to put a transition." };
      }
      if (op.kind === "none") {
        overlay.replaceTransitions([]);
        return { ok: true, message: "Cleared every transition" };
      }
      const transitions: Transition[] = boundaries.map((b) => ({
        index: b.index,
        kind: op.kind as TransitionKind,
        duration: op.duration ?? 0.5,
      }));
      overlay.replaceTransitions(transitions);
      return {
        ok: true,
        message: `Set ${transitions.length} boundar${transitions.length === 1 ? "y" : "ies"} to ${op.kind}`,
      };
    }

    case "subtitles": {
      if (op.action === "off") {
        overlay.setSubtitleEnabled(false);
        return { ok: true, message: "Subtitles off" };
      }

      const patch: Partial<SubtitleStyle> = {};
      if (op.preset) {
        const preset = SUBTITLE_PRESETS.find((p) => p.id === op.preset);
        if (preset) Object.assign(patch, preset.style);
      }
      if (op.color) patch.color = op.color;
      if (op.highlight) patch.highlight = op.highlight;
      if (op.background !== undefined) patch.background = op.background;
      if (op.position) patch.position = op.position;
      if (op.uppercase !== undefined) patch.uppercase = op.uppercase;
      if (op.maxCharsPerLine) patch.maxCharsPerLine = op.maxCharsPerLine;
      if (op.maxLines) patch.maxLines = op.maxLines;
      if (op.size) {
        patch.fontSize = subtitleSize(op.size, overlay.subtitles.style.fontSize);
      }

      if (Object.keys(patch).length) overlay.setSubtitleStyle(patch);

      // Line-length changes alter where cues break, so the cues are rebuilt
      // whenever they are turned on, asked for, or re-shaped.
      const shapeChanged =
        patch.maxCharsPerLine !== undefined || patch.maxLines !== undefined;
      const needCues =
        op.action === "regenerate" ||
        shapeChanged ||
        !useOverlayStore.getState().subtitles.cues.length;

      let count = useOverlayStore.getState().subtitles.cues.length;
      if (needCues) count = regenerateCues(patch);

      if (op.action !== "style") {
        useOverlayStore.getState().setSubtitleEnabled(true);
      }

      if (!count) {
        return {
          ok: false,
          message: "There is no transcript to build subtitles from yet.",
        };
      }
      return {
        ok: true,
        message:
          op.action === "style"
            ? "Restyled the subtitles"
            : `Subtitles on — ${count} cues`,
      };
    }

    case "removeFillers": {
      const editor = useEditorStore.getState();
      const ids = findFillerWordIds(editor.words);
      if (!ids.length) return { ok: false, message: "No filler words found." };
      editor.deleteWords(ids);
      return { ok: true, message: `Cut ${ids.length} filler word${ids.length === 1 ? "" : "s"}` };
    }

    case "removeSilences": {
      const editor = useEditorStore.getState();
      const ranges = findSilenceRanges(
        editor.words,
        editor.duration,
        editor.manualCuts,
        op.minDuration ?? MIN_SILENCE_DURATION
      );
      if (!ranges.length) return { ok: false, message: "No silences that long." };
      editor.cutRanges(ranges);
      return { ok: true, message: `Cut ${ranges.length} silence${ranges.length === 1 ? "" : "s"}` };
    }

    case "deletePhrase": {
      const editor = useEditorStore.getState();
      const ids = findPhraseWordIds(
        editor.words.filter((w) => !w.deleted),
        op.text,
        op.occurrence
      );
      if (!ids.length) {
        return { ok: false, message: `“${op.text}” isn't in the transcript.` };
      }
      editor.deleteWords(ids);
      return { ok: true, message: `Cut “${op.text.slice(0, 40)}”` };
    }

    case "deleteRange": {
      const ranges = outputRangeToSource(op.from, op.to, ctx.timeline.keepRanges);
      if (!ranges.length) {
        return {
          ok: false,
          message: `${op.from.toFixed(1)}s–${op.to.toFixed(1)}s isn't in the video (it runs ${ctx.duration.toFixed(1)}s).`,
        };
      }
      useEditorStore.getState().cutRanges(ranges);
      return {
        ok: true,
        message: `Cut ${op.from.toFixed(1)}s–${op.to.toFixed(1)}s`,
      };
    }

    case "keepOnly": {
      const drop = complementToSource(op.ranges, ctx.timeline);
      if (!drop.length) {
        return { ok: false, message: "That already is the whole video." };
      }
      const kept = op.ranges.reduce(
        (n, r) => n + Math.abs(r.to - r.from),
        0
      );
      useEditorStore.getState().cutRanges(drop);
      return {
        ok: true,
        message: `Kept ${op.ranges.length} span${op.ranges.length === 1 ? "" : "s"} — about ${kept.toFixed(1)}s`,
      };
    }

    case "splitAt": {
      const source = outputRangeToSource(
        op.at,
        Math.min(op.at + 0.001, ctx.duration),
        ctx.timeline.keepRanges
      )[0];
      if (!source) {
        return { ok: false, message: `${op.at.toFixed(1)}s isn't inside the video.` };
      }
      const done = useEditorStore.getState().splitAt(source.start);
      return done
        ? { ok: true, message: `Split at ${op.at.toFixed(1)}s` }
        : {
            ok: false,
            message: `Can't split at ${op.at.toFixed(1)}s — it is on a cut or too close to one.`,
          };
    }

    case "captionPhrase": {
      const editor = useEditorStore.getState();
      const live = editor.words.filter((w) => !w.deleted);
      const ids = findPhraseWordIds(live, op.phrase, op.occurrence ?? 1);
      if (!ids.length) {
        return {
          ok: false,
          message: `“${op.phrase}” isn't in the transcript, so there is nothing to caption.`,
        };
      }

      // Times come from the word timings, translated onto the output clock, so
      // the caption lands on the syllable rather than near it.
      const cuts = getCutRanges(editor.words, editor.duration, editor.manualCuts);
      const matched = editor.words.filter((w) => ids.includes(w.id));
      const first = matched[0];
      const last = matched[matched.length - 1];
      const start = originalToEdited(first.start, cuts);
      const end = originalToEdited(last.end, cuts) + (op.hold ?? 0.6);
      if (!(end > start)) {
        return {
          ok: false,
          message: `“${op.phrase}” has been cut out of the video.`,
        };
      }

      const styleName = op.style ?? "title";
      const fontSize = TEXT_SIZE[op.size ?? "l"] * textStyleScale(styleName);
      const w = textWidthFor(op.position);
      const rect = resolveRect(
        op.position,
        w,
        textBoxHeight(fontSize),
        "upper-third"
      );

      overlay.addText({
        text: op.text ?? op.phrase,
        name: (op.text ?? op.phrase).slice(0, 28),
        start,
        end: Math.min(end, ctx.duration || end),
        rect,
        fontSize,
        ...textStyleFields(styleName),
        ...(op.color ? { color: op.color } : {}),
        ...(op.background !== undefined ? { background: op.background } : {}),
        enter: animation(op.enter, "pop"),
        exit: animation(op.exit, "fade"),
      });
      return {
        ok: true,
        message: `“${(op.text ?? op.phrase).slice(0, 32)}” on screen at ${start.toFixed(1)}s, as it is said`,
      };
    }

    case "setFrame": {
      const patch: Record<string, unknown> = { aspect: op.aspect };
      if (op.fit) patch.fit = op.fit;
      if (op.zoom !== undefined) patch.zoom = op.zoom;
      if (op.focusX !== undefined) patch.focusX = op.focusX;
      if (op.focusY !== undefined) patch.focusY = op.focusY;
      if (op.background) patch.background = op.background;
      overlay.setFrame(patch);

      // Cue line length is a function of the frame, so captions cut for the old
      // shape are re-broken for the new one. Same reasoning as the Frame panel.
      const subtitles = useOverlayStore.getState().subtitles;
      if (subtitles.cues.length) regenerateCues();

      return {
        ok: true,
        message:
          op.aspect === "source"
            ? "Frame back to the shape it was shot in"
            : `Frame is now ${op.aspect}`,
      };
    }

    /* ---------------------------------- shots ---------------------------------- */

    case "addShot": {
      const start = Math.max(0, Math.min(op.start, ctx.duration));
      const end = Math.max(start, Math.min(op.end, ctx.duration));
      if (end - start < 0.2) {
        return { ok: false, message: "That shot is too short to see." };
      }

      const specs = op.plates?.length ? op.plates : [{ slot: 0 }];
      const want = regionCount(op.layout, specs.length);
      const plates: Plate[] = [];

      for (let slot = 0; slot < want; slot += 1) {
        const spec = specs.find((p) => p.slot === slot) ?? specs[slot] ?? { slot };
        const base = primaryPlate();
        // `selfCrop` is the footage again, framed tighter — the cutaway that
        // needs no provider and no upload, and the one an editor reaches for
        // most. It is a camera choice, not a different source.
        const isCrop = spec.source === "selfCrop";
        const camera = fitCamera(
          cameraFor({
            kind: spec.camera ?? (isCrop ? "snap" : "hold"),
            amount: spec.amount,
            focusX: spec.focusX,
            focusY: spec.focusY,
          }),
          end - start
        );

        plates.push({
          ...base,
          slot,
          source:
            spec.source === "solid"
              ? { kind: "solid", color: spec.color ?? "#0a0a0a" }
              : { kind: "primary" },
          fit: spec.fit ?? base.fit,
          camera,
          radius: spec.radius ?? base.radius,
        });
      }

      overlay.addShot({ start, end, layout: op.layout, plates });
      return {
        ok: true,
        message: `${SHOT_LAYOUT_LABELS[op.layout]} from ${start.toFixed(1)}s to ${end.toFixed(1)}s`,
      };
    }

    case "setCamera": {
      const start = Math.max(0, Math.min(op.start, ctx.duration));
      const end = Math.max(start, Math.min(op.end, ctx.duration));
      if (end - start < 0.2) {
        return { ok: false, message: "That is too short a stretch to move over." };
      }

      const camera = fitCamera(
        cameraFor({
          kind: op.camera,
          amount: op.amount,
          focusX: op.focusX,
          focusY: op.focusY,
        }),
        end - start
      );

      // A camera note about a stretch with no shot on it is a request for one:
      // refusing would be technically right and useless, since "push in here"
      // means "make this a shot that pushes in".
      const existing = shotAt({ ...currentComposition(), shots: overlay.shots }, start);
      if (existing) {
        overlay.setCamera(existing.id, 0, camera);
      } else {
        overlay.addShot({
          start,
          end,
          layout: "full",
          plates: [{ ...primaryPlate(), camera }],
        });
      }

      return {
        ok: true,
        message:
          op.camera === "hold"
            ? `Camera holds from ${start.toFixed(1)}s`
            : `${op.camera} at ${start.toFixed(1)}s`,
      };
    }

    case "removeShot": {
      const shot = shotAt({ ...currentComposition(), shots: overlay.shots }, op.at);
      if (!shot) {
        return { ok: false, message: `Nothing framed at ${op.at.toFixed(1)}s.` };
      }
      overlay.removeShot(shot.id);
      return { ok: true, message: `Dropped the shot at ${op.at.toFixed(1)}s` };
    }

    case "autoPunchIns": {
      const editor = useEditorStore.getState();
      const beats = findBeats(editor.words, editor.duration, editor.manualCuts);
      const placed = placePunchIns(beats, {
        perMinute: op.perMinute,
        duration: ctx.duration,
      });

      if (placed.length === 0) {
        return {
          ok: false,
          message: "Nothing in the delivery asked to be punched in on.",
        };
      }

      for (const punch of placed) {
        const camera = fitCamera(
          cameraFor({ kind: "punchIn", amount: op.amount }),
          punch.end - punch.start
        );
        overlay.addShot({
          start: punch.start,
          end: punch.end,
          layout: "full",
          plates: [{ ...primaryPlate(), camera }],
        });
      }

      return {
        ok: true,
        message: `${placed.length} punch-in${placed.length === 1 ? "" : "s"}, on the beats in the delivery`,
      };
    }

    case "setGrade": {
      const base = gradePreset(op.preset) ?? NEUTRAL_GRADE;
      const patch = {
        ...base,
        ...(op.exposure !== undefined ? { exposure: op.exposure } : {}),
        ...(op.contrast !== undefined ? { contrast: op.contrast } : {}),
        ...(op.saturation !== undefined ? { saturation: op.saturation } : {}),
        ...(op.temperature !== undefined ? { temperature: op.temperature } : {}),
        ...(op.vignette !== undefined ? { vignette: op.vignette } : {}),
        ...(op.grain !== undefined ? { grain: op.grain } : {}),
      };

      if (op.at === undefined) {
        overlay.setGrade(op.preset === "none" ? null : patch);
        return {
          ok: true,
          message:
            op.preset === "none"
              ? "Look back to neutral"
              : `“${op.preset}” over the whole video`,
        };
      }

      const shot = shotAt({ ...currentComposition(), shots: overlay.shots }, op.at);
      if (!shot) {
        return {
          ok: false,
          message: `Nothing framed at ${op.at.toFixed(1)}s to grade on its own.`,
        };
      }
      overlay.setGrade(op.preset === "none" ? null : patch, shot.id);
      return {
        ok: true,
        message: `“${op.preset}” on the shot at ${op.at.toFixed(1)}s`,
      };
    }

    default: {
      // Exhaustive: a new op added to the schema without a branch lands here.
      const never: never = op;
      return { ok: false, message: `Unsupported operation: ${JSON.stringify(never)}` };
    }
  }
}

/** Word ids spelling out `phrase`, matched loosely on punctuation and case. */
export function findPhraseWordIds(
  words: { id: number; text: string }[],
  phrase: string,
  occurrence?: number
): number[] {
  const normalise = (s: string) => s.replace(/[^\p{L}\p{N}']/gu, "").toLowerCase();
  const needle = phrase.split(/\s+/).map(normalise).filter(Boolean);
  if (!needle.length) return [];

  const hits: number[][] = [];
  for (let i = 0; i + needle.length <= words.length; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (normalise(words[i + j].text) !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      hits.push(words.slice(i, i + needle.length).map((w) => w.id));
      i += needle.length - 1;
    }
  }
  if (!hits.length) return [];
  if (occurrence) return hits[occurrence - 1] ?? [];
  return hits.flat();
}

/**
 * Run a whole plan in order.
 *
 * Order matters: an `addText` followed by an `updateElement` addressing it
 * has to see the element, so these are sequential rather than parallel even
 * though the image fetches would benefit from overlapping.
 */
/** Operations that change the cut, and therefore the clock everything else uses. */
const CUTTING_OPS: ReadonlySet<AgentOp["op"]> = new Set([
  "removeFillers",
  "removeSilences",
  "deletePhrase",
  "deleteRange",
  "keepOnly",
  "splitAt",
]);

/** Read the current cut back out of the editor store. */
function currentTimeline(): OutputTimeline {
  const s = useEditorStore.getState();
  return buildTimeline(s.words, s.duration, s.manualCuts, s.sceneBoundaries);
}

export async function runPlan(
  ops: AgentOp[],
  ctx: OpsContext,
  onStep?: (result: OpResult) => void,
  signal?: AbortSignal
): Promise<OpResult[]> {
  const results: OpResult[] = [];
  // Mutable across the plan: a cut moves every boundary and shortens the
  // video, so an op that runs after one has to see the new clock. Without
  // this, "cut the fillers then dissolve every cut" sets transitions on
  // boundaries that no longer exist.
  let live: OpsContext = ctx;

  for (const op of ops) {
    if (signal?.aborted) break;
    let result: OpResult;
    try {
      result = await runOne(op, live, signal);
    } catch (err) {
      result = {
        ok: false,
        message: `${op.op} failed — ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }

    if (result.ok && CUTTING_OPS.has(op.op)) {
      const timeline = currentTimeline();
      live = {
        ...live,
        timeline,
        duration: timeline.duration,
        // Keep the playhead inside the shortened video so a later "add a
        // caption here" still lands somewhere real.
        playhead: Math.min(live.playhead, Math.max(0, timeline.duration - 0.2)),
      };
    }

    results.push(result);
    onStep?.(result);
  }
  return results;
}
