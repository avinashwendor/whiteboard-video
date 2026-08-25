"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Loader2,
  Maximize2,
  Minimize2,
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
import { boardStock, setBoardStock } from "@/lib/whiteboard/palette";
import { resolveWordTimings, type WordTiming } from "@/lib/video/timing";
import { BOARD_HEIGHT, BOARD_WIDTH, renderCover, renderFrame, renderOutro } from "./renderer";
import {
  planModernScene,
  renderModernCover,
  renderModernOutro,
  renderModernScene,
  type ModernPlan,
} from "@/lib/hyperframes/modern-renderer";
import { disposeScene, planSceneCues, prepareScene, type PreparedScene } from "./scene-render";
import type { Cue } from "@/lib/video/timing";
import { useBoardImages } from "./use-board-images";
import { extensionFor, pickMimeType, startRecording } from "./use-recorder";
import {
  canExportOffline,
  canRenderOffline,
  EncoderUnavailableError,
  exportVideoFile,
  type AudioPlacement,
} from "@/lib/video/export";
import { buildScore } from "@/lib/video/score";
import { scheduleMusic, type MusicMood } from "@/lib/video/music";
import { createSfxBus, scheduleSfx } from "@/lib/video/sfx";

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

export interface CanvasFonts {
  hand: string;
  sans: string;
  /** Tight heavy grotesque, for headlines and anything set large. */
  display: string;
  /** Ultra-condensed poster face, for one word filling the frame. */
  poster: string;
}

/**
 * Resolves the CSS font tokens into families the canvas can address.
 *
 * The canvas cannot use a CSS custom property in a `font` string, so the
 * variables are read off the root element once the faces have loaded and
 * handed to the renderer as plain family names.
 */
function readFonts(): CanvasFonts {
  const fallbackSans = "sans-serif";
  if (typeof document === "undefined") {
    return { hand: "cursive", sans: fallbackSans, display: fallbackSans, poster: fallbackSans };
  }
  const styles = getComputedStyle(document.documentElement);
  const read = (token: string) => styles.getPropertyValue(token).trim();
  const hand = read("--font-hand");
  const sans = read("--font-geist-sans");
  const display = read("--font-display");
  const poster = read("--font-poster");
  const sansStack = sans ? `${sans}, sans-serif` : fallbackSans;
  return {
    hand: hand ? `${hand}, cursive` : "cursive",
    sans: sansStack,
    // Each falls back to the next-best face rather than to a system default:
    // a headline in Times because one variable was missing is far worse than
    // a headline in the interface face.
    display: display ? `${display}, ${sansStack}` : sansStack,
    poster: poster ? `${poster}, ${display || sans}, sans-serif` : sansStack,
  };
}

const DEFAULT_COVER_SECONDS = 3.2;
const DEFAULT_VOICE_DELAY = 0.5;
/** Hold after the voice stops, before the scene hands over. */
const TAIL_SECONDS = 0.62;
/** Past this much drift the clock snaps instead of easing. */
const HARD_RESYNC = 0.28;
/**
 * How far ahead of the picture the effects are committed to the audio clock.
 *
 * Long enough for the approach voices -- a riser opens most of a second before
 * the number it lands on -- and short enough that a clock correction inside the
 * window is inaudible. This replaces the old arrangement, where the whole score
 * was scheduled at once and a drifting picture left every effect behind.
 */
const SFX_LOOKAHEAD = 1.3;
/** How often the rolling window is refilled. Cheap; almost every pass is a no-op. */
const SFX_TICK_MS = 90;
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

/**
 * The transport, written out once.
 *
 * Shown on the stage itself rather than behind a help button, because a
 * shortcut nobody discovers is a shortcut nobody has.
 */
const SHORTCUT_HINT = [
  "Space  play / pause",
  "J L  ten seconds",
  "← →  five seconds  (⇧ one)",
  ", .  one frame",
  "[ ]  scene",
  "0-9  jump",
  "M  mute    S  score    F  fullscreen",
].join("\n");

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
  seekRequest,
  onSceneChange,
}: {
  project: ProjectAsset;
  className?: string;
  /**
   * A request to jump to one scene of the project, carrying a nonce so the
   * same scene can be asked for twice. It is a command rather than a bound
   * value on purpose: playback moves the editor's selection, and a bound value
   * would have that selection seek the player back to where it started.
   */
  seekRequest?: { index: number; nonce: number } | null;
  /** Fires as playback crosses into a scene, so a selection can follow along. */
  onSceneChange?: (projectIndex: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRefs = useRef<Array<HTMLAudioElement | null>>([]);
  const clockRef = useRef({ index: -1, time: 0, last: 0 });
  const exportAbortRef = useRef<AbortController | null>(null);
  /**
   * The live sound graph.
   *
   * Music and effects are deliberately on separate buses. The bed is written
   * once for the whole film and tolerates drift -- nobody can hear a pad a
   * tenth of a second late. Effects cannot tolerate any, and the only way to
   * move a scheduled oscillator is to throw it away, so keeping the two apart
   * is what lets the effects be re-laid mid-play without the music restarting
   * underneath them.
   */
  const soundRef = useRef<{
    context: AudioContext;
    /** Everything lands here; this is what mute pulls down. */
    master: GainNode;
    music: GainNode;
    /** Input to the effects chain, replaced whenever the picture clock snaps. */
    sfx: GainNode;
    /** Timeline position the rolling scheduler has committed effects up to. */
    cursor: number;
    rate: number;
  } | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  /** Set when the picture clock snaps, so the pending effects are re-laid. */
  const sfxDirtyRef = useRef(false);
  const exportGraphRef = useRef<{
    context: AudioContext;
    destination: MediaStreamAudioDestinationNode;
    sources: WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>;
  } | null>(null);

  /**
   * The surface this video is drawn on.
   *
   * Set before anything else in the component body, because scene layouts bake
   * their colours in when they are composed -- a stock chosen later would give
   * a video drawn in one palette on paper from another. Assigning during
   * render rather than in an effect is deliberate for the same reason: the
   * schedule below is built in this same pass.
   */
  setBoardStock(project.boardStock);

  const coverDuration = project.introDuration ?? DEFAULT_COVER_SECONDS;
  const voiceDelay = project.voiceDelay ?? DEFAULT_VOICE_DELAY;
  const isHyperframes = project.videoStyle === "hyperframes";

  const playable = useMemo(
    () =>
      project.scenes
        .map((scene, index) => ({ scene, index }))
        .filter(({ scene }) => scene.scene || scene.image || scene.audio || scene.heading),
    [project.scenes],
  );
  const scenes = useMemo(() => playable.map((entry) => entry.scene), [playable]);
  /** Position in the rendered list -> position in `project.scenes`. */
  const sceneOrder = useMemo(() => playable.map((entry) => entry.index), [playable]);

  const { images, ready } = useBoardImages(scenes.map((scene) => scene.image?.url));

  /* -------------------------------- schedule -------------------------------- */

  // Geometry, cue plans and subtitle phrases are all derived once. Everything
  // downstream is then a pure lookup, which is what keeps a scrub instant.
  const schedule = useMemo<SceneSchedule[]>(() => {
    if (typeof document === "undefined") return [];

    // Carried scene to scene so the modern engine never runs the same shot
    // composition twice in a row.
    const recentRoles: Array<ModernPlan["role"]> = [];
    // Shared across the video so no two frames wear the same accent glyph.
    const usedGlyphs = new Set<string>();

    const built: SceneSchedule[] = scenes.map((scene) => {
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
        modern: null,
      };
    });
    if (isHyperframes) {
      built.forEach((entry, index) => {
        const scene = scenes[index];
        entry.modern = planModernScene(
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
            shot: scene.shot,
            glyphs: scene.glyphs,
          },
          entry.words,
          { lead: entry.lead, speech: entry.speech, tail: entry.tail },
          recentRoles,
          usedGlyphs,
        );
        recentRoles.push(entry.modern.role);
      });
    }

    return built;
    // `images` only swaps the bitmap a plan points at, never the plan's timing.
    //
    // `boardStock` is here because a layout bakes its colours in when it is
    // composed, not when it is painted. Without it, switching to a chalkboard
    // repaints the paper dark and leaves the drawing in the ink it was built
    // with -- a board that is genuinely there and completely invisible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, voiceDelay, isHyperframes, project.boardStock]);

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

  /**
   * The video's parts, as spans on the timeline.
   *
   * A bare slider says how far through you are and nothing else. The scrubber
   * shows the shape — where the intro ends, how long each scene actually runs,
   * where the closing card starts — so a scene that drags is visible before
   * you've watched it.
   */
  const segments = useMemo(() => {
    const parts: Array<{ label: string; at: number; span: number }> = [];
    if (coverDuration > 0) parts.push({ label: "Intro", at: 0, span: coverDuration });
    durations.forEach((span, index) => {
      parts.push({
        label: `${index + 1}. ${scenes[index]?.heading ?? "Scene"}`,
        at: offsetOf(index, durations, coverDuration),
        span,
      });
    });
    if (outroDuration > 0) {
      parts.push({ label: "Closing", at: total - outroDuration, span: outroDuration });
    }
    return parts;
  }, [coverDuration, durations, outroDuration, scenes, total]);

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
  /**
   * Whether this machine can actually render, answered by the encoder itself.
   *
   * `null` until it replies. The button used to promise "Export MP4" on the
   * strength of the API existing, then hand back a webm — or nothing at all on
   * a GPU with no H.264 profile.
   */
  const [renderable, setRenderable] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void canRenderOffline(BOARD_WIDTH, BOARD_HEIGHT, EXPORT_FPS).then((ok) => {
      if (alive) setRenderable(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  /** Fullscreen puts the controls out of reach, so they move onto the stage. */
  const [immersive, setImmersive] = useState(false);
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
        // Sound follows picture: the shot the renderer chose decides which
        // voice a beat gets, so a glass panel and a marker stroke never share
        // a mark.
        role: entry.modern?.role,
      };
    });

    return buildScore({
      coverDuration,
      scenes: scored,
      style: isHyperframes ? "hyperframes" : "whiteboard",
      intensity: soundOn ? 1 : 0,
      mood: musicMood,
    });
  }, [coverDuration, isHyperframes, musicMood, schedule, scenes, soundOn]);


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
            fontDisplay: fonts.display,
            fontPoster: fonts.poster,
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
        const progress = clamp01(secondsIntoScene / Math.max(0.1, outroDuration));
        // The closing card belongs to whichever engine drew the film. A modern
        // video that hands over to a hand-drawn whiteboard for its last four
        // seconds has not ended, it has stopped.
        if (isHyperframes) {
          renderModernOutro(ctx, {
            title: project.title,
            description: project.description,
            fontSans: fonts.sans,
            fontDisplay: fonts.display,
            fontPoster: fonts.poster,
            progress,
            theme: scenes[scenes.length - 1]?.visualTheme ?? scenes[0]?.visualTheme,
          });
          return;
        }
        renderOutro(ctx, {
          title: project.title,
          description: project.description,
          fontHand: fonts.hand,
          fontSans: fonts.sans,
          progress,
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
            shot: scene.shot,
            glyphs: scene.glyphs,
          },
          entry.modern,
          {
            time,
            duration: entry.duration,
            fontSans: fonts.sans,
            fontDisplay: fonts.display,
            fontPoster: fonts.poster,
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

      // A board cuts through its own surface rather than through black -- the
      // same flash you get when a real board is wiped between shots. On a
      // chalkboard or a blueprint that flash is dark, which is exactly right
      // and exactly what a hardcoded white would have got wrong.
      const veil =
        Math.max(
          1 - smootherstep(range(time, 0, 0.3)),
          smootherstep(range(time, entry.duration - 0.24, entry.duration)),
        ) * 0.9;
      if (veil > 0.001) {
        ctx.save();
        ctx.globalAlpha = veil;
        ctx.fillStyle = boardStock().colours.paper;
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
    if (sceneIndex < 0) {
      // Parked at the very start, show the title card settled rather than the
      // first frame of its build-on -- which is an empty board, and reads as a
      // player that failed to load.
      draw(-1, elapsed > 0 ? elapsed : coverDuration);
      return;
    }

    const offset = elapsedInScene(elapsed, sceneIndex, durations, coverDuration);
    // Parked exactly on a scene boundary means someone jumped here to look at
    // this scene -- from the rail or a chapter button -- so show them the board
    // finished. Scrubbing lands mid-scene and stays honest about the timeline.
    const settled = offset <= 0.01 && sceneIndex < durations.length;
    // Past every beat but clear of the wipe that whites out the last 0.24s --
    // land inside it and the board reads as a washed-out ghost of itself.
    draw(sceneIndex, settled ? Math.max(0.32, durations[sceneIndex] - 0.32) : offset);
  }, [coverDuration, draw, durations, elapsed, exporting, playing, ready, sceneIndex]);

  /* ---------------------------------- audio --------------------------------- */

  /**
   * Where playback is on the finished timeline, right now.
   *
   * The transport clock is scene-relative -- it has to be, the narration it
   * chases is a per-scene clip -- while the score is written against the whole
   * film. Every number that crosses between the two goes through here.
   */
  const timelineNow = useCallback(() => {
    const clock = clockRef.current;
    const cap =
      clock.index < 0
        ? coverDuration
        : (schedule[clock.index]?.duration ?? outroDuration);
    return offsetOf(clock.index, durations, coverDuration) + Math.min(clock.time, cap);
  }, [coverDuration, durations, outroDuration, schedule]);

  /** Tears the graph down. Scheduled nodes die with the bus they feed. */
  const stopSound = useCallback(() => {
    const live = soundRef.current;
    if (!live) return;
    try {
      live.master.disconnect();
    } catch {
      /* already gone */
    }
    soundRef.current = null;
  }, []);

  const audioAt = useCallback((index: number) => {
    if (index < 0) return null;
    return audioRefs.current[index] ?? null;
  }, []);

  /**
   * Starts the bed, and opens the effects scheduler at a point on the timeline.
   *
   * The music is committed here in full: it is furniture, it is allowed to run
   * on the audio clock alone, and re-laying it mid-phrase is audible. The
   * effects are not committed at all -- `pumpSfx` feeds them in a rolling
   * window a beat ahead of the picture, which is the only arrangement where a
   * hit cannot land on the wrong frame.
   */
  const startSound = useCallback(
    (fromSeconds: number) => {
      stopSound();
      if (!soundOn || (!score.sfx.length && musicMood === "none")) return;

      try {
        const AudioCtor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtor) return;

        const context = audioCtxRef.current ?? new AudioCtor();
        audioCtxRef.current = context;
        void context.resume();

        const master = context.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(context.destination);

        const music = context.createGain();
        music.connect(master);

        const rate = playbackSpeed;
        if (musicMood !== "none") {
          scheduleMusic(context, music, {
            mood: musicMood,
            duration: total,
            duck: score.duck,
            base: context.currentTime + 0.06,
            from: fromSeconds,
            rate,
          });
        }

        soundRef.current = {
          context,
          master,
          music,
          sfx: createSfxBus(context, master),
          cursor: fromSeconds,
          rate,
        };
        sfxDirtyRef.current = false;
      } catch {
        // A blocked audio context costs the score, never the video.
      }
    },
    [muted, musicMood, playbackSpeed, score, soundOn, stopSound, total],
  );

  /**
   * Feeds the next window of effects to the audio clock.
   *
   * Called far more often than it schedules anything. Each pass asks the
   * picture where it is *now* and commits only the events inside the next
   * `SFX_LOOKAHEAD` seconds, so a clock that has just been dragged back toward
   * the narration takes the effects with it. Nothing is ever placed more than
   * a beat in advance, which is why nothing can be left stranded on the wrong
   * frame -- the failure the old schedule-it-all-at-once graph had by design.
   */
  const pumpSfx = useCallback(() => {
    const live = soundRef.current;
    if (!live || !soundOn || !score.sfx.length) return;

    const now = timelineNow();

    // The picture snapped. Anything already committed is now on the wrong
    // frame, so the effects bus is thrown away and refilled from here. The bed
    // hanging off `master` never notices.
    if (sfxDirtyRef.current) {
      try {
        live.sfx.disconnect();
      } catch {
        /* already gone */
      }
      live.sfx = createSfxBus(live.context, live.master);
      live.cursor = now;
      sfxDirtyRef.current = false;
    }

    // Behind after a stall: skip the gap rather than dumping every effect that
    // was missed as one burst.
    if (live.cursor < now) live.cursor = now;

    const until = now + SFX_LOOKAHEAD;
    if (until <= live.cursor) return;

    scheduleSfx(live.context, live.sfx, score.sfx, 1, {
      base: live.context.currentTime + (live.cursor - now) / live.rate,
      from: live.cursor,
      until,
      rate: live.rate,
      key: score.key,
    });
    live.cursor = until;
  }, [score, soundOn, timelineNow]);

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
    stopSound();
  }, [silence, stopSound]);

  /**
   * Stops rather than stalls when the tab goes away.
   *
   * The picture is driven by requestAnimationFrame and the voice is not, so a
   * backgrounded tab freezes the board while the narration carries on talking
   * over it — and the board is still frozen, now badly out of step, when you
   * come back. The clock also stops accruing, so the transport lies about where
   * playback is. Pausing outright is the honest behaviour: you return to a
   * still frame that matches the time on the scrubber.
   */
  useEffect(() => {
    if (!playing) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") stopPlayback();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [playing, stopPlayback]);

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
          if (Math.abs(drift) > HARD_RESYNC) {
            clock.time += drift;
            // The picture just moved without the effects. Whatever is already
            // committed to the audio clock is now on the wrong frame.
            sfxDirtyRef.current = true;
          } else {
            clock.time += drift * 0.06;
          }
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

  /**
   * The rolling effects scheduler.
   *
   * A 90ms tick against a 1.3s window: every effect is handed to the audio
   * clock shortly before it is due, measured from where the picture actually
   * is at that moment. Nothing is committed far enough ahead to be stranded by
   * a clock correction, which is what makes the effects land on the frame they
   * were written for rather than somewhere near it.
   */
  useEffect(() => {
    if (!playing) return;
    pumpSfx();
    const id = setInterval(pumpSfx, SFX_TICK_MS);
    return () => clearInterval(id);
  }, [playing, pumpSfx]);

  /**
   * A speed change re-lays the bed.
   *
   * The effects need no help -- the next window is measured against the new
   * rate on its own -- but a pad written for 1x plays a third too long at
   * 0.75x and drifts away from the picture over a minute.
   */
  const relayNonce = useRef(playbackSpeed);
  useEffect(() => {
    if (!playing || relayNonce.current === playbackSpeed) return;
    relayNonce.current = playbackSpeed;
    startSound(timelineNow());
  }, [playbackSpeed, playing, startSound, timelineNow]);

  useEffect(() => {
    for (const audio of audioRefs.current) if (audio) audio.muted = muted;
    const live = soundRef.current;
    if (live) live.master.gain.value = muted ? 0 : 1;
  }, [muted, scenes.length]);

  /**
   * Hands the audio hardware back when the player goes away.
   *
   * The context is deliberately kept alive across stops and scrubs -- creating
   * one costs a device round trip and the first sound after it is late -- but
   * a browser only allows a handful of them per document, and navigating
   * between six projects without this leaves a tab that can no longer make a
   * sound at all.
   */
  useEffect(() => {
    return () => {
      const context = audioCtxRef.current;
      audioCtxRef.current = null;
      soundRef.current = null;
      void context?.close().catch(() => {});
    };
  }, []);

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
    startSound(elapsed >= total - 0.05 ? 0 : elapsed);
  }, [coverDuration, durations, elapsed, ready, sceneIndex, scenes.length, startScene, startSound, total]);

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
      if (playing) startSound(target);
      else {
        stopSound();
        draw(index, offset);
      }
    },
    [coverDuration, draw, durations, playing, startScene, startSound, stopSound, total],
  );

  const restart = useCallback(() => {
    stopPlayback();
    setElapsed(0);
    startScene(-1);
    draw(-1, 0);
  }, [draw, startScene, stopPlayback]);

  /* ------------------------------ editor bridge ----------------------------- */

  const seekNonce = useRef(seekRequest?.nonce ?? -1);
  useEffect(() => {
    if (!seekRequest || seekRequest.nonce === seekNonce.current) return;
    seekNonce.current = seekRequest.nonce;
    const position = sceneOrder.indexOf(seekRequest.index);
    if (position < 0) return;
    seekTo(offsetOf(position, durations, coverDuration));
  }, [coverDuration, durations, sceneOrder, seekRequest, seekTo]);

  // Reported rather than bound, and only on a real crossing -- the parent
  // re-renders constantly while someone is typing into the inspector.
  const reported = useRef(-2);
  useEffect(() => {
    if (sceneIndex < 0 || sceneIndex >= sceneOrder.length) return;
    const projectIndex = sceneOrder[sceneIndex];
    if (reported.current === projectIndex) return;
    reported.current = projectIndex;
    onSceneChange?.(projectIndex);
  }, [onSceneChange, sceneIndex, sceneOrder]);

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
        try {
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
              key: score.key,
            },
            onProgress: (fraction, stage) => {
              setExportProgress(fraction);
              setExportStage(stage);
            },
            signal: controller.signal,
          });

          save(blob, "mp4");
          return;
        } catch (err) {
          // Having the API is not the same as being able to use it: a GPU
          // that exposes no usable H.264 profile lands here. Recording still
          // works, so fall through rather than report a broken export.
          if (!(err instanceof EncoderUnavailableError)) throw err;
          setExportStage("No usable encoder — recording instead");
        }
      }

      // Either no WebCodecs at all, or none this machine can actually use.
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

  /**
   * The transport, on the keyboard.
   *
   * Modelled on an NLE rather than on a web video player, because that is what
   * this is: someone reviewing a cut watches the same eight seconds twenty
   * times, and reaching for a mouse to do it is the difference between
   * reviewing and fighting the tool. J/K/L and comma/period are the two
   * shortcuts every editor already has in their hands.
   *
   * Bound to the stage rather than to the document: a shortcut that fires
   * while someone is typing a heading into the inspector is worse than no
   * shortcut at all.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    // A modifier means the browser's own shortcut, not ours.
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const frame = 1 / EXPORT_FPS;
    const jump = (seconds: number) => {
      event.preventDefault();
      seekTo(elapsed + seconds);
    };
    /** The boundary of the scene before or after the playhead. */
    const step = (direction: -1 | 1) => {
      event.preventDefault();
      const { index } = locate(elapsed, durations, coverDuration);
      const here = offsetOf(index, durations, coverDuration);
      // Going back inside the first second of a scene means the previous one,
      // the way a track skip does. Later than that, back means this scene.
      const target =
        direction < 0 && elapsed - here > 1
          ? here
          : offsetOf(Math.max(-1, Math.min(durations.length, index + direction)), durations, coverDuration);
      seekTo(target);
    };

    switch (event.key) {
      case " ":
      case "k":
        event.preventDefault();
        toggle();
        return;
      case "ArrowRight":
        jump(event.shiftKey ? 1 : 5);
        return;
      case "ArrowLeft":
        jump(event.shiftKey ? -1 : -5);
        return;
      case "l":
        jump(10);
        return;
      case "j":
        jump(-10);
        return;
      // One frame at a time, for checking a beat lands where it should.
      case ".":
        jump(frame);
        return;
      case ",":
        jump(-frame);
        return;
      case "]":
        step(1);
        return;
      case "[":
        step(-1);
        return;
      case "Home":
        event.preventDefault();
        seekTo(0);
        return;
      case "End":
        event.preventDefault();
        seekTo(total - 0.1);
        return;
      case "m":
        event.preventDefault();
        setMuted((value) => !value);
        return;
      case "s":
        event.preventDefault();
        setSoundOn((value) => !value);
        return;
      case "f":
        event.preventDefault();
        goFullscreen();
        return;
      default:
        break;
    }

    // 0-9 jump to that tenth of the video, as every player has done since
    // YouTube taught everyone the habit.
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      seekTo((Number(event.key) / 10) * total);
    }
  };

  const stageRef = useRef<HTMLDivElement>(null);

  const goFullscreen = () => {
    const node = stageRef.current;
    if (!node) return;

    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }

    // Safari still wants the prefix, and an embedded frame without
    // `allow="fullscreen"` rejects outright — which used to be swallowed, so
    // the button simply did nothing and said nothing.
    const request =
      node.requestFullscreen?.bind(node) ??
      (node as unknown as { webkitRequestFullscreen?: () => Promise<void> })
        .webkitRequestFullscreen?.bind(node);

    if (!request) {
      setExportError("This browser won't allow fullscreen here.");
      return;
    }

    void Promise.resolve(request()).catch(() => {
      setExportError("Fullscreen was blocked — try the page outside an embedded frame.");
    });
  };

  /**
   * Fullscreen used to take the canvas wrapper, which left every control
   * behind in the page — no pause, no scrubber, nothing but Escape. The stage
   * goes fullscreen now and carries its own overlay bar.
   *
   * Focus moves with it. The click that opened fullscreen leaves focus on a
   * toolbar button that is now outside the fullscreen element, so space and
   * the arrow keys went nowhere until you clicked the picture first.
   */
  useEffect(() => {
    const sync = () => {
      const on = document.fullscreenElement === stageRef.current;
      setImmersive(on);
      if (on) stageRef.current?.focus();
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  /**
   * Controls that behave like a video player's.
   *
   * They were hover-only, so entering fullscreen showed a bare picture and
   * nothing else until you happened to move the mouse — no way to know a
   * transport existed. Now they are up on arrival and after any movement, and
   * fade out once you have been still for a moment. The cursor goes with them.
   */
  const [barVisible, setBarVisible] = useState(true);
  useEffect(() => {
    if (!immersive) return;
    setBarVisible(true);

    let timer = 0;
    const wake = () => {
      setBarVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setBarVisible(false), 2_600);
    };

    wake();
    const node = stageRef.current;
    node?.addEventListener("mousemove", wake);
    node?.addEventListener("touchstart", wake);
    return () => {
      window.clearTimeout(timer);
      node?.removeEventListener("mousemove", wake);
      node?.removeEventListener("touchstart", wake);
    };
  }, [immersive]);

  const cycleSpeed = () => {
    const speeds = [1, 1.25, 1.5];
    setPlaybackSpeed(speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length]);
  };

  const hasNarration = scenes.some((scene) => scene.audio?.url);
  const timedToVoice = scenes.some((scene) => (scene.audio?.words?.length ?? 0) > 0);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        ref={stageRef}
        className={cn(
          "group relative overflow-hidden rounded-card border border-line",
          isHyperframes ? "bg-[#07080c]" : "bg-[#f7f5ef]",
          // Fullscreen hands us the whole screen; centre the frame in it
          // rather than stretching a 16:9 board to fill a 16:10 laptop panel.
          immersive && "flex items-center justify-center rounded-none border-0 bg-black",
          immersive && !barVisible && "cursor-none",
        )}
        tabIndex={0}
        role="application"
        aria-label={`${isHyperframes ? "Modern" : "Whiteboard"} video: ${project.title}`}
        // Discoverability without a help overlay nobody opens: the one place a
        // person already hovers when they are trying to work out the controls.
        title={SHORTCUT_HINT}
        onKeyDown={onKeyDown}
      >
        <canvas
          ref={canvasRef}
          width={BOARD_WIDTH}
          height={BOARD_HEIGHT}
          className={cn(
            "block aspect-video",
            immersive ? "max-h-full max-w-full object-contain" : "w-full",
          )}
        />

        {/*
          The transport, on the stage. Only mounted in fullscreen — in the page
          the real control row sits right underneath, and two of them would be
          one too many.
        */}
        {immersive && !exporting ? (
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 z-20 flex items-center gap-4 bg-gradient-to-t from-black/85 to-transparent px-6 pb-5 pt-12 transition-opacity duration-300 focus-within:opacity-100",
              barVisible ? "opacity-100" : "opacity-0",
            )}
          >
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
              className="grid size-11 shrink-0 place-items-center bg-white/95 text-black transition-colors hover:bg-white"
            >
              {playing ? (
                <Pause className="size-5 fill-current" aria-hidden />
              ) : (
                <Play className="size-5 translate-x-px fill-current" aria-hidden />
              )}
            </button>

            <div className="flex-1">
              <Scrubber
                elapsed={elapsed}
                total={total}
                segments={segments}
                onSeek={seekTo}
                tone="light"
              />
            </div>

            <span className="shrink-0 font-mono text-[12px] tabular-nums text-white/85">
              {formatTime(elapsed)} / {formatTime(total)}
            </span>

            <button
              type="button"
              onClick={() => setMuted((value) => !value)}
              aria-label={muted ? "Unmute" : "Mute"}
              disabled={!hasNarration}
              className="grid size-9 shrink-0 place-items-center text-white/85 transition-colors hover:text-white disabled:opacity-40"
            >
              {muted || !hasNarration ? (
                <VolumeX className="size-5" aria-hidden />
              ) : (
                <Volume2 className="size-5" aria-hidden />
              )}
            </button>

            <button
              type="button"
              onClick={goFullscreen}
              aria-label="Exit fullscreen"
              className="grid size-9 shrink-0 place-items-center text-white/85 transition-colors hover:text-white"
            >
              <Minimize2 className="size-5" aria-hidden />
            </button>
          </div>
        ) : null}

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
        <Button
          size="icon"
          variant="secondary"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause  ·  Space" : "Play  ·  Space"}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={restart}
          aria-label="Restart"
          title="Back to the start  ·  Home"
        >
          <RotateCcw className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setMuted((value) => !value)}
          aria-label={muted ? "Unmute" : "Mute"}
          title={`${muted ? "Unmute" : "Mute"} the narration  ·  M`}
          disabled={!hasNarration}
        >
          {muted || !hasNarration ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </Button>

        <Button
          size="icon"
          variant="ghost"
          onClick={() => setSoundOn((value) => !value)}
          aria-label={soundOn ? "Turn off music and effects" : "Turn on music and effects"}
          title={`Music and effects ${soundOn ? "on" : "off"}  ·  S`}
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
          <Scrubber
            elapsed={elapsed}
            total={total}
            segments={segments}
            onSeek={seekTo}
          />
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
            {formatTime(elapsed)} / {formatTime(total)}
          </span>
        </div>

        <Button
          size="icon"
          variant="ghost"
          onClick={goFullscreen}
          aria-label="Fullscreen"
          title="Fullscreen  ·  F"
        >
          <Maximize2 className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={exportVideo}
          loading={exporting}
          disabled={!ready || (renderable === false && !mimeType)}
          title={
            offlineExport
              ? "Renders a real H.264 MP4, frame by frame"
              : mimeType
                ? "Records the canvas in real time"
                : "This browser can't export video."
          }
        >
          {exporting ? null : <Download className="size-3.5" />}
          {exporting ? "Exporting" : renderable === false ? "Export video" : "Export MP4"}
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
      {renderable === false ? (
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

/**
 * A timeline you can read, not just drag.
 *
 * Each part of the video gets a proportional lane, so the intro card, four
 * scenes and the closing card are visible as the different lengths they are.
 * Dragging works anywhere on the track — including a press-and-drag, which a
 * plain range input only gives you if you happen to grab the thumb.
 */
function Scrubber({
  elapsed,
  total,
  segments,
  onSeek,
  tone = "page",
}: {
  elapsed: number;
  total: number;
  segments: Array<{ label: string; at: number; span: number }>;
  onSeek: (seconds: number) => void;
  /** `light` for the fullscreen bar, which sits on black rather than on the page. */
  tone?: "page" | "light";
}) {
  const lane = tone === "light" ? "bg-white/25" : "bg-surface-hover";
  const fill = tone === "light" ? "bg-white" : "bg-ink";
  const track = useRef<HTMLDivElement>(null);
  const span = Math.max(total, 0.1);
  const progress = clamp01(elapsed / span);

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const node = track.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      onSeek(clamp01((clientX - rect.left) / Math.max(1, rect.width)) * span);
    },
    [onSeek, span],
  );

  return (
    <div
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(span)}
      aria-valuenow={Math.round(elapsed)}
      aria-valuetext={`${formatTime(elapsed)} of ${formatTime(span)}`}
      onPointerDown={(event) => {
        // Capture so a drag that leaves the track keeps scrubbing, which is
        // what every video player does and a range input does not.
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromEvent(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromEvent(event.clientX);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onSeek(elapsed + 5);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          onSeek(elapsed - 5);
        }
      }}
      className="group/scrub relative h-6 w-full cursor-pointer touch-none select-none"
    >
      {/* the lanes */}
      <div className="absolute inset-x-0 top-1/2 flex h-1.5 -translate-y-1/2 gap-px overflow-hidden rounded-full">
        {segments.map((segment) => (
          <span
            key={segment.at}
            title={`${segment.label} · ${segment.span.toFixed(1)}s`}
            style={{ width: `${(segment.span / span) * 100}%` }}
            className={cn("h-full", lane)}
          />
        ))}
      </div>

      {/* played */}
      <div
        className={cn("pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full", fill)}
        style={{ width: `${progress * 100}%` }}
      />

      {/* the head */}
      <span
        className={cn(
          "pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform group-hover/scrub:scale-125",
          fill,
        )}
        style={{ left: `${progress * 100}%` }}
        aria-hidden
      />
    </div>
  );
}

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
