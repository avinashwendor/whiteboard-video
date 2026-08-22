"use client";

import { useState } from "react";
import { ChevronDown, Settings2 } from "lucide-react";
import { Field, Select, Slider } from "@/components/ui/field";
import { cn } from "@/lib/utils/cn";
import { useStudio } from "@/lib/studio/use-studio";
import { IMAGE_SIZES, type Mode } from "@/lib/studio/types";
import { IMAGE_STYLES } from "@/lib/ai/prompt-engineering";
import { PuterConnection } from "./puter-connection";

const STYLE_OPTIONS = [
  { value: "auto", label: "Auto — pick for me" },
  ...IMAGE_STYLES.map((style) => ({
    value: style,
    label: style.charAt(0).toUpperCase() + style.slice(1),
  })),
];

const LANGUAGE_NAMES: Record<string, string> = {
  "en-IN": "Indian English",
  en: "English (US/Global)",
  hi: "Hindi",
  te: "Telugu",
  ta: "Tamil",
  bn: "Bengali",
  mr: "Marathi",
  kn: "Kannada",
  pa: "Punjabi",
  gu: "Gujarati",
  ml: "Malayalam",
  fr: "French",
  de: "German",
  es: "Spanish",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  sv: "Swedish",
  tr: "Turkish",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  id: "Indonesian",
  ar: "Arabic",
};

const INDIAN_VOICE_SHORTCUTS = [
  { id: "4459a9a5-69d6-4680-b970-e13dc51845b6", name: "Siya", lang: "en", desc: "English (Female · Expressive)" },
  { id: "39d518b7-fd0b-4676-9b8b-29d64ff31e12", name: "Aarav", lang: "en-IN", desc: "Indian English (Storyteller)" },
  { id: "c63361f8-d142-4c62-8da7-8f8149d973d6", name: "Krishna", lang: "en-IN", desc: "Indian English (Friendly)" },
  { id: "393dd459-f8d8-4c3e-a86b-ec43a1113d0b", name: "Rahul", lang: "hi", desc: "Hindi (Male)" },
  { id: "209d9a43-03eb-40d8-a7b7-51a6d54c052f", name: "Anita", lang: "hi", desc: "Hindi (Female)" },
  { id: "d2870b91-1b4c-47ab-81a8-3718d8e9c222", name: "Arun", lang: "ta", desc: "Tamil (Male)" },
  { id: "38bded0a-3ab4-42d1-8e47-2e0b6b10ced9", name: "Vikram", lang: "te", desc: "Telugu (Male)" },
  { id: "f227bc18-3704-47fe-b759-8c78a450fdfa", name: "Suresh", lang: "mr", desc: "Marathi (Male)" },
  { id: "991c62ce-631f-48b0-8060-2a0ebecbd15b", name: "Jaspreet", lang: "pa", desc: "Punjabi (Female)" },
];

function languageLabel(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

export function AdvancedSettings({ mode }: { mode: Mode }) {
  const { settings, updateSettings, catalogues, capabilities } = useStudio();
  const [open, setOpen] = useState(false);

  const imageModels = catalogues.imageModels[settings.imageProvider] ?? [];
  const voicesForLanguage = catalogues.voices.filter((voice) =>
    [voice.language, ...(voice.languages ?? [])].includes(settings.language),
  );
  const voiceOptions = (voicesForLanguage.length ? voicesForLanguage : catalogues.voices).map(
    (voice) => ({
      value: voice.id,
      label: `${voice.name}${voice.isIndian ? " (🇮🇳)" : ""}${voice.accent ? ` · ${voice.accent}` : ""}`,
    }),
  );

  const showText = mode !== "image";
  const showImage = mode === "image" || (mode === "create" && (settings.sceneArt === "image" || settings.sceneArt === "hybrid"));
  const showVoice = mode === "voice" || mode === "create";

  return (
    <div className="border-t border-line">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-[12px] font-medium text-muted transition-colors hover:text-ink sm:px-5"
      >
        <Settings2 className="size-3.5" aria-hidden />
        Advanced Settings & Indian TTS
        <ChevronDown
          className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="animate-fade space-y-4 border-t border-line px-4 py-4 sm:px-5">
          {showVoice ? (
            <div className="rounded-card border border-line bg-surface-raised/60 p-3">
              <p className="mb-2 text-[11px] font-medium tracking-wide text-faint">
                POPULAR INDIAN TTS VOICES (CARTESIA)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {INDIAN_VOICE_SHORTCUTS.map((preset) => {
                  const isSelected = settings.voiceId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => updateSettings({ voiceId: preset.id, language: preset.lang })}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-[11px] transition-colors",
                        isSelected
                          ? "border-voice bg-voice/15 text-voice font-medium"
                          : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink",
                      )}
                    >
                      {preset.name} · <span className="opacity-80">{preset.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {showText ? (
              <Field
                label="Text model"
                hint={catalogues.notices.omega ?? "Claude Opus 4.8 handles deep reasoning and scriptwriting."}
                className={catalogues.textModels.length ? undefined : "opacity-70"}
              >
                {(id) => (
                  <Select
                    id={id}
                    value={settings.textModel}
                    onChange={(event) => updateSettings({ textModel: event.target.value })}
                    disabled={!catalogues.textModels.length}
                    options={
                      catalogues.textModels.length
                        ? catalogues.textModels.map((model) => ({
                            value: model.id,
                            label: model.id === "claude-opus-4-8" ? `${model.label} (Recommended)` : model.label,
                          }))
                        : [{ value: "", label: catalogues.loading ? "Loading…" : "Unavailable" }]
                    }
                  />
                )}
              </Field>
            ) : null}

            {showImage ? (
              <>
                <div className="space-y-2">
                  <Field label="Image provider" hint={providerNote(capabilities, settings.imageProvider)}>
                    {(id) => (
                      <Select
                        id={id}
                        value={settings.imageProvider}
                        onChange={(event) =>
                          updateSettings({
                            imageProvider: event.target.value as typeof settings.imageProvider,
                            imageModel: "",
                          })
                        }
                        options={[
                          { value: "puter", label: "Puter (primary)" },
                          { value: "pollinations", label: "Pollinations" },
                        ]}
                      />
                    )}
                  </Field>
                  {settings.imageProvider === "puter" ? <PuterConnection /> : null}
                </div>

                <Field label="Image model" hint={catalogues.notices[settings.imageProvider]}>
                  {(id) => (
                    <Select
                      id={id}
                      value={settings.imageModel}
                      onChange={(event) => updateSettings({ imageModel: event.target.value })}
                      options={[
                        { value: "", label: "Auto — best available" },
                        ...imageModels.map((model) => ({ value: model.id, label: model.label })),
                      ]}
                    />
                  )}
                </Field>

                {mode === "image" ? (
                  <>
                    <Field label="Dimensions">
                      {(id) => (
                        <Select
                          id={id}
                          value={settings.imageSize}
                          onChange={(event) => updateSettings({ imageSize: event.target.value })}
                          options={IMAGE_SIZES.map((size) => ({ value: size.value, label: size.label }))}
                        />
                      )}
                    </Field>
                    <Field label="Style">
                      {(id) => (
                        <Select
                          id={id}
                          value={settings.imageStyle}
                          onChange={(event) =>
                            updateSettings({ imageStyle: event.target.value as typeof settings.imageStyle })
                          }
                          options={STYLE_OPTIONS}
                        />
                      )}
                    </Field>
                  </>
                ) : null}
              </>
            ) : null}

            {showVoice ? (
              <>
                <Field
                  label="Language / Accent"
                  hint={
                    catalogues.languages.length
                      ? undefined
                      : (catalogues.notices.cartesia ?? "Voices unavailable.")
                  }
                >
                  {(id) => (
                    <Select
                      id={id}
                      value={settings.language}
                      onChange={(event) => {
                        const language = event.target.value;
                        // Voices are language-specific, so move to one that speaks it.
                        const match = catalogues.voices.find((voice) =>
                          [voice.language, ...(voice.languages ?? [])].includes(language),
                        );
                        updateSettings({ language, voiceId: match?.id ?? settings.voiceId });
                      }}
                      disabled={!catalogues.languages.length}
                      options={
                        catalogues.languages.length
                          ? catalogues.languages.map((code) => ({
                              value: code,
                              label: languageLabel(code),
                            }))
                          : [{ value: settings.language, label: catalogues.loading ? "Loading…" : "Unavailable" }]
                      }
                    />
                  )}
                </Field>

                <Field label="Narration voice">
                  {(id) => (
                    <Select
                      id={id}
                      value={settings.voiceId}
                      onChange={(event) => updateSettings({ voiceId: event.target.value })}
                      disabled={!voiceOptions.length}
                      options={
                        voiceOptions.length
                          ? voiceOptions
                          : [{ value: "", label: catalogues.loading ? "Loading…" : "Unavailable" }]
                      }
                    />
                  )}
                </Field>

                <Field label={`Pacing speed · ${settings.speed.toFixed(2)}×`}>
                  {(id) => (
                    <Slider
                      id={id}
                      min={0.6}
                      max={1.5}
                      step={0.05}
                      value={settings.speed}
                      onChange={(event) => updateSettings({ speed: Number(event.target.value) })}
                    />
                  )}
                </Field>
              </>
            ) : null}

            {mode === "create" ? (
              <>
                <Field
                  label="Video engine & style"
                  hint={
                    settings.videoStyle === "hyperframes"
                      ? "Modern kinetic typography, Ken Burns cinematic motion graphics & glass HUD."
                      : "Hand-drawn doodle whiteboard with live chisel-tip marker animation."
                  }
                >
                  {(id) => (
                    <Select
                      id={id}
                      value={settings.videoStyle}
                      onChange={(event) =>
                        updateSettings({ videoStyle: event.target.value as typeof settings.videoStyle })
                      }
                      options={[
                        { value: "whiteboard", label: "Hand-Drawn Whiteboard" },
                        { value: "hyperframes", label: "Modern Video (Hyperframes)" },
                      ]}
                    />
                  )}
                </Field>

                {settings.videoStyle === "whiteboard" ? (
                  <Field
                    label="Scene visual style"
                    hint={
                      settings.sceneArt === "scene"
                        ? "Hand-drawn vector marker diagrams with live pen strokes."
                        : settings.sceneArt === "hybrid"
                          ? "Hybrid: Diagrams + AI picturized art on the board."
                          : "AI Pictorize: Full-scene AI whiteboard illustrations."
                    }
                  >
                    {(id) => (
                      <Select
                        id={id}
                        value={settings.sceneArt}
                        onChange={(event) =>
                          updateSettings({ sceneArt: event.target.value as typeof settings.sceneArt })
                        }
                        options={[
                          { value: "scene", label: "Drawn Whiteboard (Marker)" },
                          { value: "hybrid", label: "Hybrid (Diagrams + AI Art)" },
                          { value: "image", label: "AI Pictorize (Image)" },
                        ]}
                      />
                    )}
                  </Field>
                ) : null}
                <Field label={`Scenes count · ${settings.sceneCount}`}>
                  {(id) => (
                    <Slider
                      id={id}
                      min={1}
                      max={8}
                      step={1}
                      value={settings.sceneCount}
                      onChange={(event) => updateSettings({ sceneCount: Number(event.target.value) })}
                    />
                  )}
                </Field>
                <Field label="Script tone">
                  {(id) => (
                    <Select
                      id={id}
                      value={settings.tone}
                      onChange={(event) =>
                        updateSettings({ tone: event.target.value as typeof settings.tone })
                      }
                      options={[
                        { value: "explainer", label: "In-Depth Explainer" },
                        { value: "lesson", label: "Masterclass Lesson" },
                        { value: "story", label: "Story & Narrative" },
                        { value: "advert", label: "High-Impact Commercial" },
                      ]}
                    />
                  )}
                </Field>
                <Field label={`Voice lead-in delay · ${settings.voiceDelay.toFixed(1)}s`}>
                  {(id) => (
                    <Slider
                      id={id}
                      min={0}
                      max={1.5}
                      step={0.1}
                      value={settings.voiceDelay}
                      onChange={(event) => updateSettings({ voiceDelay: Number(event.target.value) })}
                    />
                  )}
                </Field>
                <Field label={`Intro title card · ${settings.introDuration.toFixed(1)}s`}>
                  {(id) => (
                    <Slider
                      id={id}
                      min={1.5}
                      max={5}
                      step={0.5}
                      value={settings.introDuration}
                      onChange={(event) => updateSettings({ introDuration: Number(event.target.value) })}
                    />
                  )}
                </Field>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function providerNote(
  capabilities: ReturnType<typeof useStudio>["capabilities"],
  provider: string,
): string | undefined {
  return capabilities?.image.providers.find((entry) => entry.id === provider)?.note;
}
