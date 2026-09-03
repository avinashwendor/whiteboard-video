export type TranscriptLanguage = "en" | "es" | "fr" | "de" | "zh" | "te";

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

export const DEFAULT_TRANSCRIPT_LANGUAGE: TranscriptLanguage = "en";

export const TRANSCRIPT_LANGUAGES: Record<
  TranscriptLanguage,
  TranscriptLanguageInfo
> = {
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

export const TRANSCRIPT_LANGUAGE_ORDER: TranscriptLanguage[] = [
  "en",
  "es",
  "fr",
  "de",
  "zh",
  "te",
];

export function isTranscriptLanguage(
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

/** Whether a language exposes the native/roman script toggle. */
export function isRomanizableLanguage(language: TranscriptLanguage): boolean {
  return TRANSCRIPT_LANGUAGES[language].romanizable === true;
}

export function isTranscriptScript(value: unknown): value is TranscriptScript {
  return value === "native" || value === "roman";
}

export const DEFAULT_TRANSCRIPT_SCRIPT: TranscriptScript = "native";

/** Read the last-selected transcript language from localStorage. */
export function loadTranscriptLanguagePreference(): TranscriptLanguage {
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
export function saveTranscriptLanguagePreference(language: TranscriptLanguage) {
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
