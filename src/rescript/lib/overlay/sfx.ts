/**
 * Sound effects: a vocabulary, and where they go.
 *
 * The editor could already put an effect on the timeline — `addMusic` with
 * `kind: "sfx"` and a search query — and that was almost useless in practice,
 * for two reasons.
 *
 * The first is that "say what it should sound like" is a real burden when the
 * thing on the other end is a catalogue search. A model asked for a whoosh
 * writes "whoosh"; asked for the sound of a camera pushing in, it writes
 * something poetic that matches nothing. So the effects are *named* here, and a
 * name resolves to a query somebody has checked returns usable results.
 *
 * The second is placement, and it is the bigger one. An effect is punctuation:
 * it means "something happened here", and it only works when it lands on the
 * frame where something actually happened. That is not a thing a language model
 * can time from a transcript — it is a thing the edit already knows, because
 * the edit is what made the cut, placed the punch-in and started the caption.
 * So `planSfx` reads the edit and places them, the same way `placePunchIns`
 * reads the delivery.
 *
 * The restraint is the design. One whoosh on a hard cut is punctuation; one on
 * every cut is a ringtone, and the difference is a spacing rule and a budget
 * rather than taste. Both are here and neither is optional.
 */

/** What an effect is for. Drives which ones a style will reach for. */
export type SfxRole =
  /** Movement: a cut, a wipe, a camera that moves. */
  | "movement"
  /** Weight: something arriving hard. */
  | "impact"
  /** Anticipation: pointing forward at the thing after it. */
  | "riser"
  /** Small and mechanical: type appearing, a UI action. */
  | "tick"
  /** Texture and mood, held under something rather than hit. */
  | "texture"
  /** Comedy. Deployed once, or not at all. */
  | "punchline";

export interface SoundEffect {
  id: string;
  label: string;
  role: SfxRole;
  /**
   * What is actually searched for.
   *
   * Deliberately plain. The catalogues behind `/api/media` are tagged by
   * ordinary people using ordinary words, so "whoosh transition" finds a
   * whoosh and "the sound of momentum" finds nothing.
   */
  query: string;
  /** 0..1, before the mix. Loud effects are quieter than you would guess. */
  gain: number;
  /** How long it is allowed to occupy, in seconds. */
  hold: number;
  /**
   * Where it sits relative to the moment it marks.
   *
   * Negative for anything that has to *arrive* on the frame rather than start
   * on it — a riser has to be most of the way through by the time the cut
   * happens, or it is announcing something that already occurred.
   */
  lead: number;
  use: string;
}

export const SOUND_EFFECTS: SoundEffect[] = [
  /* -------------------------------- movement ------------------------------- */
  {
    id: "whoosh",
    label: "Whoosh",
    role: "movement",
    query: "whoosh transition",
    gain: 0.45,
    hold: 0.8,
    lead: -0.15,
    use: "the default over a hard cut or a whip pan. If you only ever use one effect, use this one",
  },
  {
    id: "swish",
    label: "Swish",
    role: "movement",
    query: "swish swipe short",
    gain: 0.4,
    hold: 0.4,
    lead: -0.08,
    use: "a lighter, shorter whoosh — for text sliding in, or a cut that does not want announcing",
  },
  {
    id: "deepWhoosh",
    label: "Deep whoosh",
    role: "movement",
    query: "deep whoosh cinematic low",
    gain: 0.42,
    hold: 1.4,
    lead: -0.35,
    use: "a slower, heavier version for a real change of subject. Not for an ordinary cut",
  },
  /* --------------------------------- impact -------------------------------- */
  {
    id: "impact",
    label: "Impact",
    role: "impact",
    query: "cinematic impact hit",
    gain: 0.4,
    hold: 1.2,
    lead: 0,
    use: "a punch-in, a title landing, a figure appearing. Weight, on the frame it happens",
  },
  {
    id: "boom",
    label: "Boom",
    role: "impact",
    query: "deep boom bass drop",
    gain: 0.38,
    hold: 1.8,
    lead: 0,
    use: "the biggest thing in the video, once. A reveal, an opening title. Twice is one too many",
  },
  {
    id: "thud",
    label: "Thud",
    role: "impact",
    query: "soft thud low",
    gain: 0.35,
    hold: 0.5,
    lead: 0,
    use: "a caption landing, when a full impact would be too much. The short-form default under type",
  },
  /* --------------------------------- riser --------------------------------- */
  {
    id: "riser",
    label: "Riser",
    role: "riser",
    query: "riser build up sweep",
    gain: 0.35,
    hold: 1.6,
    // Nearly all of it plays *before* the moment. A riser that starts on the
    // cut is describing something that already happened.
    lead: -1.4,
    use: "pointing at the thing immediately after it — a reveal, a punchline, a number. Always paired with what it leads into",
  },
  {
    id: "downlifter",
    label: "Downlifter",
    role: "riser",
    query: "downlifter reverse sweep",
    gain: 0.32,
    hold: 1.2,
    lead: -0.9,
    use: "the same idea, falling — into something quieter rather than something louder",
  },
  /* ---------------------------------- tick --------------------------------- */
  {
    id: "click",
    label: "Click",
    role: "tick",
    query: "ui click short",
    gain: 0.3,
    hold: 0.25,
    lead: 0,
    use: "a UI action in a screen recording, or a word appearing one at a time",
  },
  {
    id: "pop",
    label: "Pop",
    role: "tick",
    query: "pop bubble ui",
    gain: 0.32,
    hold: 0.3,
    lead: 0,
    use: "something small arriving — a badge, a sticker, a chip caption",
  },
  {
    id: "ding",
    label: "Ding",
    role: "tick",
    query: "notification ding bell",
    gain: 0.3,
    hold: 0.9,
    lead: 0,
    use: "a correct answer, a completed step, a tick appearing. Cheap and effective; do not use twice",
  },
  {
    id: "typing",
    label: "Typing",
    role: "tick",
    query: "keyboard typing mechanical",
    gain: 0.28,
    hold: 1.2,
    lead: 0,
    use: "under a typewriter caption or a terminal card, for exactly as long as it is typing",
  },
  /* -------------------------------- texture -------------------------------- */
  {
    id: "sparkle",
    label: "Sparkle",
    role: "texture",
    query: "sparkle shimmer magic",
    gain: 0.28,
    hold: 1.2,
    lead: -0.1,
    use: "something appearing that is meant to feel good. Easy to overdo; once a video",
  },
  {
    id: "glitch",
    label: "Glitch",
    role: "texture",
    query: "digital glitch static",
    gain: 0.3,
    hold: 0.5,
    lead: -0.1,
    use: "a hard, ugly cut you want to look deliberate. Pairs with a zoomBlur or a whipPan",
  },
  {
    id: "vinyl",
    label: "Vinyl",
    role: "texture",
    query: "vinyl crackle loop",
    gain: 0.2,
    hold: 4,
    lead: 0,
    use: "warmth under a quiet stretch. A bed, not a hit — and only where there is no music",
  },
  /* ------------------------------- punchline -------------------------------- */
  {
    id: "recordScratch",
    label: "Record scratch",
    role: "punchline",
    query: "record scratch stop",
    gain: 0.4,
    hold: 1,
    lead: -0.2,
    use: "the joke where everything stops. Once, ever, and only if the piece is funny",
  },
  {
    id: "drumroll",
    label: "Drum roll",
    role: "punchline",
    query: "drum roll build",
    gain: 0.35,
    hold: 2,
    lead: -1.8,
    use: "before a reveal that is playing for a laugh rather than for weight",
  },
  {
    id: "cashRegister",
    label: "Cash register",
    role: "punchline",
    query: "cash register kaching",
    gain: 0.35,
    hold: 1,
    lead: 0,
    use: "money. A price, a saving, a revenue figure — on the frame the number appears",
  },
  {
    id: "airhorn",
    label: "Air horn",
    role: "punchline",
    query: "air horn",
    gain: 0.3,
    hold: 1.2,
    lead: 0,
    use: "loud and unserious. Almost always the wrong choice; here because sometimes it is the right one",
  },
];

const BY_ID = new Map(SOUND_EFFECTS.map((effect) => [effect.id, effect]));

export function soundEffect(id: string): SoundEffect | null {
  return BY_ID.get(id) ?? null;
}

/** Ids as a tuple, for a zod enum. */
export const SFX_IDS = SOUND_EFFECTS.map((e) => e.id) as [string, ...string[]];

/** The library as the agent is shown it, grouped by what each role is for. */
export function describeSfx(): string {
  const order: SfxRole[] = ["movement", "impact", "riser", "tick", "texture", "punchline"];
  const labels: Record<SfxRole, string> = {
    movement: "Movement (cuts, pans, things sliding)",
    impact: "Impact (things arriving with weight)",
    riser: "Anticipation (pointing at what comes next)",
    tick: "Small and mechanical",
    texture: "Texture and mood",
    punchline: "Comedy — one per video at most",
  };
  return order
    .map((role) => {
      const entries = SOUND_EFFECTS.filter((e) => e.role === role);
      return [
        `    ${labels[role]}:`,
        ...entries.map((e) => `      ${e.id.padEnd(14)}${e.use}`),
      ].join("\n");
    })
    .join("\n");
}

/* ------------------------------- placement ---------------------------------- */

/** A moment in the edit that an effect could mark. */
export interface SfxMoment {
  at: number;
  /** What happens here. Decides which effect fits. */
  kind: "cut" | "punchIn" | "caption" | "title" | "reveal";
  /** Higher wins when two moments compete for the same slot. */
  weight: number;
}

export interface SfxStyleOptions {
  /**
   * How the video sounds.
   *
   * "subtle" marks only the strongest moments and only with movement sounds.
   * "energetic" is the short-form treatment — most cuts, impacts on punch-ins.
   * "comedic" adds one punchline sound at the single best moment and otherwise
   * behaves like "energetic".
   */
  style?: "subtle" | "energetic" | "comedic";
  /** Ceiling on effects per minute. The spacing rule still wins. */
  perMinute?: number;
  duration: number;
}

export interface PlacedSfx {
  at: number;
  effect: SoundEffect;
  /** Why it is here, for the log line. */
  reason: string;
}

/**
 * Two effects closer together than this stop being punctuation.
 *
 * 1.2s is not arbitrary: below about a second the ear groups them into one
 * event with a stutter in it, which is the exact sound of an automatic edit.
 */
const MIN_GAP_S = 1.2;

/** What each kind of moment sounds like, per style. */
const CHOICE: Record<
  NonNullable<SfxStyleOptions["style"]>,
  Record<SfxMoment["kind"], string | null>
> = {
  subtle: {
    cut: "swish",
    punchIn: null,
    caption: null,
    title: "deepWhoosh",
    reveal: "riser",
  },
  energetic: {
    cut: "whoosh",
    punchIn: "impact",
    caption: "thud",
    title: "boom",
    reveal: "riser",
  },
  comedic: {
    cut: "whoosh",
    punchIn: "impact",
    caption: "pop",
    title: "boom",
    reveal: "drumroll",
  },
};

/**
 * Choose which moments actually get a sound.
 *
 * Best-first, then spaced — the same shape as `placePunchIns`, and for the same
 * reason: taking the strongest moment and clearing its neighbourhood means a
 * merely-adequate cut never displaces the reveal two seconds after it. A
 * chronological pass gets that backwards every time.
 *
 * The budget is deliberately mean. Five effects across a two-minute video is a
 * produced piece; twenty is a soundboard, and twenty is what "mark every cut"
 * gives you on footage that has had its fillers removed.
 */
export function planSfx(
  moments: SfxMoment[],
  options: SfxStyleOptions
): PlacedSfx[] {
  const { duration } = options;
  if (duration <= 0 || moments.length === 0) return [];

  const style = options.style ?? "energetic";
  const perMinute = options.perMinute ?? (style === "subtle" ? 1.5 : 3);
  const budget = Math.max(1, Math.round((duration / 60) * perMinute));
  const table = CHOICE[style];

  const taken: PlacedSfx[] = [];
  const ranked = [...moments].sort((a, b) => b.weight - a.weight);

  // Comedy is a once-per-video decision, so it is spent on the single
  // strongest moment rather than left to fall wherever the ranking puts it.
  let punchlineSpent = style !== "comedic";

  for (const moment of ranked) {
    if (taken.length >= budget) break;
    if (moment.at < 0 || moment.at > duration) continue;
    if (taken.some((p) => Math.abs(p.at - moment.at) < MIN_GAP_S)) continue;

    let id = table[moment.kind];
    if (!punchlineSpent && (moment.kind === "reveal" || moment.kind === "title")) {
      id = "recordScratch";
      punchlineSpent = true;
    }
    if (!id) continue;

    const effect = soundEffect(id);
    if (!effect) continue;

    taken.push({ at: moment.at, effect, reason: describeMoment(moment.kind) });
  }

  return taken.sort((a, b) => a.at - b.at);
}

function describeMoment(kind: SfxMoment["kind"]): string {
  switch (kind) {
    case "cut":
      return "on a cut";
    case "punchIn":
      return "on a punch-in";
    case "caption":
      return "under a caption landing";
    case "title":
      return "under the title";
    case "reveal":
      return "into a reveal";
  }
}

/**
 * Every moment in an edit that an effect could mark.
 *
 * Gathered from what the edit already knows rather than from the transcript:
 * a boundary is a cut because somebody cut there, a shot is a push because
 * somebody pushed. That is the whole reason this can be timed to the frame and
 * a model reading a transcript cannot.
 */
export function momentsFrom(input: {
  /** Clip boundaries on the output clock. */
  boundaries: number[];
  /** Shots that move the camera, by start time. */
  pushes: number[];
  /** Text elements, by start time and whether they are the biggest thing on screen. */
  captions: { at: number; isTitle: boolean }[];
}): SfxMoment[] {
  const moments: SfxMoment[] = [];

  // A cut is worth marking, but it is the most common thing in an edit and so
  // the least remarkable. The lowest weight of the three deliberately.
  for (const at of input.boundaries) {
    moments.push({ at, kind: "cut", weight: 1 });
  }
  for (const at of input.pushes) {
    moments.push({ at, kind: "punchIn", weight: 2 });
  }
  for (const caption of input.captions) {
    moments.push({
      at: caption.at,
      kind: caption.isTitle ? "title" : "caption",
      // A title is the single best thing in most videos to put a sound on:
      // it is the one moment the viewer is already looking at the screen.
      weight: caption.isTitle ? 4 : 1.5,
    });
  }

  // A cut and a caption on the same frame are one event, and the caption is
  // the more specific description of it.
  return moments.sort((a, b) => a.at - b.at);
}
