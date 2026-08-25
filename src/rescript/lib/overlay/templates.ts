/**
 * Text templates: a look and a motion, as one named thing.
 *
 * `TEXT_STYLES` next door answers "how should this read" and stops there —
 * seven looks, none of them moving. Which meant every caption this editor made
 * had to have its motion chosen separately, from a dropdown of eleven kinds
 * whose names describe a mechanism rather than a result. Nobody picks
 * "wipeRight" because they wanted a lower third.
 *
 * A template is the whole answer: type, colour, box, entrance, exit, and how
 * the reveal is spread across the words. One click, one coherent result — and
 * the same vocabulary handed to the agent, so "add a lower third with his name"
 * is one operation with a known-good look rather than eleven style fields
 * guessed from scratch.
 *
 * The restraint that matters: every template here has to be usable over real
 * footage without further tuning. A library where half the entries need three
 * properties walked back afterwards is a library people stop opening.
 */

import type { AnimationSpec } from "./types";
import type { PositionName, SizeName } from "./ops-schema";
import type { TextStylePatch } from "./presets";

export type TemplateCategory =
  | "title"
  | "lowerThird"
  | "caption"
  | "callout"
  | "data"
  | "cta";

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  title: "Titles",
  lowerThird: "Lower thirds",
  caption: "Captions",
  callout: "Callouts",
  data: "Data",
  cta: "Call to action",
};

export interface TextTemplate {
  id: string;
  label: string;
  category: TemplateCategory;
  /** What it looks like. Merged over the element's defaults. */
  style: TextStylePatch;
  enter: AnimationSpec;
  exit: AnimationSpec;
  /** Where it wants to sit, when the caller has no opinion. */
  position: PositionName;
  size: SizeName;
  /** Placeholder text, used by the picker's preview and as a starting value. */
  sample: string;
}

const SANS = "var(--font-geist-sans), system-ui, sans-serif";
const HAND = "var(--font-hand), var(--font-geist-sans), system-ui, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "var(--font-geist-mono), ui-monospace, monospace";

/** The house accent, matching the one the agent's style guide names. */
const ACCENT = "#ffd60a";

const fade = (duration = 0.35): AnimationSpec => ({
  kind: "fade",
  duration,
  easing: "easeOut",
});

/**
 * Thirty-six templates, in six categories.
 *
 * Ordered within each category by how often they are the right answer, not
 * alphabetically — the first entry under each heading should be the one to
 * reach for when you have no particular opinion, because that is what most
 * people will click.
 */
export const TEXT_TEMPLATES: TextTemplate[] = [
  /* --------------------------------- titles --------------------------------- */
  {
    id: "kineticMask",
    label: "Kinetic mask",
    category: "title",
    style: {
      fontFamily: SANS,
      fontWeight: 800,
      color: "#ffffff",
      background: null,
      letterSpacing: -0.03,
      shadow: true,
      sizeScale: 1.2,
    },
    // The one the whole per-word reveal was ported for.
    enter: { kind: "mask", duration: 0.7, easing: "easeOut", unit: "word", stagger: 0.18 },
    exit: fade(0.25),
    position: "center",
    size: "xl",
    sample: "The whole point",
  },
  {
    id: "boldSlam",
    label: "Bold slam",
    category: "title",
    style: {
      fontFamily: SANS,
      fontWeight: 900,
      color: "#ffffff",
      background: null,
      uppercase: true,
      letterSpacing: -0.02,
      shadow: true,
      sizeScale: 1.25,
    },
    enter: { kind: "pop", duration: 0.4, easing: "backOut", unit: "word", stagger: 0.12 },
    exit: fade(0.2),
    position: "center",
    size: "xl",
    sample: "STOP DOING THIS",
  },
  {
    id: "editorialSerif",
    label: "Editorial",
    category: "title",
    style: {
      fontFamily: SERIF,
      fontWeight: 400,
      color: "#ffffff",
      background: null,
      letterSpacing: -0.01,
      shadow: true,
      sizeScale: 1.2,
    },
    enter: { kind: "mask", duration: 0.9, easing: "easeOut", unit: "word", stagger: 0.22 },
    exit: fade(0.35),
    position: "center",
    size: "xl",
    sample: "A quieter kind of title",
  },
  {
    id: "splitReveal",
    label: "Split reveal",
    category: "title",
    style: {
      fontFamily: SANS,
      fontWeight: 800,
      color: "#ffffff",
      background: null,
      uppercase: true,
      letterSpacing: 0.02,
      shadow: true,
      sizeScale: 1.1,
    },
    enter: { kind: "slideUp", duration: 0.55, easing: "easeOut", unit: "word", stagger: 0.2 },
    exit: { kind: "slideDown", duration: 0.3, easing: "easeIn" },
    position: "center",
    size: "l",
    sample: "ONE WORD AT A TIME",
  },
  {
    id: "typewriter",
    label: "Typewriter",
    category: "title",
    style: {
      fontFamily: MONO,
      fontWeight: 500,
      color: "#ffffff",
      background: null,
      letterSpacing: 0,
      shadow: true,
      sizeScale: 0.9,
    },
    enter: { kind: "typewriter", duration: 1.2, easing: "linear" },
    exit: fade(0.2),
    position: "center",
    size: "l",
    sample: "typed, not placed",
  },
  {
    id: "stamp",
    label: "Stamp",
    category: "title",
    style: {
      fontFamily: SANS,
      fontWeight: 900,
      color: ACCENT,
      background: null,
      uppercase: true,
      letterSpacing: 0.04,
      strokeColor: "#0a0b0d",
      strokeWidth: 0.06,
      shadow: false,
      sizeScale: 1.15,
    },
    enter: { kind: "pop", duration: 0.3, easing: "backOut" },
    exit: fade(0.15),
    position: "center",
    size: "xl",
    sample: "SOLD OUT",
  },
  {
    id: "neon",
    label: "Neon",
    category: "title",
    style: {
      fontFamily: SANS,
      fontWeight: 800,
      color: "#f5f3ff",
      background: null,
      uppercase: true,
      letterSpacing: 0.03,
      strokeColor: "#a855f7",
      strokeWidth: 0.03,
      shadow: true,
      sizeScale: 1.1,
    },
    enter: { kind: "blur", duration: 0.5, easing: "easeOut", unit: "word", stagger: 0.14 },
    exit: { kind: "blur", duration: 0.3, easing: "easeIn" },
    position: "center",
    size: "l",
    sample: "AFTER HOURS",
  },
  {
    id: "handwritten",
    label: "Marker",
    category: "title",
    style: {
      fontFamily: HAND,
      fontWeight: 400,
      color: "#ffffff",
      background: null,
      letterSpacing: 0.01,
      shadow: true,
      sizeScale: 1.15,
    },
    enter: { kind: "mask", duration: 0.8, easing: "easeOut", unit: "word", stagger: 0.2 },
    exit: fade(0.3),
    position: "center",
    size: "l",
    sample: "written by hand",
  },

  /* ------------------------------ lower thirds ------------------------------ */
  {
    id: "cleanBar",
    label: "Clean bar",
    category: "lowerThird",
    style: {
      fontFamily: SANS,
      fontWeight: 700,
      color: "#ffffff",
      background: "rgba(10,11,13,0.78)",
      letterSpacing: -0.005,
      padding: 0.5,
      radius: 0.12,
      shadow: false,
      align: "left",
      sizeScale: 0.7,
    },
    enter: { kind: "slideRight", duration: 0.4, easing: "easeOut" },
    exit: { kind: "slideLeft", duration: 0.3, easing: "easeIn" },
    position: "lower-third",
    size: "m",
    sample: "Alex Rivera · Director",
  },
  {
    id: "underlineGrow",
    label: "Underline",
    category: "lowerThird",
    style: {
      fontFamily: SANS,
      fontWeight: 700,
      color: "#ffffff",
      background: null,
      letterSpacing: -0.01,
      shadow: true,
      align: "left",
      sizeScale: 0.72,
    },
    enter: { kind: "wipeRight", duration: 0.5, easing: "easeOut" },
    exit: fade(0.25),
    position: "lower-third",
    size: "m",
    sample: "Alex Rivera",
  },
  {
    id: "boxedName",
    label: "Boxed",
    category: "lowerThird",
    style: {
      fontFamily: SANS,
      fontWeight: 800,
      color: "#0a0b0d",
      background: "#ffffff",
      uppercase: true,
      letterSpacing: 0.04,
      padding: 0.45,
      radius: 0.08,
      shadow: true,
      align: "left",
      sizeScale: 0.6,
    },
    enter: { kind: "scaleUp", duration: 0.35, easing: "backOut" },
    exit: fade(0.2),
    position: "lower-third",
    size: "m",
    sample: "ON LOCATION",
  },
  {
    id: "bracketed",
    label: "Bracketed",
    category: "lowerThird",
    style: {
      fontFamily: MONO,
      fontWeight: 500,
      color: ACCENT,
      background: null,
      uppercase: true,
      letterSpacing: 0.06,
      shadow: true,
      align: "left",
      sizeScale: 0.58,
    },
    enter: { kind: "fade", duration: 0.3, easing: "easeOut", unit: "char", stagger: 0.04 },
    exit: fade(0.2),
    position: "lower-third",
    size: "s",
    sample: "[ RECORDING ]",
  },
  {
    id: "minimalFade",
    label: "Minimal",
    category: "lowerThird",
    style: {
      fontFamily: SANS,
      fontWeight: 500,
      color: "rgba(255,255,255,0.9)",
      background: null,
      letterSpacing: 0.01,
      shadow: true,
      align: "left",
      sizeScale: 0.62,
    },
    enter: fade(0.5),
    exit: fade(0.4),
    position: "lower-third",
    size: "s",
    sample: "somewhere in the film",
  },
  {
    id: "cornerTag",
    label: "Corner tag",
    category: "lowerThird",
    style: {
      fontFamily: SANS,
      fontWeight: 800,
      color: "#0a0b0d",
      background: ACCENT,
      uppercase: true,
      letterSpacing: 0.05,
      padding: 0.45,
      radius: 0.4,
      shadow: true,
      sizeScale: 0.5,
    },
    enter: { kind: "slideDown", duration: 0.35, easing: "backOut" },
    exit: { kind: "slideUp", duration: 0.25, easing: "easeIn" },
    position: "top-left",
    size: "s",
    sample: "NEW",
  },

  /* -------------------------------- captions -------------------------------- */
  {
    id: "wordPop",
    label: "Word pop",
    category: "caption",
    style: {
      fontFamily: SANS,
      fontWeight: 900,
      color: "#ffffff",
      background: null,
      uppercase: true,
      letterSpacing: -0.01,
      strokeColor: "#0a0b0d",
      strokeWidth: 0.09,
      shadow: false,
      sizeScale: 0.95,
    },
    enter: { kind: "pop", duration: 0.4, easing: "backOut", unit: "word", stagger: 0.16 },
    exit: fade(0.15),
    position: "center",
    size: "l",
    sample: "THIS IS THE BIT",
  },
  {
    id: "highlightSweep",
    label: "Highlight",
    category: "caption",
    style: {
      fontFamily: SANS,
      fontWeight: 800,
      color: "#0a0b0d",
      background: ACCENT,
      uppercase: false,
      letterSpacing: -0.01,
      padding: 0.32,
      radius: 0.1,
      shadow: false,
      sizeScale: 0.85,
    },
    enter: { kind: "wipeRight", duration: 0.45, easing: "easeOut" },
    exit: fade(0.2),
    position: "center",
    size: "m",
    sample: "the part that matters",
  },
  {
    id: "boldBounce",
    label: "Bounce",
    category: "caption",
    style: {
      fontFamily: SANS,
      fontWeight: 900,
      color: ACCENT,
      background: null,
      uppercase: true,
      letterSpacing: 0,
      strokeColor: "#0a0b0d",
      strokeWidth: 0.08,
      shadow: false,
      sizeScale: 0.95,
    },
    enter: { kind: "pop", duration: 0.45, easing: "spring", unit: "word", stagger: 0.1 },
    exit: fade(0.15),
    position: "lower-third",
    size: "l",
    sample: "WAIT FOR IT",
  },
  {
    id: "scalePunch",
    label: "Scale punch",
    category: "caption",
    style: {
      fontFamily: SANS,
      fontWeight: 800,
      color: "#ffffff",
      background: "rgba(0,0,0,0.55)",
      uppercase: false,
      letterSpacing: -0.015,
      padding: 0.4,
      radius: 0.18,
      shadow: false,
      sizeScale: 0.8,
    },
    enter: { kind: "scaleUp", duration: 0.35, easing: "backOut" },
    exit: fade(0.2),
    position: "lower-third",
    size: "m",
    sample: "three times faster",
  },
  {
    id: "oneWord",
    label: "One word",
    category: "caption",
    style: {
      fontFamily: SANS,
      fontWeight: 900,
      color: "#ffffff",
      background: null,
      uppercase: true,
      letterSpacing: -0.02,
      strokeColor: "#0a0b0d",
      strokeWidth: 0.1,
      shadow: false,
      sizeScale: 1.3,
    },
    enter: { kind: "scaleUp", duration: 0.2, easing: "backOut" },
    exit: { kind: "none", duration: 0, easing: "linear" },
    position: "center",
    size: "xl",
    sample: "NOW",
  },
  {
    id: "softCaption",
    label: "Soft",
    category: "caption",
    style: {
      fontFamily: SANS,
      fontWeight: 600,
      color: "#ffffff",
      background: "rgba(0,0,0,0.45)",
      letterSpacing: 0,
      padding: 0.4,
      radius: 0.3,
      shadow: false,
      sizeScale: 0.7,
    },
    enter: { kind: "fade", duration: 0.35, easing: "easeOut", unit: "word", stagger: 0.1 },
    exit: fade(0.25),
    position: "lower-third",
    size: "m",
    sample: "a quieter note",
  },

  /* -------------------------------- callouts -------------------------------- */
  {
    id: "speechBubble",
    label: "Bubble",
    category: "callout",
    style: {
      fontFamily: SANS,
      fontWeight: 700,
      color: "#0a0b0d",
      background: "#ffffff",
      letterSpacing: -0.005,
      padding: 0.55,
      radius: 0.45,
      shadow: true,
      sizeScale: 0.65,
    },
    enter: { kind: "pop", duration: 0.35, easing: "backOut" },
    exit: fade(0.2),
    position: "upper-third",
    size: "m",
    sample: "wait, what?",
  },
  {
    id: "stickyNote",
    label: "Sticky note",
    category: "callout",
    style: {
      fontFamily: HAND,
      fontWeight: 400,
      color: "#0a0b0d",
      background: "#fde68a",
      letterSpacing: 0,
      padding: 0.6,
      radius: 0.05,
      shadow: true,
      sizeScale: 0.7,
    },
    enter: { kind: "scaleUp", duration: 0.3, easing: "backOut" },
    exit: fade(0.2),
    position: "top-right",
    size: "m",
    sample: "remember this",
  },
  {
    id: "codeCard",
    label: "Code",
    category: "callout",
    style: {
      fontFamily: MONO,
      fontWeight: 500,
      color: "#e5e7eb",
      background: "rgba(12,14,18,0.92)",
      letterSpacing: 0,
      padding: 0.6,
      radius: 0.12,
      shadow: true,
      align: "left",
      sizeScale: 0.55,
    },
    enter: { kind: "fade", duration: 0.3, easing: "easeOut" },
    exit: fade(0.2),
    position: "center",
    size: "m",
    sample: "npm run build",
  },
  {
    id: "quoteCard",
    label: "Quote",
    category: "callout",
    style: {
      fontFamily: SERIF,
      fontWeight: 400,
      italic: true,
      color: "#ffffff",
      background: null,
      letterSpacing: -0.005,
      shadow: true,
      sizeScale: 1.05,
    },
    enter: { kind: "mask", duration: 0.9, easing: "easeOut", unit: "word", stagger: 0.16 },
    exit: fade(0.4),
    position: "center",
    size: "l",
    sample: "“It was never about the tool.”",
  },
  {
    id: "warning",
    label: "Warning",
    category: "callout",
    style: {
      fontFamily: SANS,
      fontWeight: 800,
      color: "#0a0b0d",
      background: "#f97316",
      uppercase: true,
      letterSpacing: 0.04,
      padding: 0.5,
      radius: 0.1,
      shadow: true,
      sizeScale: 0.6,
    },
    enter: { kind: "slideDown", duration: 0.3, easing: "backOut" },
    exit: { kind: "slideUp", duration: 0.25, easing: "easeIn" },
    position: "upper-third",
    size: "m",
    sample: "DON'T DO THIS",
  },
  {
    id: "aside",
    label: "Aside",
    category: "callout",
    style: {
      fontFamily: SANS,
      fontWeight: 500,
      italic: true,
      color: "rgba(255,255,255,0.82)",
      background: null,
      letterSpacing: 0.005,
      shadow: true,
      align: "right",
      sizeScale: 0.55,
    },
    enter: fade(0.4),
    exit: fade(0.35),
    position: "bottom-right",
    size: "s",
    sample: "(more on this later)",
  },

  /* ---------------------------------- data ---------------------------------- */
  {
    id: "statBig",
    label: "Big stat",
    category: "data",
    style: {
      fontFamily: SANS,
      fontWeight: 900,
      color: ACCENT,
      background: null,
      letterSpacing: -0.04,
      shadow: true,
      sizeScale: 1.6,
    },
    enter: { kind: "scaleUp", duration: 0.4, easing: "backOut" },
    exit: fade(0.25),
    position: "center",
    size: "xl",
    sample: "300%",
  },
  {
    id: "statWithCaption",
    label: "Stat + note",
    category: "data",
    style: {
      fontFamily: SANS,
      fontWeight: 800,
      color: "#ffffff",
      background: null,
      letterSpacing: -0.03,
      shadow: true,
      sizeScale: 1.15,
    },
    enter: { kind: "mask", duration: 0.6, easing: "easeOut", unit: "word", stagger: 0.14 },
    exit: fade(0.25),
    position: "center",
    size: "l",
    sample: "12,400 signups",
  },
  {
    id: "listReveal",
    label: "List",
    category: "data",
    style: {
      fontFamily: SANS,
      fontWeight: 700,
      color: "#ffffff",
      background: null,
      letterSpacing: -0.01,
      shadow: true,
      align: "left",
      sizeScale: 0.8,
    },
    enter: { kind: "slideUp", duration: 0.8, easing: "easeOut", unit: "word", stagger: 0.12 },
    exit: fade(0.3),
    position: "center",
    size: "m",
    sample: "Faster\nCheaper\nSimpler",
  },
  {
    id: "comparison",
    label: "Versus",
    category: "data",
    style: {
      fontFamily: SANS,
      fontWeight: 900,
      color: "#ffffff",
      background: null,
      uppercase: true,
      letterSpacing: 0.02,
      strokeColor: "#0a0b0d",
      strokeWidth: 0.06,
      shadow: false,
      sizeScale: 1,
    },
    enter: { kind: "slideRight", duration: 0.45, easing: "easeOut", unit: "word", stagger: 0.2 },
    exit: fade(0.2),
    position: "center",
    size: "l",
    sample: "BEFORE VS AFTER",
  },
  {
    id: "unitLabel",
    label: "Unit label",
    category: "data",
    style: {
      fontFamily: MONO,
      fontWeight: 500,
      color: "rgba(255,255,255,0.75)",
      background: null,
      uppercase: true,
      letterSpacing: 0.1,
      shadow: true,
      sizeScale: 0.45,
    },
    enter: fade(0.3),
    exit: fade(0.25),
    position: "center",
    size: "s",
    sample: "MONTHLY RECURRING",
  },

  /* ---------------------------------- cta ----------------------------------- */
  {
    id: "subscribeBump",
    label: "Subscribe",
    category: "cta",
    style: {
      fontFamily: SANS,
      fontWeight: 900,
      color: "#ffffff",
      background: "#dc2626",
      uppercase: true,
      letterSpacing: 0.03,
      padding: 0.5,
      radius: 0.35,
      shadow: true,
      sizeScale: 0.7,
    },
    enter: { kind: "pop", duration: 0.4, easing: "spring" },
    exit: { kind: "scaleUp", duration: 0.25, easing: "easeIn" },
    position: "bottom-left",
    size: "m",
    sample: "SUBSCRIBE",
  },
  {
    id: "followPill",
    label: "Follow pill",
    category: "cta",
    style: {
      fontFamily: SANS,
      fontWeight: 700,
      color: "#0a0b0d",
      background: "#ffffff",
      letterSpacing: 0,
      padding: 0.5,
      radius: 0.5,
      shadow: true,
      sizeScale: 0.55,
    },
    enter: { kind: "slideUp", duration: 0.35, easing: "backOut" },
    exit: fade(0.25),
    position: "bottom-right",
    size: "s",
    sample: "@yourhandle",
  },
  {
    id: "linkBar",
    label: "Link bar",
    category: "cta",
    style: {
      fontFamily: MONO,
      fontWeight: 500,
      color: "#ffffff",
      background: "rgba(10,11,13,0.85)",
      letterSpacing: 0.02,
      padding: 0.5,
      radius: 0.1,
      shadow: false,
      sizeScale: 0.55,
    },
    enter: { kind: "slideUp", duration: 0.4, easing: "easeOut" },
    exit: { kind: "slideDown", duration: 0.3, easing: "easeIn" },
    position: "bottom",
    size: "m",
    sample: "example.com/start",
  },
  {
    id: "chapterCard",
    label: "Chapter",
    category: "cta",
    style: {
      fontFamily: SANS,
      fontWeight: 800,
      color: "#ffffff",
      background: null,
      uppercase: true,
      letterSpacing: 0.12,
      shadow: true,
      sizeScale: 0.7,
    },
    enter: { kind: "fade", duration: 0.6, easing: "easeOut", unit: "char", stagger: 0.05 },
    exit: fade(0.4),
    position: "center",
    size: "m",
    sample: "PART TWO",
  },
  {
    id: "endCard",
    label: "End card",
    category: "cta",
    style: {
      fontFamily: SANS,
      fontWeight: 900,
      color: "#ffffff",
      background: null,
      letterSpacing: -0.03,
      shadow: true,
      sizeScale: 1.35,
    },
    enter: { kind: "mask", duration: 0.8, easing: "easeOut", unit: "word", stagger: 0.2 },
    exit: { kind: "none", duration: 0, easing: "linear" },
    position: "center",
    size: "xl",
    sample: "Thanks for watching",
  },
];

export const TEMPLATE_IDS = TEXT_TEMPLATES.map((t) => t.id);

export function textTemplate(id: string): TextTemplate | null {
  return TEXT_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** Templates grouped for the picker, in the order the categories are declared. */
export function templatesByCategory(): {
  category: TemplateCategory;
  label: string;
  templates: TextTemplate[];
}[] {
  const order = Object.keys(TEMPLATE_CATEGORY_LABELS) as TemplateCategory[];
  return order
    .map((category) => ({
      category,
      label: TEMPLATE_CATEGORY_LABELS[category],
      templates: TEXT_TEMPLATES.filter((t) => t.category === category),
    }))
    .filter((group) => group.templates.length > 0);
}
