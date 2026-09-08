/**
 * The type. All of it, named once.
 *
 * Before this file the editor had four families — a grotesque, its monospace,
 * a marker and Georgia — and every template drew from those four. Which is why
 * a title card out of this editor read as *a title card out of an editor*: the
 * face is the first thing anyone sees and it was always the same face. A
 * caption in Anton and the same caption in Playfair are not two styles of the
 * same video, they are two different videos.
 *
 * So there are twelve, each picked because it does something the others cannot,
 * and each described here in terms of *when it is right* rather than of what it
 * looks like. The agent chooses by the description; the picker shows the same
 * names to the person. One list, so a prompt and a click cannot drift apart.
 *
 * No "use client" — the route handler and the agent import the names, and the
 * browser imports the CSS stacks. The actual `@font-face` declarations come
 * from `next/font/google` in the layout, keyed by the same variable names.
 * `fonts.ts` next door is what makes sure they are downloaded before the canvas
 * asks for them, which is not automatic and fails silently when it is missed.
 */

/** Every typeface the composition can use, by id. */
export const TYPEFACES = [
  {
    id: "sans",
    label: "Geist",
    stack: "var(--font-geist-sans), system-ui, sans-serif",
    /** Weights the canvas will ask for. Anything not listed will be synthesised. */
    weights: [400, 500, 600, 700, 800, 900],
    /** What it is for, in the words the agent is told to choose by. */
    use: "the neutral default — subtitles, anything that must not draw attention to itself",
  },
  {
    id: "mono",
    label: "Geist Mono",
    stack: "var(--font-geist-mono), ui-monospace, monospace",
    weights: [400, 500, 700],
    use: "code, filenames, terminals, anything typed — and timestamps and figures where alignment matters",
  },
  {
    id: "anton",
    label: "Anton",
    stack: "var(--font-anton), 'Arial Narrow', system-ui, sans-serif",
    weights: [400],
    use: "the loudest thing on screen: a one-word title, a number, a thumbnail-sized statement. Condensed and very heavy, so it fits a long word across a vertical frame without shrinking",
  },
  {
    id: "bebas",
    label: "Bebas Neue",
    stack: "var(--font-bebas), 'Arial Narrow', system-ui, sans-serif",
    weights: [400],
    use: "caps-only headings, sports and news chyrons, chapter cards. Narrower and calmer than Anton — it is a heading, not a shout",
  },
  {
    id: "archivo",
    label: "Archivo Black",
    stack: "var(--font-archivo), system-ui, sans-serif",
    weights: [400],
    use: "a wide, blunt, editorial headline. Where Anton is tall and thin, this is broad — good over a wide frame and terrible down a narrow one",
  },
  {
    id: "syne",
    label: "Syne",
    stack: "var(--font-syne), system-ui, sans-serif",
    weights: [600, 700, 800],
    use: "design, fashion, music, anything that wants to look art-directed. Its letterforms are odd on purpose, so it is memorable in small doses and exhausting in large ones",
  },
  {
    id: "playfair",
    label: "Playfair Display",
    stack: "var(--font-playfair), Georgia, 'Times New Roman', serif",
    weights: [500, 700, 900],
    use: "luxury, food, interiors, a long-form documentary title. High-contrast serif — it needs size to work, so never below size m",
  },
  {
    id: "instrument",
    label: "Instrument Serif",
    stack: "var(--font-instrument), Georgia, serif",
    weights: [400],
    use: "the modern editorial look — an essay, a founder interview, a considered piece. Quieter than Playfair and better in italic",
  },
  {
    id: "grotesk",
    label: "Space Grotesk",
    stack: "var(--font-grotesk), system-ui, sans-serif",
    weights: [500, 700],
    use: "technical and product work: a demo, a changelog, a startup explainer. Reads as engineered without reading as a terminal",
  },
  {
    id: "bungee",
    label: "Bungee",
    stack: "var(--font-bungee), 'Arial Black', system-ui, sans-serif",
    weights: [400],
    use: "signage. A sticker, a stamp, a badge, a warning — one or two words, never a sentence",
  },
  {
    id: "caveat",
    label: "Caveat",
    stack: "var(--font-caveat), var(--font-hand), cursive",
    weights: [600, 700],
    use: "an aside, a note in the margin, an annotation pointing at something. Legible handwriting — use it where the words are a person talking to you rather than a title",
  },
  {
    id: "marker",
    label: "Permanent Marker",
    stack: "var(--font-hand), var(--font-caveat), cursive",
    weights: [400],
    use: "a scrawl. Louder and less legible than Caveat, so: one word, circled, on a whiteboard-ish piece",
  },
] as const;

export type TypefaceId = (typeof TYPEFACES)[number]["id"];

/** Ids as a tuple, for a zod enum and for the picker's order. */
export const TYPEFACE_IDS = TYPEFACES.map((t) => t.id) as unknown as [
  TypefaceId,
  ...TypefaceId[],
];

const BY_ID = new Map<string, (typeof TYPEFACES)[number]>(
  TYPEFACES.map((t) => [t.id, t])
);

/** The CSS family list for a typeface, or the neutral one for an unknown id. */
export function typefaceStack(id: string | undefined): string {
  return (id && BY_ID.get(id)?.stack) ?? TYPEFACES[0].stack;
}

export function typeface(id: string | undefined) {
  return id ? BY_ID.get(id) : undefined;
}

/**
 * Which typeface a stored family list came from.
 *
 * The element stores the stack, not the id — the DOM half of the editor needs a
 * real family list — so the picker has to work backwards to show which button
 * is pressed. Matched on the leading `var(--…)` rather than on the whole
 * string, so a stack that gained a fallback still resolves.
 */
export function typefaceOf(stack: string | undefined): TypefaceId | null {
  if (!stack) return null;
  const variable = /var\(\s*(--[\w-]+)/.exec(stack)?.[1];
  if (!variable) return null;
  for (const face of TYPEFACES) {
    if (face.stack.startsWith(`var(${variable})`)) return face.id;
  }
  return null;
}

/**
 * The catalogue as the agent is shown it.
 *
 * Kept here rather than written into the prompt so there is one list. A face
 * added below appears in the person's picker and in the model's vocabulary in
 * the same commit, which is the only way a library of this size stays honest.
 */
export function describeTypefaces(): string {
  return TYPEFACES.map((face) => `  ${face.id.padEnd(11)} ${face.label} — ${face.use}`).join(
    "\n"
  );
}
