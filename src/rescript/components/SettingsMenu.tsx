"use client";

import { useId, useState } from "react";
import { Settings } from "lucide-react";
import { useTelemetryPref } from "@/rescript/hooks/useTelemetryPref";
import Popover, { PopoverContent, PopoverTrigger } from "./Popover";
import { useI18n } from "./I18nProvider";
import {
  UI_LOCALES,
  UI_LOCALE_META,
  isUiLocalePreference,
} from "@/rescript/lib/i18n";


/**
 * Top-bar settings popover. Transcript source, language and telemetry.
 *
 * The appearance switch is gone: there is one skin now, and it is the same
 * one the rest of the site wears.
 */
export default function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { enabled: telemetry, setEnabled: setTelemetry } = useTelemetryPref();
  const { t, preference, setPreference } = useI18n();

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      backdrop
    >
      <div className="relative z-30 shrink-0">
        <PopoverTrigger>
          <button
            type="button"
            aria-label={t("common.settings")}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={panelId}
            title={t("common.settings")}
            onClick={() => setOpen((v) => !v)}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <Settings size={16} />
          </button>
        </PopoverTrigger>

        <PopoverContent
          id={panelId}
          role="dialog"
          aria-label={t("common.settings")}
          className="z-40 w-[15rem] overflow-hidden"
        >

          <section className="border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
            <label className="block text-[11px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
              {t("settings.interfaceLanguage")}
              <select
                value={preference}
                onChange={(event) => {
                  const next = event.target.value;
                  if (isUiLocalePreference(next)) setPreference(next);
                }}
                className="mt-2 block h-8 w-full rounded-lg border border-zinc-200 bg-white px-2 text-[12px] text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              >
                <option value="system">{t("common.system")}</option>
                {UI_LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {UI_LOCALE_META[locale].nativeLabel}
                  </option>
                ))}
              </select>
            </label>
          </section>


          <section className="px-2 py-2.5">
            <p className="mb-2 text-[11px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
              {t("settings.privacy")}
            </p>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={telemetry}
                onChange={(e) => setTelemetry(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-transparent"
              />
              <span>
                <span className="block text-[12px] text-zinc-700 dark:text-zinc-300">
                  {t("settings.helpImprove")}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
                  {t("settings.telemetryHelp")}
                </span>
              </span>
            </label>
          </section>

        </PopoverContent>
      </div>
    </Popover>
  );
}
