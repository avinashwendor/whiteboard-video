import { LUCIDE_NAMES, LUCIDE_PATHS } from "./icon-paths.generated";

/**
 * Concept -> icon.
 *
 * The model names what it wants ("memory", "revenue", "risk") and this finds
 * the drawing. It never asks the model for geometry, because a model cannot
 * draw: that route produced a brain that looked like a spill, and the fault
 * was the method, not the prompt.
 *
 * Server-side only. The catalogue is a third of a megabyte and has no business
 * in a browser bundle -- resolved geometry travels with the scene instead.
 */

export interface PickedIcon {
  /** The Lucide name that won, for logging and cache keys. */
  name: string;
  /** Path data in Lucide's 24x24 space. */
  paths: string[];
}

/**
 * Explainer vocabulary that no name match would ever find.
 *
 * Lucide is named after objects; scripts are written about ideas. "Demand"
 * is not an icon, "trending-up" is. Every entry here is a word an explainer
 * actually uses, pointed at the drawing that carries it.
 */
const SYNONYMS: Record<string, string> = {
  // thinking, learning, memory
  mind: "brain", think: "brain", thought: "brain", cognition: "brain",
  memory: "brain-cog", learning: "graduation-cap", knowledge: "book-open",
  idea: "lightbulb", insight: "lightbulb", innovation: "lightbulb",
  creativity: "sparkles", intelligence: "brain-circuit", ai: "brain-circuit",
  recall: "rotate-ccw", forget: "eraser", attention: "eye", focus: "crosshair",
  understanding: "lightbulb", curiosity: "search", question: "circle-question-mark",
  answer: "circle-check", knowhow: "wrench", skill: "wrench",

  // money
  money: "banknote", cash: "banknote", revenue: "trending-up", profit: "trending-up",
  loss: "trending-down", cost: "receipt", price: "tag", pricing: "tag",
  budget: "wallet", funding: "piggy-bank", investment: "chart-candlestick",
  investor: "handshake", capital: "landmark", bank: "landmark",
  payment: "credit-card", billing: "credit-card", salary: "banknote",
  rupee: "indian-rupee", dollar: "circle-dollar-sign", euro: "euro",
  savings: "piggy-bank", debt: "file-minus", tax: "receipt-indian-rupee",
  economy: "chart-line", market: "store", sales: "shopping-cart",

  // growth and measurement
  growth: "trending-up", scale: "chart-no-axes-column-increasing",
  decline: "trending-down", metric: "gauge", measure: "ruler",
  data: "database", analytics: "chart-column", statistics: "chart-column",
  result: "chart-line", performance: "gauge", benchmark: "target",
  progress: "trending-up", improvement: "arrow-up-right", efficiency: "zap",
  percentage: "percent", ratio: "divide", average: "equal",

  // people and business
  customer: "user-round", user: "user-round", audience: "users-round",
  team: "users-round", founder: "user-round", employee: "id-card",
  competitor: "swords", partner: "handshake", community: "users-round",
  meeting: "presentation", interview: "mic", feedback: "message-square-quote",
  support: "life-buoy", leader: "crown", hiring: "user-plus",
  company: "building-2", startup: "rocket", office: "building",
  factory: "factory", supply: "truck", delivery: "package",
  inventory: "boxes", product: "package", service: "concierge-bell",
  brand: "badge", contract: "file-pen-line", deal: "handshake",

  // product and process
  build: "hammer", building: "hammer", create: "plus", make: "hammer",
  design: "pen-tool", prototype: "drafting-compass", test: "flask-conical",
  testing: "flask-conical", experiment: "flask-conical", launch: "rocket",
  ship: "send", release: "package-check", iterate: "refresh-cw",
  plan: "clipboard-list", planning: "clipboard-list", strategy: "target",
  process: "workflow", workflow: "workflow", pipeline: "git-branch",
  step: "footprints", method: "list-checks", framework: "layout-grid",
  system: "settings", automation: "bot", tool: "wrench",

  // validation
  validate: "circle-check", validation: "circle-check", proof: "badge-check",
  evidence: "file-search", verify: "shield-check", confirm: "check",
  survey: "clipboard-list", research: "microscope", discovery: "compass",
  demand: "trending-up", interest: "heart", signup: "user-plus",
  waitlist: "list-ordered", landing: "layout-template", page: "file-text",
  conversion: "funnel", funnel: "funnel", traffic: "activity",

  // risk and failure
  risk: "triangle-alert", danger: "triangle-alert", warning: "triangle-alert",
  fail: "circle-x", failure: "circle-x", mistake: "circle-x",
  problem: "circle-alert", issue: "bug", bug: "bug",
  obstacle: "construction", blocker: "octagon-x", trap: "shield-alert",
  waste: "trash-2", loss2: "trending-down", debt2: "file-x",
  uncertainty: "circle-question-mark", assumption: "circle-question-mark", guess: "dices",
  bias: "scale", myth: "ghost", fear: "ghost",

  // time
  time: "clock", speed: "gauge", fast: "zap", slow: "hourglass",
  deadline: "alarm-clock", schedule: "calendar", timeline: "calendar-range",
  delay: "hourglass", duration: "timer", year: "calendar", month: "calendar-days",
  history: "rotate-ccw", future: "telescope", now: "clock",

  // communication
  message: "message-square", talk: "message-circle", conversation: "messages-square",
  email: "mail", call: "phone", notification: "bell", announcement: "megaphone",
  marketing: "megaphone", advertising: "megaphone", story: "book-open",
  content: "file-text", video: "video", podcast: "mic", social: "share-2",

  // technology
  code: "code", software: "code-xml", app: "smartphone", website: "globe",
  server: "server", cloud: "cloud", network: "network", api: "plug",
  security: "shield", privacy: "lock", encryption: "key", password: "key",
  algorithm: "binary", model: "box", training: "dumbbell", chip: "cpu",
  hardware: "hard-drive", device: "monitor", robot: "bot", energy: "zap",
  battery: "battery-charging", power: "plug-zap",

  // outcomes
  success: "trophy", win: "trophy", achievement: "award", goal: "target",
  objective: "target", milestone: "flag", reward: "gift", value: "gem",
  benefit: "thumbs-up", advantage: "arrow-up-right", opportunity: "door-open",
  choice: "git-fork", decision: "git-fork", tradeoff: "scale", balance: "scale",
  comparison: "columns-2", difference: "git-compare", change: "refresh-cw",
  transformation: "sparkles", impact: "waves-horizontal",

  // physical world
  world: "globe", earth: "globe", city: "building-2", home: "house",
  school: "school", hospital: "hospital", health: "heart-pulse", medicine: "pill",
  food: "utensils", water: "droplet", plant: "sprout", tree: "trees",
  climate: "thermometer", weather: "cloud-sun", sun: "sun", light: "sun",
  transport: "car", travel: "plane", map: "map", location: "map-pin",
  road: "route", journey: "route", bridge: "cable", door: "door-open",

  // abstract
  simple: "minus", complex: "network", small: "minimize-2", big: "maximize-2",
  more: "plus", less: "minus", all: "layout-grid", none: "ban",
  start: "play", stop: "square", pause: "pause", repeat: "repeat",
  cycle: "refresh-cw", loop: "rotate-cw", flow: "waves-horizontal", direction: "compass",
  scratchpad: "notebook-pen", note: "sticky-note", list: "list",
  replay: "rotate-ccw", rehearsal: "rotate-ccw", practice: "dumbbell",
  sleep: "moon", night: "moon", dream: "cloud-moon", wake: "sunrise",
  magnifier: "search", magnify: "search", zoom: "zoom-in", inspect: "search",
  sunlight: "sun", daylight: "sun", shade: "cloud", leaf: "leaf",
  photosynthesis: "leaf", chlorophyll: "leaf", growthstage: "sprout",
  graveyard: "skull", dead: "skull", death: "skull", cemetery: "skull",
  neuroscience: "brain", neuron: "brain-circuit", cortex: "brain",
  hippocampus: "brain", synapse: "brain-circuit", nerve: "activity",
  oxygen: "wind", air: "wind", carbon: "cloud", gas: "cloud",
  soil: "layers", root: "sprout", seed: "sprout", harvest: "wheat",

  // medicine and health
  doctor: "stethoscope", nurse: "stethoscope", patient: "bed",
  clinic: "cross", surgery: "scissors", diagnosis: "clipboard-plus",
  symptom: "thermometer", disease: "biohazard", virus: "biohazard", bacteria: "bug",
  infection: "biohazard", vaccine: "syringe", injection: "syringe",
  drug: "pill", prescription: "clipboard-list", pharmacy: "pill-bottle", dose: "pill",
  therapy: "heart-handshake", recovery: "heart-pulse", fitness: "dumbbell",
  exercise: "dumbbell", nutrition: "apple", diet: "salad", calorie: "flame",
  stress: "brain", mental: "brain", wellbeing: "heart", pulse: "heart-pulse",
  bloodpressure: "activity", blood: "droplet", dna: "dna", gene: "dna", cell: "circle-dot",
  scan: "scan", xray: "scan-line", ambulance: "ambulance", emergency: "siren",
  firstaid: "briefcase-medical", dentist: "face-slightly-smiling", eye: "eye",
  bone: "bone", pregnancy: "baby", child: "baby", elderly: "accessibility",
  disability: "accessibility",

  // education
  university: "graduation-cap", college: "graduation-cap",
  student: "backpack", teacher: "presentation", lecture: "presentation",
  classroom: "school", lesson: "book-open", course: "book-marked",
  curriculum: "list-checks", homework: "pencil", exam: "file-check",
  grade: "badge-check", degree: "graduation-cap", certificate: "award", library: "library",
  textbook: "book", study: "book-open", reading: "book-open", writing: "pen-line",
  math: "calculator", science: "flask-conical", geography: "globe",
  language: "languages", translation: "languages", alphabet: "a-large-small",
  tutor: "user-round", scholarship: "award", enrollment: "user-plus",
  graduation: "graduation-cap",

  // law and government
  law: "scale", legal: "gavel", court: "gavel", judge: "gavel", lawyer: "briefcase",
  trial: "scale", verdict: "gavel", witness: "eye",
  jury: "users-round", policy: "file-text", regulation: "book-lock",
  compliance: "shield-check", audit: "file-search", licence: "id-card", license: "id-card",
  permit: "file-check", patent: "stamp", copyright: "copyright", government: "landmark",
  parliament: "landmark", election: "vote", vote: "vote", democracy: "vote",
  citizen: "user-round", passport: "book-user", visa: "stamp", border: "fence",
  police: "shield", crime: "siren", prison: "lock",
  justice: "scale", rights: "hand-heart", treaty: "file-pen-line", sanction: "ban",
  corruption: "triangle-alert",

  // agriculture and food
  farm: "tractor", farmer: "tractor", crop: "wheat",
  irrigation: "droplets", fertiliser: "sprout", fertilizer: "sprout",
  pesticide: "spray-can", livestock: "beef", cattle: "beef", dairy: "milk", poultry: "egg",
  fishing: "fish", fish: "fish", greenhouse: "warehouse", orchard: "trees",
  vineyard: "grape", grain: "wheat", rice: "wheat", vegetable: "carrot", fruit: "apple",
  cooking: "cooking-pot", kitchen: "cooking-pot", chef: "chef-hat", restaurant: "utensils",
  menu: "scroll-text", recipe: "scroll-text", coffee: "coffee", tea: "cup-soda",
  bread: "croissant", meat: "ham", spice: "soup", organic: "leaf",
  hunger: "utensils-crossed",

  // construction and industry
  construction: "hard-hat", builder: "hard-hat", architect: "drafting-compass",
  blueprint: "scroll", site: "construction", crane: "construction",
  scaffold: "construction", cement: "brick-wall", brick: "brick-wall", steel: "factory",
  timber: "trees", welding: "flame", drill: "drill", saw: "axe", nail: "hammer",
  machine: "cog", machinery: "cog", equipment: "wrench", maintenance: "wrench",
  repair: "wrench", assembly: "boxes", production: "factory", manufacturing: "factory",
  warehouse: "warehouse", quality: "badge-check", defect: "circle-x",
  inspection: "search-check", safety: "hard-hat", shift: "clock", worker: "user-round",
  labour: "users-round", labor: "users-round", union: "users-round",

  // logistics and transport
  logistics: "truck", shipping: "ship", freight: "container", cargo: "container",
  port: "anchor", warehouseops: "warehouse", fleet: "truck", route: "route",
  dispatch: "send", courier: "package", parcel: "package", tracking: "map-pin",
  lastmile: "bike", railway: "train-track", train: "train-front", bus: "bus",
  taxi: "car-taxi-front", flight: "plane", airport: "plane-takeoff", airline: "plane",
  fuel: "fuel", mileage: "gauge", congestion: "traffic-cone",
  customs: "stamp", export: "ship", import: "ship",
  supplychain: "link", bicycle: "bike", scooter: "bike", walking: "footprints",
  commute: "route",

  // energy and environment
  electricity: "plug-zap", grid: "grid-3x3",
  solar: "sun-medium", wind: "wind", turbine: "fan", hydro: "waves-horizontal",
  nuclear: "atom", coal: "mountain", oil: "fuel",
  charging: "battery-charging", renewable: "recycle",
  emission: "factory", pollution: "factory",
  recycling: "recycle", sustainability: "leaf",
  warming: "thermometer-sun", forest: "trees", deforestation: "axe", biodiversity: "bird",
  wildlife: "squirrel", ocean: "waves-horizontal", river: "waves-horizontal",
  drought: "sun", flood: "waves-horizontal", earthquake: "activity",
  disaster: "triangle-alert", conservation: "leaf",

  // technology and data
  database: "database", backend: "server", frontend: "monitor",
  sdk: "package", repository: "git-branch",
  commit: "git-commit-vertical", merge: "git-merge", branch: "git-branch",
  deployment: "rocket", devops: "infinity", container: "container",
  kubernetes: "container", microservice: "boxes", monolith: "box", cache: "zap",
  queue: "list-ordered", latency: "timer", bandwidth: "gauge", uptime: "activity",
  outage: "power-off", incident: "siren", monitoring: "activity", logging: "scroll-text",
  debugging: "bug", refactor: "recycle", machinelearning: "brain-circuit",
  neuralnetwork: "brain-circuit", dataset: "database", label: "tag", inference: "cpu",
  gpu: "cpu", cloudcomputing: "cloud", serverless: "cloud-cog", edge: "router",
  blockchain: "link", crypto: "bitcoin", wallet: "wallet", token: "coins",
  ledger: "book-open", firewall: "shield", malware: "bug", phishing: "fish",
  breach: "shield-x", backup: "hard-drive", storage: "hard-drive",
  wifi: "wifi", bluetooth: "bluetooth", satellite: "satellite", iot: "router",
  sensor: "radio", chatbot: "bot", prompt: "message-square",

  // business and work
  agenda: "list", minutes: "file-text",
  project: "folder-kanban", task: "square-check", backlog: "list-todo", sprint: "timer",
  roadmap: "map", priority: "arrow-up",
  stakeholder: "users-round", client: "handshake", vendor: "store", supplier: "truck",
  invoice: "receipt", quote: "file-text", proposal: "file-text",
  negotiation: "handshake", onboarding: "user-plus", offboarding: "user-minus",
  recruitment: "user-search", resume: "file-user",
  promotion: "trending-up", appraisal: "star", payroll: "banknote",
  leave: "tree-palm", holiday: "tree-palm", remote: "house",
  desk: "lamp-desk", workspace: "monitor", productivity: "gauge", burnout: "battery-low",
  morale: "face-slightly-smiling", culture: "users-round", mentor: "user-check",
  scaleup: "trending-up", merger: "git-merge", acquisition: "handshake",
  ipo: "chart-candlestick", valuation: "gem", equity: "chart-pie", dividend: "coins",

  // marketing and media
  campaign: "megaphone", advert: "megaphone", branding: "palette", logo: "badge",
  slogan: "quote", reach: "radio-tower", impression: "eye",
  engagement: "heart", click: "mouse-pointer-click",
  retention: "repeat", churn: "user-minus", newsletter: "mail", subscriber: "user-plus",
  influencer: "star", testimonial: "quote", review: "star", rating: "star",
  poll: "chart-bar",
  broadcast: "radio-tower", stream: "video", episode: "clapperboard", film: "clapperboard",
  camera: "camera", photography: "camera", editing: "scissors",
  typography: "type", illustration: "brush", animation: "film", publishing: "newspaper",
  news: "newspaper", journalism: "newspaper", article: "file-text", blog: "pen-line",
  seo: "search",

  // finance detail
  loan: "landmark", mortgage: "house", insurance: "shield",
  premium: "shield-check", claim: "file-text", pension: "piggy-bank",
  retirement: "tree-palm", portfolio: "briefcase", stock: "chart-candlestick",
  share: "chart-pie", bond: "file-text", fund: "landmark", inflation: "trending-up",
  recession: "trending-down", gdp: "chart-line", trade: "arrow-left-right",
  currency: "coins", exchange: "arrow-left-right", remittance: "send",
  subsidy: "hand-coins", grant: "hand-coins", donation: "hand-heart",
  charity: "heart-handshake", fundraising: "piggy-bank", accounting: "calculator",
  bookkeeping: "book", cashflow: "waves-horizontal",
  creditscore: "gauge", fraud: "shield-alert", refund: "undo-2", discount: "percent",
  subscription: "repeat", transaction: "arrow-left-right", atm: "landmark",
  upi: "smartphone",

  // society and culture
  family: "users-round", marriage: "heart-handshake", friendship: "handshake",
  volunteer: "hand-heart", religion: "church",
  temple: "landmark", festival: "party-popper", celebration: "party-popper",
  tradition: "scroll", art: "palette", museum: "landmark", music: "music", dance: "music",
  theatre: "drama", sport: "trophy", game: "gamepad-2", cricket: "trophy",
  football: "trophy", olympics: "medal", coach: "megaphone",
  tourism: "tree-palm", hotel: "bed-double", booking: "calendar-check",
  migration: "route", refugee: "tent", poverty: "hand-coins", inequality: "scale",
  population: "users-round", census: "clipboard-list", urban: "building-2", rural: "trees",
  housing: "house", slum: "house", sanitation: "droplets", waterSupply: "droplet",

  // space and science
  space: "rocket", planet: "globe", star: "star", galaxy: "sparkles", orbit: "orbit",
  astronaut: "rocket", telescope: "telescope",
  gravity: "arrow-down", physics: "atom", chemistry: "flask-round", biology: "microscope",
  hypothesis: "circle-question-mark", theory: "book-open",
  formula: "sigma", measurement: "ruler", microscope: "microscope",
  laboratory: "flask-conical", researcher: "microscope",
  invention: "lightbulb", magnet: "magnet",
  radiation: "radiation", laser: "zap", quantum: "atom", robotics: "bot",

  // abstractions an explainer leans on, and the long tail of domain nouns
  surgeon: "scissors", insulin: "syringe", pandemic: "biohazard",
  quarantine: "shield-alert", eyesight: "eye", blindness: "eye-off", hearing: "ear",
  allergy: "triangle-alert", obesity: "scale", syllabus: "list-checks",
  dropout: "user-minus", literacy: "book-open", tuition: "banknote", alumni: "users-round",
  internship: "briefcase", apprentice: "hammer", bankruptcy: "trending-down",
  collateral: "landmark", liability: "scale", asset: "gem", overhead: "receipt",
  margin: "percent", turnover: "repeat", monsoon: "cloud-rain", rain: "cloud-rain",
  snow: "snowflake", storm: "cloud-lightning", season: "calendar", humidity: "droplets",
  temperature: "thermometer", fisheries: "fish", granary: "warehouse", silo: "warehouse",
  foreman: "hard-hat", refinery: "factory", windmill: "fan", groundwater: "droplet",
  landfill: "trash-2", sewage: "droplets", reservoir: "droplets",
  attrition: "trending-down", mentorship: "user-check", teamwork: "users-round",
  handover: "arrow-left-right", bottleneck: "funnel", constraint: "funnel",
  scalability: "trending-up", throughput: "gauge", capacity: "gauge", utilisation: "gauge",
  utilization: "gauge", downtime: "power-off", constitution: "scroll",
  municipality: "building-2", ministry: "landmark", bureaucracy: "file-stack",
  pilgrimage: "route", marathon: "footprints", orchestra: "music", catalyst: "zap",
  cause: "arrow-right", effect: "arrow-right", reason: "circle-question-mark",
  example: "quote", exception: "triangle-alert", pattern: "grid-3x3", trend: "trending-up",
  signal: "radio", noise: "audio-waveform", threshold: "minus", limit: "ban",
  boundary: "fence", gap: "move-horizontal", overlap: "copy", sequence: "list-ordered",
  hierarchy: "list-tree", dependency: "link", iteration: "rotate-cw",
  version: "git-commit-vertical", baseline: "minus", forecast: "chart-line",
  estimate: "calculator", scope: "crosshair", resource: "boxes", allocation: "chart-pie",
  surplus: "plus", shortage: "minus", demandcurve: "chart-line", equilibrium: "scale",
  incentive: "gift", penalty: "ban", habit: "repeat", behaviour: "user-round",
  behavior: "user-round", motivation: "flame", perception: "eye", emotion: "heart",
  empathy: "heart-handshake", trust: "handshake", reputation: "star",
  influence: "radio-tower", persuasion: "megaphone", conflict: "swords",
  agreement: "handshake", compromise: "scale", consensus: "users-round",
  leadership: "crown", delegation: "share-2", ownership: "key-round",
  accountability: "clipboard-check", transparency: "eye", secrecy: "eye-off",
  consent: "check", identity: "id-card", authentication: "fingerprint-pattern",
  authorisation: "key", authorization: "key", accuracy: "target", precision: "crosshair",
  reliability: "shield-check", resilience: "shield", redundancy: "copy",
  failover: "refresh-cw", integration: "puzzle", interface: "plug", protocol: "file-text",
  standard: "badge-check", specification: "file-text", documentation: "book-open",
  adoption: "trending-up", satisfaction: "face-slightly-smiling",
  complaint: "message-square-warning", escalation: "arrow-up", resolution: "circle-check",
  triage: "list-filter", severity: "triangle-alert", rootcause: "search",
  postmortem: "file-search",
};

/**
 * A general visual vocabulary, offered to the model when nothing matched.
 *
 * The catalogue is far too large to put in a prompt, and a shortlist built by
 * word overlap is empty for exactly the words that need help -- "hippocampus"
 * shares no token with any icon. So the model is asked to translate the idea
 * into the nearest of these instead.
 */
export const GENERAL_ICONS = [
  "brain", "brain-circuit", "lightbulb", "sparkles", "eye", "search", "target",
  "book-open", "graduation-cap", "microscope", "flask-conical", "telescope",
  "users-round", "user-round", "handshake", "heart", "hand-heart", "baby",
  "building-2", "factory", "house", "school", "store", "landmark",
  "banknote", "coins", "credit-card", "piggy-bank", "wallet", "indian-rupee",
  "trending-up", "trending-down", "chart-column", "chart-line", "chart-pie",
  "gauge", "percent", "scale", "ruler", "timer", "clock", "calendar",
  "rocket", "plane", "car", "truck", "ship", "route", "map-pin", "globe",
  "package", "boxes", "gift", "shopping-cart", "tag", "receipt",
  "hammer", "wrench", "settings", "cog", "workflow", "git-branch", "network",
  "cpu", "server", "database", "cloud", "code", "smartphone", "monitor", "bot",
  "shield", "lock", "key", "triangle-alert", "circle-alert", "octagon-x", "bug",
  "circle-check", "badge-check", "thumbs-up", "thumbs-down", "trophy", "award",
  "flag", "crown", "gem", "star", "zap", "flame", "droplet", "wind", "waves",
  "sun", "moon", "cloud-sun", "thermometer", "leaf", "sprout", "trees", "wheat",
  "utensils", "pill", "heart-pulse", "cross", "activity", "dumbbell",
  "megaphone", "mail", "message-square", "phone", "mic", "video", "bell",
  "file-text", "clipboard-list", "list-checks", "list-ordered", "notebook-pen",
  "folder", "layers", "layout-grid", "layout-template", "columns-2", "funnel",
  "scissors", "trash-2", "recycle", "refresh-cw", "rotate-ccw", "repeat",
  "play", "pause", "square", "arrow-up-right", "arrow-right", "git-fork",
  "door-open", "compass", "anchor", "puzzle", "skull", "ghost", "swords",
  "eraser", "pen-tool", "palette", "camera", "music", "battery-charging",
] as const;

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Lucide names, indexed by their own hyphen-separated words. */
const TOKEN_INDEX = (() => {
  const index = new Map<string, string[]>();
  for (const name of LUCIDE_NAMES) {
    for (const token of name.split("-")) {
      if (token.length < 3) continue;
      const list = index.get(token);
      if (list) list.push(name);
      else index.set(token, [name]);
    }
  }
  return index;
})();

const FLAT_NAMES = new Map(LUCIDE_NAMES.map((name) => [normalise(name), name]));

/** Singular/plural and -ing/-ed forms, without dragging in a stemmer. */
function variants(word: string): string[] {
  const out = new Set([word]);
  if (word.endsWith("ies")) out.add(`${word.slice(0, -3)}y`);
  if (word.endsWith("es")) out.add(word.slice(0, -2));
  if (word.endsWith("s")) out.add(word.slice(0, -1));
  if (word.endsWith("ing")) {
    out.add(word.slice(0, -3));
    out.add(`${word.slice(0, -3)}e`);
  }
  if (word.endsWith("ed")) {
    out.add(word.slice(0, -2));
    out.add(word.slice(0, -1));
  }
  out.add(`${word}s`);
  return [...out].filter((entry) => entry.length >= 3);
}

/**
 * Finds the drawing for a concept.
 *
 * Ordered by how much the match can be trusted: a curated synonym beats a
 * coincidental substring, and an exact name beats everything.
 */
export function pickIcon(
  concept: string | undefined,
  /** Names already used on this board, so a scene does not repeat itself. */
  taken?: ReadonlySet<string>,
): PickedIcon | null {
  const raw = (concept ?? "").trim().toLowerCase();
  if (!raw) return null;

  const words = raw.split(/[\s_-]+/).filter(Boolean);
  const flat = normalise(raw);

  const build = (name: string): PickedIcon | null => {
    if (taken?.has(name)) return null;
    const paths = LUCIDE_PATHS[name];
    return paths?.length ? { name, paths } : null;
  };

  // 1. The exact icon name, however it was spelled.
  const exact = FLAT_NAMES.get(flat);
  if (exact) return build(exact);

  // 2. Curated vocabulary, on the whole phrase then on each word.
  const synonym = SYNONYMS[flat] ?? words.map((word) => SYNONYMS[word]).find(Boolean);
  if (synonym) {
    const found = build(synonym);
    if (found) return found;
  }

  // 3. Curated vocabulary again, allowing for plurals and verb endings.
  for (const word of words) {
    for (const variant of variants(word)) {
      const mapped = SYNONYMS[variant] ?? FLAT_NAMES.get(variant);
      if (mapped) {
        const found = build(mapped);
        if (found) return found;
      }
    }
  }

  // 4. Score whatever shares a word with the concept. Shorter names win ties:
  //    `heart` is a better answer for "heart" than `heart-handshake`.
  const scores = new Map<string, number>();
  const bump = (name: string, points: number) => {
    scores.set(name, (scores.get(name) ?? 0) + points);
  };

  for (const word of words) {
    for (const variant of variants(word)) {
      for (const name of TOKEN_INDEX.get(variant) ?? []) {
        bump(name, variant === word ? 10 : 6);
      }
      for (const name of LUCIDE_NAMES) {
        if (name.includes(variant) && !TOKEN_INDEX.get(variant)?.includes(name)) bump(name, 3);
      }
    }
  }

  let best: string | null = null;
  let bestScore = 0;
  for (const [name, score] of scores) {
    if (taken?.has(name)) continue;
    const adjusted = score - name.length * 0.06;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      best = name;
    }
  }

  return best ? build(best) : null;
}

/**
 * Names worth showing a model when nothing matched.
 *
 * Capped hard: the point is a shortlist to choose from, not the catalogue.
 */
export function shortlistFor(concept: string, limit = 60): string[] {
  const words = (concept ?? "").toLowerCase().split(/[\s_-]+/).filter(Boolean);
  const found = new Set<string>();

  for (const word of words) {
    for (const variant of variants(word)) {
      for (const name of TOKEN_INDEX.get(variant) ?? []) {
        found.add(name);
        if (found.size >= limit) return [...found];
      }
    }
  }
  return [...found];
}

export function hasIcon(name: string): boolean {
  return Boolean(LUCIDE_PATHS[name]);
}

export { LUCIDE_NAMES };
