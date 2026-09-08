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
import { typefaceStack } from "./typefaces";
import { knownShape } from "./shapes";
import { defaultGainFor } from "./audio";
import { momentsFrom, planSfx, soundEffect, type PlacedSfx } from "./sfx";
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
  type AmbientKind,
  type AmbientSpec,
  type AnimationKind,
  type CounterSpec,
  type AnimationSpec,
  type OverlayElement,
  type Plate,
  type ImageMotionKind,
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

/**
 * Which way the next still moves.
 *
 * Rotated across a session rather than chosen at random. Random gives you two
 * identical drifts in a row about a third of the time, which is exactly the
 * thing the variation exists to avoid; and a counter is reproducible, which
 * random is not.
 */
let motionCursor = 0;
const MOTION_CYCLE = ["zoomIn", "panRight", "zoomOut", "panLeft"] as const;

function imageMotion(
  asked: "auto" | "none" | "zoomIn" | "zoomOut" | "panLeft" | "panRight" | undefined
): ImageMotionKind {
  if (asked && asked !== "auto") return asked;
  const kind = MOTION_CYCLE[motionCursor % MOTION_CYCLE.length];
  motionCursor += 1;
  return kind;
}

/** Testing seam, and called when a project is opened. */
export function resetImageMotion() {
  motionCursor = 0;
}

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

/**
 * Read an ambient motion out of an op.
 *
 * Accepts the bare name — which is what the agent should almost always write —
 * as well as the object form for the rare case that wants a smaller amount.
 * `"none"` comes back as a spec rather than `undefined`, because setting a
 * motion to none has to be able to *remove* one.
 */
function ambient(
  value: AmbientKind | { kind: AmbientKind; amount?: number; speed?: number } | undefined
): AmbientSpec | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? { kind: value } : value;
}

/** A counter op field as the element stores it. */
function counter(
  value: { from: number; to: number; decimals?: number; prefix?: string; suffix?: string; hold?: number } | undefined
): CounterSpec | undefined {
  return value ? { ...value } : undefined;
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

/**
 * What a template does once it has landed, by what the template is for.
 *
 * Set here rather than on all fifty-two templates because it is a property of
 * the *job*, not of the look: anything that sits under someone talking holds
 * still, because a name badge that drifts while a person speaks is a
 * distraction rather than a flourish; anything that is on screen alone is
 * allowed to be alive, because a full-frame title that freezes for three
 * seconds is the thing that makes an automatic edit read as automatic.
 *
 * Overridable per operation. These are defaults, not decisions.
 */
const AMBIENT_BY_CATEGORY: Record<string, AmbientSpec | undefined> = {
  title: { kind: "float" },
  callout: { kind: "wobble", amount: 0.7 },
  data: { kind: "breathe" },
  cta: { kind: "pulse", amount: 0.8 },
  lowerThird: undefined,
  caption: undefined,
};

function resolveTextLook(op: {
  template?: string;
  style?: Parameters<typeof textStyleFields>[0];
  typeface?: string;
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
  ambient: AmbientSpec | undefined;
} {
  const template = op.template ? textTemplate(op.template) : null;
  // A named face beats whatever the template or the style would have set. The
  // two are orthogonal — "a badge, in Bungee" is a sentence, and the operation
  // has to be able to say it.
  const face = op.typeface ? { fontFamily: typefaceStack(op.typeface) } : {};

  if (!template) {
    const styleName = op.style ?? "plain";
    return {
      fields: { ...textStyleFields(styleName), ...face },
      scale: textStyleScale(styleName),
      size: op.size ?? "l",
      position: op.position,
      enter: animation(op.enter, "slideUp"),
      exit: animation(op.exit, "fade"),
      ambient: undefined,
    };
  }

  const { sizeScale, ...look } = template.style;
  return {
    fields: { ...look, ...face } as ReturnType<typeof textStyleFields>,
    scale: sizeScale ?? 1,
    size: op.size ?? template.size,
    position: op.position ?? template.position,
    // An explicit kind wins, but the template's timing is kept: a template
    // whose reveal is 0.7s per word does not become a 0.4s fade because
    // someone named a different kind.
    enter: op.enter ? animation(op.enter, "slideUp") : template.enter,
    exit: op.exit ? animation(op.exit, "fade") : template.exit,
    ambient: AMBIENT_BY_CATEGORY[template.category],
  };
}

/* ---------------------------------- media ---------------------------------- */

interface FoundMedia {
  title: string;
  artist: string;
  downloadUrl: string;
  duration?: number;
  licence: { name: string; attributionRequired: boolean };
  pageUrl?: string;
}

/**
 * The first commercially-usable result for a query.
 *
 * "First" is the right answer here rather than a weak one: the route already
 * ranks best-first and filters out anything that cannot be published, so the
 * top result is the best *usable* one. Offering the model a list to choose from
 * would mean sending it twenty titles it has no way to judge between.
 */
async function findMedia(
  query: string,
  kind: "music" | "sfx" | "video",
  signal?: AbortSignal
): Promise<FoundMedia | null> {
  try {
    const res = await fetch("/api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, kind, limit: 5 }),
      signal,
    });
    const json = (await res.json()) as { success?: boolean; results?: FoundMedia[] };
    if (!json.success) return null;
    return json.results?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Bring the bytes onto our origin, where the mix can read them. */
async function proxyMedia(
  url: string,
  filename: string,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const res = await fetch("/api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "fetch", url, filename: filename.slice(0, 40) }),
      signal,
    });
    const json = (await res.json()) as { success?: boolean; url?: string };
    return json.success && json.url ? json.url : null;
  } catch {
    return null;
  }
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

/**
 * Run tasks with a ceiling on how many are in flight.
 *
 * `autoSfx` places up to half a dozen effects, and each one is a catalogue
 * search followed by a proxy fetch — twelve round trips. Serially that is ten
 * to twenty seconds of an edit doing nothing visible, which on a feature whose
 * whole pitch is "one call and the video is sounded" is most of the experience.
 *
 * Not unbounded, though, and the reason is in the original comment this
 * replaces: firing all six at once is how one upstream rate limit becomes six
 * failures instead of one retry. Three is the compromise — most of the speed,
 * and a burst small enough that a catalogue does not push back.
 *
 * Results come back in input order regardless of what finished when, because
 * the log line reads chronologically and a sound at 4s reported after one at
 * 31s reads as a bug in the placement.
 */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await run(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Make an effect rather than find one.
 *
 * Preferred over the catalogue when generation is configured, and the reason is
 * in `sfx.ts`: every entry there already carries a plain-words query — "riser
 * build up sweep", "deep boom bass drop" — written so a catalogue search would
 * match it, which turns out to be exactly the right generation prompt. So the
 * same library serves both paths with no second vocabulary.
 *
 * Generated audio also carries no licence, which removes the one thing that
 * makes catalogue sound awkward in a client's video.
 *
 * Returns null when generation is unavailable or fails, and the caller falls
 * back to searching — a worse effect is better than no effect.
 */
async function makeAudio(
  kind: "sfx" | "music",
  prompt: string,
  seconds: number,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const res = await fetch("/api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate", kind, prompt, seconds }),
      signal,
    });
    const json = (await res.json()) as { success?: boolean; url?: string };
    return json.success && json.url ? json.url : null;
  } catch {
    return null;
  }
}

/**
 * Fetch a named effect and put it on the timeline so it *lands* on `at`.
 *
 * The lead is the whole reason this is a function rather than three lines at
 * each call site. A riser that starts on the cut is announcing something that
 * has already happened; it has to be most of the way through by the time the
 * frame arrives. Every effect carries its own lead and every path has to
 * respect it, including the automatic one.
 */
async function placeEffect(
  placed: PlacedSfx,
  ctx: OpsContext,
  gain: number | undefined,
  signal?: AbortSignal
): Promise<{ ok: boolean; message: string }> {
  const { effect } = placed;
  const start = Math.max(0, Math.min(placed.at + effect.lead, Math.max(0, ctx.duration - 0.1)));
  const end = Math.min(ctx.duration || start + effect.hold, start + effect.hold);
  if (end - start < 0.05) {
    return { ok: false, message: `There is no room for a ${effect.label} at ${placed.at.toFixed(1)}s.` };
  }

  // Generated first, catalogue second. The generated one matches its own
  // description exactly and owes nobody a credit; the catalogue is the fallback
  // for a deployment without a generation key.
  let src = await makeAudio("sfx", effect.query, effect.hold, signal);
  let credit: FoundMedia | null = null;
  if (!src) {
    credit = await findMedia(effect.query, "sfx", signal);
    if (!credit) {
      return { ok: false, message: `No usable ${effect.label} could be made or found.` };
    }
    src = await proxyMedia(credit.downloadUrl, credit.title, signal);
    if (!src) return { ok: false, message: `“${credit.title}” could not be fetched.` };
  }

  useOverlayStore.getState().addAudio({
    kind: "sfx",
    name: `${effect.label} — ${placed.reason}`,
    src,
    start,
    end,
    trimIn: 0,
    gain: gain ?? effect.gain,
    fadeIn: 0,
    // A hard stop on a tail that is still ringing is more obvious than the
    // effect itself. Short, and never more than a third of the clip.
    fadeOut: Math.min(0.25, (end - start) / 3),
    duck: false,
    loop: false,
    muted: false,
    // A generated sound owes no attribution, and recording that is more use
    // than recording nothing: the credit block is what somebody pastes into a
    // description, and it should say what actually has to be credited.
    credit: credit
      ? {
          title: credit.title,
          artist: credit.artist,
          licence: credit.licence.name,
          url: credit.pageUrl,
          attributionRequired: credit.licence.attributionRequired,
        }
      : {
          title: effect.label,
          artist: "Generated",
          licence: "Generated — no attribution required",
          attributionRequired: false,
        },
  });

  return {
    ok: true,
    message: `${effect.label} ${placed.reason}, at ${placed.at.toFixed(1)}s${credit ? "" : " (generated)"}`,
  };
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
        ...(op.tracking !== undefined ? { letterSpacing: op.tracking } : {}),
        ...(op.stroke !== undefined
          ? {
              strokeWidth: op.stroke,
              // An outline with no colour draws in the fill colour and
              // disappears, which reads as the stroke silently not working.
              strokeColor: op.strokeColor ?? "#000000",
            }
          : op.strokeColor
            ? { strokeColor: op.strokeColor, strokeWidth: 0.08 }
            : {}),
        ...(op.rotation !== undefined ? { rotation: op.rotation } : {}),
        // The operation's own choice, then whatever the template's job implies.
        ...(op.ambient
          ? { ambient: ambient(op.ambient) }
          : look.ambient
            ? { ambient: look.ambient }
            : {}),
        ...(op.count ? { counter: counter(op.count) } : {}),
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
        ...(op.ambient ? { ambient: ambient(op.ambient) } : {}),
        enter: animation(op.enter, "pop"),
        exit: animation(op.exit, "fade"),
        motion: { kind: imageMotion(op.motion), amount: 1 },
      });
      void fitImageHeight(id, image.url, ctx.aspect);
      return {
        ok: true,
        message: op.prompt
          ? `Generated “${op.prompt.slice(0, 40)}”`
          : `Found a photo of “${op.query!.slice(0, 40)}”`,
      };
    }

    case "addBroll": {
      const { start, end } = resolveWindow(op, ctx);
      const w = IMAGE_SIZE[op.size ?? "m"];
      // Sixteen-by-nine inside its own box: stock footage is shot wide, and a
      // square hole for a wide clip crops the thing that was searched for.
      const rect = resolveRect(op.position, w, (w * ctx.aspect) / (16 / 9), "right");

      const found = await findMedia(op.query, "video", signal);
      if (!found) {
        return {
          ok: false,
          message: `No usable clip came back for “${op.query}”. A broader word usually helps.`,
        };
      }
      const src = await proxyMedia(found.downloadUrl, found.title, signal);
      if (!src) {
        return { ok: false, message: `That clip could not be fetched.` };
      }

      overlay.addVideo(src, {
        name: op.query.slice(0, 28),
        query: op.query,
        start,
        end,
        rect,
        rate: op.rate ?? 1,
        ...(op.ambient ? { ambient: ambient(op.ambient) } : {}),
        enter: animation(op.enter, "fade"),
        exit: animation(op.exit, "fade"),
      });
      const owed = found.licence.attributionRequired ? ", credit required" : "";
      return {
        ok: true,
        message: `Cut in “${op.query.slice(0, 40)}” — ${found.artist} (${found.licence.name}${owed})`,
      };
    }

    case "addShape": {
      const { start, end } = resolveWindow(op, ctx);
      const wantsMark = op.shape === "path" || !!op.mark;

      // A name nobody has is a plan that would place an invisible element and
      // report success. Refusing it says which name was wrong, which is the
      // only way the next attempt is better than the last.
      if (wantsMark && !knownShape(op.mark ?? "")) {
        return {
          ok: false,
          message: op.mark
            ? `There is no mark called “${op.mark}”.`
            : "A path shape needs a mark name.",
        };
      }

      const { w, h } = SHAPE_SIZE[op.size ?? "l"];
      // A mark is scaled to fit and centred, so a wide box would just centre it
      // in empty space. Square it off from the smaller side.
      const side = wantsMark ? Math.min(w, h) : 0;
      overlay.addShape({
        start,
        end,
        rect: wantsMark
          ? resolveRect(op.position, side, side, "center")
          : resolveRect(op.position, w, h, "bottom"),
        shape: wantsMark ? "path" : op.shape,
        ...(wantsMark ? { pathName: op.mark, name: op.mark } : {}),
        ...(op.fill !== undefined ? { fill: op.fill } : {}),
        ...(op.strokeColor !== undefined ? { strokeColor: op.strokeColor } : {}),
        ...(op.ambient ? { ambient: ambient(op.ambient) } : {}),
      });
      return {
        ok: true,
        message: wantsMark ? `Drew a ${op.mark}` : `Added a ${op.shape}`,
      };
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
        // Before `style`, so a request that names both a style and a face gets
        // the style's weight and box with the face on top rather than the
        // style's face back.
        if (op.typeface) patch.fontFamily = typefaceStack(op.typeface);
        if (op.color) patch.color = op.color;
        if (op.background !== undefined) patch.background = op.background;
        if (op.align) patch.align = op.align;
        if (op.uppercase !== undefined) patch.uppercase = op.uppercase;
        if (op.bold !== undefined) patch.fontWeight = op.bold ? 800 : 500;
        if (op.italic !== undefined) patch.italic = op.italic;
        if (op.style) {
          Object.assign(patch, textStyleFields(op.style));
          if (op.typeface) patch.fontFamily = typefaceStack(op.typeface);
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
      if (op.ambient) patch.ambient = ambient(op.ambient);
      if (op.count && element.kind === "text") {
        (patch as Partial<TextElement>).counter = counter(op.count);
      }
      overlay.updateElement(element.id, patch);
      const how = op.ambient
        ? ` (${typeof op.ambient === "string" ? op.ambient : op.ambient.kind})`
        : "";
      return { ok: true, message: `Animated element ${op.element}${how}` };
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
      if (op.wordsPerCue !== undefined) patch.maxWords = op.wordsPerCue;
      if (op.typeface) patch.fontFamily = typefaceStack(op.typeface);
      if (op.emphasis) patch.emphasis = op.emphasis;
      if (op.keywords) {
        // Matched against words stripped of punctuation and case, so they are
        // stored the same way — otherwise "Growth." never matches "growth".
        patch.keywords = op.keywords
          .map((word) => word.replace(/[^\p{L}\p{N}']/gu, "").toLowerCase())
          .filter(Boolean);
      }
      if (op.emphasisColor) patch.emphasisColor = op.emphasisColor;
      if (op.activeScale !== undefined) patch.activeScale = op.activeScale;
      if (op.size) {
        patch.fontSize = subtitleSize(op.size, overlay.subtitles.style.fontSize);
      }

      if (Object.keys(patch).length) overlay.setSubtitleStyle(patch);

      // Line-length changes alter where cues break, so the cues are rebuilt
      // whenever they are turned on, asked for, or re-shaped.
      // Anything that changes where a cue *breaks*. Colour and weight do not;
      // words-per-cue does, and it is the one people notice when it is missed —
      // asking for one word at a time and getting the old two-line cues
      // restyled looks like the operation was ignored.
      const shapeChanged =
        patch.maxCharsPerLine !== undefined ||
        patch.maxLines !== undefined ||
        patch.maxWords !== undefined;
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
        style: op.style,
      });

      if (placed.length === 0) {
        return {
          ok: false,
          message: "Nothing in the delivery asked to be punched in on.",
        };
      }

      for (const punch of placed) {
        const camera = fitCamera(
          cameraFor({ kind: punch.camera, amount: op.amount }),
          punch.end - punch.start
        );
        overlay.addShot({
          start: punch.start,
          end: punch.end,
          layout: "full",
          plates: [{ ...primaryPlate(), camera }],
        });
      }

      // Named per kind rather than counted as "punch-ins", because with a
      // varied style they are not all punch-ins and a log line that said so
      // would be describing an edit that did not happen.
      const kinds = new Map<string, number>();
      for (const punch of placed) {
        kinds.set(punch.camera, (kinds.get(punch.camera) ?? 0) + 1);
      }
      const described = [...kinds.entries()]
        .map(([kind, n]) => `${n} ${kind}`)
        .join(", ");
      return {
        ok: true,
        message: `${described}, on the beats in the delivery`,
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

    /* ---------------------------------- sound ---------------------------------- */

    case "addVoiceover": {
      const at = Math.max(0, Math.min(op.at ?? ctx.playhead, Math.max(0, ctx.duration - 0.2)));
      const spoken = await speakLine(op.text, op.provider, op.voice, signal);
      if (!spoken) {
        return {
          ok: false,
          message:
            "No voice engine answered. Add ELEVENLABS_API_KEY, DEEPGRAM_API_KEY or CARTESIA_API_KEY.",
        };
      }
      overlay.addAudio({
        kind: "voice",
        name: op.text.slice(0, 32),
        src: spoken.src,
        start: at,
        // Deliberately allowed to run past the end of the video rather than be
        // clipped to it: a line cut off mid-word is worse than one that reaches
        // the last frame, and the exporter trims the mix to length anyway.
        end: at + Math.max(0.2, spoken.seconds),
        trimIn: 0,
        gain: op.gain ?? defaultGainFor("voice"),
        fadeIn: 0.05,
        fadeOut: 0.15,
        // Narration is the thing being listened to. A voiceover that pulls
        // itself down under the speech it is narrating over is fighting the mix.
        duck: false,
        loop: false,
        muted: false,
        credit: {
          title: op.text.slice(0, 40),
          artist: spoken.provider,
          licence: "Generated for this video",
          attributionRequired: false,
        },
      });
      return {
        ok: true,
        message: `Narrated “${op.text.slice(0, 40)}” at ${at.toFixed(1)}s (${spoken.seconds.toFixed(1)}s)`,
      };
    }

    case "addMusic": {
      const isBed = op.kind === "music";
      const start = isBed ? 0 : Math.max(0, Math.min(op.start ?? ctx.playhead, ctx.duration));
      const end = Math.min(op.end ?? (isBed ? ctx.duration : start + 3), ctx.duration);
      if (end - start < 0.2) {
        return { ok: false, message: "That is too short a stretch to put sound under." };
      }

      // Generated first unless the catalogue was asked for by name. A bed made
      // to the description matches it exactly and owes no credit; a searched
      // one is somebody else's recording with a licence attached.
      const wants = op.source ?? "auto";
      let src: string | null = null;
      let found: FoundMedia | null = null;

      if (wants !== "catalogue") {
        src = await makeAudio(op.kind, op.query, end - start, signal);
      }
      if (!src && wants !== "generated") {
        // Searched here rather than by the model: it cannot know what is in a
        // catalogue, and a URL it invented would fail the proxy's allowlist —
        // correctly, but with an error nobody could act on.
        found = await findMedia(op.query, op.kind, signal);
        if (found) src = await proxyMedia(found.downloadUrl, found.title, signal);
      }
      if (!src) {
        return {
          ok: false,
          message:
            wants === "generated"
              ? `That couldn't be generated. Check ELEVENLABS_API_KEY, or leave "source" out to fall back to the catalogue.`
              : `Nothing usable came back for “${op.query}”. A broader word usually helps.`,
        };
      }

      overlay.addAudio({
        kind: op.kind,
        // A generated bed has no title and no artist; the description it was
        // made from is the only honest name for it.
        name: found ? `${found.title} — ${found.artist}` : `${op.query} (generated)`,
        src,
        start,
        end,
        trimIn: 0,
        gain: op.gain ?? defaultGainFor(op.kind),
        fadeIn: isBed ? 1.5 : 0,
        fadeOut: isBed ? 2 : 0,
        duck: isBed,
        // A generated bed is made to length, so it never needs looping.
        loop: isBed && !!found && (found.duration ?? 0) < end - start,
        muted: false,
        credit: found
          ? {
              title: found.title,
              artist: found.artist,
              licence: found.licence.name,
              url: found.pageUrl,
              attributionRequired: found.licence.attributionRequired,
            }
          : {
              title: op.query,
              artist: "Generated",
              licence: "Generated — no attribution required",
              attributionRequired: false,
            },
      });

      // The licence is named in the log, not buried: it is the thing that
      // decides whether the person can publish what was just added.
      if (!found) {
        return { ok: true, message: `Generated “${op.query}” — no credit required` };
      }
      const owed = found.licence.attributionRequired ? ", credit required" : "";
      return {
        ok: true,
        message: `“${found.title}” by ${found.artist} (${found.licence.name}${owed})`,
      };
    }

    case "setMusicLevel": {
      const beds = overlay.audio.filter((clip) => clip.kind === "music");
      if (beds.length === 0) {
        return { ok: false, message: "There is no music to set the level of." };
      }
      for (const bed of beds) {
        overlay.updateAudio(bed.id, {
          gain: op.gain,
          ...(op.duck !== undefined ? { duck: op.duck } : {}),
        });
      }
      return {
        ok: true,
        message: `Music at ${Math.round(op.gain * 100)}%${
          op.duck === false ? ", no ducking" : ""
        }`,
      };
    }

    case "addSfx": {
      const effect = soundEffect(op.effect);
      if (!effect) return { ok: false, message: `There is no effect called “${op.effect}”.` };
      return placeEffect(
        { at: op.at, effect, reason: "as asked" },
        ctx,
        op.gain,
        signal
      );
    }

    case "autoSfx": {
      // Read off the edit, not off the transcript. A boundary is a cut because
      // somebody cut there; a shot with a camera on it is a push because
      // somebody pushed. Neither is guessable from words, which is why this
      // exists rather than the model placing them one at a time.
      const boundaries = ctx.timeline.boundaries.map((b) => b.outTime);
      const pushes = overlay.shots
        .filter((shot) => shot.plates.some((plate) => plate.camera && plate.camera.kind !== "hold"))
        .map((shot) => shot.start);
      const captions = overlay.elements
        .filter((element) => element.kind === "text")
        .map((element) => ({
          at: element.start,
          // The biggest type in the video is its title, whatever it was called
          // when it was added.
          isTitle:
            (element as TextElement).fontSize >=
            Math.max(
              ...overlay.elements
                .filter((e) => e.kind === "text")
                .map((e) => (e as TextElement).fontSize)
            ),
        }));

      const placed = planSfx(momentsFrom({ boundaries, pushes, captions }), {
        style: op.style,
        perMinute: op.perMinute,
        duration: ctx.duration,
      });

      if (!placed.length) {
        return {
          ok: false,
          message:
            "There is nothing to sound yet — no cuts, no camera moves and no captions. Do the edit first, then add the effects.",
        };
      }

      // Three at a time. Serially this was twelve round trips and most of a
      // slow edit; all at once it is one rate limit away from failing whole.
      const results = await mapWithLimit(placed, 3, (one) =>
        placeEffect(one, ctx, undefined, signal)
      );
      const done = results.filter((r) => r.ok).map((r) => r.message);
      const failed = results.filter((r) => !r.ok).map((r) => r.message);

      if (!done.length) {
        return { ok: false, message: `No effects could be fetched — ${failed[0]}` };
      }
      return {
        ok: true,
        message: `${done.length} effect${done.length === 1 ? "" : "s"}: ${done.join("; ")}${
          failed.length ? ` (${failed.length} could not be fetched)` : ""
        }`,
      };
    }

    case "removeSfx": {
      const effects = overlay.audio.filter((clip) => clip.kind === "sfx");
      if (!effects.length) return { ok: false, message: "There are no sound effects to remove." };

      if (op.at === undefined) {
        for (const clip of effects) overlay.removeAudio(clip.id);
        return { ok: true, message: `Removed ${effects.length} sound effect${effects.length === 1 ? "" : "s"}` };
      }

      const at = op.at;
      const nearest = effects.reduce((best, clip) =>
        Math.abs(clip.start - at) < Math.abs(best.start - at) ? clip : best
      );
      overlay.removeAudio(nearest.id);
      return { ok: true, message: `Removed “${nearest.name}”` };
    }

    case "removeMusic": {
      const beds = overlay.audio.filter((clip) => clip.kind === "music");
      if (beds.length === 0) {
        return { ok: false, message: "There is no music to remove." };
      }
      for (const bed of beds) overlay.removeAudio(bed.id);
      return { ok: true, message: `Removed the music` };
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

/**
 * Speak a line, and say how long it turned out to be.
 *
 * The length matters more than it looks. An engine that returns word timings
 * hands one back; the rest do not, and a clip whose length is a guess either
 * cuts the last word off or holds silence after it. Read off the file, it is
 * exact and costs one metadata fetch of something already in the cache.
 */
async function speakLine(
  text: string,
  provider: string | undefined,
  voiceId: string | undefined,
  signal?: AbortSignal
): Promise<{ src: string; seconds: number; provider: string } | null> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      transcript: text,
      ...(provider ? { provider } : {}),
      ...(voiceId ? { voiceId } : {}),
    }),
  });
  const json = (await res.json()) as {
    success?: boolean;
    audioUrl?: string;
    duration?: number;
    provider?: string;
  };
  if (!json.success || !json.audioUrl) return null;
  const seconds = json.duration ?? (await mediaLength(json.audioUrl));
  return { src: json.audioUrl, seconds, provider: json.provider ?? "voice" };
}

/** Length of an audio file, read off the file rather than estimated. */
function mediaLength(src: string): Promise<number> {
  return new Promise((resolve) => {
    const probe = new Audio();
    const done = (value: number) => {
      probe.src = "";
      resolve(value);
    };
    probe.addEventListener("loadedmetadata", () =>
      done(Number.isFinite(probe.duration) ? probe.duration : 4)
    );
    // A file that will not report its length still has to place something, and
    // four seconds of narration is a sentence.
    probe.addEventListener("error", () => done(4));
    probe.preload = "metadata";
    probe.src = src;
  });
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
