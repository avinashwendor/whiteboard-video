"use client";

/**
 * Making sure the type is actually there before the canvas draws it.
 *
 * This is not automatic and its failure is silent, which is the whole reason
 * the file exists. `next/font` declares an `@font-face` and preloads the file,
 * but a browser only *loads* a face when something in the layout uses it — and
 * nothing in the layout uses these. The composition is drawn with
 * `ctx.fillText`, and Canvas2D does not trigger a font load: it takes the first
 * family in the list that is already available and silently draws in that.
 *
 * So a title set in Anton renders in Geist, correctly sized, correctly placed,
 * with no error in the console and nothing to notice unless you know what Anton
 * looks like. And it renders that way *sometimes* — whenever the picker has
 * been open, the DOM has used the face and it happens to be loaded, so the same
 * project exports differently depending on which panels somebody visited.
 * `document.fonts.ready` does not help: a face nobody has requested is not
 * pending, so `ready` resolves immediately having waited for nothing.
 *
 * `document.fonts.load()` is the request. This makes it, for every face at
 * every weight the composition can ask for, once, and hands back a promise the
 * preview and the exporter both await.
 */

import { TYPEFACES } from "./typefaces";
import { forgetFonts, resolveFontFamily } from "./render";

/** In flight or done. One per document; there is only ever one document. */
let pending: Promise<void> | null = null;

/**
 * The first real family name in a resolved stack.
 *
 * `document.fonts.load` takes a font shorthand, and a shorthand naming twelve
 * fallbacks asks for all twelve — including `system-ui`, which is not a
 * loadable face and makes the whole call reject. So the stack is resolved
 * through the same path the renderer uses and only its head is asked for.
 */
function primaryFamily(stack: string): string | null {
  const first = resolveFontFamily(stack).split(",")[0]?.trim();
  if (!first) return null;
  const bare = first.replace(/^['"]|['"]$/g, "");
  // The generics are always present and never loadable.
  if (/^(system-ui|ui-monospace|serif|sans-serif|monospace|cursive|fantasy)$/i.test(bare)) {
    return null;
  }
  return first.includes(" ") && !/^['"]/.test(first) ? `"${bare}"` : first;
}

/**
 * Load every face the composition can use.
 *
 * Resolves when they are all settled, whichever way. A face that will not load
 * is not worth failing an export over — the renderer's fallback stack is right
 * behind it and the video still comes out — so failures are counted and
 * returned rather than thrown.
 */
export function ensureTypefaces(): Promise<void> {
  if (pending) return pending;
  if (typeof document === "undefined" || !document.fonts) {
    pending = Promise.resolve();
    return pending;
  }

  // The variables live on <html>, and are read through getComputedStyle. Before
  // hydration they are not there yet, and a family cached as empty would stay
  // empty for the life of the page.
  forgetFonts();

  const requests: Promise<unknown>[] = [];
  for (const face of TYPEFACES) {
    const family = primaryFamily(face.stack);
    if (!family) continue;
    for (const weight of face.weights) {
      // 64px is arbitrary and irrelevant — the load is per face and weight, not
      // per size — but it must be a size the parser accepts.
      requests.push(document.fonts.load(`${weight} 64px ${family}`).catch(() => null));
    }
    // Italic is only asked for where a face has one, but asking for a
    // synthesised italic costs a rejected promise and nothing else.
    requests.push(
      document.fonts.load(`italic ${face.weights[0]} 64px ${family}`).catch(() => null)
    );
  }

  pending = Promise.all(requests).then(() => {
    // The families were resolved from custom properties that are now certain to
    // exist; anything cached from before hydration was resolved against
    // nothing.
    forgetFonts();
  });
  return pending;
}

/**
 * Whether a face is loaded *right now*, without waiting.
 *
 * For the render loop, which cannot await anything: a frame drawn before the
 * fonts arrive is drawn in the fallback, and the honest thing is to know that
 * happened rather than to discover it in the export.
 */
export function typefaceReady(stack: string, weight = 700): boolean {
  if (typeof document === "undefined" || !document.fonts) return true;
  const family = primaryFamily(stack);
  if (!family) return true;
  try {
    return document.fonts.check(`${weight} 64px ${family}`);
  } catch {
    return true;
  }
}

/** Testing seam: forget that the load happened. */
export function resetTypefaceLoad() {
  pending = null;
}
