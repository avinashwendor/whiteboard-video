import { NextResponse } from "next/server";
import { defaultModel, omega } from "@/lib/ai/omega";
import type { ChatMessage } from "@/lib/ai/types";
import { AppError } from "@/lib/utils/errors";
import { acquire, clientKey } from "@/lib/utils/rate-limit";
import { fail, failFrom, parseBody } from "@/lib/utils/route-helpers";
import { createRequestSchema, storyboardSchema, type Storyboard } from "@/lib/validation/schemas";
import { SCENE_ROLES_TUPLE, SHOT_BRIEFS } from "@/lib/hyperframes/roles";
import { KIND } from "@/lib/hyperframes/casting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LIMITS = { capacity: 12, windowMs: 60_000, maxConcurrent: 2, leaseTtlMs: 75_000 };

/**
 * The screen menu, written out of the engine's own library.
 *
 * Generated rather than typed, because a hand-written list of thirty-five
 * layouts drifts the first time one is added and there is no way to notice:
 * the director keeps asking for a screen that no longer exists, the renderer
 * quietly substitutes another, and the films get worse for a reason nobody can
 * see in a diff.
 */
const SHOT_MENU = [
  "HOW EACH SCENE IS SHOT",
  "You are cutting the shot list. Every screen below is a real composition; pick the one whose *job*",
  "matches what the scene is doing, and give the scene the content that screen needs.",
  "",
  ...(
    [
      ["title", "TYPE — a claim, held"],
      ["number", "NUMBERS — a figure, made the subject"],
      ["sequence", "SEQUENCES — things in an order"],
      ["compare", "COMPARISONS — two or more things weighed"],
      ["structure", "STRUCTURE — how parts relate"],
      ["media", "PICTURES — photography carrying the frame"],
    ] as const
  ).flatMap(([kind, heading]) => [
    `  ${heading}`,
    ...SCENE_ROLES_TUPLE.filter((role) => KIND[role] === kind).map(
      (role) => `    ${role.padEnd(12)} ${SHOT_BRIEFS[role]}`,
    ),
    "",
  ]),
  '  "hero" and "takeaway" are positional -- the renderer uses them for the first and last scene and',
  "  you should not ask for them.",
].join("\n");

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
    return `RETURN EXACTLY ${sceneCount} SCENES. Not ${sceneCount - 1}, not ${sceneCount + 1}. Count them before you reply.

You are a film director cutting a short, modern explainer. Not a slide deck with music over it -- a piece of film, with a shape: a hook that earns the next ten seconds, a real tension, a mechanism that resolves it, and a line at the end worth repeating.

${TONE_GUIDANCE[tone] ?? TONE_GUIDANCE.explainer}

${COMPREHENSION}

Return exactly ${sceneCount} scene${sceneCount === 1 ? "" : "s"}.

THE ARC (map your scenes onto this; with fewer scenes merge, with more scenes split a beat in two)
  1. HOOK -- the surprising claim or the question the viewer did not know they had.
  2. TENSION -- why the obvious answer fails, or what is actually at stake.
  3. MECHANISM -- how the thing really works, in plain concrete terms.
  4. EVIDENCE -- the number, the case, the proof.
  5. TAKEAWAY -- the one sentence they will repeat to someone else tomorrow.

Six or more scenes means splitting MECHANISM across two or three, one move each -- not padding the others. A scene that carries one move is what makes a short scene work.

${SHOT_MENU}

RULES FOR THE SHOT LIST
- Name a "shot" on every scene. It is the *opening* screen of that scene, and the renderer picks the rest.
- No shot may appear twice in any three consecutive scenes. Vary it deliberately, before you write.
- The bullet count is part of the shot. Asking for a step rail and giving it one bullet gets you a
  different layout than you asked for, because the renderer refuses a shot the scene cannot carry.
- At least two scenes across the film must have 0 or 1 bullets. A film where every frame is a list is
  a slide deck, however good the writing is.

EVERY SCENE IS SEVERAL SCREENS
A scene of ten seconds or more is cut into two, three or four screens, and its bullets and its
statistic are dealt out across them -- so the picture changes three or four times while one paragraph
of narration is spoken. You do not schedule this and cannot control it directly. What you control is
whether there is anything to cut *to*: a scene with one bullet and no number holds one screen for its
whole length however long it runs. Give a long scene three or four short bullets and it becomes a
sequence of screens; give it one and it is a held frame.

FIELDS
- "title": 3-7 words. Concrete and specific. No colon-subtitle, no "The Ultimate Guide To".
- "description": one sentence naming the insight the viewer walks away with.
- "narration": the full script, all scene narrations joined in order, reading as continuous speech.
- Scene "narration": 1-2 sentences of natural spoken language. HARD LIMIT 22-40 words -- count them. That is roughly 9-16 seconds. Short scenes are the point: the picture changes more often, the film keeps moving, and a viewer never sits watching one frame. A 60-word scene is a static frame however good the writing. No markdown, no stage directions, no emoji. Spell numbers out the way they are said.
- "heading": 2-5 words. The point of the shot, not a label for it.
- "bullets": 0-3 fragments, 2-5 words each. Fewer and shorter than feels natural -- these are captions read at a glance, not a list. Three is the maximum, and most scenes want two or none.
- "keywords": 2-4 words from THIS scene's narration to lift in the accent colour.
- "stat": include ONLY when the narration actually says a number. Short form: "85%", "3.4x", "₹10,000 CR", "100M+".
- "stat_caption": 2-3 words naming what the number measures.
- "image_prompt": one cinematic 16:9 frame, in English. Describe a real subject in a real space -- lens, light, depth. No text, no charts, no UI, no collage, no infographics.
- "photo_query": 4-8 words, in English, to search the web for a real photograph of this scene. Write it the way a picture editor would: a concrete subject in a concrete place ("empty factory floor night shift", "surgeon hands operating theatre light"). Not the heading, not an abstraction, and never a brand name.
- "support_visual": where this shot's plate comes from. "photo" for anything that exists and can be photographed -- always prefer this, it is what makes the film look real. "generated" only when the subject cannot be photographed: a metaphor, an imagined scene, an invisible mechanism. "none" ONLY for a deliberate hold on type, at most once per video.
- "shot": the composition, from the list above.

TIMING RULE, AND IT MATTERS
Every bullet and every stat must use words that also appear in that scene's narration, close to where the narration makes that point. The renderer pins each beat to the moment its words are spoken, so a bullet phrased differently from the script animates at the wrong time.

ONE LOOK FOR THE WHOLE FILM
- "visual_style": one sentence of art direction applied to every frame -- palette, light, lens, era, texture. Every scene's image_prompt is rendered with this prefixed, so write it once and write it well.
- "visual_theme": the palette, and it decides far more than colour. Each one carries a whole drawing vocabulary, so pick the one whose *language* fits the subject, not the one whose hue you like.

  EDITORIAL -- near-black, one saturated plate, crop marks, display type set enormous behind the subject.
  Magazine cover language. For claims, culture, news, money, anything with an argument in it.
    "obsidian"   near-black and a printing red. The default for this engine, and the strongest look in it.
    "noir"       pure black, pure white, one alarm red. For risk, loss, gravity.
    "ember"      charcoal and a burnt orange. Warmer; for human stakes told with weight.
    "newsprint"  the same language on broadsheet stock: warm paper, black ink, one red. For history, policy, letters.

  GLASS -- blooms of coloured light under frosted panels, brushed-metal titles, dotted routes between nodes.
  Product-film language. For software, systems, data, anything about how a thing works.
    "cobalt"     deep blue light, one warm orange accent. Product, launch, platform.
    "abyss"      ink and teal. Depth, infrastructure, the unseen.
    "daylight"   pale blue light on white frost, one strong blue. Bright, calm, consumer-facing.

  PRINTED -- ruled paper, hard offset shadows, marker swipes. Handmade and warm. For teaching.
    "clean-light"  warm paper and a yellow.   "studio-dark"  the same after dark.
    "cyber-blue"   cool paper and a blue.     "sunset"       warm paper and a coral.

  Do not default to "obsidian" for everything. A lesson about photosynthesis is printed; a film about a
  database is glass; a film about a company collapsing is editorial.

SOUND
- "music_mood": the underscore. "calm" (explanatory, reflective), "curious" (discovery, science), "driving" (urgency, business, momentum), "warm" (human stories), "serious" (risk, loss, gravity), or "none" when music would cheapen the subject.
- "voice_brief": who should read this. {"gender":"feminine|masculine|any","qualities":["..."]} where qualities are drawn from: calm, smooth, warm, professional, confident, natural, expressive, energetic, empathetic, clear, melodic, deep, casual. Pick 2-3 that suit the subject; a voice is chosen from the catalogue to match.
- Narration, headings, bullets and keywords MUST be in ${language}. Keep image_prompt and visual_style in English.

Reply with JSON only:
{"title":"...","description":"...","image_prompt":"...","narration":"...","visual_style":"...","visual_theme":"obsidian","music_mood":"calm","voice_brief":{"gender":"any","qualities":["..."]},"scenes":[{"heading":"...","bullets":["..."],"shot":"bracket","image_prompt":"...","photo_query":"...","support_visual":"photo|generated|none","narration":"...","keywords":["..."],"stat":"...","stat_caption":"..."}]}`;
  }

  return `RETURN EXACTLY ${sceneCount} SCENES. Not ${sceneCount - 1}, not ${sceneCount + 1}. Count them before you reply.

You are a world-class whiteboard explainer director and scriptwriter powered by Claude Opus 4.8. You create highly informative, intellectually satisfying, and visually vivid explainer videos.

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
  * HARD LIMIT: 22-40 words per scene. Count them. This is about 9-16 seconds spoken. Short scenes are the point: the board changes more often and the video keeps moving. A scene of 60 words is a failure however good the writing is.
  * One or two sentences. If you need a third, the scene is doing too much -- cut it or split it into two scenes.
- "heading": 2-5 words capturing the scene's core theme or question.
- "bullets": 2-3 labels of 2-5 words each, drawn on the board as captions under the icons. Not sentences. Three is the maximum; two is usually stronger.
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

THE SURFACE
- "board_stock": what this is drawn on. It changes the whole register of the video, so pick the surface the subject actually belongs on rather than defaulting.
  "marker"    a warm whiteboard under a room light. The everyday choice.
  "blueprint" navy drafting stock, white line work. Plans, systems, engineering, architecture, anything mechanical.
  "chalk"     slate and dusty chalk. Teaching, school subjects, first principles, history of an idea.
  "kraft"     brown card and black ink. Craft, making, food, anything handmade or physical.
  "legal"     a yellow pad in blue biro. Working something out: money, decisions, back-of-envelope reasoning.

SOUND
- "music_mood": the underscore. "calm" (explanatory, reflective), "curious" (discovery, science), "driving" (urgency, business, momentum), "warm" (human stories), "serious" (risk, loss, gravity), or "none" when music would cheapen the subject.
- "voice_brief": who should read this. {"gender":"feminine|masculine|any","qualities":["..."]} where qualities come from: calm, smooth, warm, professional, confident, natural, expressive, energetic, empathetic, clear, melodic, deep, casual. Pick 2-3 that suit the subject; a narrator is cast from the catalogue to match.

Reply with JSON only, no code fence:
{"title":"...","description":"...","image_prompt":"...","narration":"...","board_stock":"marker","music_mood":"calm","voice_brief":{"gender":"any","qualities":["..."]},"scenes":[{"heading":"...","bullets":["..."],"image_prompt":"...","photo_query":"...","support_visual":"photo|generated|none","narration":"..."}]}`;
}
/**
 * Which of the two engines actually suits this idea.
 *
 * Whiteboard is a hand drawn under a marker: process, mechanism, "how does X
 * work", anything better understood as a diagram than seen. Hyperframes is
 * cut like a piece of film over real photography: numbers, product, news,
 * a claim that lands harder shown than sketched. The choice is asked of the
 * model rather than guessed from keywords, because "how a heart attack
 * happens" and "how inflation happens" want opposite answers for reasons a
 * keyword list cannot see.
 *
 * Kept to one word out, low temperature, tiny token budget: this is a
 * classification, not a creative act, and it must not become the slow part
 * of starting a video. Any failure -- timeout, bad JSON, an unrecognised
 * word -- falls back to the heuristic below rather than failing the request.
 */
async function classifyVideoStyle(
  prompt: string,
  tone: string,
  model: string,
): Promise<{ style: "whiteboard" | "hyperframes"; reason: string }> {
  try {
    const result = await omega.generateText({
      model,
      temperature: 0.1,
      maxTokens: 80,
      json: true,
      messages: [
        {
          role: "system",
          content: `You cast one of two video engines for an idea, before a single word of script is written.

WHITEBOARD -- a hand draws diagrams and icons on a board as a narrator explains. Wins when the idea is a process, a mechanism, an abstract system, a "how/why does X work", something clearer as a sketch than a photograph.

HYPERFRAMES -- cut like a short film over real photography and kinetic on-screen text, built for numbers and claims. Wins when the idea is about the real world: a product, a place, a person, a statistic, business, news, culture, anything a camera would actually want to point at.

The tone requested is "${tone}"; treat "advert" and most "story" prompts as a strong pull toward hyperframes unless the idea is unmistakably a mechanism.

Reply with JSON only: {"style":"whiteboard"|"hyperframes","reason":"under 8 words"}`,
        },
        { role: "user", content: prompt.slice(0, 600) },
      ],
    });

    const candidate = firstJsonObject(stripFence(result.text));
    const parsed = candidate ? JSON.parse(candidate) : null;
    if (parsed?.style === "whiteboard" || parsed?.style === "hyperframes") {
      return { style: parsed.style, reason: String(parsed.reason ?? "").slice(0, 120) };
    }
  } catch {
    // Fall through to the heuristic -- classification must never be the
    // reason a video fails to start.
  }

  const real = /\b(stat|statistic|percent|%|revenue|market|company|startup|product|launch|news|price|cost|report|sales|brand|celebrity|country|city|war|election|sport|match|athlete)\b/i;
  const mechanism = /\b(how does|how do|why does|why do|works?|mechanism|process|system|cycle|algorithm|explain(ed)?)\b/i;
  if (tone === "advert" || (real.test(prompt) && !mechanism.test(prompt))) {
    return { style: "hyperframes", reason: "real-world subject, heuristic fallback" };
  }
  return { style: "whiteboard", reason: "mechanism or default, heuristic fallback" };
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

/**
 * What the brief asked for, checked against what came back.
 *
 * The schema only proves the shape is right. A plan can validate perfectly and
 * still be six scenes when eight were asked for, or carry sixty-word scenes
 * that make the video a slideshow -- and those are the two things that decide
 * whether the film moves. So they are checked, and a miss is sent back with
 * the specific complaint rather than accepted.
 */
function briefProblems(storyboard: Storyboard, sceneCount: number): string[] {
  const problems: string[] = [];

  if (Math.abs(storyboard.scenes.length - sceneCount) > 1) {
    problems.push(
      `you returned ${storyboard.scenes.length} scenes; ${sceneCount} were asked for`,
    );
  }

  const wordy = storyboard.scenes
    .map((scene, index) => ({ index, words: scene.narration.trim().split(/\s+/).length }))
    .filter((entry) => entry.words > 46);
  if (wordy.length) {
    problems.push(
      `these scenes run long: ${wordy
        .map((entry) => `scene ${entry.index + 1} at ${entry.words} words`)
        .join(", ")} — every scene must be 22-40 words`,
    );
  }

  const listy = storyboard.scenes
    .map((scene, index) => ({ index, count: scene.bullets.length }))
    .filter((entry) => entry.count > 3);
  if (listy.length) {
    problems.push(
      `these scenes carry too many bullets: ${listy
        .map((entry) => `scene ${entry.index + 1}`)
        .join(", ")} — three is the maximum`,
    );
  }

  // Every scene the same shape is a template, whatever the words say. The
  // renderer picks a shot from the bullet count, so uniform bullets means one
  // composition repeated for the whole film.
  const threes = storyboard.scenes.filter((scene) => scene.bullets.length >= 3).length;
  const counts = new Set(storyboard.scenes.map((scene) => scene.bullets.length));
  if (storyboard.scenes.length >= 4 && counts.size === 1) {
    problems.push(
      `every scene has ${storyboard.scenes[0].bullets.length} bullets, so the renderer cuts every scene as the same shot — give some scenes 2, some 1, some 0`,
    );
  } else if (threes > Math.ceil(storyboard.scenes.length / 2)) {
    problems.push(
      `${threes} of ${storyboard.scenes.length} scenes have 3 bullets — at most half may, the rest need 2, 1 or none`,
    );
  }

  return problems;
}

export async function POST(req: Request) {
  let lease;
  try {
    const body = await parseBody(req, createRequestSchema);
    lease = acquire(clientKey(req, "create"), LIMITS, req.signal);

    const sceneCount = body.sceneCount ?? 6;
    const tone = body.tone ?? "explainer";
    const language = body.language ?? "en";
    const model = body.model ?? (await defaultModel());

    let videoStyle: "whiteboard" | "hyperframes";
    let styleReason: string | undefined;
    if (body.videoStyle === "auto" || !body.videoStyle) {
      const cast = await classifyVideoStyle(body.prompt, tone, model);
      videoStyle = cast.style;
      styleReason = cast.reason;
    } else {
      videoStyle = body.videoStyle;
    }

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(sceneCount, tone, language, videoStyle) },
      { role: "user", content: body.prompt },
    ];

    let outcome: ParseOutcome = {};
    /** The closest plan to the brief so far -- the repair round can come back worse. */
    let best: Storyboard | undefined;
    let bestMisses = Number.POSITIVE_INFINITY;
    let usage;

    // One repair round: models occasionally trail prose after the JSON or drop a
    // field, and telling them exactly what broke fixes it far more often than not.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await omega.generateText({
        messages,
        model,
        temperature: attempt === 0 ? 0.75 : 0.3,
        // Eight scenes of JSON plus the narration field is a lot of tokens; a
        // truncated reply reads as a parse failure and wastes the repair round.
        maxTokens: 7000,
        json: true,
      });
      usage = result.usage;

      outcome = parseStoryboard(result.text);

      if (outcome.storyboard) {
        const problems = briefProblems(outcome.storyboard, sceneCount);
        // Keep whichever attempt missed by least, not simply the last one: a
        // repair round that fixes the bullets and breaks the pacing is not an
        // improvement, and overwriting blindly threw the better plan away.
        if (problems.length < bestMisses) {
          best = outcome.storyboard;
          bestMisses = problems.length;
        }
        if (!problems.length) break;
        // Missing the brief is worth one re-ask, but never worth failing the
        // whole video over: a six-scene film still plays.
        outcome = { problem: problems.join("; ") };
      }

      messages.push({ role: "assistant", content: result.text.slice(0, 4_000) });
      messages.push({
        role: "user",
        content: `That wasn't usable: ${outcome.problem}. Reply again with only the JSON object, matching the schema exactly and honouring every constraint.`,
      });
    }

    // A plan that missed the brief is still renderable, so it beats an error.
    if (!outcome.storyboard && best) outcome = { storyboard: best };

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
      videoStyle,
      styleReason,
    });
  } catch (err) {
    return err instanceof AppError ? fail(err) : failFrom(err);
  } finally {
    lease?.release();
  }
}
