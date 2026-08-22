"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { generateImage } from "@/lib/ai/image/client";
import { castVoice } from "./casting";
import { renderThumbnail } from "@/components/whiteboard/thumbnail";
import type { SceneSpec } from "@/lib/whiteboard/scene";
import type { ImageStyle, ModelInfo, VoiceInfo } from "@/lib/ai/types";
import {
  ApiError,
  createStoryboard,
  curateVisual,
  fetchCapabilities,
  fetchCatalogue,
  generateScene,
  generateServerImage,
  generateSpeech,
  generateText,
  streamText,
  type Capabilities,
} from "./api";
import { cacheGeneration, hydrateGeneration, loadHistory, saveGeneration } from "./history";
import {
  DEFAULT_SETTINGS,
  parseSize,
  type AudioAsset,
  type Generation,
  type ImageAsset,
  type Mode,
  type ProjectAsset,
  type SceneAsset,
  type Settings,
} from "./types";

const SETTINGS_KEY = "whiteboard-studio:settings:v1";

interface Catalogues {
  textModels: ModelInfo[];
  imageModels: Record<string, ModelInfo[]>;
  voices: VoiceInfo[];
  languages: string[];
  notices: Record<string, string | undefined>;
  loading: boolean;
}

interface StudioValue {
  mode: Mode;
  setMode: (mode: Mode) => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  capabilities: Capabilities | null;
  catalogues: Catalogues;
  current: Generation | null;
  history: Generation[];
  /** False until the stored history has been read back out of IndexedDB. */
  historyLoaded: boolean;
  running: boolean;
  run: (override?: { prompt?: string; mode?: Mode }) => Promise<void>;
  cancel: () => void;
  openGeneration: (generation: Generation) => void;
  reuse: (generation: Generation) => void;
  refreshHistory: () => void;
  /** Writes an edited project back into history. Persisting is debounced. */
  updateProject: (generationId: string, project: ProjectAsset) => void;
}

const StudioContext = createContext<StudioValue | null>(null);

export function useStudio(): StudioValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudio must be used inside <StudioProvider>");
  return value;
}

function readSettings(): Settings {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Reads a clip's real length so the whiteboard can time scenes against it. */
function measureDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const settle = (value?: number) => {
      audio.removeAttribute("src");
      resolve(Number.isFinite(value) && (value ?? 0) > 0 ? value : undefined);
    };
    audio.addEventListener("loadedmetadata", () => settle(audio.duration), { once: true });
    audio.addEventListener("error", () => settle(undefined), { once: true });
    setTimeout(() => settle(undefined), 8_000);
    audio.preload = "metadata";
    audio.src = url;
  });
}

function messageFor(err: unknown): { code: string; message: string } {
  if (err instanceof ApiError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: "unknown", message: err.message };
  return { code: "unknown", message: "Something went wrong." };
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("create");
  const [prompt, setPrompt] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [current, setCurrent] = useState<Generation | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [catalogues, setCatalogues] = useState<Catalogues>({
    textModels: [],
    imageModels: {},
    voices: [],
    languages: [],
    notices: {},
    loading: true,
  });

  const abortRef = useRef<AbortController | null>(null);

  /* ------------------------------ bootstrapping ----------------------------- */

  useEffect(() => {
    // Persisted browser state is read once after mount rather than during
    // render, so the server-rendered markup stays deterministic. That is
    // exactly the cascading-render the rule guards against, and it is the
    // point here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(readSettings());
    void (async () => {
      const stored = loadHistory();
      const hydrated = await Promise.all(stored.map(hydrateGeneration));
      setHistory(hydrated);
      setHistoryLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* non-fatal */
    }
  }, [settings]);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      const [caps, text, puterImages, pollinationsImages, voice] = await Promise.all([
        fetchCapabilities(controller.signal),
        fetchCatalogue("omega", controller.signal),
        fetchCatalogue("puter", controller.signal),
        fetchCatalogue("pollinations", controller.signal),
        fetchCatalogue("voice", controller.signal),
      ]);
      if (controller.signal.aborted) return;

      setCapabilities(caps);
      setCatalogues({
        textModels: text.models ?? [],
        imageModels: {
          puter: puterImages.models ?? [],
          pollinations: pollinationsImages.models ?? [],
        },
        voices: voice.voices ?? [],
        languages: voice.languages ?? [],
        notices: {
          omega: text.notice,
          puter: puterImages.notice,
          pollinations: pollinationsImages.notice,
          voice: voice.notice,
        },
        loading: false,
      });

      // Defaults come from the live catalogues, prioritizing Opus 4.8 and Indian TTS
      setSettings((previous) => {
        const next = { ...previous };
        if (!next.textModel && text.models?.length) {
          const opus48 = text.models.find((m) => m.id === "claude-opus-4-8");
          next.textModel = opus48?.id ?? text.models[0].id;
        }
        // A saved voice id from another engine will not resolve here, so the
        // default is re-picked whenever the current one is not in the list.
        const known = voice.voices?.some((entry) => entry.id === next.voiceId);
        if (voice.voices?.length && (!next.voiceId || !known)) {
          const preferred =
            voice.voices.find((entry) => entry.id === "aura-2-hera-en") ??
            voice.voices.find((entry) => entry.isIndian || entry.language === "en-IN") ??
            voice.voices.find((entry) => [entry.language, ...(entry.languages ?? [])].includes("en"));
          next.voiceId = (preferred ?? voice.voices[0]).id;
        }
        return next;
      });
    })();

    return () => controller.abort();
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  const refreshHistory = useCallback(() => {
    void (async () => {
      const hydrated = await Promise.all(loadHistory().map(hydrateGeneration));
      setHistory(hydrated);
      setHistoryLoaded(true);
    })();
  }, []);

  /* -------------------------------- editing --------------------------------- */

  const editTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const editDrafts = useRef(new Map<string, ProjectAsset>());
  const editVersions = useRef(new Map<string, number>());

  /**
   * An edited project.
   *
   * The screen updates immediately; the write to localStorage waits, because a
   * person typing into a narration box would otherwise re-serialise the whole
   * video on every keystroke. The flush goes through `cacheGeneration`, which
   * skips assets that already carry a cacheKey and copies newly generated ones
   * into IndexedDB -- without that, an image regenerated in the editor dies
   * with the next server restart.
   */
  const updateProject = useCallback((generationId: string, project: ProjectAsset) => {
    editDrafts.current.set(generationId, project);
    const version = (editVersions.current.get(generationId) ?? 0) + 1;
    editVersions.current.set(generationId, version);

    setCurrent((previous) =>
      previous && previous.id === generationId ? { ...previous, project } : previous,
    );
    setHistory((previous) =>
      previous.map((entry) => (entry.id === generationId ? { ...entry, project } : entry)),
    );

    const timers = editTimers.current;
    const existing = timers.get(generationId);
    if (existing) clearTimeout(existing);

    timers.set(
      generationId,
      setTimeout(() => {
        timers.delete(generationId);
        const draft = editDrafts.current.get(generationId);
        editDrafts.current.delete(generationId);
        if (!draft) return;

        void (async () => {
          const stored = loadHistory().find((entry) => entry.id === generationId);
          if (!stored) return;
          const cached = await cacheGeneration({ ...stored, project: draft });
          // Caching downloads bytes, so a fast typist can have moved on since
          // this flush started. Writing a stale project back would undo them.
          if (editVersions.current.get(generationId) !== version) return;
          setHistory(saveGeneration(cached));
          setCurrent((previous) => (previous?.id === generationId ? cached : previous));
        })();
      }, 400),
    );
  }, []);

  useEffect(() => {
    const timers = editTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  /* --------------------------------- runners -------------------------------- */

  const commit = useCallback(async (generation: Generation) => {
    const cached = await cacheGeneration(generation);
    setCurrent(cached);
    setHistory(saveGeneration(cached));
  }, []);

  const run = useCallback(
    async (override?: { prompt?: string; mode?: Mode }) => {
      const activeMode = override?.mode ?? mode;
      const activePrompt = (override?.prompt ?? prompt).trim();
      if (!activePrompt || running) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      const started = Date.now();
      const generation: Generation = {
        id: newId(),
        mode: activeMode,
        prompt: activePrompt,
        createdAt: started,
        status: "running",
        stage: "Starting",
        progress: 0,
        meta: {},
      };

      setRunning(true);
      setCurrent(generation);

      const patch = (update: Partial<Generation>) => {
        Object.assign(generation, update);
        setCurrent({ ...generation });
      };

      const { width, height } = parseSize(settings.imageSize);
      const style = settings.imageStyle as ImageStyle | "auto";

      try {
        switch (activeMode) {
          case "write": {
            patch({ stage: "Writing", text: "" });
            let streamed = "";
            const result = await streamText(
              { prompt: activePrompt, model: settings.textModel || undefined },
              (delta) => {
                streamed += delta;
                patch({ text: streamed, stage: "Writing" });
              },
              signal,
            );
            patch({
              status: "done",
              stage: undefined,
              progress: 1,
              text: result.text,
              meta: { model: result.model, provider: result.provider, durationMs: Date.now() - started },
            });
            break;
          }

          case "image": {
            const image = await generateImage({
              prompt: activePrompt,
              provider: settings.imageProvider,
              model: settings.imageModel || undefined,
              width,
              height,
              style,
              onStage: (stage) => patch({ stage }),
              signal,
            });
            patch({
              status: "done",
              stage: undefined,
              progress: 1,
              image,
              meta: {
                provider: image.provider,
                imageModel: image.model,
                durationMs: Date.now() - started,
              },
            });
            break;
          }

          case "voice": {
            let transcript = activePrompt;

            if (settings.voiceSource === "script") {
              patch({ stage: "Writing the script", progress: 0.15 });
              const written = await generateText(
                {
                  prompt: activePrompt,
                  systemPrompt:
                    "Write narration to be read aloud. Plain spoken sentences only: no markdown, no headings, no bullet points, no stage directions, no emoji. Aim for 60-120 words unless the request implies otherwise.",
                  model: settings.textModel || undefined,
                },
                signal,
              );
              transcript = written.text;
              patch({ text: transcript, meta: { ...generation.meta, model: written.model } });
            }

            patch({ stage: "Recording narration", progress: 0.6 });
            const speech = await generateSpeech(
              {
                transcript,
                voiceId: settings.voiceId,
                language: settings.language || undefined,
                speed: settings.speed,
              },
              signal,
            );
            const duration = speech.duration ?? (await measureDuration(speech.audioUrl));

            patch({
              status: "done",
              stage: undefined,
              progress: 1,
              text: settings.voiceSource === "script" ? transcript : undefined,
              audio: {
                url: speech.audioUrl,
                provider: speech.provider,
                model: speech.model,
                voiceId: speech.voiceId,
                language: settings.language,
                duration,
                words: speech.words,
              },
              meta: {
                ...generation.meta,
                provider: speech.provider,
                voiceId: speech.voiceId,
                language: settings.language,
                durationMs: Date.now() - started,
              },
            });
            break;
          }

          case "create": {
            patch({ stage: "Planning the video", progress: 0.05 });
            const plan = await createStoryboard(
              {
                prompt: activePrompt,
                model: settings.textModel || undefined,
                sceneCount: settings.sceneCount,
                language: settings.language || undefined,
                tone: settings.tone,
                videoStyle: settings.videoStyle,
              },
              signal,
            );

            // One art direction, prefixed onto every frame: six shots that
            // share a palette and a lens read as one film, and six that do not
            // read as six stock pictures in a row.
            const artDirection = plan.storyboard.visual_style?.trim();
            const theme = plan.storyboard.visual_theme ?? "studio-dark";

            /**
             * The narrator the director asked for.
             *
             * A brief is matched against the live catalogue rather than a
             * voice being named outright, so the choice survives swapping the
             * whole speech provider. A voice the user has explicitly picked
             * always wins.
             */
            const voiceId = castVoice({
              brief: plan.storyboard.voice_brief,
              catalogue: catalogues.voices,
              language: settings.language || "en",
              current: settings.voiceId,
              pinned: settings.voicePinned,
            });

            const scenes: SceneAsset[] = plan.storyboard.scenes.map((scene) => ({
              heading: scene.heading,
              bullets: scene.bullets,
              narration: scene.narration,
              imagePrompt: artDirection
                ? `${artDirection} ${scene.image_prompt}`
                : scene.image_prompt,
              photoQuery: scene.photo_query,
              supportVisual: scene.support_visual,
              status: "pending",
              keywords: scene.keywords,
              stat: scene.stat,
              statCaption: scene.stat_caption,
              visualTheme: theme,
            }));

            patch({
              stage: settings.videoStyle === "hyperframes" ? "Synthesizing modern scenes" : "Drawing the board",
              progress: 0.15,
              project: {
                ...plan.storyboard,
                scenes,
                videoStyle: settings.videoStyle,
                introDuration: settings.introDuration ?? 3.0,
                voiceDelay: settings.voiceDelay ?? 0.6,
                musicMood: plan.storyboard.music_mood ?? "calm",
              },
              meta: { model: plan.model, provider: plan.provider, usage: plan.usage },
            });

            // Every asset request is one unit of progress: scenes get a visual
            // and a voice track each, plus the cover.
            const totalSteps = scenes.length * (settings.sceneArt === "hybrid" ? 3 : 2);
            let completed = 0;
            const step = (stage: string) => {
              completed += 1;
              patch({ stage, progress: 0.15 + 0.85 * (completed / totalSteps) });
            };

            const drawImage = async (imagePrompt: string): Promise<ImageAsset | undefined> => {
              try {
                const made = await generateImage({
                  prompt: imagePrompt,
                  provider: settings.imageProvider,
                  model: settings.imageModel || undefined,
                  width: 1280,
                  height: 720,
                  // A modern scene is a shot, so its plate is a photograph
                  // unless the user has deliberately asked for something else.
                  style:
                    settings.videoStyle === "hyperframes"
                      ? settings.imageStyle === "auto"
                        ? "photorealistic"
                        : settings.imageStyle
                      : "whiteboard",
                  enhance: false,
                  signal,
                });
                return { ...made, kind: "drawn" as const };
              } catch (err) {
                console.warn("Client image generation failed, trying server fallback:", err);
                try {
                  const fallback = await generateServerImage(
                    {
                      prompt: imagePrompt,
                      width: 1280,
                      height: 720,
                      style:
                        settings.videoStyle === "hyperframes"
                          ? settings.imageStyle === "auto"
                            ? "photorealistic"
                            : settings.imageStyle
                          : "whiteboard",
                      enhance: false,
                    },
                    signal,
                  );
                  return { ...fallback.image, kind: "drawn" as const, promptUsed: fallback.prompt.used };
                } catch (fallbackErr) {
                  console.warn("Server image fallback failed:", fallbackErr);
                  return undefined;
                }
              }
            };

            /**
             * Scene artwork.
             * In "hyperframes" mode: cinematic images and kinetic typography.
             * In "whiteboard" mode: composed vector layouts, AI images, or hybrid.
             */
            const usedLayouts: string[] = [];

            /**
             * A real photograph for a modern scene.
             *
             * Generated art gives you something that looks like the idea;
             * a photograph gives you the thing itself, which is most of what
             * separates a video from a slide deck. It is searched, downloaded
             * and then actually looked at by the model before it is used, and
             * anything that fails falls through to generation.
             */
            const findPhoto = async (
              scene: SceneAsset,
            ): Promise<{ image?: ImageAsset; note?: string }> => {
              const query = scene.photoQuery?.trim() || [scene.heading, ...(scene.keywords ?? [])].join(" ");
              if (!query) return {};

              try {
                const found = await curateVisual(
                  {
                    brief: `${scene.heading}. ${scene.narration}`.slice(0, 560),
                    query,
                    model: settings.textModel || undefined,
                  },
                  signal,
                );
                if (found.image) {
                  return {
                    image: { ...found.image, kind: "photo" as const, promptUsed: query },
                    note: found.reason,
                  };
                }
                return { note: found.reason };
              } catch (err) {
                if (signal.aborted) throw err;
                console.warn("Photo search failed, generating instead:", err);
                return {};
              }
            };

            const buildScene = async (
              scene: SceneAsset,
            ): Promise<{ scene?: SceneSpec; image?: ImageAsset; note?: string }> => {
              if (settings.videoStyle === "hyperframes") {
                // Same casting as the board: the director decides whether this
                // shot's plate is real or drawn, and a failed search falls
                // through to generation rather than to an empty frame.
                const wants =
                  settings.modernArt === "generated"
                    ? "generated"
                    : (scene.supportVisual ?? "photo");

                if (wants === "none") return {};

                if (wants === "photo" && (scene.photoQuery?.trim() || scene.heading)) {
                  const photo = await findPhoto(scene);
                  if (photo.image) return { image: photo.image, note: photo.note };
                  const generated = await drawImage(scene.imagePrompt);
                  return {
                    image: generated,
                    note: photo.note ? `${photo.note} — generated instead` : undefined,
                  };
                }

                const img = await drawImage(scene.imagePrompt);
                return { image: img };
              }

              if (settings.sceneArt === "image") {
                const img = await drawImage(scene.imagePrompt);
                return { image: img };
              }

              const brief = [
                `Heading: ${scene.heading}`,
                scene.bullets.length ? `Key points: ${scene.bullets.join("; ")}` : "",
                `Narration: ${scene.narration}`,
              ]
                .filter(Boolean)
                .join("\n");

            const layOut = (hasPhoto: boolean) =>
                generateScene(
                  {
                    brief,
                    usedLayouts: [...usedLayouts],
                    hasPhoto,
                    model: settings.textModel || undefined,
                  },
                  signal,
                ).then((res) => {
                  usedLayouts.push(res.scene.layout);
                  return res.scene;
                });

              if (settings.sceneArt === "hybrid") {
                const img = await drawImage(scene.imagePrompt);
                return { scene: await layOut(Boolean(img)), image: img };
              }

              // Every board is drawn. What shares it with the drawing is the
              // director's call, scene by scene: a real photograph where the
              // subject exists, a marker illustration where it does not, and
              // nothing at all when the diagram already says it.
              //
              // The picture is settled before the layout, because the board
              // has to be composed knowing whether it has the full width or
              // only the column beside the image.
              if (settings.sceneArt === "rich") {
                const wants = scene.supportVisual ?? (scene.photoQuery ? "photo" : "generated");
                let image: ImageAsset | undefined;
                let note: string | undefined;

                if (wants === "photo" && scene.photoQuery?.trim()) {
                  const photo = await findPhoto(scene);
                  image = photo.image;
                  note = photo.note;
                }
                // Generated marker artwork needs an image model that can do
                // line art. Without one the board is better off with just its
                // own drawing than with a stock photo of a meeting room.
                const canDrawArt =
                  capabilities?.image.providers.find((entry) => entry.id === settings.imageProvider)
                    ?.lineArt ?? false;

                if (!image && wants !== "none" && canDrawArt) {
                  image = await drawImage(scene.imagePrompt);
                  if (note) note = `${note} — drew it instead`;
                } else if (!image && wants !== "none") {
                  note = note
                    ? `${note} — no line-art model configured`
                    : "Add POLLINATIONS_API_KEY for generated marker artwork.";
                }

                return { scene: await layOut(Boolean(image)), image, note };
              }

              return { scene: await layOut(false) };
            };

            const speak = async (narration: string): Promise<AudioAsset> => {
              const speech = await generateSpeech(
                {
                  transcript: narration,
                  voiceId,
                  language: settings.language || undefined,
                  speed: settings.speed,
                },
                signal,
              );
              return {
                url: speech.audioUrl,
                provider: speech.provider,
                model: speech.model,
                voiceId: speech.voiceId,
                language: settings.language,
                // The server knows the exact length when it built the WAV
                // itself; only the mp3 fallback has to be measured here.
                duration: speech.duration ?? (await measureDuration(speech.audioUrl)),
                words: speech.words,
              };
            };

            const project = generation.project!;

            // Boards are laid out one after another so each one can be told
            // which layout the previous scene used and pick a different one.
            for (const [index, scene] of scenes.entries()) {
              if (signal.aborted) break;
              project.scenes[index].status = "running";
              patch({ project: { ...project, scenes: [...project.scenes] } });

              const [art, audio] = await Promise.allSettled([
                buildScene(scene),
                speak(scene.narration),
              ]);

              const target = project.scenes[index];
              if (art.status === "fulfilled") {
                target.scene = art.value.scene;
                target.image = art.value.image;
                target.imageNote = art.value.note;
              }
              if (audio.status === "fulfilled") target.audio = audio.value;

              const problems = [art, audio]
                .filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
                .map((entry) => messageFor(entry.reason).message);

              const hasArt = Boolean(target.scene || target.image);
              target.status =
                settings.videoStyle === "hyperframes"
                  ? target.heading
                    ? "done"
                    : "error"
                  : problems.length && !hasArt && !target.audio
                    ? "error"
                    : "done";
              if (problems.length) target.error = problems[0];

              step(`Scene ${index + 1} ready`);
              patch({ project: { ...project, scenes: [...project.scenes] } });
            }

            if (signal.aborted) throw new DOMException("Aborted", "AbortError");

            const usable = project.scenes.filter(
              (scene) => scene.heading || scene.scene || scene.image || scene.audio,
            );
            if (!usable.length) {
              throw new ApiError(
                "provider_error",
                "None of the scenes could be generated. Check the provider settings and try again.",
              );
            }

            // Poster frame: rendered from the finished title card, so history
            // and the recent strip have a real thumbnail rather than an icon.
            if (!project.cover) {
              const thumbnail = renderThumbnail({
                title: project.title,
                description: project.description,
                videoStyle: settings.videoStyle,
              });
              if (thumbnail) {
                project.cover = {
                  url: thumbnail.url,
                  provider: "sketch",
                  model: "composed board",
                  width: thumbnail.width,
                  height: thumbnail.height,
                  canvasSafe: true,
                };
              }
            }

            patch({
              status: "done",
              stage: undefined,
              progress: 1,
              project: { ...project, scenes: [...project.scenes] },
              meta: {
                ...generation.meta,
                imageModel:
                  settings.videoStyle === "whiteboard" && settings.sceneArt === "scene"
                    ? "composed board"
                    : project.scenes.find((s) => s.image)?.image?.model,
                voiceId,
                language: settings.language,
                durationMs: Date.now() - started,
              },
            });
            break;
          }
        }

        await commit({ ...generation });
      } catch (err) {
        if (signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          setCurrent(null);
          return;
        }
        const error = messageFor(err);
        const failed: Generation = {
          ...generation,
          status: "error",
          stage: undefined,
          error,
          meta: { ...generation.meta, durationMs: Date.now() - started },
        };
        setCurrent(failed);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setRunning(false);
      }
    },
    [capabilities, catalogues.voices, commit, mode, prompt, running, settings],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setCurrent(null);
  }, []);

  const openGeneration = useCallback((generation: Generation) => {
    setCurrent(generation);
    setMode(generation.mode);
  }, []);

  const reuse = useCallback((generation: Generation) => {
    setPrompt(generation.prompt);
    setMode(generation.mode);
  }, []);

  const value = useMemo<StudioValue>(
    () => ({
      mode,
      setMode,
      prompt,
      setPrompt,
      settings,
      updateSettings,
      capabilities,
      catalogues,
      current,
      history,
      historyLoaded,
      running,
      run,
      cancel,
      openGeneration,
      reuse,
      refreshHistory,
      updateProject,
    }),
    [
      mode,
      prompt,
      settings,
      updateSettings,
      capabilities,
      catalogues,
      current,
      history,
      historyLoaded,
      running,
      run,
      cancel,
      openGeneration,
      reuse,
      refreshHistory,
      updateProject,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}
