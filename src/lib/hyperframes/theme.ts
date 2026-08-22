import { withAlpha } from "@/lib/video/grade";

/**
 * The look.
 *
 * One system, four palettes. Every one is built from the same five roles --
 * paper, ink, one accent, one tinted surface, one highlight marker -- because
 * the failure mode of generated video design is four hues and a gradient
 * fighting inside one frame. Restraint is what makes it read as designed
 * rather than assembled.
 *
 * The vocabulary is deliberately flat and printed: paper with a ruled grid,
 * rounded cards with a hard offset shadow, a marker swipe behind the words
 * that matter. No glass, no glow, no neon.
 */

export type ThemeName = "studio-dark" | "cyber-blue" | "sunset" | "clean-light";

export interface Theme {
  name: ThemeName;
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
  /** A tinted card fill, the accent at a fraction of its strength. */
  surface: string;
  /** Marker swipe behind a phrase that carries the point. */
  highlight: string;
  /** Plain card fill sitting on the paper. */
  card: string;
  /** Hard offset shadow under cards and numerals. Never blurred. */
  shadow: string;

  /* ---- kept for the parts that render over artwork ---- */
  backdrop: [string, string, string];
  gradeTop: string;
  gradeBottom: string;
  panel: string;
  panelBorder: string;
  support: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  /** The default: warm paper, one yellow, a blue marker. */
  "clean-light": {
    name: "clean-light",
    dark: false,
    ground: "#FBFAF6",
    grid: "rgba(26, 26, 26, 0.052)",
    ink: "#1D1D1B",
    inkMuted: "rgba(29, 29, 27, 0.60)",
    accent: "#FBD24B",
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
  },

  /** The same system after dark: ink paper, the yellow does all the work. */
  "studio-dark": {
    name: "studio-dark",
    dark: true,
    ground: "#131519",
    grid: "rgba(255, 255, 255, 0.055)",
    ink: "#F7F6F1",
    inkMuted: "rgba(247, 246, 241, 0.62)",
    accent: "#FBD24B",
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
  },

  /** Cool paper, one blue, a warm marker so the two never merge. */
  "cyber-blue": {
    name: "cyber-blue",
    dark: false,
    ground: "#F7F9FC",
    grid: "rgba(20, 33, 58, 0.055)",
    ink: "#14213A",
    inkMuted: "rgba(20, 33, 58, 0.60)",
    accent: "#5E9BFF",
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
  },

  /** Warm paper, coral accent, a green marker to keep them apart. */
  sunset: {
    name: "sunset",
    dark: false,
    ground: "#FDF7F2",
    grid: "rgba(42, 26, 20, 0.055)",
    ink: "#2A1A14",
    inkMuted: "rgba(42, 26, 20, 0.60)",
    accent: "#FF9257",
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
  },
};

export function themeOf(name: ThemeName | undefined): Theme {
  return THEMES[name ?? "clean-light"] ?? THEMES["clean-light"];
}

/**
 * Type shadow.
 *
 * Flat printed work does not use one: it is only reached for when words sit
 * directly on a photograph and have nothing else to hold them.
 */
export function inkShadow(theme: Theme): { colour: string; blur: number } {
  return theme.dark
    ? { colour: "rgba(0, 0, 0, 0.55)", blur: 22 }
    : { colour: "rgba(29, 29, 27, 0.20)", blur: 16 };
}

export function accentGlow(theme: Theme, strength = 0.5): string {
  return withAlpha(theme.accent, strength);
}
