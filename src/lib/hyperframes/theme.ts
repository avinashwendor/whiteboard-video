import { withAlpha } from "@/lib/video/grade";

/**
 * Looks.
 *
 * One accent per video, used where it means something -- the number, the live
 * word, the line that carries the point -- and neutrals everywhere else. The
 * previous engine reached for cyan, magenta, purple and blue inside a single
 * frame, and no amount of motion design survives four hues fighting.
 */

export type ThemeName = "studio-dark" | "cyber-blue" | "sunset" | "clean-light";

export interface Theme {
  name: ThemeName;
  /** True when the frame is dark and type should be light. */
  dark: boolean;
  /** Background ramp, painted when there is no artwork behind the scene. */
  backdrop: [string, string, string];
  /** Grade laid over artwork so type always has something to sit on. */
  gradeTop: string;
  gradeBottom: string;
  ink: string;
  inkMuted: string;
  accent: string;
  /** A second hue, used only where two things must be told apart. */
  support: string;
  /** Panel fill and hairline for glass surfaces. */
  panel: string;
  panelBorder: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  "studio-dark": {
    name: "studio-dark",
    dark: true,
    backdrop: ["#0b0d12", "#141922", "#07080c"],
    gradeTop: "rgba(6, 8, 14, 0.42)",
    gradeBottom: "rgba(4, 5, 10, 0.94)",
    ink: "#ffffff",
    inkMuted: "rgba(233, 236, 243, 0.74)",
    accent: "#f5b13d",
    support: "#7fb2ff",
    panel: "rgba(12, 16, 26, 0.56)",
    panelBorder: "rgba(255, 255, 255, 0.14)",
  },
  "cyber-blue": {
    name: "cyber-blue",
    dark: true,
    backdrop: ["#05101c", "#0b2036", "#03080f"],
    gradeTop: "rgba(4, 12, 24, 0.44)",
    gradeBottom: "rgba(2, 6, 14, 0.94)",
    ink: "#ffffff",
    inkMuted: "rgba(214, 232, 248, 0.74)",
    accent: "#43d2ff",
    support: "#9d8bff",
    panel: "rgba(8, 22, 38, 0.58)",
    panelBorder: "rgba(140, 220, 255, 0.20)",
  },
  sunset: {
    name: "sunset",
    dark: true,
    backdrop: ["#180b12", "#2c1420", "#0b0508"],
    gradeTop: "rgba(20, 8, 12, 0.40)",
    gradeBottom: "rgba(10, 4, 8, 0.94)",
    ink: "#fff6f0",
    inkMuted: "rgba(255, 226, 214, 0.74)",
    accent: "#ff8a4c",
    support: "#ffd166",
    panel: "rgba(30, 14, 20, 0.56)",
    panelBorder: "rgba(255, 190, 150, 0.20)",
  },
  "clean-light": {
    name: "clean-light",
    dark: false,
    backdrop: ["#f6f7f9", "#eceef2", "#e3e6ec"],
    gradeTop: "rgba(255, 255, 255, 0.34)",
    gradeBottom: "rgba(245, 246, 249, 0.92)",
    ink: "#0d1117",
    inkMuted: "rgba(28, 34, 45, 0.68)",
    accent: "#1f6feb",
    support: "#d1462f",
    panel: "rgba(255, 255, 255, 0.72)",
    panelBorder: "rgba(15, 20, 30, 0.12)",
  },
};

export function themeOf(name: ThemeName | undefined): Theme {
  return THEMES[name ?? "studio-dark"] ?? THEMES["studio-dark"];
}

/** Type shadow that keeps words legible over any artwork. */
export function inkShadow(theme: Theme): { colour: string; blur: number } {
  return theme.dark
    ? { colour: "rgba(0, 0, 0, 0.62)", blur: 26 }
    : { colour: "rgba(15, 20, 30, 0.22)", blur: 18 };
}

export function accentGlow(theme: Theme, strength = 0.5): string {
  return withAlpha(theme.accent, strength);
}
