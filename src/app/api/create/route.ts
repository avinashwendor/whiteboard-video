import { NextResponse } from "next/server";
import { defaultModel, omega } from "@/lib/ai/omega";
import type { ChatMessage } from "@/lib/ai/types";
import { AppError } from "@/lib/utils/errors";
import { acquire, clientKey } from "@/lib/utils/rate-limit";
import { fail, failFrom, parseBody } from "@/lib/utils/route-helpers";
import { createRequestSchema, storyboardSchema, type Storyboard } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LIMITS = { capacity: 8, windowMs: 60_000, maxConcurrent: 1 };

const TONE_GUIDANCE: Record<string, string> = {
  explainer: "Deep, high-information explanation for an intelligent, curious audience. Build first-principles understanding step by step with concrete analogies and real mechanisms.",
  story: "Compelling narrative storytelling with a relatable protagonist, real friction/struggle, an analytical turning point, and a powerful takeaway.",
  advert: "High-impact, persuasive commercial script: irresistible hook, clear pain point, transformative solution, undeniable evidence/metrics, and a memorable closing call.",
  lesson: "Masterclass-grade pedagogy: define core concept, dissect mechanics with clear examples, highlight common misconceptions, and reinforce key takeaways.",
};

const LANGUAGE_LABELS: Record<string, string> = {
  "en-IN": "Indian English (natural, clear Indian English conversational tone)",
  en: "English",
  hi: "Hindi (natural, expressive conversational Hindi in Devanagari or standard script)",
  te: "Telugu",
  ta: "Tamil",
  bn: "Bengali",
  mr: "Marathi",
  kn: "Kannada",
  pa: "Punjabi",
  gu: "Gujarati",
  ml: "Malayalam",
};

/**
 * The rules that decide whether anyone actually learns anything.
 *
 * A video can be beautifully rendered, perfectly synced and still leave the
 * viewer no wiser, which is the only failure that matters. These are the
 * habits of an explanation that lands: one idea at a time, no undefined
 * jargon, something concrete to hang the abstraction on, and a plain sentence
 * at the end saying what it all meant.
 */
const COMPREHENSION = `HOW TO EXPLAIN (these matter more than the visuals)
- One idea per scene. If a scene needs the word "and" to describe its purpose, it is two scenes.
- Assume an intelligent viewer who knows nothing about this subject. Never assume prior context.
- Any term of art must be explained in plain words the first time it is spoken, in the same sentence. Do not use a piece of jargon and explain it later.
- Prefer the concrete to the abstract. "A shopkeeper waits three days for the money" beats "settlement latency affects merchants".
- Every video needs at least one real, specific anchor: a number, a named example, a before-and-after. Never invent one; if the subject has none, use a concrete scenario instead.
- Say the surprising thing early. A viewer decides in the first ten seconds whether this is worth their attention.
- Cause before effect, always. Explain why something happens before describing what it leads to.
- The final scene must state, in one plain sentence, the thing the viewer now understands that they did not before.
- Bullets are labels, not sentences: 2-6 words, no trailing punctuation. They are read at a glance while the narration continues, so anything longer is never read at all.
- The bullets must be the load-bearing points of that scene's narration, in the order the narration makes them.`;

function systemPrompt(sceneCount: number, tone: string, languageCode: string, videoStyle = "whiteboard"): string {
  const language = LANGUAGE_LABELS[languageCode] ?? languageCode;

  if (videoStyle === "hyperframes") {
    return `You are a film director cutting a short, modern explainer. Not a slide deck with music over it -- a piece of film, with a shape: a hook that earns the next ten seconds, a real tension, a mechanism that resolves it, and a line at the end worth repeating.

${TONE_GUIDANCE[tone] ?? TONE_GUIDANCE.explainer}

${COMPREHENSION}

Return exactly ${sceneCount} scene${sceneCount === 1 ? "" : "s"}.

THE ARC (map your scenes onto this; with fewer scenes, merge rather than skip)
  1. HOOK -- the surprising claim or the question the viewer did not know they had.
  2. TENSION -- why the obvious answer fails, or what is actually at stake.
  3. MECHANISM -- how the thing really works, in plain concrete terms.
  4. EVIDENCE -- the number, the case, the proof.
  5. TAKEAWAY -- the one sentence they will repeat to someone else tomorrow.

HOW EACH SCENE IS SHOT
The renderer chooses a shot from what the scene contains, so give it something to work with:
  - a scene with "stat" is cut as a full-frame counting metric;
  - a scene with 3+ bullets is cut as a step-by-step process rail;
  - a scene with exactly 2 bullets is cut as a two-panel contrast;
  - a scene with 0-1 bullets is cut as a held statement.
Vary the shape deliberately across the video. Do not give every scene three bullets.

FIELDS
- "title": 3-7 words. Concrete and specific. No colon-subtitle, no "The Ultimate Guide To".
- "description": one sentence naming the insight the viewer walks away with.
- "narration": the full script, all scene narrations joined in order, reading as continuous speech.
- Scene "narration": 2-3 sentences of natural spoken language. HARD LIMIT 40-65 words -- count them. That is roughly 15-25 seconds; a 90-word scene is a static frame the viewer abandons, however good the writing. No markdown, no stage directions, no emoji. Spell numbers out the way they are said.
- "heading": 2-5 words. The point of the shot, not a label for it.
- "bullets": 0-4 fragments, 3-8 words each. These are the beats the picture animates.
- "keywords": 2-4 words from THIS scene's narration to lift in the accent colour.
- "stat": include ONLY when the narration actually says a number. Short form: "85%", "3.4x", "₹10,000 CR", "100M+".
- "stat_caption": 2-3 words naming what the number measures.
- "image_prompt": one cinematic 16:9 frame, in English. Describe a real subject in a real space -- lens, light, depth. No text, no charts, no UI, no collage, no infographics.
- "photo_query": 4-8 words, in English, to search the web for a real photograph of this scene. Write it the way a picture editor would: a concrete subject in a concrete place ("empty factory floor night shift", "surgeon hands operating theatre light"). Not the heading, not an abstraction, and never a brand name.
- "support_visual": where this shot's plate comes from. "photo" for anything that exists and can be photographed -- always prefer this, it is what makes the film look real. "generated" only when the subject cannot be photographed: a metaphor, an imagined scene, an invisible mechanism. "none" ONLY for a deliberate hold on type, at most once per video.

TIMING RULE, AND IT MATTERS
Every bullet and every stat must use words that also appear in that scene's narration, close to where the narration makes that point. The renderer pins each beat to the moment its words are spoken, so a bullet phrased differently from the script animates at the wrong time.

ONE LOOK FOR THE WHOLE FILM
- "visual_style": one sentence of art direction applied to every frame -- palette, light, lens, era, texture. Every scene's image_prompt is rendered with this prefixed, so write it once and write it well.
- "visual_theme": pick the grade that fits the subject: "studio-dark" (default, warm amber accent), "cyber-blue" (technology, data), "sunset" (human, cultural, hopeful), "clean-light" (medical, editorial, calm).

SOUND
- "music_mood": the underscore. "calm" (explanatory, reflective), "curious" (discovery, science), "driving" (urgency, business, momentum), "warm" (human stories), "serious" (risk, loss, gravity), or "none" when music would cheapen the subject.
- "voice_brief": who should read this. {"gender":"feminine|masculine|any","qualities":["..."]} where qualities are drawn from: calm, smooth, warm, professional, confident, natural, expressive, energetic, empathetic, clear, melodic, deep, casual. Pick 2-3 that suit the subject; a voice is chosen from the catalogue to match.
- Narration, headings, bullets and keywords MUST be in ${language}. Keep image_prompt and visual_style in English.

Reply with JSON only:
{"title":"...","description":"...","image_prompt":"...","narration":"...","visual_style":"...","visual_theme":"studio-dark","music_mood":"calm","voice_brief":{"gender":"any","qualities":["..."]},"scenes":[{"heading":"...","bullets":["..."],"image_prompt":"...","photo_query":"...","support_visual":"photo|generated|none","narration":"...","keywords":["..."],"stat":"...","stat_caption":"..."}]}`;
  }

  return `You are a world-class whiteboard explainer director and scriptwriter powered by Claude Opus 4.8. You create highly informative, intellectually satisfying, and visually vivid explainer videos.

${TONE_GUIDANCE[tone] ?? TONE_GUIDANCE.explainer}

${COMPREHENSION}

Return exactly ${sceneCount} scene${sceneCount === 1 ? "" : "s"} that flow seamlessly from one to the next.

SCRIPT & STORYBOARD RULES:
- "title": 3-7 words, punchy, concrete, memorable. No colon-subtitles.
- "description": 1 crisp sentence stating the core insight the viewer gains.
- "narration": the complete video narration script (all scene narrations joined smoothly in order).
- Every scene's "narration" is written for natural human speech:
  * Engaging, articulate, conversational sentences with rhythmic cadence.
  * No markdown, stage directions, parentheticals, sound effects, or emojis.
  * Spell out numbers and symbols where words sound better spoken aloud (e.g. "twenty-five percent", "ten billion dollars").
  * HARD LIMIT: 40-65 words per scene. Count them. This is about 15-25 seconds spoken, and it is the difference between a scene that holds attention and a static board the viewer abandons. A scene of 90 words is a failure however good the writing is.
  * Two or three sentences. If you need a fourth, the scene is doing too much -- cut it or split it.
- "heading": 2-5 words capturing the scene's core theme or question.
- "bullets": 2-4 labels of 2-6 words each, drawn on the board as captions under the icons. Not sentences.
- TIMING RULE: each bullet must reuse words that also appear in that scene's narration, at the point the narration makes that point. Every drawing is pinned to the moment its words are spoken, so a bullet worded differently from the script is drawn at the wrong time.
- "image_prompt": A highly specific description for a hand-drawn whiteboard marker illustration or diagram. Include concrete objects, directional flow arrows, connected nodes, metrics, or conceptual icons on a clean white board. No text inside the image. Keep "image_prompt" in English.
- "support_visual": what this scene carries BESIDE the drawing. Every scene is drawn; this decides what shares the board with it.
  * "photo" -- a real photograph, searched and verified. Use when the scene is about something that exists: a real place, object, document, person, event, or the look of real work being done.
  * "generated" -- a marker illustration, drawn to order. Use when the scene needs a picture of something that cannot be photographed: a metaphor, an imagined future, an internal mechanism, an abstraction made concrete.
  * "none" -- the diagram alone. Use when the board is already doing the work: a chart, a comparison, a single number, a process the icons fully explain.
  AT LEAST HALF THE SCENES MUST CARRY A VISUAL. "none" is the exception, not the default: reach for it only when the board genuinely says everything -- a chart, a two-sided comparison, one big number. A video where every scene is "none" is a slideshow of captions, and it is the most common way these come out flat. Mix "photo" and "generated" across the video rather than repeating one.
  Even an abstract subject has photographable anchors: the people affected, the place it happens, the object involved, the document produced. Reach for those before settling on "none".
- "photo_query": REQUIRED when support_visual is "photo", omitted otherwise. 4-8 words in English naming a concrete subject in a concrete place.
- The top-level "image_prompt" is the hero title illustration for the video.
- Narration, headings, and bullets MUST be written in ${language}.

SOUND
- "music_mood": the underscore. "calm" (explanatory, reflective), "curious" (discovery, science), "driving" (urgency, business, momentum), "warm" (human stories), "serious" (risk, loss, gravity), or "none" when music would cheapen the subject.
- "voice_brief": who should read this. {"gender":"feminine|masculine|any","qualities":["..."]} where qualities come from: calm, smooth, warm, professional, confident, natural, expressive, energetic, empathetic, clear, melodic, deep, casual. Pick 2-3 that suit the subject; a narrator is cast from the catalogue to match.

Reply with JSON only, no code fence:
{"title":"...","description":"...","image_prompt":"...","narration":"...","music_mood":"calm","voice_brief":{"gender":"any","qualities":["..."]},"scenes":[{"heading":"...","bullets":["..."],"image_prompt":"...","photo_query":"...","support_visual":"photo|generated|none","narration":"..."}]}`;
}
function stripFence(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

interface ParseOutcome {
  storyboard?: Storyboard;
  problem?: string;
}

function parseStoryboard(text: string): ParseOutcome {
  const candidate = firstJsonObject(stripFence(text));
  if (!candidate) return { problem: "the reply contained no JSON object" };

  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch (err) {
    return { problem: `the JSON was malformed (${err instanceof Error ? err.message : "parse error"})` };
  }

  const parsed = storyboardSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { problem: `${issue.path.join(".") || "root"} ${issue.message}` };
  }
  return { storyboard: parsed.data };
}

export async function POST(req: Request) {
  let lease;
  try {
    const body = await parseBody(req, createRequestSchema);
    lease = acquire(clientKey(req, "create"), LIMITS);

    const sceneCount = body.sceneCount ?? 4;
    const tone = body.tone ?? "explainer";
    const language = body.language ?? "en";
    const videoStyle = body.videoStyle ?? "whiteboard";
    const model = body.model ?? (await defaultModel());

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(sceneCount, tone, language, videoStyle) },
      { role: "user", content: body.prompt },
    ];

    let outcome: ParseOutcome = {};
    let usage;

    // One repair round: models occasionally trail prose after the JSON or drop a
    // field, and telling them exactly what broke fixes it far more often than not.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await omega.generateText({
        messages,
        model,
        temperature: attempt === 0 ? 0.75 : 0.3,
        maxTokens: 4200,
        json: true,
      });
      usage = result.usage;

      outcome = parseStoryboard(result.text);
      if (outcome.storyboard) break;

      messages.push({ role: "assistant", content: result.text.slice(0, 4_000) });
      messages.push({
        role: "user",
        content: `That wasn't usable: ${outcome.problem}. Reply again with only the JSON object, matching the schema exactly.`,
      });
    }

    if (!outcome.storyboard) {
      throw new AppError("malformed_response", {
        userMessage: "The model couldn't produce a usable plan. Try rephrasing your idea.",
        detail: `storyboard validation failed: ${outcome.problem}`,
      });
    }

    return NextResponse.json({
      success: true as const,
      storyboard: outcome.storyboard,
      model,
      provider: "omega",
      usage: usage ?? {},
    });
  } catch (err) {
    return err instanceof AppError ? fail(err) : failFrom(err);
  } finally {
    lease?.release();
  }
}
