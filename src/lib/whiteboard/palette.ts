/**
 * The board stock, and what is drawn on it.
 *
 * A whiteboard video's colour is the first thing anyone judges it on, and the
 * default failure is specific: bright, evenly-spaced, high-chroma primaries --
 * the palette every framework ships and every generated video wears. Real
 * marker work does not look like that. Neuland and Copic inks are dirtier and
 * unevenly weighted, the paper is never pure white, and no two of the colours
 * are at the same saturation.
 *
 * So there are five stocks rather than one palette. Each is a different
 * physical surface with the pens that belong on it -- a warm whiteboard, a
 * drafting blueprint, a slate chalkboard, kraft paper, a legal pad -- and each
 * one gets a video a whole different register without a line of new drawing
 * code. Every one keeps the same role names, so the layouts never know which
 * surface they are on.
 *
 * ## The mutable export
 *
 * `COLOURS` is a live binding rather than a constant. Canvas rendering here is
 * single-threaded and always draws one project at a time: the stock is set
 * once before a frame is composed and every draw inside that frame reads the
 * same value. Threading a palette object through fourteen drawing functions
 * would buy nothing that this does not already guarantee, and would make every
 * one of them take an argument that never varies within a call.
 */

export type ColourKey =
  | "ink"
  | "blue"
  | "yellow"
  | "orange"
  | "green"
  | "red"
  | "violet"
  | "teal"
  | "pink"
  | "white"
  | "paper";

export type BoardStockName = "marker" | "blueprint" | "chalk" | "kraft" | "legal";

export interface BoardStock {
  name: BoardStockName;
  /** Shown in the editor. */
  label: string;
  /** One line on when to reach for it, for the director's brief. */
  brief: string;
  /** True when the surface is dark and the ink is light. */
  dark: boolean;
  colours: Record<ColourKey, string>;
  /** The lighting on the surface: centre, midfield, edge. */
  wash: [string, string, string];
  /** The shadow the frame casts along the top edge. */
  bezel: string;
  /** The hairline around the whole board. */
  edge: string;
  /** Strength of the paper grain, 0-255 in the tile's alpha channel. */
  grain: number;
}

export const BOARD_STOCKS: Record<BoardStockName, BoardStock> = {
  /**
   * A warm whiteboard under a room light. The default.
   *
   * The pens are deliberately off the primaries: a slightly grey blue, a
   * yellow with orange in it, a red that is closer to vermilion than to fire
   * engine. Sampled from the way real markers dry rather than picked off a
   * colour wheel, which is the whole reason it does not look generated.
   */
  marker: {
    name: "marker",
    label: "Whiteboard",
    brief: "a warm whiteboard under a room light -- the everyday choice",
    dark: false,
    colours: {
      ink: "#17181A",
      blue: "#2F6FB5",
      yellow: "#F0B400",
      orange: "#E2622C",
      green: "#3E9B5F",
      red: "#D23B2E",
      violet: "#7355C0",
      teal: "#2C9490",
      pink: "#CE5F92",
      white: "#FFFFFF",
      paper: "#F7F6F3",
    },
    wash: ["rgba(255, 253, 246, 0.72)", "rgba(247, 245, 239, 0.22)", "rgba(206, 200, 184, 0.30)"],
    bezel: "rgba(0, 0, 0, 0.07)",
    edge: "rgba(0, 0, 0, 0.055)",
    grain: 9,
  },

  /**
   * Drafting blueprint: dark navy stock, white line work, cool accents.
   *
   * For architecture, engineering, systems -- anything where the drawing is a
   * plan rather than a sketch. The ink is a warm white so it does not glare.
   */
  blueprint: {
    name: "blueprint",
    label: "Blueprint",
    brief: "navy drafting stock and white line work -- for plans, systems, engineering",
    dark: true,
    colours: {
      ink: "#E6EFFA",
      blue: "#7FC4FF",
      yellow: "#F3CE72",
      orange: "#FF9F63",
      green: "#78D8A0",
      red: "#FF837A",
      violet: "#B49BFF",
      teal: "#67DFD6",
      pink: "#FF9FC4",
      white: "#FFFFFF",
      paper: "#0D2137",
    },
    wash: ["rgba(72, 132, 196, 0.22)", "rgba(20, 52, 88, 0.16)", "rgba(3, 12, 24, 0.42)"],
    bezel: "rgba(255, 255, 255, 0.06)",
    edge: "rgba(255, 255, 255, 0.10)",
    grain: 12,
  },

  /**
   * A slate chalkboard. Dusty, soft, and unmistakably a classroom.
   *
   * The accents are all desaturated toward the board: chalk cannot be
   * saturated, and a bright green on slate is the giveaway that this is a
   * filter rather than a surface.
   */
  chalk: {
    name: "chalk",
    label: "Chalkboard",
    brief: "slate and dusty chalk -- for teaching, school subjects, first principles",
    dark: true,
    colours: {
      ink: "#F1ECE0",
      blue: "#93B9E4",
      yellow: "#EFD094",
      orange: "#EDAB80",
      green: "#9BD0A6",
      red: "#E9908A",
      violet: "#BCA9E2",
      teal: "#93D5CD",
      pink: "#E7A8C2",
      white: "#FBF8F0",
      paper: "#20262B",
    },
    wash: ["rgba(240, 236, 224, 0.10)", "rgba(32, 38, 43, 0.10)", "rgba(8, 11, 13, 0.40)"],
    bezel: "rgba(255, 255, 255, 0.05)",
    edge: "rgba(255, 255, 255, 0.09)",
    grain: 16,
  },

  /**
   * Kraft paper: brown card, black ink, one red. Studio-notebook language.
   *
   * The accents are earth-weighted so they sit in the paper rather than on it.
   */
  kraft: {
    name: "kraft",
    label: "Kraft paper",
    brief: "brown card and black ink -- for craft, making, history, anything handmade",
    dark: false,
    colours: {
      ink: "#221A12",
      blue: "#2C5C82",
      yellow: "#C08908",
      orange: "#BF541F",
      green: "#3F7346",
      red: "#A82F26",
      violet: "#5B4489",
      teal: "#226E6B",
      pink: "#A44F76",
      white: "#F6EFE2",
      paper: "#D9C4A3",
    },
    wash: ["rgba(255, 244, 224, 0.36)", "rgba(217, 196, 163, 0.14)", "rgba(120, 96, 66, 0.28)"],
    bezel: "rgba(60, 44, 26, 0.09)",
    edge: "rgba(60, 44, 26, 0.10)",
    grain: 22,
  },

  /**
   * A legal pad in blue biro. The most informal surface in the set.
   *
   * For working-out, plans, notes to yourself -- anything that should look
   * like thinking rather than presenting.
   */
  legal: {
    name: "legal",
    label: "Legal pad",
    brief: "yellow pad and blue biro -- for working things out, notes, back-of-envelope",
    dark: false,
    colours: {
      ink: "#1D2B57",
      blue: "#23439B",
      yellow: "#C79A0A",
      orange: "#C25A1D",
      green: "#2F6B3E",
      red: "#B22C2B",
      violet: "#5C3F92",
      teal: "#1F6E6C",
      pink: "#A8497A",
      white: "#FFFDF0",
      paper: "#F7ECB4",
    },
    wash: ["rgba(255, 250, 214, 0.5)", "rgba(247, 236, 180, 0.16)", "rgba(190, 168, 96, 0.26)"],
    bezel: "rgba(60, 52, 12, 0.07)",
    edge: "rgba(60, 52, 12, 0.09)",
    grain: 11,
  },
};

/** As a tuple, so a Zod enum can be built from it without repeating the names. */
export const BOARD_STOCK_NAMES_TUPLE = ["marker", "blueprint", "chalk", "kraft", "legal"] as const;

export const BOARD_STOCK_NAMES: BoardStockName[] = [...BOARD_STOCK_NAMES_TUPLE];

let stock: BoardStock = BOARD_STOCKS.marker;

/**
 * The pens currently in hand.
 *
 * A live binding: reassigned by `setBoardStock`, and every importer sees the
 * change. See the note at the top of the file for why this is a module-level
 * value rather than an argument.
 */
export let COLOURS: Record<ColourKey, string> = stock.colours;

/** Everything about the surface, not just its pens. */
export function boardStock(): BoardStock {
  return stock;
}

/**
 * Picks the surface for the video about to be drawn.
 *
 * Must be called before a scene is *composed*, not merely before it is
 * painted: layouts bake colours into their primitives, so a stock chosen after
 * `prepareScene` would leave a video drawn in one palette on paper from
 * another.
 */
export function setBoardStock(name: BoardStockName | undefined): BoardStock {
  stock = BOARD_STOCKS[name ?? "marker"] ?? BOARD_STOCKS.marker;
  COLOURS = stock.colours;
  return stock;
}

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
