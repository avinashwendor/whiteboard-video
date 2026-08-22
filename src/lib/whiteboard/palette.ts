/**
 * The doodle-icon palette. Flat, saturated, opaque -- the look is chunky
 * near-black outlines over solid colour, so there are no gradients or washes.
 */
export const COLOURS = {
  ink: "#17181a",
  blue: "#4a9eff",
  yellow: "#ffd93d",
  orange: "#ffa35c",
  green: "#5bd97e",
  red: "#ff6b6b",
  violet: "#a78bfa",
  teal: "#5eead4",
  pink: "#f9a8d4",
  white: "#ffffff",
  paper: "#f7f6f3",
} as const;

export type ColourKey = keyof typeof COLOURS;

export const FILLABLE: ColourKey[] = [
  "blue",
  "yellow",
  "orange",
  "green",
  "red",
  "violet",
  "teal",
  "pink",
  "white",
];

/** Rotation used when a layout needs distinct colours without being told which. */
export const SERIES: ColourKey[] = ["blue", "yellow", "green", "orange", "violet", "red", "teal", "pink"];

export function colourOf(key: string | undefined, fallback: ColourKey = "blue"): string {
  return COLOURS[(key ?? "") as ColourKey] ?? COLOURS[fallback];
}
