import { NextResponse } from "next/server";
import { generateText } from "@/lib/ai/omega";
import { acquire, clientKey } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMITS = { capacity: 20, windowMs: 60_000, maxConcurrent: 3 };

/** Beyond this the prompt gets unwieldy and the model starts losing indices. */
const MAX_WORDS = 400;

interface CorrectRequest {
  words?: unknown;
  language?: unknown;
}

/**
 * Proof-read an ASR transcript **without touching the timeline.**
 *
 * The transcript is a timeline index: every word carries the timestamps that
 * drive cutting, so a correction that inserts, drops or reorders words would
 * silently desynchronise the edit from the audio. The model is therefore only
 * ever allowed to *substitute* a word in place, and is asked for sparse
 * `{index, text}` edits rather than a rewritten transcript — a shape that
 * cannot express an insertion, so a malformed reply fails closed instead of
 * corrupting the timeline.
 *
 * Indices outside the input, and "corrections" identical to the original, are
 * dropped here rather than trusted.
 */
export async function POST(req: Request) {
  try {
    const permit = acquire(clientKey(req, "correct"), LIMITS);
    try {
      const body = (await req.json()) as CorrectRequest;
      const words = Array.isArray(body.words)
        ? body.words.filter((w): w is string => typeof w === "string")
        : [];
      const language = typeof body.language === "string" ? body.language : "";

      if (words.length === 0) {
        return NextResponse.json({ error: "No words to correct" }, { status: 400 });
      }
      if (words.length > MAX_WORDS) {
        return NextResponse.json(
          { error: `Too many words (${words.length} > ${MAX_WORDS})` },
          { status: 400 }
        );
      }

      const numbered = words.map((w, i) => `${i}\t${w}`).join("\n");
      const languageLine = language
        ? `The speech is in ${language}. Code-mixed English words are normal and must be kept as they are.`
        : "The speech may be code-mixed. Keep foreign words as they are.";

      const system = [
        "You proof-read speech-recognition output.",
        languageLine,
        "You are given one word per line as `index<TAB>word`.",
        "Fix only words that are clearly mis-recognised: wrong spelling, split or",
        "merged syllables, or an obvious phonetic mistake in context.",
        "",
        "Hard rules:",
        "- Reply with JSON only: {\"edits\":[{\"index\":<int>,\"text\":\"<word>\"}]}",
        "- Each edit replaces exactly ONE word with exactly ONE word.",
        "- Never add, delete, split, merge or reorder words. The count is fixed.",
        "- Do not translate, transliterate, or change the script.",
        "- Do not fix punctuation, casing or style. Only genuine recognition errors.",
        "- If a word is plausible as-is, leave it out. Few edits is a good answer.",
        "- An empty list is a valid answer.",
      ].join("\n");

      const result = await generateText({
        messages: [
          { role: "system", content: system },
          { role: "user", content: numbered },
        ],
        temperature: 0,
        json: true,
      });

      let edits: Array<{ index: number; text: string }> = [];
      try {
        const parsed = JSON.parse(result.text) as {
          edits?: Array<{ index?: unknown; text?: unknown }>;
        };
        for (const edit of parsed.edits ?? []) {
          const index = typeof edit.index === "number" ? edit.index : NaN;
          const text = typeof edit.text === "string" ? edit.text.trim() : "";
          // Reject anything out of range, empty, multi-word (an insertion in
          // disguise), or identical to what is already there.
          if (!Number.isInteger(index) || index < 0 || index >= words.length) continue;
          if (!text || /\s/.test(text) || text === words[index]) continue;
          edits.push({ index, text });
        }
      } catch {
        return NextResponse.json(
          { error: "The model did not return usable JSON." },
          { status: 502 }
        );
      }

      // One edit per index, in transcript order, so applying them is stable.
      const seen = new Set<number>();
      edits = edits
        .filter((e) => (seen.has(e.index) ? false : seen.add(e.index)))
        .sort((a, b) => a.index - b.index);

      return NextResponse.json({ edits, model: result.model ?? null });
    } finally {
      permit.release();
    }
  } catch (err) {
    console.error("Transcript correction error:", err);
    const detail = err as { message?: unknown; status?: unknown };
    const message =
      typeof detail?.message === "string" ? detail.message : "Correction failed";
    const status =
      typeof detail?.status === "number" && detail.status >= 400 && detail.status <= 599
        ? detail.status
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
