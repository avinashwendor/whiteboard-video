export type TranscriptLanguage = "en" | "es" | "fr" | "de" | "zh" | "te";

/**
 * What the user picked on the model menu: one specific language, or "auto" to
 * let Whisper decide.
 *
 * "auto" matters more than it looks. Whisper does not *guess* when it is handed
 * a language — it obeys, and decoding speech as a language it is not produces
 * fluent nonsense in that language's script rather than an error. A stale
 * setting is therefore indistinguishable from a broken model, which is exactly
 * how it fails in practice, so detection is the default.
 */
export type TranscriptLanguageSetting = TranscriptLanguage | "auto";

/**
 * Output script for languages that have a non-Latin native script.
 *
 * "native" keeps Whisper's own output (తెలుగు); "roman" transliterates it to
 * readable Latin ("Tenglish"). English words mixed in are unaffected either way.
 * Only languages where {@link TRANSCRIPT_LANGUAGES}.romanizable is set expose
 * the choice; the rest are always "native" (which, for English, is Latin).
 */
export type TranscriptScript = "native" | "roman";

export interface TranscriptLanguageInfo {
  label: string;
  nativeLabel: string;
  /** Flag emoji shown beside the language name in the submenu. */
  flag: string;
  /** Short uppercase code shown in the model selector trigger. */
  code: string;
  /**
   * Native script is non-Latin, so a native/roman toggle is offered. Absent for
   * languages that are already Latin (English, Spanish, …).
   */
  romanizable?: boolean;
}

const LANGUAGE_STORAGE_KEY = "rescript.transcript-language";
const SCRIPT_STORAGE_KEY = "rescript.transcript-script";

export const DEFAULT_TRANSCRIPT_LANGUAGE: TranscriptLanguageSetting = "auto";

export const TRANSCRIPT_LANGUAGES: Record<
  TranscriptLanguageSetting,
  TranscriptLanguageInfo
> = {
  auto: {
    label: "Auto-detect",
    nativeLabel: "Auto-detect",
    flag: "🌐",
    code: "AUTO",
  },
  en: {
    label: "English",
    nativeLabel: "English",
    flag: "🇺🇸",
    code: "EN",
  },
  es: {
    label: "Spanish",
    nativeLabel: "Español",
    flag: "🇪🇸",
    code: "ES",
  },
  fr: {
    label: "French",
    nativeLabel: "Français",
    flag: "🇫🇷",
    code: "FR",
  },
  de: {
    label: "German",
    nativeLabel: "Deutsch",
    flag: "🇩🇪",
    code: "DE",
  },
  zh: {
    label: "Chinese",
    nativeLabel: "中文",
    flag: "🇨🇳",
    code: "ZH",
  },
  te: {
    label: "Telugu",
    nativeLabel: "తెలుగు",
    flag: "🇮🇳",
    code: "TE",
    romanizable: true,
  },
};

export const TRANSCRIPT_LANGUAGE_ORDER: TranscriptLanguageSetting[] = [
  "auto",
  "en",
  "es",
  "fr",
  "de",
  "zh",
  "te",
];

/** A concrete language — excludes "auto". This is what the aligner is keyed by. */
export function isSpecificLanguage(
  value: unknown
): value is TranscriptLanguage {
  return (
    value === "en" ||
    value === "es" ||
    value === "fr" ||
    value === "de" ||
    value === "zh" ||
    value === "te"
  );
}

/** Anything selectable on the language menu, "auto" included. */
export function isTranscriptLanguage(
  value: unknown
): value is TranscriptLanguageSetting {
  return value === "auto" || isSpecificLanguage(value);
}

/** Whether a language exposes the native/roman script toggle. */
export function isRomanizableLanguage(
  language: TranscriptLanguageSetting
): boolean {
  return TRANSCRIPT_LANGUAGES[language].romanizable === true;
}

export function isTranscriptScript(value: unknown): value is TranscriptScript {
  return value === "native" || value === "roman";
}

export const DEFAULT_TRANSCRIPT_SCRIPT: TranscriptScript = "native";

/** Read the last-selected transcript language from localStorage. */
export function loadTranscriptLanguagePreference(): TranscriptLanguageSetting {
  if (typeof window === "undefined") return DEFAULT_TRANSCRIPT_LANGUAGE;
  try {
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isTranscriptLanguage(raw)) return raw;
  } catch {
    // private mode / disabled storage
  }
  return DEFAULT_TRANSCRIPT_LANGUAGE;
}

/** Persist the selected transcript language for the next visit. */
export function saveTranscriptLanguagePreference(
  language: TranscriptLanguageSetting
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // private mode / disabled storage
  }
}

/** Read the last-selected output script from localStorage. */
export function loadTranscriptScriptPreference(): TranscriptScript {
  if (typeof window === "undefined") return DEFAULT_TRANSCRIPT_SCRIPT;
  try {
    const raw = window.localStorage.getItem(SCRIPT_STORAGE_KEY);
    if (isTranscriptScript(raw)) return raw;
  } catch {
    // private mode / disabled storage
  }
  return DEFAULT_TRANSCRIPT_SCRIPT;
}

/** Persist the selected output script for the next visit. */
export function saveTranscriptScriptPreference(script: TranscriptScript) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCRIPT_STORAGE_KEY, script);
  } catch {
    // private mode / disabled storage
  }
}
