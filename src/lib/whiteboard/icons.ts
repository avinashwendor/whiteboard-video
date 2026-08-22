import { circle, curve, ellipse, line, poly, rr } from "./geometry";
import type { ColourKey } from "./palette";

/**
 * The doodle-icon library.
 *
 * Every icon is authored in a 0..100 box from a handful of primitives, drawn
 * back to front: filled silhouette first, then details on top.
 *
 * Includes dynamic runtime registration for on-the-fly generated icons
 * produced by the agentic loop synthesizer.
 */

export interface IconShape {
  d: string;
  fill?: ColourKey;
  stroke?: boolean;
  /** Stroke width in icon units (the box is 100 wide). */
  width?: number;
}

export interface IconDef {
  shapes: IconShape[];
  /** Extra words that should resolve to this icon. */
  aliases?: string[];
}

const W = 7;

function def(shapes: IconShape[], aliases?: string[]): IconDef {
  return { shapes, aliases };
}

export const ICONS: Record<string, IconDef> = {
  /* ------------------------------- thinking & AI ------------------------------- */

  brain: def(
    [
      { d: "M 50 75 V 20.83", stroke: true, width: 8 },
      { d: "M 62.5 54.17 a 17.38 17.38 0 0 1 -12.5 -16.67 17.38 17.38 0 0 1 -12.5 16.67", stroke: true, width: 8 },
      { d: "M 73.33 27.08 A 12.5 12.5 0 1 0 50 20.83 a 12.5 12.5 0 1 0 -23.33 6.25", stroke: true, width: 8 },
      { d: "M 74.99 21.35 a 16.67 16.67 0 0 1 10.53 24.04", stroke: true, width: 8 },
      { d: "M 75 75 a 16.67 16.67 0 0 0 8.33 -31.1", stroke: true, width: 8 },
      { d: "M 83.2 72.85 A 16.67 16.67 0 1 1 50 75 a 16.67 16.67 0 1 1 -33.2 -2.15", stroke: true, width: 8 },
      { d: "M 25 75 a 16.67 16.67 0 0 1 -8.33 -31.1", stroke: true, width: 8 },
      { d: "M 25.01 21.35 a 16.67 16.67 0 0 0 -10.52 24.04", stroke: true, width: 8 },
    ],
    ["mind", "idea", "think", "ai", "intelligence", "learning", "memory", "neuroscience", "cognition"],
  ),

  lightbulb: def(
    [
      { d: "M 50 12 Q 76 12 76 38 Q 76 52 62 62 L 62 72 L 38 72 L 38 62 Q 24 52 24 38 Q 24 12 50 12 Z", fill: "yellow" },
      { d: rr(39, 72, 22, 8, 3), fill: "orange" },
      { d: rr(41, 80, 18, 8, 3), fill: "orange" },
      { d: line(50, 34, 50, 62), width: 5 },
      { d: line(42, 44, 50, 52), width: 5 },
      { d: line(58, 44, 50, 52), width: 5 },
    ],
    ["idea", "insight", "innovation", "solution", "discovery", "creative", "invention"],
  ),

  sparkle: def(
    [
      { d: "M 50 10 Q 50 50 90 50 Q 50 50 50 90 Q 50 50 10 50 Q 50 50 50 10 Z", fill: "yellow" },
      { d: circle(76, 24, 5), fill: "teal", width: 3 },
      { d: circle(24, 76, 4), fill: "pink", width: 3 },
    ],
    ["magic", "ai", "smart", "generate", "creative", "shine", "special", "intelligence", "prompt", "llm"],
  ),

  question: def(
    [
      { d: circle(50, 50, 34), fill: "violet" },
      { d: "M 38 40 Q 38 26 50 26 Q 64 26 64 38 Q 64 48 52 52 L 52 60", stroke: true, width: 8 },
      { d: circle(51, 72, 4), fill: "ink", width: 3 },
    ],
    ["why", "unknown", "confusion", "problem", "doubt", "faq", "curiosity", "question"],
  ),

  /* --------------------------------- people & society -------------------------------- */

  person: def(
    [
      { d: circle(50, 28, 16), fill: "yellow" },
      { d: "M 24 88 Q 24 54 50 54 Q 76 54 76 88 Z", fill: "blue" },
      { d: circle(44, 27, 2.6), fill: "ink", width: 2 },
      { d: circle(57, 27, 2.6), fill: "ink", width: 2 },
      { d: curve(43, 35, 57, 35, 5), stroke: true, width: 4 },
    ],
    ["user", "human", "student", "customer", "you", "child", "individual", "man", "woman"],
  ),

  team: def(
    [
      { d: circle(30, 34, 13), fill: "green" },
      { d: "M 10 86 Q 10 58 30 58 Q 50 58 50 86 Z", fill: "green" },
      { d: circle(70, 34, 13), fill: "violet" },
      { d: "M 50 86 Q 50 58 70 58 Q 90 58 90 86 Z", fill: "violet" },
    ],
    ["people", "group", "everyone", "society", "community", "audience", "collaborate", "partnership"],
  ),

  /* ---------------------------------- tech & hardware --------------------------------- */

  chip: def(
    [
      { d: rr(28, 28, 44, 44, 6), fill: "violet" },
      { d: rr(40, 40, 20, 20, 3), fill: "white", width: 5 },
      { d: line(38, 28, 38, 16), width: 6 },
      { d: line(62, 28, 62, 16), width: 6 },
      { d: line(38, 72, 38, 84), width: 6 },
      { d: line(62, 72, 62, 84), width: 6 },
      { d: line(28, 40, 16, 40), width: 6 },
      { d: line(28, 60, 16, 60), width: 6 },
      { d: line(72, 40, 84, 40), width: 6 },
      { d: line(72, 60, 84, 60), width: 6 },
    ],
    ["processor", "cpu", "hardware", "compute", "gpu", "silicon", "microchip", "semiconductor"],
  ),

  laptop: def(
    [
      { d: rr(22, 22, 56, 40, 5), fill: "yellow" },
      { d: rr(28, 28, 44, 28, 3), fill: "blue" },
      { d: poly([[12, 62], [88, 62], [82, 76], [18, 76]]), fill: "yellow" },
      { d: rr(44, 66, 12, 5, 2.5), fill: "blue", width: 4 },
    ],
    ["computer", "pc", "software", "demo", "device", "workstation", "screen"],
  ),

  phone: def(
    [
      { d: rr(32, 10, 36, 80, 8), fill: "blue" },
      { d: rr(38, 20, 24, 54, 3), fill: "white" },
      { d: circle(50, 82, 4), fill: "white", width: 4 },
    ],
    ["mobile", "app", "call", "smartphone", "cellular", "ios", "android"],
  ),

  robot: def(
    [
      { d: rr(24, 30, 52, 46, 10), fill: "teal" },
      { d: circle(39, 48, 6), fill: "white" },
      { d: circle(61, 48, 6), fill: "white" },
      { d: curve(40, 64, 60, 64, 6), stroke: true, width: 5 },
      { d: line(50, 30, 50, 18), width: 6 },
      { d: circle(50, 14, 6), fill: "red" },
    ],
    ["automation", "bot", "machine", "assistant", "agent", "robotics"],
  ),

  cloud: def(
    [
      { d: "M 24 68 Q 8 68 10 54 Q 12 42 26 42 Q 30 24 48 26 Q 64 26 68 40 Q 88 40 88 56 Q 88 68 74 68 Z", fill: "blue" },
      { d: curve(30, 52, 44, 48, 5), stroke: true, width: 4 },
    ],
    ["server", "internet", "online", "storage", "production", "sky", "saas", "infrastructure"],
  ),

  database: def(
    [
      { d: ellipse(50, 26, 28, 11), fill: "blue" },
      { d: "M 22 26 L 22 74 Q 22 85 50 85 Q 78 85 78 74 L 78 26", fill: "blue" },
      { d: ellipse(50, 26, 28, 11), fill: "blue" },
      { d: curve(24, 46, 76, 46, 9), stroke: true, width: 5 },
      { d: curve(24, 62, 76, 62, 9), stroke: true, width: 5 },
      { d: circle(38, 70, 3.4), fill: "yellow", width: 3 },
    ],
    ["data", "storage", "records", "dataset", "spreadsheets", "sql", "warehouse"],
  ),

  code: def(
    [
      { d: poly([[34, 28], [16, 50], [34, 72]], false), stroke: true, width: 8 },
      { d: poly([[66, 28], [84, 50], [66, 72]], false), stroke: true, width: 8 },
      { d: line(56, 22, 44, 78), width: 7 },
    ],
    ["programming", "developer", "syntax", "algorithm", "software", "api", "logic", "terminal", "script"],
  ),

  network: def(
    [
      { d: circle(50, 24, 10), fill: "blue" },
      { d: circle(24, 72, 10), fill: "green" },
      { d: circle(76, 72, 10), fill: "violet" },
      { d: line(50, 34, 24, 62), width: 6 },
      { d: line(50, 34, 76, 62), width: 6 },
      { d: line(34, 72, 66, 72), width: 6 },
    ],
    ["graph", "connected", "nodes", "internet", "mesh", "flow", "topology", "distributed"],
  ),

  layers: def(
    [
      { d: poly([[50, 16], [84, 30], [50, 44], [16, 30]]), fill: "blue" },
      { d: poly([[50, 38], [84, 52], [50, 66], [16, 52]]), fill: "teal" },
      { d: poly([[50, 60], [84, 74], [50, 88], [16, 74]]), fill: "yellow" },
    ],
    ["stack", "architecture", "tiers", "hierarchy", "system", "deep", "levels", "neural"],
  ),

  /* --------------------------------- money & finance --------------------------------- */

  rupee: def(
    [
      { d: circle(50, 50, 36), fill: "orange" },
      { d: "M 32 30 L 68 30", stroke: true, width: 7 },
      { d: "M 32 44 L 62 44", stroke: true, width: 7 },
      { d: "M 42 30 L 42 44", stroke: true, width: 7 },
      { d: "M 42 44 Q 66 44 66 58 Q 66 70 42 70 L 66 84", stroke: true, width: 7 },
      { d: "M 42 44 L 42 70", stroke: true, width: 7 },
    ],
    ["rupee", "inr", "upi", "indiancurrency", "india", "paisa", "rupees"],
  ),

  coin: def(
    [
      { d: circle(50, 50, 32), fill: "yellow" },
      { d: circle(50, 50, 23), stroke: true, width: 5 },
      { d: "M 50 34 L 50 66 M 42 42 Q 58 42 58 50 Q 58 58 42 58", stroke: true, width: 6 },
    ],
    ["money", "cash", "coins", "price", "cost", "dollar", "interest", "savings", "currency", "usd"],
  ),

  wallet: def(
    [
      { d: rr(16, 28, 68, 46, 8), fill: "orange" },
      { d: rr(58, 44, 30, 16, 6), fill: "white" },
      { d: circle(70, 52, 4), fill: "ink", width: 3 },
    ],
    ["budget", "purse", "spending", "account", "bank", "payment", "funds"],
  ),

  creditcard: def(
    [
      { d: rr(14, 24, 72, 52, 8), fill: "blue" },
      { d: line(14, 38, 86, 38), width: 8 },
      { d: rr(24, 54, 16, 12, 2), fill: "yellow", width: 3 },
      { d: line(48, 60, 74, 60), width: 5 },
    ],
    ["card", "credit", "debit", "transaction", "swipe", "visa", "mastercard"],
  ),

  bank: def(
    [
      { d: poly([[50, 14], [88, 34], [12, 34]]), fill: "blue" },
      { d: line(12, 34, 88, 34), width: 6 },
      { d: line(22, 34, 22, 72), width: 7 },
      { d: line(40, 34, 40, 72), width: 7 },
      { d: line(60, 34, 60, 72), width: 7 },
      { d: line(78, 34, 78, 72), width: 7 },
      { d: rr(10, 72, 80, 12, 2), fill: "blue" },
    ],
    ["finance", "institution", "depository", "vault", "reserve", "loan"],
  ),

  /* --------------------------------- science & biology --------------------------------- */

  dna: def(
    [
      { d: "M 28 16 Q 72 36 28 56 Q 72 76 28 92", stroke: true, width: 7 },
      { d: "M 72 16 Q 28 36 72 56 Q 28 76 72 92", stroke: true, width: 7 },
      { d: line(36, 26, 64, 26), width: 5 },
      { d: line(36, 46, 64, 46), width: 5 },
      { d: line(36, 66, 64, 66), width: 5 },
      { d: line(36, 82, 64, 82), width: 5 },
    ],
    ["genetics", "biology", "gene", "heredity", "rna", "evolution", "helix"],
  ),

  atom: def(
    [
      { d: circle(50, 50, 9), fill: "red" },
      { d: ellipse(50, 50, 38, 14), stroke: true, width: 5 },
      { d: "M 23 23 A 38 14 45 0 0 77 77 A 38 14 45 0 0 23 23", stroke: true, width: 5 },
      { d: "M 77 23 A 38 14 135 0 0 23 77 A 38 14 135 0 0 77 23", stroke: true, width: 5 },
    ],
    ["physics", "quantum", "molecule", "science", "nuclear", "particles"],
  ),

  heart: def(
    [
      { d: "M 50 86 Q 12 60 12 36 Q 12 16 32 16 Q 46 16 50 30 Q 54 16 68 16 Q 88 16 88 36 Q 88 60 50 86 Z", fill: "red" },
    ],
    ["love", "care", "health", "passion", "wellbeing", "like", "medical", "cardio"],
  ),

  stethoscope: def(
    [
      { d: "M 32 18 L 32 42 Q 32 72 50 72 Q 68 72 68 42 L 68 18", stroke: true, width: 7 },
      { d: line(50, 72, 50, 84), width: 7 },
      { d: circle(50, 84, 8), fill: "teal" },
      { d: circle(32, 16, 4), fill: "ink" },
      { d: circle(68, 16, 4), fill: "ink" },
    ],
    ["doctor", "medicine", "hospital", "clinic", "diagnosis", "healthcare"],
  ),

  flask: def(
    [
      { d: poly([[42, 14], [58, 14], [58, 32], [82, 78], [18, 78], [42, 32]]), fill: "teal" },
      { d: line(38, 14, 62, 14), width: 6 },
      { d: "M 26 66 L 74 66", stroke: true, width: 5 },
      { d: circle(50, 56, 4), fill: "white", width: 3 },
      { d: circle(60, 68, 3), fill: "white", width: 2 },
    ],
    ["chemistry", "experiment", "lab", "research", "test", "science", "formula"],
  ),

  /* --------------------------------- business & strategy --------------------------------- */

  trophy: def(
    [
      { d: poly([[26, 18], [74, 18], [66, 52], [34, 52]]), fill: "yellow" },
      { d: "M 26 24 Q 10 24 12 38 Q 14 50 32 48", stroke: true, width: 6 },
      { d: "M 74 24 Q 90 24 88 38 Q 86 50 68 48", stroke: true, width: 6 },
      { d: line(50, 52, 50, 72), width: 8 },
      { d: rr(32, 72, 36, 14, 4), fill: "orange" },
      { d: circle(50, 34, 6), fill: "white", width: 3 },
    ],
    ["award", "victory", "winner", "prize", "achievement", "success", "best", "rank"],
  ),

  target: def(
    [
      { d: circle(50, 50, 34), fill: "red" },
      { d: circle(50, 50, 22), fill: "white" },
      { d: circle(50, 50, 10), fill: "red" },
    ],
    ["goal", "aim", "objective", "focus", "purpose", "outcome", "kpi"],
  ),

  chart: def(
    [
      { d: line(18, 16, 18, 82), width: 8 },
      { d: line(18, 82, 86, 82), width: 8 },
      { d: rr(28, 58, 14, 24, 3), fill: "blue" },
      { d: rr(48, 42, 14, 40, 3), fill: "blue" },
      { d: rr(68, 26, 14, 56, 3), fill: "blue" },
      { d: circle(55, 52, 4), fill: "red", width: 3 },
      { d: rr(71, 32, 8, 8, 2), fill: "yellow", width: 3 },
    ],
    ["bars", "statistics", "metrics", "results", "growth", "analytics", "dashboard"],
  ),

  trendup: def(
    [
      { d: line(16, 84, 84, 84), width: 7 },
      { d: line(16, 16, 16, 84), width: 7 },
      { d: "M 24 70 L 42 52 L 56 62 L 80 28", stroke: true, width: 8 },
      { d: poly([[84, 22], [66, 28], [78, 40]]), fill: "green" },
    ],
    ["increase", "rise", "improve", "up", "gain", "progress", "scaling", "rally"],
  ),

  trenddown: def(
    [
      { d: line(16, 84, 84, 84), width: 7 },
      { d: line(16, 16, 16, 84), width: 7 },
      { d: "M 24 30 L 42 48 L 56 38 L 80 72", stroke: true, width: 8 },
      { d: poly([[84, 78], [66, 72], [78, 60]]), fill: "red" },
    ],
    ["decrease", "fall", "drop", "down", "loss", "decline", "crash"],
  ),

  briefcase: def(
    [
      { d: rr(16, 32, 68, 50, 6), fill: "orange" },
      { d: "M 36 32 L 36 20 Q 36 14 50 14 Q 64 14 64 20 L 64 32", stroke: true, width: 6 },
      { d: line(16, 50, 84, 50), width: 6 },
      { d: rr(44, 46, 12, 10, 2), fill: "yellow", width: 3 },
    ],
    ["work", "job", "career", "business", "professional", "portfolio"],
  ),

  handshake: def(
    [
      { d: "m 45.83 70.83 8.33 8.33 a 4.17 4.17 0 1 0 12.5 -12.5", stroke: true, width: 8 },
      { d: "m 58.33 58.33 10.42 10.42 a 4.17 4.17 0 1 0 12.5 -12.5 l -16.17 -16.17 a 12.5 12.5 0 0 0 -17.67 0 l -3.67 3.67 a 4.17 4.17 0 1 1 -12.5 -12.5 l 11.71 -11.71 a 24.13 24.13 0 0 1 29.42 -3.63 l 1.96 1.17 a 8.33 8.33 0 0 0 5.92 1.04 L 87.5 16.67", stroke: true, width: 8 },
      { d: "m 87.5 12.5 4.17 45.83 h -8.33", stroke: true, width: 8 },
      { d: "M 12.5 12.5 8.33 58.33 l 27.08 27.08 a 4.17 4.17 0 1 0 12.5 -12.5", stroke: true, width: 8 },
      { d: "M 12.5 16.67 h 33.33", stroke: true, width: 8 },
    ],
    ["deal", "agreement", "partnership", "trust", "contract", "cooperation", "negotiation"],
  ),

  rocket: def(
    [
      { d: "M 50 8 Q 72 32 72 60 L 72 74 L 28 74 L 28 60 Q 28 32 50 8 Z", fill: "blue" },
      { d: "M 50 8 Q 60 20 63 34 L 37 34 Q 40 20 50 8 Z", fill: "yellow" },
      { d: circle(50, 46, 10), fill: "teal" },
      { d: poly([[28, 56], [14, 74], [28, 74]]), fill: "teal" },
      { d: poly([[72, 56], [86, 74], [72, 74]]), fill: "teal" },
      { d: "M 42 78 Q 50 96 58 78 Q 50 86 42 78 Z", fill: "orange" },
    ],
    ["launch", "startup", "fast", "growth", "space", "boost", "future", "speed"],
  ),

  /* --------------------------------- education & docs --------------------------------- */

  education: def(
    [
      { d: poly([[50, 18], [90, 36], [50, 54], [10, 36]]), fill: "violet" },
      { d: "M 24 44 L 24 66 Q 50 82 76 66 L 76 44", stroke: true, width: 6 },
      { d: line(90, 36, 90, 72), width: 5 },
      { d: circle(90, 74, 4), fill: "yellow", width: 3 },
    ],
    ["graduation", "degree", "university", "college", "school", "academy", "learning", "student"],
  ),

  book: def(
    [
      { d: rr(18, 20, 64, 62, 5), fill: "red" },
      { d: line(50, 20, 50, 82), width: 6 },
      { d: line(32, 38, 42, 38), width: 5 },
      { d: line(32, 52, 42, 52), width: 5 },
      { d: line(58, 38, 68, 38), width: 5 },
      { d: line(58, 52, 68, 52), width: 5 },
    ],
    ["learn", "study", "lesson", "knowledge", "read", "school", "textbook"],
  ),

  document: def(
    [
      { d: poly([[26, 12], [62, 12], [76, 28], [76, 88], [26, 88]]), fill: "white" },
      { d: poly([[62, 12], [62, 28], [76, 28]], false), stroke: true, width: 5 },
      { d: line(36, 44, 66, 44), width: 5 },
      { d: line(36, 56, 66, 56), width: 5 },
      { d: line(36, 68, 54, 68), width: 5 },
    ],
    ["file", "paper", "report", "page", "pdf", "note", "article", "contract"],
  ),

  presentation: def(
    [
      { d: rr(14, 16, 72, 50, 6), fill: "white" },
      { d: line(50, 66, 50, 88), width: 7 },
      { d: line(34, 88, 66, 88), width: 7 },
      { d: line(24, 32, 44, 32), width: 5 },
      { d: line(24, 44, 54, 44), width: 5 },
      { d: circle(64, 38, 8), fill: "blue", width: 4 },
    ],
    ["board", "showcase", "speech", "keynote", "lecture", "teach", "pitch", "slides"],
  ),

  building: def(
    [
      { d: rr(24, 18, 52, 70, 4), fill: "blue" },
      { d: rr(32, 28, 10, 10, 2), fill: "yellow", width: 3 },
      { d: rr(58, 28, 10, 10, 2), fill: "yellow", width: 3 },
      { d: rr(32, 46, 10, 10, 2), fill: "yellow", width: 3 },
      { d: rr(58, 46, 10, 10, 2), fill: "yellow", width: 3 },
      { d: rr(42, 68, 16, 20, 2), fill: "white", width: 4 },
    ],
    ["company", "office", "enterprise", "organization", "industry", "firm", "headquarters"],
  ),

  /* --------------------------------- security & utility --------------------------------- */

  shield: def(
    [
      { d: "M 50 10 L 84 24 L 84 54 Q 84 80 50 92 Q 16 80 16 54 L 16 24 Z", fill: "green" },
      { d: "M 36 50 L 46 62 L 66 38", stroke: true, width: 8 },
    ],
    ["defence", "protection", "trust", "reliable", "guard", "security", "firewall"],
  ),

  lock: def(
    [
      { d: "M 32 44 L 32 32 Q 32 14 50 14 Q 68 14 68 32 L 68 44", fill: "blue", width: 9 },
      { d: rr(20, 42, 60, 46, 8), fill: "blue" },
      { d: circle(42, 64, 4.5), fill: "yellow", width: 3 },
      { d: "M 62 56 Q 54 64 62 72 Q 70 64 62 56 Z", fill: "pink", width: 3 },
    ],
    ["secure", "security", "private", "protected", "safety", "password", "encryption"],
  ),

  key: def(
    [
      { d: "M 10.78 72.56 A 8.33 8.33 0 0 0 8.33 78.45 V 87.5 a 4.17 4.17 0 0 0 4.17 4.17 h 12.5 a 4.17 4.17 0 0 0 4.17 -4.17 v -4.17 a 4.17 4.17 0 0 1 4.17 -4.17 h 4.17 a 4.17 4.17 0 0 0 4.17 -4.17 v -4.17 a 4.17 4.17 0 0 1 4.17 -4.17 h 0.72 a 8.33 8.33 0 0 0 5.89 -2.44 l 3.39 -3.39 a 27.08 27.08 0 1 0 -16.67 -16.67 z", stroke: true, width: 8 },
      { d: "M 66.67 31.25 A 2.08 2.08 0 1 0 70.83 31.25 A 2.08 2.08 0 1 0 66.67 31.25 Z", stroke: true, width: 8 },
    ],
    ["access", "unlock", "solution", "answer", "secret", "permission"],
  ),

  sync: def(
    [
      { d: "M 12.5 50 a 37.5 37.5 0 0 1 37.5 -37.5 40.63 40.63 0 0 1 28.08 11.42 L 87.5 33.33", stroke: true, width: 8 },
      { d: "M 87.5 12.5 v 20.83 h -20.83", stroke: true, width: 8 },
      { d: "M 87.5 50 a 37.5 37.5 0 0 1 -37.5 37.5 40.63 40.63 0 0 1 -28.08 -11.42 L 12.5 66.67", stroke: true, width: 8 },
      { d: "M 33.33 66.67 H 12.5 v 20.83", stroke: true, width: 8 },
    ],
    ["loop", "reload", "update", "refresh", "iteration", "pipeline", "cycle", "continuous"],
  ),

  clock: def(
    [
      { d: circle(50, 52, 34), fill: "teal" },
      { d: line(50, 52, 50, 30), width: 7 },
      { d: line(50, 52, 66, 60), width: 7 },
      { d: circle(50, 52, 4), fill: "ink", width: 3 },
    ],
    ["time", "hours", "speed", "wait", "duration", "deadline", "years", "pacing"],
  ),

  calendar: def(
    [
      { d: rr(16, 22, 68, 62, 8), fill: "blue" },
      { d: line(16, 42, 84, 42), width: 6 },
      { d: line(32, 12, 32, 30), width: 7 },
      { d: line(68, 12, 68, 30), width: 7 },
      { d: circle(38, 58, 4), fill: "yellow", width: 3 },
      { d: circle(58, 58, 4), fill: "red", width: 3 },
      { d: circle(48, 72, 4), fill: "white", width: 3 },
    ],
    ["date", "schedule", "year", "planning", "month", "timeline"],
  ),

  sun: def(
    [
      { d: circle(50, 50, 24), fill: "yellow" },
      { d: line(50, 8, 50, 20), width: 7 },
      { d: line(50, 80, 50, 92), width: 7 },
      { d: line(8, 50, 20, 50), width: 7 },
      { d: line(80, 50, 92, 50), width: 7 },
      { d: line(20, 20, 29, 29), width: 7 },
      { d: line(71, 71, 80, 80), width: 7 },
      { d: line(80, 20, 71, 29), width: 7 },
      { d: line(29, 71, 20, 80), width: 7 },
      { d: circle(41, 43, 3.6), fill: "white", width: 3 },
    ],
    ["light", "energy", "sunlight", "day", "warm", "heat", "solar"],
  ),

  plant: def(
    [
      { d: poly([[32, 60], [68, 60], [62, 88], [38, 88]]), fill: "orange" },
      { d: rr(29, 52, 42, 10, 3), fill: "orange" },
      { d: line(50, 52, 50, 30), width: 7 },
      { d: "M 50 40 Q 30 40 26 24 Q 46 20 50 40 Z", fill: "green" },
      { d: "M 50 34 Q 70 32 74 16 Q 54 14 50 34 Z", fill: "green" },
    ],
    ["nature", "grow", "leaf", "tree", "seed", "photosynthesis", "green", "agriculture", "sustainable"],
  ),

  globe: def(
    [
      { d: circle(50, 50, 34), fill: "blue" },
      { d: "M 26 34 Q 36 24 40 34 Q 34 46 28 44 Z", fill: "green", width: 4 },
      { d: "M 44 56 Q 54 50 58 62 Q 52 76 44 70 Z", fill: "green", width: 4 },
      { d: "M 62 30 Q 76 32 74 46 Q 64 48 60 40 Z", fill: "green", width: 4 },
    ],
    ["world", "earth", "planet", "global", "geography", "country", "international"],
  ),

  fire: def(
    [
      { d: "M 50 8 Q 74 32 74 56 Q 74 84 50 84 Q 26 84 26 56 Q 26 36 42 40 Q 36 22 50 8 Z", fill: "orange" },
      { d: "M 50 46 Q 62 58 62 66 Q 62 80 50 80 Q 38 80 38 66 Q 38 56 50 46 Z", fill: "yellow" },
    ],
    ["hot", "burn", "energy", "urgent", "passion", "power"],
  ),

  scale: def(
    [
      { d: "M 50 12.5 v 75", stroke: true, width: 8 },
      { d: "m 79.17 33.33 12.5 33.33 a 20.83 20.83 0 0 1 -25 0 z V 29.17", stroke: true, width: 8 },
      { d: "M 12.5 29.17 h 4.17 a 70.83 70.83 0 0 0 33.33 -8.33 70.83 70.83 0 0 0 33.33 8.33 h 4.17", stroke: true, width: 8 },
      { d: "m 20.83 33.33 12.5 33.33 a 20.83 20.83 0 0 1 -25 0 z V 29.17", stroke: true, width: 8 },
      { d: "M 29.17 87.5 h 41.67", stroke: true, width: 8 },
    ],
    ["balance", "compare", "tradeoff", "fair", "weigh", "justice", "law", "ethics"],
  ),

  search: def(
    [
      { d: circle(42, 42, 26), fill: "white" },
      { d: line(61, 61, 84, 84), width: 10 },
      { d: curve(30, 36, 40, 26, 5), stroke: true, width: 5 },
    ],
    ["find", "research", "look", "explore", "investigate", "discover", "query"],
  ),

  mail: def(
    [
      { d: rr(12, 26, 76, 50, 6), fill: "pink" },
      { d: poly([[12, 30], [50, 56], [88, 30]], false), stroke: true, width: 6 },
    ],
    ["email", "message", "letter", "contact", "communication", "inbox"],
  ),

  star: def(
    [
      {
        d: poly([
          [50, 8],
          [62, 38],
          [92, 40],
          [68, 58],
          [77, 88],
          [50, 70],
          [23, 88],
          [32, 58],
          [8, 40],
          [38, 38],
        ]),
        fill: "yellow",
      },
    ],
    ["favourite", "quality", "best", "rating", "excellent", "reward", "highlight"],
  ),

  checklist: def(
    [
      { d: rr(18, 12, 64, 78, 6), fill: "white" },
      { d: rr(30, 26, 12, 12, 2), fill: "green", width: 4 },
      { d: line(48, 32, 72, 32), width: 5 },
      { d: rr(30, 46, 12, 12, 2), fill: "green", width: 4 },
      { d: line(48, 52, 72, 52), width: 5 },
      { d: rr(30, 66, 12, 12, 2), fill: "white", width: 4 },
      { d: line(48, 72, 72, 72), width: 5 },
    ],
    ["steps", "tasks", "plan", "todo", "process", "checklist", "requirements"],
  ),

  gear: def(
    [
      { d: circle(50, 50, 30), fill: "violet" },
      { d: circle(50, 50, 12), fill: "white" },
      { d: rr(44, 6, 12, 16, 3), fill: "violet" },
      { d: rr(44, 78, 12, 16, 3), fill: "violet" },
      { d: rr(6, 44, 16, 12, 3), fill: "violet" },
      { d: rr(78, 44, 16, 12, 3), fill: "violet" },
    ],
    ["settings", "process", "engine", "system", "mechanics", "how", "configure", "operations"],
  ),
};

/** Dynamic on-the-fly generated icons cache */
export const DYNAMIC_ICONS: Record<string, IconDef> = {};

export function registerDynamicIcon(name: string, iconDef: IconDef): void {
  const normalized = name.trim().toLowerCase().replace(/[\s_-]+/g, "");
  DYNAMIC_ICONS[normalized] = iconDef;
  ALIAS_INDEX[normalized] = normalized;
  for (const alias of iconDef.aliases ?? []) {
    const cleanAlias = alias.trim().toLowerCase().replace(/[\s_-]+/g, "");
    ALIAS_INDEX[cleanAlias] = normalized;
  }
}

/** Names the model can choose from initially */
export const ICON_NAMES = Object.keys(ICONS);

export function getAllIconNames(): string[] {
  return [...Object.keys(ICONS), ...Object.keys(DYNAMIC_ICONS)];
}

const ALIAS_INDEX: Record<string, string> = (() => {
  const index: Record<string, string> = {};
  for (const [name, icon] of Object.entries(ICONS)) {
    index[name] = name;
    for (const alias of icon.aliases ?? []) {
      const cleanAlias = alias.trim().toLowerCase().replace(/[\s_-]+/g, "");
      index[cleanAlias] = name;
    }
  }
  return index;
})();

/**
 * Finds a hand-drawn icon for a name, or admits it has none.
 *
 * The strict half of resolution. `resolveIcon` needs a fallback so the board
 * always draws something, but the server needs to know when this library has
 * genuinely missed -- that is the signal to reach for the wider catalogue
 * instead of quietly drawing a lightbulb.
 */
export function findIcon(
  name: string | undefined,
  /** Names already on this board, so one scene never draws the same icon twice. */
  taken?: ReadonlySet<string>,
): { name: string; icon: IconDef } | null {
  const key = (name ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!key) return null;

  const free = (candidate: string) => !taken?.has(candidate);

  const direct = ICONS[key] ?? DYNAMIC_ICONS[key];
  if (direct && free(key)) return { name: key, icon: direct };

  const aliased = ALIAS_INDEX[key];
  if (aliased && free(aliased)) {
    const found = ICONS[aliased] ?? DYNAMIC_ICONS[aliased];
    if (found) return { name: aliased, icon: found };
  }

  // Word-level match, so "customer feedback" can still find "feedback".
  const words = (name ?? "").trim().toLowerCase().split(/[\s_-]+/).filter(Boolean);
  for (const word of words) {
    const target = ALIAS_INDEX[word];
    if (!target || !free(target)) continue;
    const found = ICONS[target] ?? DYNAMIC_ICONS[target];
    if (found) return { name: target, icon: found };
  }

  // A containment match, but only for aliases long enough to mean something.
  // The old rule matched any alias that shared any substring, which is how
  // "rail" ended up drawing a bee.
  for (const [alias, target] of Object.entries(ALIAS_INDEX)) {
    if (alias.length < 5 || !free(target)) continue;
    if (!key.includes(alias) && !alias.includes(key)) continue;
    if (Math.abs(alias.length - key.length) > 4) continue;
    const found = ICONS[target] ?? DYNAMIC_ICONS[target];
    if (found) return { name: target, icon: found };
  }

  return null;
}

/**
 * Resolves whatever the model wrote to a real icon, always returning one.
 *
 * Used on the board itself, where drawing nothing is not an option.
 */
export function resolveIcon(name: string | undefined): { name: string; icon: IconDef } {
  return findIcon(name) ?? { name: "lightbulb", icon: ICONS.lightbulb };
}

/* --------------------------------- badges --------------------------------- */

export type BadgeKind = "check" | "cross" | "alert";

export const BADGES: Record<BadgeKind, IconShape[]> = {
  check: [
    { d: circle(50, 50, 42), fill: "green" },
    { d: "M 30 52 L 44 66 L 72 36", stroke: true, width: 12 },
  ],
  cross: [
    { d: circle(50, 50, 42), fill: "red" },
    { d: line(34, 34, 66, 66), width: 12 },
    { d: line(66, 34, 34, 66), width: 12 },
  ],
  alert: [
    { d: circle(50, 50, 42), fill: "yellow" },
    { d: line(50, 26, 50, 56), width: 12 },
    { d: circle(50, 70, 6), fill: "ink", width: 4 },
  ],
};

export const DEFAULT_ICON_WIDTH = W;
