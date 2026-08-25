/**
 * A version stamp for the editor agent's prompt.
 *
 * Bumped by hand whenever the system prompt, the operation vocabulary or the
 * style guide changes in a way that could move output quality. It is recorded
 * against every feedback event and every eval run, which is the only thing that
 * makes "did that prompt edit help?" a question with an answer — without it, a
 * change that quietly regresses three cases looks exactly like a change that
 * fixed two.
 *
 * Kept in its own tiny module because both halves need it: the server builds
 * the prompt, and the browser records what people thought of the result.
 * Importing the agent itself into a client component would drag the whole
 * planner into the editor bundle.
 */
export const PROMPT_VERSION = "2026-08-25.1";
