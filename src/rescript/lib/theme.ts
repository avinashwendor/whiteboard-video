/**
 * User-selected appearance.
 *
 * Defaults to dark so the editor opens in the same skin as the rest of the
 * site — crossing from a near-black studio into a white editor was the most
 * jarring thing in the product. Still a preference, still does not follow the
 * OS, and the toggle in Settings works exactly as before.
 */
export type Appearance = "light" | "dark";

const APPEARANCE_STORAGE_KEY = "rescript.appearance";

export function isAppearance(value: unknown): value is Appearance {
  return value === "light" || value === "dark";
}

/** Read the stored appearance (defaults to dark). */
export function loadAppearance(): Appearance {
  if (typeof window === "undefined") return "dark";
  try {
    const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (isAppearance(raw)) return raw;
  } catch {
    /* private mode / blocked storage */
  }
  return "dark";
}

export function saveAppearance(appearance: Appearance) {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
  } catch {
    /* ignore */
  }
}

/** Toggle the `dark` class on <html> so Tailwind `dark:` utilities apply. */
export function applyAppearance(appearance: Appearance) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", appearance === "dark");
}
