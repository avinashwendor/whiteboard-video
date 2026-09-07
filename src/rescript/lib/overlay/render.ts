/**
 * The one renderer.
 *
 * Both the live preview and the exporter call `paintComposition`, so a
 * composition cannot look one way on screen and another in the file. That is
 * the entire reason this module exists as a plain function over a
 * `CanvasRenderingContext2D` rather than as React components drawn in DOM: DOM
 * cannot be encoded, and a second drawing path is a second set of bugs.
 *
 * Nothing here reads global state or the clock. Everything is a pure function
 * of (composition, time, frame size), which is what lets the exporter ask for
 * frames out of order and far faster than real time.
 */

import {
  clamp01,
  drawStateAt,
  tokenProgress,
  type DrawState,
} from "./animation";
import { drawShapePath } from "./shapes";
import type {
  Composition,
  ImageElement,
  ImageMotion,
  OverlayElement,
  ShapeElement,
  SubtitleCue,
  SubtitleStyle,
  TextElement,
} from "./types";

export interface FrameSize {
  width: number;
  height: number;
}

/**
 * Pixels that one unit of "fraction of frame height" is worth for *type*.
 *
 * Type is specified as a fraction of frame height, which is the correct unit
 * for a landscape frame and wrong for a tall one: in 9:16 the height is nearly
 * twice the width, so a caption at 0.07 of it is half the width of the phone
 * before a single letter is measured. Referencing a 4:3-equivalent height
 * instead leaves every landscape and square frame exactly as it was — for those
 * the height is already the smaller number — and only pulls type back on frames
 * taller than 4:3, which is precisely where the old unit broke down.
 *
 * Rects are untouched: a box that is half the frame should stay half the frame
 * whatever its shape. Only the type inside it is corrected.
 */
export function typeUnit(size: FrameSize): number {
  return Math.min(size.height, size.width * (4 / 3));
}

/* ------------------------------ image registry ------------------------------ */

const images = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();
const failed = new Set<string>();

/**
 * Load an image for compositing.
 *
 * `crossOrigin` is never set: the editor is cross-origin isolated, every image
 * it accepts is same-origin (uploads become blob: URLs, generated art is served
 * from /api/asset), and a cross-origin image would taint the canvas and make
 * the export throw at the first `VideoFrame`. Failing the load here is the
 * honest outcome — the element renders as a placeholder instead.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  const done = images.get(src);
  if (done) return Promise.resolve(done);
  const inflight = pending.get(src);
  if (inflight) return inflight;

  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      images.set(src, img);
      pending.delete(src);
      resolve(img);
    };
    img.onerror = () => {
      pending.delete(src);
      failed.add(src);
      reject(new Error(`Could not load image: ${src}`));
    };
    img.src = src;
  });
  pending.set(src, p);
  return p;
}

/** Already-decoded image, or null. Never blocks — the preview draws what it has. */
export function peekImage(src: string): HTMLImageElement | null {
  return images.get(src) ?? null;
}

export function imageFailed(src: string): boolean {
  return failed.has(src);
}

/** Warm every image in a composition. Used before an export starts. */
export async function preloadComposition(c: Composition): Promise<void> {
  const srcs = c.elements
    .filter((e): e is ImageElement => e.kind === "image")
    .map((e) => e.src);
  await Promise.all(
    srcs.map((src) => loadImage(src).catch(() => null))
  );
}

export function forgetImage(src: string) {
  images.delete(src);
  pending.delete(src);
  failed.delete(src);
}

/* --------------------------------- helpers --------------------------------- */

interface Px {
  x: number;
  y: number;
  w: number;
  h: number;
}

function toPixels(
  element: OverlayElement,
  size: FrameSize,
  state: DrawState
): Px {
  const w = element.rect.w * size.width;
  const h = element.rect.h * size.height;
  const x = (element.rect.x + state.dx) * size.width;
  const y = (element.rect.y + state.dy) * size.height;
  return { x, y, w, h };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

/**
 * Wrap `text` to `maxWidth`, honouring explicit newlines first.
 * `ctx` must already have the final font set.
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** `ctx.letterSpacing` is not in every engine; fall back to no tracking. */
function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number) {
  if ("letterSpacing" in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${px}px`;
  }
}

/**
 * Resolve `var(--custom-prop)` inside a font-family list.
 *
 * `ctx.font` is parsed as CSS, but *without* a cascade — custom properties do
 * not resolve, and rather than throwing, the assignment is silently ignored and
 * the context keeps its 10px sans-serif default. So a family list carrying
 * `var(--font-geist-sans)` renders every caption as unreadably small text with
 * no error anywhere. Element styles are stored with the variable (it is the
 * right thing for the DOM half of the editor), so it is resolved here, once per
 * distinct list.
 */
const familyCache = new Map<string, string>();

export function resolveFontFamily(family: string): string {
  const cached = familyCache.get(family);
  if (cached) return cached;

  const resolved = family.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
    (_match, name: string, fallback = "") => {
      if (typeof document === "undefined") return fallback.trim();
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
      return value || fallback.trim();
    }
  );

  // A list that resolved to nothing but commas would be invalid too.
  const cleaned =
    resolved
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .join(", ") || "system-ui, sans-serif";

  familyCache.set(family, cleaned);
  return cleaned;
}

/** Clear the cache when the document's fonts change (theme or font swap). */
export function forgetFonts() {
  familyCache.clear();
}

function fontString(el: {
  italic?: boolean;
  fontWeight: number;
  fontFamily: string;
}, sizePx: number): string {
  return `${el.italic ? "italic " : ""}${el.fontWeight} ${sizePx}px ${resolveFontFamily(el.fontFamily)}`;
}

/**
 * Set `ctx.font`, falling back to a plain stack if the browser rejected it.
 * A rejected assignment is silent, so it is checked rather than assumed.
 */
function setFont(
  ctx: CanvasRenderingContext2D,
  el: { italic?: boolean; fontWeight: number; fontFamily: string },
  sizePx: number
) {
  const wanted = fontString(el, sizePx);
  ctx.font = wanted;
  if (!ctx.font.includes(`${Math.round(sizePx)}px`) && !ctx.font.includes(`${sizePx}px`)) {
    ctx.font = `${el.italic ? "italic " : ""}${el.fontWeight} ${sizePx}px system-ui, sans-serif`;
  }
}

/* -------------------------------- elements --------------------------------- */

function drawText(
  ctx: CanvasRenderingContext2D,
  el: TextElement,
  size: FrameSize,
  state: DrawState,
  box: Px
) {
  const fontPx = el.fontSize * typeUnit(size);
  if (fontPx <= 0) return;

  setFont(ctx, el, fontPx);
  setLetterSpacing(ctx, el.letterSpacing * fontPx);
  ctx.textBaseline = "top";

  const padPx = el.padding * fontPx;
  const innerWidth = Math.max(1, box.w - padPx * 2);

  let content = el.uppercase ? el.text.toUpperCase() : el.text;
  if (state.charFraction < 1) {
    // Typewriter counts printable characters, not lines, so the reveal rate is
    // even regardless of where the wraps land.
    const keep = Math.ceil(content.length * clamp01(state.charFraction));
    content = content.slice(0, keep);
  }

  const lines = wrapText(ctx, content, innerWidth);
  const lineHeight = fontPx * el.lineHeight;
  const textHeight = lines.length * lineHeight;

  // The rect is the *box*; text is vertically centred inside it so that
  // resizing the box does not make the type jump.
  const originY = box.y + (box.h - textHeight) / 2;

  if (el.background) {
    ctx.save();
    if (el.shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = fontPx * 0.4;
      ctx.shadowOffsetY = fontPx * 0.1;
    }
    ctx.fillStyle = el.background;
    roundRect(
      ctx,
      box.x,
      originY - padPx,
      box.w,
      textHeight + padPx * 2,
      el.radius * Math.min(box.w, textHeight + padPx * 2)
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  if (el.shadow && !el.background) {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = fontPx * 0.35;
    ctx.shadowOffsetY = fontPx * 0.08;
  }

  /** Draw one run of text, with the element's stroke and fill. */
  const stamp = (run: string, x: number, y: number) => {
    if (el.strokeColor && el.strokeWidth > 0) {
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth * fontPx;
      ctx.strokeText(run, x, y);
    }
    ctx.fillStyle = el.color;
    ctx.fillText(run, x, y);
  };

  // Tokens are counted across the whole element, not per line, so the stagger
  // runs continuously through a wrapped caption instead of restarting — a
  // reveal that begins again on the second line reads as two captions.
  const tokens = state.tokens;
  const perLine = tokens
    ? lines.map((line) => splitTokens(line, tokens.unit))
    : null;
  const totalTokens = perLine
    ? perLine.reduce((sum, parts) => sum + parts.length, 0)
    : 0;
  let tokenIndex = 0;

  lines.forEach((line, i) => {
    const metrics = ctx.measureText(line);
    let x = box.x + padPx;
    if (el.align === "center") x = box.x + (box.w - metrics.width) / 2;
    else if (el.align === "right") x = box.x + box.w - padPx - metrics.width;
    const y = originY + i * lineHeight;

    if (!perLine || !tokens) {
      stamp(line, x, y);
      return;
    }

    // Laid out from the *undivided* line, so the tokens sit exactly where they
    // would have without an animation. Measuring each token on its own and
    // adding the widths drifts, because a space at the end of a run is
    // measured differently from a space between two glyphs.
    let cursor = x;
    for (const token of perLine[i]) {
      const width = ctx.measureText(token).width;
      const p = tokenProgress(tokens.p, tokenIndex, totalTokens, tokens.stagger);
      tokenIndex += 1;

      if (token.trim() && p > 0) {
        const own = tokenState(state, p);
        ctx.save();
        // The mask is per token and clips to the line, so a word rising out
        // from behind its own baseline is hidden by the line above's space
        // rather than by a box drawn around it.
        if (own.rise < 1) {
          ctx.beginPath();
          ctx.rect(cursor - 1, y, width + 2, lineHeight * own.rise);
          ctx.clip();
        }
        ctx.globalAlpha *= own.opacity;
        stamp(
          token,
          cursor + own.dx * size.width,
          y + own.dy * lineHeight
        );
        ctx.restore();
      }
      cursor += width;
    }
  });
  ctx.restore();
  setLetterSpacing(ctx, 0);
}

/**
 * Split a line into the units a staggered reveal moves.
 *
 * Trailing spaces stay attached to the word before them so the cursor advances
 * by exactly the width the undivided line would have used — the whole point of
 * laying out from the original measurement.
 */
function splitTokens(line: string, unit: "word" | "char"): string[] {
  if (unit === "char") return Array.from(line);
  return line.match(/\S+\s*/g) ?? [line];
}

/** One token's own progress through the element's animation. */
function tokenState(state: DrawState, p: number): DrawState {
  // Re-derived from the element's kind rather than scaled from the element's
  // state: the state carries where the *whole* element is, which for a
  // staggered reveal is nowhere in particular.
  const eased = p;
  return {
    ...state,
    opacity: state.opacity === 0 ? 0 : eased,
    dy: state.rise < 1 ? (1 - eased) * 0.9 : state.dy * (1 - eased),
    dx: state.dx * (1 - eased),
    rise: state.rise < 1 ? eased : 1,
  };
}

/**
 * How far a Ken Burns move travels, at amount 1.
 *
 * 6% of zoom over the life of the shot, or 4% of the box in pan. Both are under
 * what anybody consciously registers, which is the entire specification: the
 * move exists so the picture does not read as dead, and a still that visibly
 * slides has become a slideshow transition instead.
 */
const KEN_BURNS_ZOOM = 0.06;
const KEN_BURNS_PAN = 0.04;

/**
 * The transform for a still's slow move, at progress `p` through its life.
 *
 * `cover` is forced while a move is on, and it has to be: `contain` fits the
 * whole picture in the box, so panning it reveals the empty box behind it and
 * zooming it out shrinks the picture away from its own frame. There is nothing
 * to move *into* unless the picture is already larger than what you can see.
 */
export function kenBurns(
  motion: ImageMotion | undefined,
  p: number
): { zoom: number; dx: number; dy: number } {
  if (!motion || motion.kind === "none") return { zoom: 1, dx: 0, dy: 0 };
  const amount = Math.max(0, Math.min(2, motion.amount));
  const eased = Math.max(0, Math.min(1, p));

  switch (motion.kind) {
    case "zoomIn":
      return { zoom: 1 + KEN_BURNS_ZOOM * amount * eased, dx: 0, dy: 0 };
    case "zoomOut":
      return { zoom: 1 + KEN_BURNS_ZOOM * amount * (1 - eased), dx: 0, dy: 0 };
    case "panLeft":
      // Held slightly zoomed throughout, or the pan would expose the edge.
      return {
        zoom: 1 + KEN_BURNS_PAN * amount,
        dx: -KEN_BURNS_PAN * amount * (eased - 0.5),
        dy: 0,
      };
    case "panRight":
      return {
        zoom: 1 + KEN_BURNS_PAN * amount,
        dx: KEN_BURNS_PAN * amount * (eased - 0.5),
        dy: 0,
      };
    default:
      return { zoom: 1, dx: 0, dy: 0 };
  }
}

function drawImageElement(
  ctx: CanvasRenderingContext2D,
  el: ImageElement,
  box: Px,
  /** 0..1 through the element's life on screen. Drives the slow move. */
  progress = 0
) {
  const img = peekImage(el.src);
  const radius = el.radius * Math.min(box.w, box.h);

  if (!img || !img.naturalWidth) {
    // A visible placeholder beats a silent gap: the person can see the element
    // is there and that its picture has not arrived (or failed).
    ctx.save();
    roundRect(ctx, box.x, box.y, box.w, box.h, radius);
    ctx.fillStyle = imageFailed(el.src)
      ? "rgba(220,38,38,0.18)"
      : "rgba(255,255,255,0.10)";
    ctx.fill();
    ctx.strokeStyle = imageFailed(el.src)
      ? "rgba(248,113,113,0.7)"
      : "rgba(255,255,255,0.35)";
    ctx.lineWidth = Math.max(1, box.h * 0.006);
    ctx.setLineDash([box.h * 0.04, box.h * 0.03]);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.save();
  if (el.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = Math.min(box.w, box.h) * 0.08;
    ctx.shadowOffsetY = Math.min(box.w, box.h) * 0.02;
  }
  roundRect(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.clip();

  const move = kenBurns(el.motion, progress);
  const moving = move.zoom !== 1 || move.dx !== 0 || move.dy !== 0;
  // A move needs something to move into, and `contain` has nothing: the whole
  // picture already fits, so panning it exposes the box behind it.
  const fit = moving ? "cover" : el.fit;
  const scale =
    (fit === "cover"
      ? Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight)
      : Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight)) * move.zoom;
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(
    img,
    box.x + (box.w - dw) / 2 + move.dx * box.w,
    box.y + (box.h - dh) / 2 + move.dy * box.h,
    dw,
    dh
  );
  ctx.restore();
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  el: ShapeElement,
  size: FrameSize,
  box: Px,
  state: DrawState
) {
  // A named mark draws itself on, using the reveal the animation already
  // computes — so `wipeRight` on an arrow becomes the arrow being drawn rather
  // than a rectangle sliding over it.
  if (el.shape === "path") {
    const drawn = drawShapePath(ctx, el.pathName ?? "arrow", box, size, {
      stroke: el.strokeColor,
      fill: el.fill,
      strokeWidth: el.strokeWidth,
      progress: state.reveal,
    });
    // An unknown name falls through to a rectangle rather than drawing nothing:
    // an element that is invisible is one nobody can select to fix.
    if (drawn) return;
  }

  const lineWidth = el.strokeWidth * size.height;
  ctx.save();
  if (el.shape === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(
      box.x + box.w / 2,
      box.y + box.h / 2,
      box.w / 2,
      box.h / 2,
      0,
      0,
      Math.PI * 2
    );
  } else if (el.shape === "line") {
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + box.h / 2);
    ctx.lineTo(box.x + box.w, box.y + box.h / 2);
  } else {
    roundRect(ctx, box.x, box.y, box.w, box.h, el.radius * Math.min(box.w, box.h));
  }
  if (el.fill && el.shape !== "line") {
    ctx.fillStyle = el.fill;
    ctx.fill();
  }
  if (el.strokeColor && lineWidth > 0) {
    ctx.strokeStyle = el.strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();
}

/** Draw one element with its animation state applied. */
export function paintElement(
  ctx: CanvasRenderingContext2D,
  element: OverlayElement,
  size: FrameSize,
  t: number
) {
  const state = drawStateAt(element, t);
  if (!state || state.opacity <= 0.001) return;

  const box = toPixels(element, size, state);
  if (box.w <= 0 || box.h <= 0) return;

  ctx.save();
  ctx.globalAlpha = clamp01(state.opacity);

  if (state.blur > 0) {
    ctx.filter = `blur(${state.blur * size.height}px)`;
  }

  // Rotation and animated scale both act about the element's centre.
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (element.rotation || state.scale !== 1) {
    ctx.translate(cx, cy);
    if (element.rotation) ctx.rotate((element.rotation * Math.PI) / 180);
    if (state.scale !== 1) ctx.scale(state.scale, state.scale);
    ctx.translate(-cx, -cy);
  }

  if (state.reveal < 1) {
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w * clamp01(state.reveal), box.h);
    ctx.clip();
  }

  switch (element.kind) {
    case "text":
      drawText(ctx, element, size, state, box);
      break;
    case "image": {
      // Progress through the element's own life, not the video's, so a picture
      // up for three seconds completes its move in three seconds whether it
      // sits at the top of the video or the end.
      const life = Math.max(0.001, element.end - element.start);
      drawImageElement(ctx, element, box, (t - element.start) / life);
      break;
    }
    case "shape":
      drawShape(ctx, element, size, box, state);
      break;
  }

  ctx.restore();
  ctx.filter = "none";
}

/* -------------------------------- subtitles -------------------------------- */

export function cueAt(cues: SubtitleCue[], t: number): SubtitleCue | null {
  // Cues are kept sorted; a linear scan is fine at the counts involved and
  // avoids a stale binary search when the AI inserts one out of order.
  for (const cue of cues) {
    if (t >= cue.start && t < cue.end) return cue;
  }
  return null;
}

function subtitleLines(
  ctx: CanvasRenderingContext2D,
  cue: SubtitleCue,
  style: SubtitleStyle,
  maxWidth: number
): string[] {
  const text = style.uppercase ? cue.text.toUpperCase() : cue.text;
  const lines = wrapText(ctx, text, maxWidth);
  if (lines.length <= style.maxLines) return lines;
  // Overflow is folded into the last permitted line rather than dropped, so no
  // spoken words silently vanish from the burn-in.
  const kept = lines.slice(0, style.maxLines - 1);
  kept.push(lines.slice(style.maxLines - 1).join(" "));
  return kept;
}

/**
 * A word, stripped to what two spellings of it have in common.
 *
 * Punctuation and case are what stop "faster," matching "faster", which is the
 * only comparison this file ever makes between two tokens.
 */
function bareWord(token: string): string {
  return token.replace(/[^\p{L}\p{N}']/gu, "").toLowerCase();
}

/**
 * Should this word be stressed?
 *
 * "auto" is a shape rule, not an understanding one: anything carrying a digit,
 * a currency amount or a percentage, and anything written in capitals in the
 * transcript. Those are what a person emphasises out loud, near enough, and
 * the rule costs a regex rather than a model call. Keywords are always
 * stressed, on top.
 *
 * The deliberate omission is emphasis by *meaning*. Guessing which adjective
 * matters produces a caption where a different word is coloured every line,
 * which reads as a fault rather than as emphasis.
 */
function stressed(token: string, style: SubtitleStyle): boolean {
  const bare = bareWord(token);
  if (!bare) return false;
  if (style.keywords.length && style.keywords.includes(bare)) return true;
  if (style.emphasis !== "auto") return false;
  if (/\d/.test(token)) return true;
  if (/[%$£€₹]/.test(token)) return true;
  // Written in capitals in the source. Two letters or more, so "I" and "A" do
  // not light up every line.
  const letters = token.replace(/[^\p{L}]/gu, "");
  return letters.length >= 2 && letters === letters.toUpperCase();
}

export function paintSubtitle(
  ctx: CanvasRenderingContext2D,
  cue: SubtitleCue,
  style: SubtitleStyle,
  size: FrameSize,
  t: number
) {
  const fontPx = style.fontSize * typeUnit(size);
  if (fontPx <= 0) return;

  ctx.save();
  setFont(ctx, style, fontPx);
  ctx.textBaseline = "top";

  const maxWidth = size.width * 0.86;
  const lines = subtitleLines(ctx, cue, style, maxWidth);
  const lineHeight = fontPx * 1.25;
  const blockHeight = lines.length * lineHeight;
  const padX = fontPx * 0.5;
  const padY = fontPx * 0.28;

  let top: number;
  if (style.position === "top") top = style.margin * size.height;
  else if (style.position === "center") top = (size.height - blockHeight) / 2;
  else top = size.height - style.margin * size.height - blockHeight;

  // Entrance is per-cue, so each line lands rather than the track fading once.
  let alpha = 1;
  let scale = 1;
  const into = t - cue.start;
  if (style.animation === "fade") {
    alpha = clamp01(into / 0.12);
  } else if (style.animation === "pop") {
    const p = clamp01(into / 0.18);
    alpha = clamp01(p * 2);
    scale = 0.9 + 0.1 * (1 - Math.pow(1 - p, 3));
  } else if (style.animation === "bounce") {
    // Overshoots and settles, in 220ms. The overshoot is the difference
    // between a caption that appears and one that lands.
    const p = clamp01(into / 0.22);
    alpha = clamp01(p * 3);
    const eased = 1 - Math.pow(1 - p, 3);
    scale = 0.72 + 0.36 * eased - 0.08 * Math.sin(eased * Math.PI);
  }
  ctx.globalAlpha = alpha;

  if (scale !== 1) {
    const cx = size.width / 2;
    const cy = top + blockHeight / 2;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }

  // The live word, for karaoke and for the grow-on-speech. Needed whenever
  // either is asked for, not only under the karaoke animation — the two were
  // one thing until a preset wanted a bounce with a plain colour.
  const wantsLive =
    (style.animation === "karaoke" || style.activeScale !== 1) && !!cue.words?.length;
  const active = wantsLive
    ? (cue.words!.find((w) => t >= w.start && t < w.end) ?? null)
    : null;
  const highlighting = style.animation === "karaoke";
  const emphasising = style.emphasis === "auto" || style.keywords.length > 0;
  // Word-by-word drawing costs a `measureText` per token, so it is only taken
  // when something actually differs between words.
  const perWord = !!active || emphasising;
  const emphasisInk = style.emphasisColor ?? style.highlight;

  lines.forEach((line, i) => {
    const width = ctx.measureText(line).width;
    const x = (size.width - width) / 2;
    const y = top + i * lineHeight;

    if (style.background) {
      ctx.save();
      ctx.fillStyle = style.background;
      roundRect(
        ctx,
        x - padX,
        y - padY,
        width + padX * 2,
        lineHeight,
        fontPx * 0.22
      );
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    if (style.shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = fontPx * 0.3;
      ctx.shadowOffsetY = fontPx * 0.06;
    }
    if (style.outline) {
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.lineWidth = fontPx * 0.14;
      ctx.strokeText(line, x, y);
    }

    if (perWord) {
      // Re-draw word by word so the live one and the stressed ones can differ.
      // Splitting on the rendered line keeps spacing identical to the plain
      // path — laying each token out from its own measurement would drift.
      const liveBare = active ? bareWord(active.text) : "";
      let cursor = x;
      for (const token of line.split(/(\s+)/)) {
        const tokenWidth = ctx.measureText(token).width;
        if (token.trim()) {
          const bare = bareWord(token);
          const live = !!liveBare && bare.length > 0 && bare === liveBare;
          ctx.fillStyle =
            live && highlighting
              ? style.highlight
              : stressed(token, style)
                ? emphasisInk
                : style.color;

          if (live && style.activeScale !== 1) {
            // Grown about its own centre, so the words either side do not move.
            // Scaling the line instead is the obvious implementation and it
            // makes the whole caption jitter once a word, which reads as a
            // rendering fault rather than as emphasis.
            ctx.save();
            const cx = cursor + tokenWidth / 2;
            const cy = y + lineHeight / 2;
            ctx.translate(cx, cy);
            ctx.scale(style.activeScale, style.activeScale);
            ctx.translate(-cx, -cy);
            ctx.fillText(token, cursor, y);
            ctx.restore();
          } else {
            ctx.fillText(token, cursor, y);
          }
        }
        cursor += tokenWidth;
      }
    } else {
      ctx.fillStyle = style.color;
      ctx.fillText(line, x, y);
    }
    ctx.restore();
  });

  ctx.restore();
}

/* ------------------------------- composition ------------------------------- */

/**
 * Paint the whole overlay layer for edited-timeline second `t`.
 * The caller has already drawn the video frame (and any transition) beneath.
 */
export function paintComposition(
  ctx: CanvasRenderingContext2D,
  composition: Composition,
  size: FrameSize,
  t: number
) {
  const ordered = [...composition.elements].sort((a, b) => a.z - b.z);
  for (const element of ordered) paintElement(ctx, element, size, t);

  const { subtitles } = composition;
  if (subtitles.enabled && subtitles.cues.length) {
    const cue = cueAt(subtitles.cues, t);
    if (cue) paintSubtitle(ctx, cue, subtitles.style, size, t);
  }
}
