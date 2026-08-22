"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Loader2,
  Maximize2,
  Music,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { ProjectAsset, SceneAsset } from "@/lib/studio/types";
import { clamp01, range, smootherstep } from "@/lib/video/easing";
import { resolveWordTimings, type WordTiming } from "@/lib/video/timing";
import { BOARD_HEIGHT, BOARD_WIDTH, renderCover, renderFrame, renderOutro } from "./renderer";
import {
  planModernScene,
  renderModernCover,
  renderModernScene,
  type ModernPlan,
} from "@/lib/hyperframes/modern-renderer";
import { disposeScene, planSceneCues, prepareScene, type PreparedScene } from "./scene-render";
import type { Cue } from "@/lib/video/timing";
import { useBoardImages } from "./use-board-images";
import { extensionFor, pickMimeType, startRecording } from "./use-recorder";
import { canExportOffline, exportVideoFile, type AudioPlacement } from "@/lib/video/export";
import { buildScore } from "@/lib/video/score";
import { scheduleMusic, type MusicMood } from "@/lib/video/music";
import { scheduleSfx } from "@/lib/video/sfx";

/**
 * The player.
 *
 * Two things here matter more than the rest.
 *
 * The clock is the narration. A scene advances on its own virtual time, but
 * every frame that time is nudged back toward `audio.currentTime` — so the
 * drawing cannot drift away from the voice over a two-minute video, no matter
 * how long the browser stalls or how late the audio element decides to start.
 *
 * The schedule is built once. Each scene's board geometry, cue plan and
 * subtitle phrases are prepared up front, which is why scrubbing is instant
 * and why the exported recording is frame-for-frame what was previewed.
 */

/** Seconds a scene holds when there is no narration to time against. */
function estimateDuration(narration: string): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(4.5, Math.min(24, words / 2.6 + 1.2));
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

/** Resolves the CSS font tokens into families the canvas can address. */
function readFonts(): { hand: string; sans: string } {
  if (typeof document === "undefined") return { hand: "cursive", sans: "sans-serif" };
  const styles = getComputedStyle(document.documentElement);
  const hand = styles.getPropertyValue("--font-hand").trim();
  const sans = styles.getPropertyValue("--font-geist-sans").trim();
  return {
    hand: hand ? `${hand}, cursive` : "cursive",
    sans: sans ? `${sans}, sans-serif` : "sans-serif",
  };
}

const DEFAULT_COVER_SECONDS = 3.2;
const DEFAULT_VOICE_DELAY = 0.5;
/** Hold after the voice stops, before the scene hands over. */
const TAIL_SECONDS = 0.62;
/** Past this much drift the clock snaps instead of easing. */
const HARD_RESYNC = 0.28;
/**
 * The closing card, restating the point in one sentence.
 *
 * Not decoration: a viewer who has followed four diagrams still needs to be
 * told plainly what they add up to.
 */
const OUTRO_SECONDS = 4.2;
/**
 * Frame rate of the exported file.
 *
 * 30 is the standard for this kind of explainer and halves both the encode
 * time and the file size. The motion here is slow and eased, so the extra
 * frames of 60 buy very little that a viewer would notice.
 */
const EXPORT_FPS = 30;

interface SceneSchedule {
  /** Silence before the voice starts. */
  lead: number;
  /** Length of the narration clip. */
  speech: number;
  tail: number;
  duration: number;
  words: WordTiming[];
  board: PreparedScene | null;
  cues: Cue[];
  modern: ModernPlan | null;
}

export function WhiteboardPlayer({
  project,
  className,
}: {
  project: ProjectAsset;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRefs = useRef<Array<HTMLAudioElement | null>>([]);
  const clockRef = useRef({ index: -1, time: 0, last: 0 });
  const exportAbortRef = useRef<AbortController | null>(null);
  const scoreRef = useRef<{ context: AudioContext; bus: GainNode } | null>(null);
  const exportGraphRef = useRef<{
    context: AudioContext;
    destination: MediaStreamAudioDestinationNode;
    sources: WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>;
  } | null>(null);

  const coverDuration = project.introDuration ?? DEFAULT_COVER_SECONDS;
  const voiceDelay = project.voiceDelay ?? DEFAULT_VOICE_DELAY;
  const isHyperframes = project.videoStyle === "hyperframes";

  const scenes = useMemo(
    () => project.scenes.filter((scene) => scene.scene || scene.image || scene.audio || scene.heading),
    [project.scenes],
  );

  const { images, ready } = useBoardImages(scenes.map((scene) => scene.image?.url));

  /* -------------------------------- schedule -------------------------------- */

  // Geometry, cue plans and subtitle phrases are all derived once. Everything
  // downstream is then a pure lookup, which is what keeps a scrub instant.
  const schedule = useMemo<SceneSchedule[]>(() => {
    if (typeof document === "undefined") return [];

    return scenes.map((scene, index) => {
      const speech = scene.audio?.duration && scene.audio.duration > 0
        ? scene.audio.duration
        : estimateDuration(scene.narration);

      // Cartesia clips open with a beat of silence of their own. Counting the
      // configured lead-in on top of it would leave the board blank for a
      // second and a half, so the clip's own silence is spent as the lead and
      // only the shortfall is added.
      const opening = scene.audio?.words?.[0]?.start ?? 0;
      const lead = scene.audio?.url
        ? Math.max(0, voiceDelay - opening)
        : Math.min(voiceDelay, 0.25);
      const tail = TAIL_SECONDS;
      const duration = lead + speech + tail;
      const words = resolveWordTimings(scene.narration, speech, scene.audio?.words);

      // The board is composed knowing whether a photograph is coming, so it
      // lays itself out in the narrower column rather than being covered.
      const board =
        !isHyperframes && scene.scene
          ? prepareScene(scene.scene, { photo: Boolean(scene.image?.url) })
          : null;
      const timing = { lead, speech, tail };

      return {
        lead,
        speech,
        tail,
        duration,
        words,
        board,
        cues: board
          ? planSceneCues(board, words, timing)
          : // Bitmap-only boards still need a cue for the heading.
            planSceneCues({ beats: [], title: null, photoBox: null }, words, timing),
        modern: isHyperframes
          ? planModernScene(
              {
                heading: scene.heading,
                bullets: scene.bullets,
                narration: scene.narration,
                image: images[index] ?? null,
                index,
                totalScenes: scenes.length,
                keywords: scene.keywords,
                stat: scene.stat,
                statCaption: scene.statCaption,
                visualTheme: scene.visualTheme,
              },
              words,
              timing,
            )
          : null,
      };
    });
    // `images` only swaps the bitmap a plan points at, never the plan's timing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, voiceDelay, isHyperframes]);

  useEffect(
    () => () => {
      for (const entry of schedule) if (entry.board) disposeScene(entry.board);
    },
    [schedule],
  );

  const durations = useMemo(() => schedule.map((entry) => entry.duration), [schedule]);

  const outroDuration = project.description?.trim() ? OUTRO_SECONDS : 0;

  const total = useMemo(
    () => coverDuration + durations.reduce((sum, value) => sum + value, 0) + outroDuration,
    [coverDuration, durations, outroDuration],
  );

  const [sceneIndex, setSceneIndex] = useState(-1); // -1 is the cover card
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  /** Music and effects, separate from the narration. */
  const [soundOn, setSoundOn] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStage, setExportStage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [fonts, setFonts] = useState(readFonts);

  const mimeType = useMemo(() => (typeof window === "undefined" ? null : pickMimeType()), []);
  /** WebCodecs renders the file; without it we are back to recording it. */
  const offlineExport = useMemo(() => canExportOffline(), []);
  /** The bed the director asked for, if any. */
  const musicMood: MusicMood = (project.musicMood as MusicMood) ?? "calm";

  /**
   * The sound score.
   *
   * Built from the same cue plan that drives the picture, so an effect cannot
   * drift from the beat it belongs to -- they are the same number.
   */
  const score = useMemo(() => {
    let cursor = coverDuration;
    const scored = schedule.map((entry, index) => {
      const start = cursor;
      cursor += entry.duration;
      return {
        start,
        duration: entry.duration,
        lead: entry.lead,
        speech: entry.speech,
        cues: entry.modern ? entry.modern.beats : entry.cues,
        statAt: entry.modern?.stat?.at ?? null,
        hasNarration: Boolean(scenes[index]?.audio?.url),
      };
    });

    return buildScore({
      coverDuration,
      scenes: scored,
      style: isHyperframes ? "hyperframes" : "whiteboard",
      intensity: soundOn ? 1 : 0,
    });
  }, [coverDuration, isHyperframes, schedule, scenes, soundOn]);


  /* --------------------------------- fonts --------------------------------- */

  useEffect(() => {
    let cancelled = false;
    // The canvas silently substitutes a fallback if the face isn't loaded yet,
    // so wait for the marker font before trusting the first paint.
    void document.fonts?.ready.then(() => {
      if (!cancelled) setFonts(readFonts());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* -------------------------------- drawing -------------------------------- */

  /**
   * Paints one frame onto any surface.
   *
   * Deliberately not tied to the visible canvas: the exporter hands it an
   * offscreen one and asks for frames by timestamp, and the two have to agree
   * pixel for pixel.
   */
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, index: number, secondsIntoScene: number) => {
      if (index < 0) {
        const progress = clamp01(secondsIntoScene / coverDuration);
        if (isHyperframes) {
          renderModernCover(ctx, {
            title: project.title,
            description: project.description,
            fontSans: fonts.sans,
            progress,
            image: images[0] ?? null,
            theme: scenes[0]?.visualTheme,
          });
        } else {
          renderCover(ctx, {
            title: project.title,
            description: project.description,
            fontHand: fonts.hand,
            fontSans: fonts.sans,
            progress,
          });
        }
        return;
      }

      if (index >= scenes.length) {
        renderOutro(ctx, {
          title: project.title,
          description: project.description,
          fontHand: fonts.hand,
          fontSans: fonts.sans,
          progress: clamp01(secondsIntoScene / Math.max(0.1, outroDuration)),
        });
        return;
      }

      const scene = scenes[index];
      const entry = schedule[index];
      if (!scene || !entry) return;

      const time = Math.min(secondsIntoScene, entry.duration);
      const before = durations.slice(0, index).reduce((sum, value) => sum + value, coverDuration);

      if (isHyperframes && entry.modern) {
        renderModernScene(
          ctx,
          {
            heading: scene.heading,
            bullets: scene.bullets,
            narration: scene.narration,
            image: images[index] ?? null,
            index,
            totalScenes: scenes.length,
            keywords: scene.keywords,
            stat: scene.stat,
            statCaption: scene.statCaption,
            visualTheme: scene.visualTheme,
          },
          entry.modern,
          {
            time,
            duration: entry.duration,
            fontSans: fonts.sans,
            globalProgress: clamp01((before + time) / total),
          },
        );
        return;
      }

      renderFrame(
        ctx,
        {
          scene: entry.board,
          image: images[index] ?? null,
          imageKind: scene.image?.kind,
          heading: scene.heading,
          index,
        },
        {
          time,
          duration: entry.duration,
          cues: entry.cues,
          fontHand: fonts.hand,
          fontSans: fonts.sans,
        },
      );

      // A whiteboard cuts through white rather than through black -- the same
      // flash you get when a real board is wiped between shots.
      const veil =
        Math.max(
          1 - smootherstep(range(time, 0, 0.3)),
          smootherstep(range(time, entry.duration - 0.24, entry.duration)),
        ) * 0.9;
      if (veil > 0.001) {
        ctx.save();
        ctx.fillStyle = `rgba(247, 246, 243, ${veil})`;
        ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
        ctx.restore();
      }
    },
    [
      coverDuration,
      durations,
      fonts,
      images,
      isHyperframes,
      outroDuration,
      project.description,
      project.title,
      scenes,
      schedule,
      total,
    ],
  );

  const draw = useCallback(
    (index: number, secondsIntoScene: number) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) paint(ctx, index, secondsIntoScene);
    },
    [paint],
  );

  /** The same frame, addressed by position in the finished video. */
  const paintAt = useCallback(
    (ctx: CanvasRenderingContext2D, seconds: number) => {
      const { index, offset } = locate(seconds, durations, coverDuration);
      paint(ctx, index, offset);
    },
    [coverDuration, durations, paint],
  );

  // Repaint whenever the inputs change while paused (first render, scrubbing).
  // Never while recording: the export loop owns the canvas, and a second
  // painter at a slightly different timestamp lands in the file as a stutter.
  useEffect(() => {
    if (!ready || playing || exporting) return;
    draw(
      sceneIndex,
      sceneIndex < 0 ? elapsed : elapsedInScene(elapsed, sceneIndex, durations, coverDuration),
    );
  }, [coverDuration, draw, durations, elapsed, exporting, playing, ready, sceneIndex]);

  /* ---------------------------------- audio --------------------------------- */

  /** Disconnects the whole score graph; scheduled nodes die with the bus. */
  const stopScore = useCallback(() => {
    const live = scoreRef.current;
    if (!live) return;
    try {
      live.bus.disconnect();
    } catch {
      /* already gone */
    }
    scoreRef.current = { context: live.context, bus: live.context.createGain() };
  }, []);

  const audioAt = useCallback((index: number) => {
    if (index < 0) return null;
    return audioRefs.current[index] ?? null;
  }, []);

  /**
   * Starts music and effects from a given point on the timeline.
   *
   * The graph is rebuilt from scratch each time rather than paused, because a
   * scheduled oscillator cannot be rescheduled -- and a scrub has to be able
   * to join the bed mid-phrase.
   */
  const startScore = useCallback(
    (fromSeconds: number) => {
      stopScore();
      if (!soundOn || (!score.sfx.length && !musicMood)) return;

      try {
        const AudioCtor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtor) return;

        const context = scoreRef.current?.context ?? new AudioCtor();
        const bus = context.createGain();
        bus.gain.value = muted ? 0 : 1;
        bus.connect(context.destination);
        void context.resume();

        const base = context.currentTime + 0.06;
        if (musicMood !== "none") {
          scheduleMusic(context, bus, {
            mood: musicMood,
            duration: total,
            duck: score.duck,
            base,
            from: fromSeconds,
          });
        }
        scheduleSfx(context, bus, score.sfx, 1, { base, from: fromSeconds });

        scoreRef.current = { context, bus };
      } catch {
        // A blocked audio context costs the score, never the video.
      }
    },
    [muted, musicMood, score, soundOn, stopScore, total],
  );

  const silence = useCallback(
    (except?: number) => {
      audioRefs.current.forEach((audio, index) => {
        if (!audio || index === except) return;
        audio.pause();
        audio.currentTime = 0;
      });
    },
    [],
  );

  /* -------------------------------- transport ------------------------------- */

  const startScene = useCallback(
    (index: number, offsetSeconds = 0) => {
      clockRef.current = { index, time: Math.max(0, offsetSeconds), last: performance.now() };
      setSceneIndex(index);
      silence(index);

      const audio = audioAt(index);
      const entry = schedule[index];
      if (!audio || !entry) return;

      audio.playbackRate = playbackSpeed;
      audio.currentTime = Math.max(0, offsetSeconds - entry.lead);
    },
    [audioAt, playbackSpeed, schedule, silence],
  );

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    silence();
    stopScore();
  }, [silence, stopScore]);

  /**
   * One frame.
   *
   * The scene's own time advances by wall-clock delta, then is pulled back
   * toward the narration's position. Small differences ease out over a few
   * frames; a big one -- a stalled buffer, a backgrounded tab -- snaps.
   */
  const advance = useCallback(
    (speed: number) => {
      const clock = clockRef.current;
      const index = clock.index;
      const entry = index < 0 || index >= schedule.length ? null : schedule[index];
      const duration =
        index >= scenes.length ? outroDuration : (entry?.duration ?? coverDuration);

      const now = performance.now();
      const delta = Math.min(0.25, (now - clock.last) / 1000) * speed;
      clock.last = now;
      clock.time += delta;

      const audio = audioAt(index);
      if (entry && audio) {
        const started = clock.time >= entry.lead - 0.03;

        if (started && audio.paused && clock.time < entry.lead + entry.speech - 0.15) {
          audio.currentTime = Math.max(0, clock.time - entry.lead);
          audio.playbackRate = speed;
          void audio.play().catch(() => {});
        }

        const live = !audio.paused && !audio.ended && audio.readyState >= 2 && audio.currentTime > 0.02;
        if (live) {
          const drift = audio.currentTime + entry.lead - clock.time;
          clock.time += Math.abs(drift) > HARD_RESYNC ? drift : drift * 0.06;
        }
      }

      draw(index, clock.time);

      const before =
        index < 0 ? 0 : durations.slice(0, index).reduce((sum, value) => sum + value, coverDuration);
      setElapsed(before + Math.min(clock.time, duration));

      if (clock.time < duration - 0.01) return true;

      const next = index + 1;
      // One past the last scene is the closing card; one past that is the end.
      if (next > scenes.length || (next === scenes.length && outroDuration <= 0)) {
        setElapsed(total);
        return false;
      }
      startScene(next);
      return true;
    },
    [
      audioAt,
      coverDuration,
      draw,
      durations,
      outroDuration,
      schedule,
      scenes.length,
      startScene,
      total,
    ],
  );

  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function loop() {
      if (advance(playbackSpeed)) frame = requestAnimationFrame(loop);
      else stopPlayback();
    });
    return () => cancelAnimationFrame(frame);
  }, [advance, playbackSpeed, playing, stopPlayback]);

  useEffect(() => {
    for (const audio of audioRefs.current) if (audio) audio.muted = muted;
    const live = scoreRef.current;
    if (live) live.bus.gain.value = muted ? 0 : 1;
  }, [muted, scenes.length]);

  useEffect(() => {
    for (const audio of audioRefs.current) if (audio) audio.playbackRate = playbackSpeed;
  }, [playbackSpeed, scenes.length]);

  const play = useCallback(() => {
    if (!ready) return;
    // `scenes.length` is the closing card, so only past that is the end.
    if (elapsed >= total - 0.05 || sceneIndex > scenes.length) {
      setElapsed(0);
      startScene(-1);
    } else {
      startScene(sceneIndex, elapsedInScene(elapsed, sceneIndex, durations, coverDuration));
    }
    setPlaying(true);
    startScore(elapsed >= total - 0.05 ? 0 : elapsed);
  }, [coverDuration, durations, elapsed, ready, sceneIndex, scenes.length, startScene, startScore, total]);

  const toggle = useCallback(() => {
    if (playing) stopPlayback();
    else play();
  }, [play, playing, stopPlayback]);

  const seekTo = useCallback(
    (seconds: number) => {
      const target = Math.max(0, Math.min(total - 0.05, seconds));
      const { index, offset } = locate(target, durations, coverDuration);
      setElapsed(target);
      // `startScene` already parks every other clip; the seeked one keeps the
      // position it was just given so pressing play resumes from the scrub.
      startScene(index, offset);
      if (playing) startScore(target);
      else {
        stopScore();
        draw(index, offset);
      }
    },
    [coverDuration, draw, durations, playing, startScene, startScore, stopScore, total],
  );

  const restart = useCallback(() => {
    stopPlayback();
    setElapsed(0);
    startScene(-1);
    draw(-1, 0);
  }, [draw, startScene, stopPlayback]);

  /* --------------------------------- export -------------------------------- */

  const exportVideo = useCallback(async () => {
    if (exporting || !ready) return;

    setExportError(null);
    setExporting(true);
    setExportStage("Preparing");
    setExportProgress(0);
    stopPlayback();

    const controller = new AbortController();
    exportAbortRef.current = controller;

    const save = (blob: Blob, extension: string) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${slugify(project.title)}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
    };

    try {
      if (offlineExport) {
        // Every clip is placed at the exact second its scene's voice begins,
        // so the finished file is in step by construction rather than by luck.
        const audio: AudioPlacement[] = [];
        scenes.forEach((scene, index) => {
          const url = scene.audio?.url;
          const entry = schedule[index];
          if (!url || !entry) return;
          audio.push({ url, at: offsetOf(index, durations, coverDuration) + entry.lead });
        });

        const blob = await exportVideoFile({
          width: BOARD_WIDTH,
          height: BOARD_HEIGHT,
          fps: EXPORT_FPS,
          duration: total,
          paint: paintAt,
          audio,
          sound: {
            sfx: score.sfx,
            mood: musicMood,
            duck: score.duck,
          },
          onProgress: (fraction, stage) => {
            setExportProgress(fraction);
            setExportStage(stage);
          },
          signal: controller.signal,
        });

        save(blob, "mp4");
        return;
      }

      // No WebCodecs: fall back to recording the canvas in real time.
      const canvas = canvasRef.current;
      if (!canvas || !mimeType) throw new Error("This browser cannot export video.");

      setExportStage("Recording in real time");
      const stream = canvas.captureStream(60);

      if (scenes.some((scene) => scene.audio?.url)) {
        try {
          if (!exportGraphRef.current) {
            const AudioCtor =
              window.AudioContext ??
              (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (AudioCtor) {
              const context = new AudioCtor();
              exportGraphRef.current = {
                context,
                destination: context.createMediaStreamDestination(),
                sources: new WeakMap(),
              };
            }
          }

          const graph = exportGraphRef.current;
          if (graph) {
            for (const audio of audioRefs.current) {
              if (!audio || graph.sources.has(audio)) continue;
              // An element can only ever be given one source node.
              const source = graph.context.createMediaElementSource(audio);
              source.connect(graph.destination);
              source.connect(graph.context.destination);
              graph.sources.set(audio, source);
            }
            await graph.context.resume();
            for (const track of graph.destination.stream.getAudioTracks()) stream.addTrack(track);
          }
        } catch {
          // Silent video is still a usable export.
        }
      }

      const recorder = startRecording(stream, mimeType);
      startScene(-1);
      await new Promise<void>((resolve) => {
        let frame = requestAnimationFrame(function loop() {
          setExportProgress(clamp01(clockRef.current.time / Math.max(total, 0.1)));
          if (advance(1)) frame = requestAnimationFrame(loop);
          else resolve();
        });
        void frame;
      });

      // Let the last frames and audio packets land before closing the file.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const blob = await recorder.stop();
      silence();
      save(blob, extensionFor(mimeType));
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setExportError(
          err instanceof Error && err.message
            ? `The export didn't finish: ${err.message}`
            : "The export didn't finish. Try again.",
        );
      }
    } finally {
      exportAbortRef.current = null;
      setExporting(false);
      setExportProgress(0);
      setExportStage(null);
    }
  }, [
    advance,
    coverDuration,
    durations,
    exporting,
    mimeType,
    musicMood,
    offlineExport,
    paintAt,
    score,
    project.title,
    ready,
    scenes,
    schedule,
    silence,
    startScene,
    stopPlayback,
    total,
  ]);

  const cancelExport = useCallback(() => {
    exportAbortRef.current?.abort();
  }, []);

  /* ------------------------------- interaction ------------------------------ */

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === " " || event.key === "k") {
      event.preventDefault();
      toggle();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      seekTo(elapsed + 5);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekTo(elapsed - 5);
    }
  };

  const goFullscreen = () => {
    const node = canvasRef.current?.parentElement;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void node.requestFullscreen?.().catch(() => {});
  };

  const cycleSpeed = () => {
    const speeds = [1, 1.25, 1.5];
    setPlaybackSpeed(speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length]);
  };

  const hasNarration = scenes.some((scene) => scene.audio?.url);
  const timedToVoice = scenes.some((scene) => (scene.audio?.words?.length ?? 0) > 0);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        className={cn(
          "group relative overflow-hidden rounded-card border border-line",
          isHyperframes ? "bg-[#07080c]" : "bg-[#f7f5ef]",
        )}
        tabIndex={0}
        role="application"
        aria-label={`${isHyperframes ? "Modern" : "Whiteboard"} video: ${project.title}`}
        onKeyDown={onKeyDown}
      >
        <canvas
          ref={canvasRef}
          width={BOARD_WIDTH}
          height={BOARD_HEIGHT}
          className="block aspect-video w-full"
        />

        {!ready ? (
          <div
            className={cn(
              "absolute inset-0 grid place-items-center",
              isHyperframes ? "bg-[#07080c]" : "bg-[#f7f5ef]",
            )}
          >
            <div
              className={cn(
                "flex items-center gap-2 text-sm",
                isHyperframes ? "text-white/70" : "text-[#5c5f66]",
              )}
            >
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {isHyperframes ? "Preparing the edit" : "Preparing the board"}
            </div>
          </div>
        ) : null}

        {ready && !playing && !exporting && elapsed < 0.05 ? (
          <button
            type="button"
            onClick={play}
            aria-label="Play the video"
            className="absolute inset-0 grid place-items-center bg-[#1d1f24]/0 transition-colors hover:bg-[#1d1f24]/10"
          >
            <span className="grid size-16 place-items-center rounded-full bg-[#1d1f24] text-[#f7f5ef] shadow-lg transition-transform group-hover:scale-105">
              <Play className="size-6 translate-x-0.5" aria-hidden />
            </span>
          </button>
        ) : null}

        {exporting ? (
          <div className="absolute inset-0 grid place-items-center bg-[#08090b]/85 backdrop-blur-[2px]">
            <div className="flex w-full max-w-[24rem] flex-col items-center gap-3 px-6 text-center text-[#f7f5ef]">
              <Loader2 className="size-6 animate-spin" aria-hidden />
              <p className="text-sm font-medium">
                {offlineExport ? "Rendering MP4" : "Recording video"}
              </p>

              <div className="h-1 w-full overflow-hidden rounded-full bg-white/12">
                <div
                  className="h-full rounded-full bg-[#f5b13d] transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.round(exportProgress * 100)}%` }}
                />
              </div>

              <p className="font-mono text-[11px] tabular-nums text-[#f7f5ef]/70">
                {exportStage ?? "Working"} · {Math.round(exportProgress * 100)}%
              </p>
              <p className="text-xs text-[#f7f5ef]/55">
                {offlineExport
                  ? "Encoding every frame at 30 fps. You can switch tabs — nothing is dropped."
                  : "Recording in real time. Keep this tab visible."}
              </p>

              <button
                type="button"
                onClick={cancelExport}
                className="rounded-md border border-white/20 px-3 py-1 text-xs text-[#f7f5ef]/80 transition-colors hover:bg-white/10 hover:text-[#f7f5ef]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {/* One element per scene, preloaded: swapping `src` mid-playback is
            what used to put a gap between the picture and the voice. */}
        <div className="hidden">
          {scenes.map((scene, index) => (
            <audio
              key={`${index}-${scene.audio?.url ?? "silent"}`}
              ref={(node) => {
                audioRefs.current[index] = node;
              }}
              src={scene.audio?.url}
              preload="auto"
            />
          ))}
        </div>
      </div>

      {/* -------------------------------- controls ------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="secondary" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </Button>
        <Button size="icon" variant="ghost" onClick={restart} aria-label="Restart">
          <RotateCcw className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setMuted((value) => !value)}
          aria-label={muted ? "Unmute" : "Mute"}
          disabled={!hasNarration}
        >
          {muted || !hasNarration ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </Button>

        <Button
          size="icon"
          variant="ghost"
          onClick={() => setSoundOn((value) => !value)}
          aria-label={soundOn ? "Turn off music and effects" : "Turn on music and effects"}
          title={soundOn ? "Music and effects on" : "Music and effects off"}
        >
          {soundOn ? <Music className="size-4" /> : <Music2 className="size-4 opacity-40" />}
        </Button>

        <button
          type="button"
          onClick={cycleSpeed}
          title="Change playback speed"
          className="rounded-md border border-line bg-surface-raised px-2 py-1 font-mono text-[11px] font-medium text-muted transition-colors hover:text-ink"
        >
          {playbackSpeed}x
        </button>

        <div className="flex min-w-[10rem] flex-1 items-center gap-3">
          <input
            type="range"
            min={0}
            max={Math.max(total, 0.1)}
            step={0.05}
            value={Math.min(elapsed, total)}
            onChange={(event) => seekTo(Number(event.target.value))}
            aria-label="Seek"
            className={cn(
              "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-hover",
              "[&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none",
              "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink",
              "[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white",
            )}
          />
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
            {formatTime(elapsed)} / {formatTime(total)}
          </span>
        </div>

        <Button size="icon" variant="ghost" onClick={goFullscreen} aria-label="Fullscreen">
          <Maximize2 className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={exportVideo}
          loading={exporting}
          disabled={!ready || (!offlineExport && !mimeType)}
          title={
            offlineExport
              ? "Renders a real H.264 MP4, frame by frame"
              : mimeType
                ? "Records the canvas in real time"
                : "This browser can't export video."
          }
        >
          {exporting ? null : <Download className="size-3.5" />}
          {exporting ? "Exporting" : offlineExport ? "Export MP4" : "Export video"}
        </Button>
      </div>

      {/* --------------------------------- scenes -------------------------------- */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => seekTo(0)}
          className={cn(
            "rounded-lg border px-2.5 py-1 text-[11px] transition-colors",
            sceneIndex === -1
              ? "border-line-strong bg-surface-hover text-ink"
              : "border-line bg-surface-raised text-muted hover:text-ink",
          )}
        >
          Intro Card
        </button>

        {scenes.map((scene, index) => (
          <button
            key={`${scene.heading}-${index}`}
            type="button"
            onClick={() => seekTo(offsetOf(index, durations, coverDuration))}
            className={cn(
              "max-w-[13rem] truncate rounded-lg border px-2.5 py-1 text-[11px] transition-colors",
              index === sceneIndex
                ? "border-line-strong bg-surface-hover text-ink"
                : "border-line bg-surface-raised text-muted hover:text-ink",
            )}
          >
            {index + 1}. {scene.heading}
          </button>
        ))}
      </div>

      {exportError ? <p className="text-xs text-danger">{exportError}</p> : null}
      {!offlineExport ? (
        mimeType ? (
          <p className="text-xs text-faint">
            This browser has no WebCodecs encoder, so export falls back to a real-time recording.
            Chrome or Edge will render a true MP4 instead.
          </p>
        ) : (
          <p className="text-xs text-faint">
            Video export needs Chrome or Edge — this browser can neither encode nor record.
          </p>
        )
      ) : null}
      {!hasNarration ? (
        <p className="text-xs text-faint">
          Narration is unavailable, so this plays silently with estimated scene timings.
        </p>
      ) : timedToVoice ? (
        <p className="text-xs text-faint">
          Animation is scheduled against the narration&rsquo;s word timings, so every beat lands on
          the words that describe it.
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------- timeline -------------------------------- */

function offsetOf(index: number, durations: number[], coverDuration = DEFAULT_COVER_SECONDS): number {
  if (index < 0) return 0;
  return coverDuration + durations.slice(0, index).reduce((sum, value) => sum + value, 0);
}

function locate(
  seconds: number,
  durations: number[],
  coverDuration = DEFAULT_COVER_SECONDS,
): { index: number; offset: number } {
  if (seconds < coverDuration) return { index: -1, offset: seconds };
  let remaining = seconds - coverDuration;
  for (let index = 0; index < durations.length; index += 1) {
    if (remaining < durations[index]) return { index, offset: remaining };
    remaining -= durations[index];
  }
  // Anything past the last scene belongs to the closing card.
  return { index: durations.length, offset: Math.max(0, remaining) };
}

function elapsedInScene(
  elapsed: number,
  index: number,
  durations: number[],
  coverDuration = DEFAULT_COVER_SECONDS,
): number {
  return Math.max(0, elapsed - offsetOf(index, durations, coverDuration));
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "whiteboard-video"
  );
}

export type { SceneAsset };
