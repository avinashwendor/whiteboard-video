import { withAlpha } from "@/lib/video/grade";

/**
 * The look.
 *
 * A palette here is not four hex codes. It is a *finish* -- a whole drawing
 * vocabulary -- plus the colours that vocabulary is executed in. The finish is
 * what decides whether a card has a hard printed shadow or a frosted edge,
 * whether the ground is ruled paper or a bloom of colour, whether a headline
 * is solid ink or brushed metal. Changing hue alone is what makes generated
 * design look generated: every frame is the same frame in a different colour.
 *
 * Three finishes, because three is what a subject actually needs:
 *
 * - **print** — ruled paper, hard offset shadows, marker swipes. Flat, warm,
 *   made of physical objects. For teaching and for anything that should feel
 *   handmade.
 * - **editorial** — near-black ground, enormous ghosted type behind the
 *   subject, crop marks at the corners, one saturated plate carrying the only
 *   colour in frame. Magazine cover language. For claims, culture and news.
 * - **glass** — a bloom of colour under frosted panels with a hairline light
 *   edge, brushed-metal display type, dotted connectors between nodes. For
 *   product, systems and anything about software.
 *
 * Every palette still resolves the same five roles underneath -- ground, ink,
 * one accent, one tinted surface, one highlight -- because restraint is what
 * makes any of them read as designed rather than assembled.
 */

export type Finish = "print" | "editorial" | "glass";

export const THEME_NAMES = [
  "clean-light",
  "studio-dark",
  "cyber-blue",
  "sunset",
  "obsidian",
  "noir",
  "newsprint",
  "ember",
  "cobalt",
  "abyss",
  "daylight",
] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

export interface Theme {
  name: ThemeName;
  /** The drawing vocabulary this palette is executed in. */
  finish: Finish;
  /** True when the ground is dark and type should be light. */
  dark: boolean;

  /* ---- the five roles ---- */
  /** The paper the whole frame is printed on. */
  ground: string;
  /** Ruled grid drawn over the paper. Very low contrast on purpose. */
  grid: string;
  ink: string;
  inkMuted: string;
  /** The one colour that means something. */
  accent: string;
  /**
   * The accent at a weight that survives as a hairline or a caption.
   *
   * A plate of colour and a two-pixel rule are not the same problem. A pale
   * yellow makes a superb card on cream paper and is completely invisible as a
   * rule on it -- and an eyebrow label set in it cannot be read at all. So the
   * accent is allowed to be light, and everything drawn thin uses this
   * instead. On dark palettes the two are usually the same colour.
   */
  mark: string;
  /** Ink that survives on top of the accent at full strength. */
  accentInk: string;
  /** A second accent, for the one frame a year that genuinely needs two. */
  accentAlt: string;
  /** A tinted card fill, the accent at a fraction of its strength. */
  surface: string;
  /** Marker swipe behind a phrase that carries the point. */
  highlight: string;
  /** Plain card fill sitting on the paper. */
  card: string;
  /** Hard offset shadow under cards and numerals. Never blurred. */
  shadow: string;

  /* ---- editorial ---- */
  /**
   * The display type set enormous behind the subject.
   *
   * Barely above the ground -- if you can read it comfortably it is competing
   * with the headline instead of holding it.
   */
  ghost: string;
  /** Crop marks and framing brackets. */
  bracket: string;
  /** Hairline rules and dividers. */
  hairline: string;

  /* ---- glass ---- */
  /**
   * Three colours blooming under the panels.
   *
   * Drawn as wide soft radial fields rather than a linear gradient: a linear
   * ramp reads as a slide template, a bloom reads as light.
   */
  mesh: [string, string, string];
  /** Frosted panel fill. */
  glassFill: string;
  /** The hairline catching the light along a panel's top edge. */
  glassEdge: string;
  /** Bloom behind a panel, so it sits above the ground rather than on it. */
  glassGlow: string;
  /** Brushed-metal ramp for display type, light to dark to light. */
  chrome: [string, string, string, string];

  /* ---- kept for the parts that render over artwork ---- */
  backdrop: [string, string, string];
  gradeTop: string;
  gradeBottom: string;
  panel: string;
  panelBorder: string;
  support: string;
}

/** Everything a print palette shares, so a new one is only its colours. */
function print(
  base: Pick<
    Theme,
    | "name" | "dark" | "ground" | "grid" | "ink" | "inkMuted" | "accent" | "accentInk"
    | "accentAlt" | "surface" | "highlight" | "card" | "shadow" | "backdrop"
    | "gradeTop" | "gradeBottom" | "panel" | "panelBorder" | "support"
  > & { mark?: string },
): Theme {
  return {
    mark: base.mark ?? base.accent,
    ...base,
    finish: "print",
    ghost: base.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.045)",
    bracket: base.dark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.32)",
    hairline: base.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)",
    mesh: base.backdrop,
    glassFill: base.panel,
    glassEdge: base.panelBorder,
    glassGlow: withAlpha(base.accent, 0.2),
    chrome: [base.ink, base.ink, base.inkMuted, base.ink],
  };
}

export const THEMES: Record<ThemeName, Theme> = {
  /* ------------------------------- print ------------------------------- */

  /** The default: warm paper, one yellow, a blue marker. */
  "clean-light": print({
    name: "clean-light",
    dark: false,
    ground: "#FBFAF6",
    grid: "rgba(26, 26, 26, 0.052)",
    ink: "#1D1D1B",
    inkMuted: "rgba(29, 29, 27, 0.60)",
    accent: "#FBD24B",
    mark: "#8A6205",
    accentInk: "#1D1D1B",
    accentAlt: "#6AA6FF",
    surface: "#FCEFB7",
    highlight: "#C3D7F7",
    card: "#FFFFFF",
    shadow: "#1D1D1B",
    backdrop: ["#FBFAF6", "#F3F1EA", "#EDEAE1"],
    gradeTop: "rgba(251, 250, 246, 0.30)",
    gradeBottom: "rgba(251, 250, 246, 0.88)",
    panel: "rgba(255, 255, 255, 0.86)",
    panelBorder: "rgba(29, 29, 27, 0.14)",
    support: "#6AA6FF",
  }),

  /** The same system after dark: ink paper, the yellow does all the work. */
  "studio-dark": print({
    name: "studio-dark",
    dark: true,
    ground: "#131519",
    grid: "rgba(255, 255, 255, 0.055)",
    ink: "#F7F6F1",
    inkMuted: "rgba(247, 246, 241, 0.62)",
    accent: "#FBD24B",
    mark: "#FBD24B",
    accentInk: "#17181C",
    accentAlt: "#8FB8FF",
    surface: "#332C1E",
    highlight: "#3A4A6B",
    card: "#232830",
    shadow: "#000000",
    backdrop: ["#17181C", "#1E2026", "#101116"],
    gradeTop: "rgba(12, 13, 17, 0.34)",
    gradeBottom: "rgba(12, 13, 17, 0.90)",
    panel: "rgba(33, 34, 39, 0.82)",
    panelBorder: "rgba(255, 255, 255, 0.14)",
    support: "#8FB8FF",
  }),

  /** Cool paper, one blue, a warm marker so the two never merge. */
  "cyber-blue": print({
    name: "cyber-blue",
    dark: false,
    ground: "#F7F9FC",
    grid: "rgba(20, 33, 58, 0.055)",
    ink: "#14213A",
    inkMuted: "rgba(20, 33, 58, 0.60)",
    accent: "#5E9BFF",
    mark: "#2A5FC4",
    accentInk: "#0B1428",
    accentAlt: "#F2B441",
    surface: "#DCE8FF",
    highlight: "#FFE08A",
    card: "#FFFFFF",
    shadow: "#14213A",
    backdrop: ["#F7F9FC", "#EDF2FA", "#E4EBF6"],
    gradeTop: "rgba(247, 249, 252, 0.30)",
    gradeBottom: "rgba(247, 249, 252, 0.88)",
    panel: "rgba(255, 255, 255, 0.86)",
    panelBorder: "rgba(20, 33, 58, 0.14)",
    support: "#F2B441",
  }),

  /** Warm paper, coral accent, a green marker to keep them apart. */
  sunset: print({
    name: "sunset",
    dark: false,
    ground: "#FDF7F2",
    grid: "rgba(42, 26, 20, 0.055)",
    ink: "#2A1A14",
    inkMuted: "rgba(42, 26, 20, 0.60)",
    accent: "#FF9257",
    mark: "#C24A15",
    accentInk: "#2A1A14",
    accentAlt: "#4FA98A",
    surface: "#FFE1CD",
    highlight: "#BFE3D6",
    card: "#FFFFFF",
    shadow: "#2A1A14",
    backdrop: ["#FDF7F2", "#F8EDE4", "#F2E3D7"],
    gradeTop: "rgba(253, 247, 242, 0.30)",
    gradeBottom: "rgba(253, 247, 242, 0.88)",
    panel: "rgba(255, 255, 255, 0.86)",
    panelBorder: "rgba(42, 26, 20, 0.14)",
    support: "#4FA98A",
  }),

  /* ----------------------------- editorial ----------------------------- */

  /**
   * The magazine cover. Near-black, one red plate, crop marks.
   *
   * The red is a printing red rather than a screen red -- slightly orange,
   * slightly dirty -- because a pure #FF0000 on black is the single most
   * common tell of a frame nobody art-directed.
   */
  obsidian: {
    name: "obsidian",
    finish: "editorial",
    dark: true,
    ground: "#0A0A0B",
    grid: "rgba(255, 255, 255, 0.035)",
    ink: "#F2F0EC",
    inkMuted: "rgba(242, 240, 236, 0.55)",
    accent: "#E0342A",
    mark: "#E0342A",
    accentInk: "#0A0A0B",
    accentAlt: "#E8C46A",
    surface: "#17171A",
    highlight: "#2A1614",
    card: "#141416",
    shadow: "#000000",
    ghost: "rgba(255, 255, 255, 0.042)",
    bracket: "rgba(255, 255, 255, 0.62)",
    hairline: "rgba(255, 255, 255, 0.13)",
    mesh: ["#0A0A0B", "#141215", "#0A0A0B"],
    glassFill: "rgba(24, 24, 27, 0.72)",
    glassEdge: "rgba(255, 255, 255, 0.16)",
    glassGlow: "rgba(224, 52, 42, 0.20)",
    chrome: ["#FFFFFF", "#DAD8D4", "#79777A", "#F5F3EF"],
    backdrop: ["#0A0A0B", "#131315", "#08080A"],
    gradeTop: "rgba(8, 8, 10, 0.30)",
    gradeBottom: "rgba(8, 8, 10, 0.92)",
    panel: "rgba(20, 20, 22, 0.84)",
    panelBorder: "rgba(255, 255, 255, 0.14)",
    support: "#E8C46A",
  },

  /** Pure black, pure white, one alarm red. Nothing else in the frame. */
  noir: {
    name: "noir",
    finish: "editorial",
    dark: true,
    ground: "#000000",
    grid: "rgba(255, 255, 255, 0.03)",
    ink: "#FFFFFF",
    inkMuted: "rgba(255, 255, 255, 0.52)",
    accent: "#C81E1E",
    mark: "#E23B3B",
    accentInk: "#FFFFFF",
    accentAlt: "#8A8A8A",
    surface: "#111111",
    highlight: "#1E0A0A",
    card: "#0C0C0C",
    shadow: "#000000",
    ghost: "rgba(255, 255, 255, 0.05)",
    bracket: "rgba(255, 255, 255, 0.7)",
    hairline: "rgba(255, 255, 255, 0.18)",
    mesh: ["#000000", "#0B0B0B", "#000000"],
    glassFill: "rgba(14, 14, 14, 0.78)",
    glassEdge: "rgba(255, 255, 255, 0.2)",
    glassGlow: "rgba(200, 30, 30, 0.22)",
    chrome: ["#FFFFFF", "#CFCFCF", "#6E6E6E", "#FFFFFF"],
    backdrop: ["#000000", "#0A0A0A", "#000000"],
    gradeTop: "rgba(0, 0, 0, 0.28)",
    gradeBottom: "rgba(0, 0, 0, 0.94)",
    panel: "rgba(12, 12, 12, 0.86)",
    panelBorder: "rgba(255, 255, 255, 0.18)",
    support: "#8A8A8A",
  },

  /** The same language on paper: broadsheet stock, one ink, one red. */
  newsprint: {
    name: "newsprint",
    finish: "editorial",
    dark: false,
    ground: "#F4F1EA",
    grid: "rgba(20, 18, 15, 0.045)",
    ink: "#14120F",
    inkMuted: "rgba(20, 18, 15, 0.56)",
    accent: "#D2402B",
    mark: "#B5301D",
    accentInk: "#FFFFFF",
    accentAlt: "#1B4D8F",
    surface: "#E7E2D6",
    highlight: "#F6DCC8",
    card: "#FFFFFF",
    shadow: "#14120F",
    ghost: "rgba(20, 18, 15, 0.055)",
    bracket: "rgba(20, 18, 15, 0.5)",
    hairline: "rgba(20, 18, 15, 0.16)",
    mesh: ["#F4F1EA", "#EDE8DD", "#F4F1EA"],
    glassFill: "rgba(255, 255, 255, 0.82)",
    glassEdge: "rgba(20, 18, 15, 0.14)",
    glassGlow: "rgba(210, 64, 43, 0.16)",
    chrome: ["#14120F", "#2E2A25", "#7A736A", "#14120F"],
    backdrop: ["#F4F1EA", "#EDE8DD", "#E5DFD2"],
    gradeTop: "rgba(244, 241, 234, 0.28)",
    gradeBottom: "rgba(244, 241, 234, 0.9)",
    panel: "rgba(255, 255, 255, 0.88)",
    panelBorder: "rgba(20, 18, 15, 0.14)",
    support: "#1B4D8F",
  },

  /** Charcoal and a burnt orange. Warmer than obsidian, still a cover. */
  ember: {
    name: "ember",
    finish: "editorial",
    dark: true,
    ground: "#100E0D",
    grid: "rgba(255, 244, 238, 0.04)",
    ink: "#F6F1EC",
    inkMuted: "rgba(246, 241, 236, 0.56)",
    accent: "#FF6A2B",
    mark: "#FF6A2B",
    accentInk: "#150C06",
    accentAlt: "#F7C948",
    surface: "#20160F",
    highlight: "#2E1A0E",
    card: "#181413",
    shadow: "#000000",
    ghost: "rgba(255, 241, 236, 0.045)",
    bracket: "rgba(255, 241, 236, 0.58)",
    hairline: "rgba(255, 241, 236, 0.14)",
    mesh: ["#100E0D", "#1B1210", "#0C0A09"],
    glassFill: "rgba(28, 22, 20, 0.74)",
    glassEdge: "rgba(255, 241, 236, 0.16)",
    glassGlow: "rgba(255, 106, 43, 0.24)",
    chrome: ["#FFF6EF", "#E4D8CE", "#7E7369", "#FFF6EF"],
    backdrop: ["#100E0D", "#1A1614", "#0B0A09"],
    gradeTop: "rgba(12, 10, 9, 0.3)",
    gradeBottom: "rgba(12, 10, 9, 0.92)",
    panel: "rgba(26, 22, 20, 0.84)",
    panelBorder: "rgba(255, 241, 236, 0.15)",
    support: "#F7C948",
  },

  /* ------------------------------- glass ------------------------------- */

  /**
   * Deep blue light with frosted panels over it, and one warm accent.
   *
   * The warm accent matters more than the blue: a blue frame with blue marks
   * on it has no focal point, and the bloom underneath will swallow anything
   * that shares its hue.
   */
  cobalt: {
    name: "cobalt",
    finish: "glass",
    dark: true,
    ground: "#050B1A",
    grid: "rgba(210, 230, 255, 0.05)",
    ink: "#F2F7FF",
    inkMuted: "rgba(242, 247, 255, 0.62)",
    accent: "#FF8A5B",
    mark: "#FF8A5B",
    accentInk: "#160A05",
    accentAlt: "#5CA8FF",
    surface: "rgba(92, 168, 255, 0.16)",
    highlight: "rgba(255, 138, 91, 0.22)",
    card: "rgba(14, 30, 62, 0.72)",
    shadow: "#02060F",
    ghost: "rgba(210, 230, 255, 0.055)",
    bracket: "rgba(210, 230, 255, 0.55)",
    hairline: "rgba(210, 230, 255, 0.18)",
    mesh: ["#0A2E8C", "#123FA8", "#04102B"],
    glassFill: "rgba(226, 238, 255, 0.10)",
    glassEdge: "rgba(255, 255, 255, 0.34)",
    glassGlow: "rgba(70, 140, 255, 0.4)",
    chrome: ["#FFFFFF", "#D6E4F7", "#7E93B4", "#FFFFFF"],
    backdrop: ["#04102B", "#0A2E8C", "#03091C"],
    gradeTop: "rgba(3, 9, 28, 0.26)",
    gradeBottom: "rgba(3, 9, 28, 0.9)",
    panel: "rgba(226, 238, 255, 0.12)",
    panelBorder: "rgba(255, 255, 255, 0.3)",
    support: "#5CA8FF",
  },

  /** Ink and teal. For anything about systems, depth or the unseen. */
  abyss: {
    name: "abyss",
    finish: "glass",
    dark: true,
    ground: "#04090E",
    grid: "rgba(200, 255, 246, 0.045)",
    ink: "#EAF7F5",
    inkMuted: "rgba(234, 247, 245, 0.58)",
    accent: "#2FD9C3",
    mark: "#2FD9C3",
    accentInk: "#02110E",
    accentAlt: "#A88BFF",
    surface: "rgba(47, 217, 195, 0.14)",
    highlight: "rgba(168, 139, 255, 0.2)",
    card: "rgba(10, 28, 32, 0.74)",
    shadow: "#01060A",
    ghost: "rgba(200, 255, 246, 0.05)",
    bracket: "rgba(200, 255, 246, 0.5)",
    hairline: "rgba(200, 255, 246, 0.16)",
    mesh: ["#0B4F52", "#123A5E", "#03080D"],
    glassFill: "rgba(220, 255, 250, 0.09)",
    glassEdge: "rgba(255, 255, 255, 0.3)",
    glassGlow: "rgba(47, 217, 195, 0.32)",
    chrome: ["#FFFFFF", "#CFE9E5", "#6C8A88", "#FFFFFF"],
    backdrop: ["#03080D", "#0B3A3E", "#02060A"],
    gradeTop: "rgba(2, 6, 10, 0.26)",
    gradeBottom: "rgba(2, 6, 10, 0.9)",
    panel: "rgba(220, 255, 250, 0.1)",
    panelBorder: "rgba(255, 255, 255, 0.26)",
    support: "#A88BFF",
  },

  /**
   * The bright one: pale blue light, white frost, a single strong blue.
   *
   * The only light glass palette. Light frost needs a much stronger ink than
   * dark frost does -- half the contrast disappears into the bloom -- so the
   * ink here is near-black rather than a soft navy.
   */
  daylight: {
    name: "daylight",
    finish: "glass",
    dark: false,
    ground: "#E9F3FF",
    grid: "rgba(11, 27, 43, 0.05)",
    ink: "#0B1B2B",
    inkMuted: "rgba(11, 27, 43, 0.58)",
    accent: "#1F6FEB",
    mark: "#1F6FEB",
    accentInk: "#FFFFFF",
    accentAlt: "#FF7A45",
    surface: "rgba(31, 111, 235, 0.12)",
    highlight: "rgba(255, 122, 69, 0.2)",
    card: "rgba(255, 255, 255, 0.78)",
    shadow: "rgba(11, 27, 43, 0.32)",
    ghost: "rgba(11, 27, 43, 0.05)",
    bracket: "rgba(11, 27, 43, 0.42)",
    hairline: "rgba(11, 27, 43, 0.14)",
    mesh: ["#BEDCFF", "#EAF4FF", "#D6E9FF"],
    glassFill: "rgba(255, 255, 255, 0.55)",
    glassEdge: "rgba(255, 255, 255, 0.9)",
    glassGlow: "rgba(31, 111, 235, 0.18)",
    chrome: ["#0B1B2B", "#274A6B", "#8FA6BC", "#0B1B2B"],
    backdrop: ["#EAF4FF", "#D6E9FF", "#C4DEFF"],
    gradeTop: "rgba(233, 243, 255, 0.28)",
    gradeBottom: "rgba(233, 243, 255, 0.88)",
    panel: "rgba(255, 255, 255, 0.72)",
    panelBorder: "rgba(11, 27, 43, 0.12)",
    support: "#FF7A45",
  },
};

export function themeOf(name: ThemeName | undefined): Theme {
  return THEMES[name ?? "clean-light"] ?? THEMES["clean-light"];
}

export function isThemeName(value: string | undefined): value is ThemeName {
  return Boolean(value && value in THEMES);
}

/**
 * Type shadow.
 *
 * Flat printed work does not use one: it is only reached for when words sit
 * directly on a photograph and have nothing else to hold them. Glass does,
 * always -- type over a bloom of light has nothing else to separate it.
 */
export function inkShadow(theme: Theme): { colour: string; blur: number } {
  if (theme.finish === "glass") {
    return theme.dark
      ? { colour: "rgba(0, 0, 0, 0.42)", blur: 28 }
      : { colour: "rgba(11, 27, 43, 0.22)", blur: 20 };
  }
  return theme.dark
    ? { colour: "rgba(0, 0, 0, 0.55)", blur: 22 }
    : { colour: "rgba(29, 29, 27, 0.20)", blur: 16 };
}

export function accentGlow(theme: Theme, strength = 0.5): string {
  return withAlpha(theme.accent, strength);
}
