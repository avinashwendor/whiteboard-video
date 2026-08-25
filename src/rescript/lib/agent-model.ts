/**
 * Which text model the editor's AI panel asks.
 *
 * The studio has had a model picker since it shipped; the editor's panel never
 * sent a `model` at all, so every plan it made silently fell through to the
 * server's `defaultModel()`. That is a reasonable default and a bad thing to
 * have no control over: the panel is the surface where a model's reasoning
 * budget actually shows, and "why is it worse today" had no answer you could
 * check.
 *
 * Stored under `rescript.*` like the editor's other preferences rather than in
 * the studio's settings blob — the two apps have separate shells, separate
 * layouts and separate storage namespaces, and sharing one key across them
 * would make a change in one silently move the other.
 */

const STORAGE_KEY = "rescript.agentModel";

/** Empty string means "whatever the server prefers", which stays the default. */
export function loadAgentModel(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return ""; // private mode / blocked storage
  }
}

export function saveAgentModel(model: string) {
  try {
    if (model) window.localStorage.setItem(STORAGE_KEY, model);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / blocked storage */
  }
}
