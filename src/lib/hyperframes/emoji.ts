/**
 * The accent glyph.
 *
 * A frame of flat colour and type wants one object in it -- something with
 * weight that is not a word. Emoji do that job better than an icon set here:
 * they are full colour, they render at any size without geometry, and every
 * platform already has them, so a frame never falls back to a grey box.
 *
 * Chosen from what the scene is actually about, never at random. One per
 * frame, two at the very most: past that they stop reading as an accent and
 * start reading as clip art.
 */

/**
 * Stem -> glyph.
 *
 * Keyed on stems rather than whole words so "meeting"/"meetings" and
 * "write"/"writing"/"written" all land. Ordered loosely by how specific the
 * stem is, because the lookup takes the first hit.
 */
const LEXICON: Array<[RegExp, string]> = [
  // people and work
  [/\b(meeting|calendar|schedul|agenda)/i, "📅"],
  [/\b(team|colleague|peopl|staff|employee|everyone)/i, "👥"],
  [/\b(remote|distribut|timezone|time zone|async)/i, "🌍"],
  [/\b(writ|memo|document|doc\b|note|essay|draft)/i, "📝"],
  [/\b(read|book|study|learn|course|lesson)/i, "📖"],
  [/\b(talk|conversation|discuss|chat|voice|say)/i, "💬"],
  [/\b(think|idea|insight|realis|realiz|understand)/i, "💡"],
  [/\b(decision|decide|choice|choose|pick)/i, "✅"],
  [/\b(question|ask|wonder|unclear|confus)/i, "❓"],
  [/\b(problem|broken|fail|wrong|issue|bug|error)/i, "⚠️"],

  // money and business
  [/\b(money|cash|payment|pay|price|cost|fee|revenue|profit)/i, "💰"],
  [/\b(bank|account|deposit|transfer)/i, "🏦"],
  [/\b(card|credit|debit)/i, "💳"],
  [/\b(shop|store|merchant|retail|buy|purchas)/i, "🏪"],
  [/\b(growth|grow|increas|scale|rise|up\b)/i, "📈"],
  [/\b(decline|drop|fall|decreas|loss)/i, "📉"],
  [/\b(chart|graph|metric|statistic|data|number|measur)/i, "📊"],
  [/\b(target|goal|aim|objective|focus)/i, "🎯"],

  // technology
  [/\b(server|datacent|data cent|host|backend)/i, "🖥️"],
  [/\b(cloud|cdn|edge)/i, "☁️"],
  [/\b(network|internet|web|cable|connect|link)/i, "🌐"],
  [/\b(phone|mobile|app\b|smartphone)/i, "📱"],
  [/\b(laptop|computer|machine|desktop)/i, "💻"],
  [/\b(code|program|develop|software|script|python|api\b)/i, "⌨️"],
  [/\b(database|storage|store|record|archiv)/i, "🗄️"],
  [/\b(secur|safe|protect|encrypt|privacy|lock)/i, "🔒"],
  [/\b(key|password|credential|token|auth)/i, "🔑"],
  [/\b(search|find|look|discover|explor|inspect)/i, "🔍"],
  [/\b(cache|copy|duplicate|replica)/i, "🗂️"],
  [/\b(ai\b|model|intelligen|neural|machine learn)/i, "🤖"],

  // speed, time, motion
  [/\b(fast|quick|speed|instant|rapid|accelerat)/i, "⚡"],
  [/\b(slow|wait|delay|latency|lag|queue)/i, "🐢"],
  [/\b(time|hour|minute|second|clock|duration)/i, "⏱️"],
  [/\b(launch|ship|release|start|begin|deploy)/i, "🚀"],
  [/\b(journey|travel|route|path|trip|distance)/i, "🧭"],
  [/\b(step|process|flow|sequence|pipeline|stage)/i, "🪜"],

  // qualities
  [/\b(build|make|construct|create|craft)/i, "🔨"],
  [/\b(fix|repair|solve|solution|improv)/i, "🛠️"],
  [/\b(measure|size|scale|dimension|length)/i, "📏"],
  [/\b(balance|compare|versus|tradeoff|trade-off)/i, "⚖️"],
  [/\b(win|success|achiev|best|top|award)/i, "🏆"],
  [/\b(warn|risk|danger|caution|careful)/i, "🚨"],
  [/\b(energy|power|electric|fuel)/i, "🔋"],
  [/\b(health|medical|doctor|patient|care)/i, "🩺"],
  [/\b(nature|plant|green|environment|climate)/i, "🌱"],
  [/\b(light|bright|clear|obvious|reveal)/i, "🔦"],
  [/\b(hidden|secret|dark|unknown|mystery)/i, "🕵️"],
  [/\b(rule|law|policy|govern|regulat)/i, "📜"],
  [/\b(email|message|send|inbox|mail)/i, "✉️"],
  [/\b(sign|label|tag|name|title)/i, "🏷️"],
];

/** Used when nothing matched, keyed off the scene's position in the video. */
const NEUTRAL = ["✨", "🔹", "📌", "🧩", "🔸", "◾"];

/**
 * The glyph for a scene.
 *
 * Keywords first because the director chose them, then the heading, then the
 * bullets. `avoid` keeps a video from putting the same glyph on two frames,
 * which is the fastest way to make the accent look automatic.
 */
export function emojiFor(
  parts: Array<string | undefined>,
  options: { avoid?: Set<string>; index?: number } = {},
): string {
  const avoid = options.avoid;
  const haystacks = parts.filter((part): part is string => Boolean(part?.trim()));

  // First pass: the best match that has not been used yet.
  for (const text of haystacks) {
    for (const [pattern, glyph] of LEXICON) {
      if (!pattern.test(text)) continue;
      if (avoid?.has(glyph)) continue;
      avoid?.add(glyph);
      return glyph;
    }
  }

  // Second pass: a repeat of the right glyph beats a neutral mark. Uniqueness
  // is a preference, not a rule -- a later scene about documents should still
  // get the notepad rather than a sparkle just because an earlier one took it.
  for (const text of haystacks) {
    for (const [pattern, glyph] of LEXICON) {
      if (pattern.test(text)) return glyph;
    }
  }

  // Nothing matched at all: a neutral mark rather than a forced metaphor.
  const start = options.index ?? 0;
  for (let step = 0; step < NEUTRAL.length; step += 1) {
    const glyph = NEUTRAL[(start + step) % NEUTRAL.length];
    if (avoid?.has(glyph)) continue;
    avoid?.add(glyph);
    return glyph;
  }
  return NEUTRAL[0];
}

/** A font stack that actually has colour emoji on every platform we run on. */
export const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
