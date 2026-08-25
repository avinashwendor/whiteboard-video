"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Captions,
  Clapperboard,
  Download,
  FileText,
  Film,
  Music,
  X,
} from "lucide-react";
import { useEditorStore } from "@/rescript/lib/store";
import { trackEvent } from "@/rescript/lib/telemetry";
import { currentComposition, useOverlayStore } from "@/rescript/lib/overlay/store";
import {
  canCompose,
  composeOverlays,
  needsCompositing,
} from "@/rescript/lib/overlay/compose";
import {
  FRAME_ASPECTS,
  frameRatio,
  outputSize,
  type FrameAspectId,
} from "@/rescript/lib/overlay/types";
import { useOutputTimeline } from "@/rescript/hooks/useOverlayTimeline";
import { formatTime, getEditedDuration, getKeepRanges } from "@/rescript/lib/edits";
import {
  exportAudio,
  exportVideo,
  type AudioExportFormat,
  type VideoExportFormat,
  type VideoExportResolution,
} from "@/rescript/lib/ffmpeg";
import {
  compositionFor,
  extraTargets,
  nameFor,
} from "@/rescript/lib/overlay/deliver";
import {
  downloadTranscript,
  type SubtitleFormat,
  type TranscriptDocFormat,
} from "@/rescript/lib/serializeTranscript";
import {
  downloadTimelineExport,
  TIMELINE_FORMATS,
  TIMELINE_FRAME_RATES,
  type TimelineExportFormat,
  type TimelineFrameRate,
} from "@/rescript/lib/serializeTimeline";
import { AAF_MAX_CLIPS } from "@/rescript/lib/aaf/patchAaf";
import { useCutRanges } from "@/rescript/hooks/useCutRanges";
import { useI18n } from "./I18nProvider";
import { localizeRuntimeMessage } from "@/rescript/lib/i18n";
import { en } from "@/rescript/lib/i18n/messages/en";

type ExportTab = "video" | "audio" | "transcript" | "subtitles" | "timeline";

const VIDEO_FORMATS: { value: VideoExportFormat; label: string }[] = [
  { value: "mp4", label: "MP4" },
  { value: "webm", label: "WebM" },
];

const VIDEO_RESOLUTIONS: { value: VideoExportResolution; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "720", label: "720p" },
  { value: "1080", label: "1080p" },
  { value: "2160", label: "4K" },
];

const AUDIO_FORMATS: { value: AudioExportFormat; label: string }[] = [
  { value: "m4a", label: "M4A" },
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
];

const TRANSCRIPT_FORMATS: { value: TranscriptDocFormat; label: string }[] = [
  { value: "txt", label: "Plain text" },
  { value: "md", label: "Markdown" },
];

const SUBTITLE_FORMATS: { value: SubtitleFormat; label: string }[] = [
  { value: "srt", label: "SRT" },
  { value: "vtt", label: "VTT" },
  { value: "json", label: "JSON" },
];

export default function ExportDialog() {
  const { t } = useI18n();
  const open = useEditorStore((s) => s.exportOpen);
  const setOpen = useEditorStore((s) => s.setExportOpen);
  const videoFile = useEditorStore((s) => s.videoFile);
  const mediaKind = useEditorStore((s) => s.mediaKind);
  const duration = useEditorStore((s) => s.duration);
  const words = useEditorStore((s) => s.words);
  const speakers = useEditorStore((s) => s.speakers);
  const hasAudioTrack = useEditorStore((s) => s.hasAudio);
  const status = useEditorStore((s) => s.status);
  const setStatus = useEditorStore((s) => s.setStatus);
  const exportUrl = useEditorStore((s) => s.exportUrl);
  const setExportUrl = useEditorStore((s) => s.setExportUrl);

  const isAudioProject = mediaKind === "audio";
  const [tab, setTab] = useState<ExportTab>("video");
  const [videoFormat, setVideoFormat] = useState<VideoExportFormat>("mp4");
  const [resolution, setResolution] = useState<VideoExportResolution>("original");
  /**
   * Extra shapes to deliver beside the one the project is framed in.
   *
   * The cut is aspect-independent — ffmpeg trims the media once and only the
   * composite pass knows what shape the output is — so three deliverables cost
   * one trim and three composites, and the composite is the fast half.
   */
  const [alsoMake, setAlsoMake] = useState<FrameAspectId[]>([]);
  const [extras, setExtras] = useState<{ name: string; url: string }[]>([]);
  const [audioFormat, setAudioFormat] = useState<AudioExportFormat>("m4a");
  const [transcriptFormat, setTranscriptFormat] =
    useState<TranscriptDocFormat>("txt");
  const [subtitleFormat, setSubtitleFormat] = useState<SubtitleFormat>("srt");
  const [timelineFormat, setTimelineFormat] =
    useState<TimelineExportFormat>("resolve");
  const [timelineFrameRate, setTimelineFrameRate] =
    useState<TimelineFrameRate>("30");
  const [timelineBusy, setTimelineBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cuts = useCutRanges();
  const timeline = useOutputTimeline();
  const compositionElements = useOverlayStore((s) => s.elements);
  const compositionSubtitles = useOverlayStore((s) => s.subtitles);
  const compositionTransitions = useOverlayStore((s) => s.transitions);
  const compositionFrame = useOverlayStore((s) => s.frame);
  const compositionShots = useOverlayStore((s) => s.shots);
  const compositionGrade = useOverlayStore((s) => s.grade);
  const compositionAudio = useOverlayStore((s) => s.audio);
  const sourceAspect = useOverlayStore((s) => s.sourceAspect);
  /**
   * Whether captions, overlays or transitions have to be rendered into the
   * file. Recomputed here rather than read once at export time so the format
   * picker can reflect it.
   */
  const hasComposition = useMemo(
    () =>
      needsCompositing(
        {
          elements: compositionElements,
          subtitles: compositionSubtitles,
          transitions: compositionTransitions,
          frame: compositionFrame,
          shots: compositionShots,
          grade: compositionGrade,
          audio: compositionAudio,
        },
        sourceAspect
      ),
    [
      compositionElements,
      compositionSubtitles,
      compositionTransitions,
      compositionFrame,
      compositionShots,
      compositionGrade,
      compositionAudio,
      sourceAspect,
    ]
  );

  /**
   * The size the file will actually be.
   *
   * Worth stating outright rather than leaving to be discovered on download:
   * once the frame can differ from the footage, "1080p" no longer tells you the
   * shape of what you are about to get.
   */
  const frameSize = useMemo(() => {
    const videoEl = useEditorStore.getState().videoEl as HTMLVideoElement | null;
    const nativeWidth = videoEl?.videoWidth || 1920;
    const nativeHeight = videoEl?.videoHeight || 1080;
    const scaled =
      resolution === "original" ? null : Number.parseInt(resolution, 10);
    const ratio = frameRatio(compositionFrame, nativeWidth / nativeHeight);
    // The ffmpeg pass scales to the requested height first; the compositor then
    // sizes the frame against that picture, so the same number is used here.
    const base = scaled
      ? { width: (nativeWidth / nativeHeight) * scaled, height: scaled }
      : { width: nativeWidth, height: nativeHeight };
    return outputSize(ratio, base.width, base.height);
  }, [compositionFrame, resolution]);

  /**
   * The shapes worth offering beside the one the project is already in.
   *
   * Compared by shape rather than by name, so a 16:9 project is not offered
   * "Source" and a 4:3 recording is not offered 4:3 — either would produce two
   * identical files and a question about which is which.
   */
  const otherShapes = useMemo(
    () =>
      extraTargets(
        compositionFrame.aspect,
        sourceAspect,
        resolution === "original" ? undefined : Number.parseInt(resolution, 10)
      ),
    [compositionFrame.aspect, sourceAspect, resolution]
  );

  const frameLabel =
    FRAME_ASPECTS.find((a) => a.id === compositionFrame.aspect)?.label ??
    "Source";
  const editedDuration = useMemo(
    () => getEditedDuration(cuts, duration),
    [cuts, duration]
  );
  const keepRangeCount = useMemo(
    () => getKeepRanges(cuts, duration).length,
    [cuts, duration]
  );
  const aafOverCap =
    timelineFormat === "aaf" && keepRangeCount > AAF_MAX_CLIPS;
  const exporting = status === "exporting";
  const dialogBusy = exporting || timelineBusy;
  const hasWords = words.length > 0;

  // Fall back when the remembered tab isn't valid for this project.
  const activeTab: ExportTab =
    tab === "video" && isAudioProject
      ? "audio"
      : tab === "audio" && !hasAudioTrack
        ? isAudioProject
          ? "timeline"
          : "video"
        : (tab === "transcript" || tab === "subtitles") && !hasWords
          ? isAudioProject
            ? hasAudioTrack
              ? "audio"
              : "timeline"
            : "video"
          : tab;

  const baseName = videoFile
    ? videoFile.name.replace(/\.[^.]+$/, "")
    : "edited";

  const mediaExt =
    activeTab === "audio"
      ? audioFormat
      : videoFormat === "webm" && !hasComposition
        ? "webm"
        : "mp4";
  const mediaFileName = `${baseName}.edited.${mediaExt}`;

  const clearMediaExport = useCallback(() => {
    const prev = useEditorStore.getState().exportUrl;
    if (prev) URL.revokeObjectURL(prev);
    setExportUrl(null);
    setProgress(0);
  }, [setExportUrl]);

  const selectTab = useCallback(
    (next: ExportTab) => {
      setTab((prev) => {
        if (prev === next) return prev;
        clearMediaExport();
        setError(null);
        return next;
      });
    },
    [clearMediaExport]
  );

  const setVideoFormatOption = useCallback(
    (value: VideoExportFormat) => {
      setVideoFormat((prev) => {
        if (prev === value) return prev;
        clearMediaExport();
        return value;
      });
    },
    [clearMediaExport]
  );

  const setResolutionOption = useCallback(
    (value: VideoExportResolution) => {
      setResolution((prev) => {
        if (prev === value) return prev;
        clearMediaExport();
        return value;
      });
    },
    [clearMediaExport]
  );

  const setAudioFormatOption = useCallback(
    (value: AudioExportFormat) => {
      setAudioFormat((prev) => {
        if (prev === value) return prev;
        clearMediaExport();
        return value;
      });
    },
    [clearMediaExport]
  );

  const startMediaExport = useCallback(async () => {
    if (!videoFile) return;
    if (activeTab === "video" && isAudioProject) return;
    if (activeTab === "audio" && !hasAudioTrack) return;

    setError(null);
    setProgress(0);
    setStage(null);
    setStatus("exporting");
    try {
      const keeps = getKeepRanges(cuts, duration);
      const composition = currentComposition();
      // Compositing runs as a second pass over ffmpeg's output, so the cut
      // itself is unaffected by whether there is anything on top of it.
      const burnIn =
        activeTab === "video" && needsCompositing(composition, sourceAspect);
      // Keep the container honest with what the compositor can actually emit.
      const container: VideoExportFormat = burnIn ? "mp4" : videoFormat;

      let blob =
        activeTab === "audio"
          ? await exportAudio(videoFile, keeps, editedDuration, setProgress, {
              format: audioFormat,
            })
          : await exportVideo(
              videoFile,
              keeps,
              editedDuration,
              // Leave the back half of the bar for the composite when there is
              // one, so the number never goes backwards.
              (ratio) => setProgress(burnIn ? ratio * 0.45 : ratio),
              {
                withAudio: hasAudioTrack,
                format: container,
                resolution,
              }
            );

      // Held because every extra shape composites from the *cut*, not from a
      // finished file: compositing a composite burns the captions in twice.
      const cutOnly = blob;

      if (burnIn) {
        if (!canCompose()) {
          throw new Error(
            "This browser can't burn in captions and overlays — it has no video encoder. Try Chrome, Edge or Safari."
          );
        }
        setStage("Compositing");
        const composited = await composeOverlays({
          source: blob,
          composition,
          timeline,
          withAudio: hasAudioTrack,
          onProgress: (fraction, label) => {
            setProgress(0.45 + fraction * 0.55);
            setStage(label);
          },
        });
        blob = composited.blob;
        setStage(null);
      }

      // The other shapes, from the same trimmed source. `blob` at this point
      // is already composited for the project's own frame, so each extra
      // re-composites the *cut* rather than the finished file — compositing a
      // composite would burn the captions in twice, at two different sizes.
      const madeExtras: { name: string; url: string }[] = [];
      if (activeTab === "video" && alsoMake.length > 0 && canCompose()) {
        for (const [i, aspect] of alsoMake.entries()) {
          setStage(`Also making ${aspect}`);
          setProgress(i / alsoMake.length);
          const shaped = await composeOverlays({
            source: cutOnly,
            composition: compositionFor(composition, aspect, sourceAspect),
            timeline,
            withAudio: hasAudioTrack,
            onProgress: (fraction) =>
              setProgress((i + fraction) / alsoMake.length),
          });
          madeExtras.push({
            name: nameFor(mediaFileName, aspect, "mp4"),
            url: URL.createObjectURL(shaped.blob),
          });
        }
        setStage(null);
      }

      for (const extra of extras) URL.revokeObjectURL(extra.url);
      setExtras(madeExtras);

      const prev = useEditorStore.getState().exportUrl;
      if (prev) URL.revokeObjectURL(prev);
      setExportUrl(URL.createObjectURL(blob));
      trackEvent("export_completed", {
        kind: activeTab,
        format: activeTab === "audio" ? audioFormat : videoFormat,
        ...(activeTab === "audio" ? {} : { resolution }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : en["error.export"]);
    } finally {
      setStatus("ready");
    }
  }, [
    videoFile,
    activeTab,
    alsoMake,
    extras,
    mediaFileName,
    isAudioProject,
    hasAudioTrack,
    cuts,
    duration,
    editedDuration,
    audioFormat,
    videoFormat,
    resolution,
    timeline,
    sourceAspect,
    setStatus,
    setExportUrl,
  ]);

  const exportText = useCallback(
    (kind: "transcript" | "subtitles") => {
      if (!hasWords) return;
      const format = kind === "transcript" ? transcriptFormat : subtitleFormat;
      try {
        downloadTranscript(words, format, baseName, {
          duration,
          cuts,
          speakers,
        });
        setError(null);
        trackEvent("export_completed", { kind, format });
      } catch (err) {
        setError(err instanceof Error ? err.message : en["error.export"]);
      }
    },
    [
      hasWords,
      words,
      speakers,
      transcriptFormat,
      subtitleFormat,
      baseName,
      duration,
      cuts,
    ]
  );

  const exportTimeline = useCallback(async () => {
    if (!videoFile) return;
    setTimelineBusy(true);
    setError(null);
    try {
      const keeps = getKeepRanges(cuts, duration);
      const videoEl = useEditorStore.getState().videoEl;
      const width =
        videoEl && "videoWidth" in videoEl
          ? (videoEl as HTMLVideoElement).videoWidth || 1920
          : 1920;
      const height =
        videoEl && "videoHeight" in videoEl
          ? (videoEl as HTMLVideoElement).videoHeight || 1080
          : 1080;
      await downloadTimelineExport(timelineFormat, {
        keepRanges: keeps,
        duration,
        mediaFileName: videoFile.name,
        projectName: baseName,
        frameRate: timelineFrameRate,
        withVideo: !isAudioProject,
        withAudio: hasAudioTrack,
        width,
        height,
      });
      trackEvent("export_completed", { kind: "timeline", format: timelineFormat });
    } catch (err) {
      setError(err instanceof Error ? err.message : en["error.timelineExport"]);
    } finally {
      setTimelineBusy(false);
    }
  }, [
    videoFile,
    cuts,
    duration,
    timelineFormat,
    timelineFrameRate,
    baseName,
    isAudioProject,
    hasAudioTrack,
  ]);

  if (!open) return null;

  const tabs: {
    id: ExportTab;
    label: string;
    icon: typeof Film;
    disabled?: boolean;
    title?: string;
  }[] = [
    {
      id: "video",
      label: t("export.video"),
      icon: Film,
      disabled: isAudioProject,
      title: isAudioProject
        ? t("export.videoUnavailable")
        : undefined,
    },
    {
      id: "audio",
      label: t("export.audio"),
      icon: Music,
      disabled: !hasAudioTrack,
      title: !hasAudioTrack ? t("export.noAudio") : undefined,
    },
    {
      id: "transcript",
      label: t("export.transcript"),
      icon: FileText,
      disabled: !hasWords,
      title: !hasWords ? t("export.noWordsFirst") : undefined,
    },
    {
      id: "subtitles",
      label: t("export.subtitles"),
      icon: Captions,
      disabled: !hasWords,
      title: !hasWords ? t("export.noWordsFirst") : undefined,
    },
    {
      id: "timeline",
      label: t("export.timeline"),
      icon: Clapperboard,
      title: t("export.timelineTitle"),
    },
  ];

  // app-no-drag: the backdrop covers the draggable top bar, so it needs to take
  // clicks (dismiss) rather than letting them move the window.
  return (
    <div
      className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 backdrop-blur-sm dark:bg-black/60"
      onClick={() => !dialogBusy && setOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900 dark:shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {t("export.title")}
          </h2>
          <button
            onClick={() => setOpen(false)}
            disabled={dialogBusy}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="mb-5 grid grid-cols-5 gap-0.5 rounded-xl bg-zinc-100 p-0.5 dark:bg-zinc-800"
          role="tablist"
          aria-label={t("export.type")}
        >
          {tabs.map(({ id, label, icon: Icon, disabled, title }) => {
            const selected = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                disabled={disabled || dialogBusy}
                title={title}
                onClick={() => selectTab(id)}
                className={`flex h-9 items-center justify-center gap-1.5 rounded-[0.625rem] text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  selected
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                <Icon size={13} className="shrink-0 opacity-70" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            );
          })}
        </div>

        {(activeTab === "video" ||
          activeTab === "audio" ||
          activeTab === "timeline") && (
          <div className="mb-5 grid grid-cols-3 gap-2 text-center">
            <Stat label={t("export.statOriginal")} value={formatTime(duration)} />
            <Stat label={t("export.statCuts")} value={String(cuts.length)} />
            <Stat label={t("export.statEdited")} value={formatTime(editedDuration)} accent />
          </div>
        )}

        {activeTab === "video" && (
          <div className="mb-5 space-y-4">
            <OptionGroup
              label={t("export.format")}
              value={hasComposition ? "mp4" : videoFormat}
              options={VIDEO_FORMATS}
              // Burning the composition in re-encodes through the browser's
              // H.264 encoder and muxes to MP4; there is no WebM path for it.
              // Better to take the choice away with a reason than to hand back
              // an MP4 wearing a .webm extension.
              disabled={exporting || hasComposition}
              onChange={setVideoFormatOption}
            />
            {hasComposition && (
              <p className="-mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                MP4, because captions, overlays and transitions are rendered into
                the picture. The audio is copied across untouched.
              </p>
            )}
            <OptionGroup
              label={t("export.resolution")}
              value={resolution}
              options={VIDEO_RESOLUTIONS.map((option) =>
                option.value === "original"
                  ? { ...option, label: t("export.original") }
                  : option
              )}
              disabled={exporting}
              onChange={setResolutionOption}
            />
            <p className="-mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              {frameLabel} frame — {frameSize.width}×{frameSize.height}. Change it
              in the Frame tab.
            </p>

            {canCompose() && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  Also make
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {otherShapes.map((target) => {
                    const on = alsoMake.includes(target.aspect);
                    return (
                      <button
                        key={target.aspect}
                        type="button"
                        disabled={exporting}
                        title={`${target.width}×${target.height}`}
                        onClick={() =>
                          setAlsoMake((prev) =>
                            prev.includes(target.aspect)
                              ? prev.filter((a) => a !== target.aspect)
                              : [...prev, target.aspect]
                          )
                        }
                        className={`cursor-pointer rounded-lg border px-2 py-1 text-[11px] font-medium transition disabled:opacity-40 ${
                          on
                            ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                            : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500"
                        }`}
                      >
                        {target.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {alsoMake.length === 0
                    ? "The same edit in other shapes. The cut is only made once, so each extra costs a re-render and not a re-cut."
                    : `${alsoMake.length + 1} files from one edit.`}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === "audio" && (
          <div className="mb-5">
            <OptionGroup
              label={t("export.format")}
              value={audioFormat}
              options={AUDIO_FORMATS}
              disabled={exporting}
              onChange={setAudioFormatOption}
            />
          </div>
        )}

        {activeTab === "transcript" && (
          <div className="mb-5 space-y-3">
            <OptionGroup
              label={t("export.format")}
              value={transcriptFormat}
              options={TRANSCRIPT_FORMATS.map((option) =>
                option.value === "txt"
                  ? { ...option, label: t("export.plainText") }
                  : option
              )}
              onChange={setTranscriptFormat}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("export.transcriptHelp")}
            </p>
          </div>
        )}

        {activeTab === "subtitles" && (
          <div className="mb-5 space-y-3">
            <OptionGroup
              label={t("export.format")}
              value={subtitleFormat}
              options={SUBTITLE_FORMATS}
              onChange={setSubtitleFormat}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("export.subtitlesHelp")}
            </p>
          </div>
        )}

        {activeTab === "timeline" && (
          <div className="mb-5 space-y-4">
            <OptionGroup
              label={t("export.nle")}
              value={timelineFormat}
              options={TIMELINE_FORMATS.map(({ value, label }) => ({
                value,
                label,
              }))}
              disabled={timelineBusy}
              onChange={setTimelineFormat}
            />
            <div>
              <p className="mb-2 text-[11px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
                {t("export.frameRate")}
              </p>
              <div
                className="grid grid-cols-4 gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800"
                role="radiogroup"
                aria-label={t("export.frameRate")}
              >
                {TIMELINE_FRAME_RATES.map((opt) => {
                  const selected = timelineFrameRate === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={timelineBusy}
                      onClick={() => setTimelineFrameRate(opt.value)}
                      className={`flex h-8 items-center justify-center rounded-md px-1 text-[11px] font-medium tabular-nums transition disabled:opacity-40 ${
                        selected
                          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                          : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("export.timelineHelp")}{" "}
              {t(
                timelineFormat === "aaf"
                  ? "export.timelineHelpAaf"
                  : timelineFormat === "fcpx"
                    ? "export.timelineHelpFcpx"
                    : timelineFormat === "premiere"
                      ? "export.timelineHelpPremiere"
                      : "export.timelineHelpResolve"
              )}
            </p>
            {aafOverCap && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                {t("export.aafOverCap", {
                  count: keepRangeCount,
                  max: AAF_MAX_CLIPS,
                })}
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/30 dark:bg-red-950/30 dark:text-red-900">
            {localizeRuntimeMessage(error, t)}
          </p>
        )}

        {(activeTab === "video" || activeTab === "audio") &&
          (exporting ? (
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-zinc-700 dark:text-zinc-200">
                  {t("export.rendering")}
                </span>
                <span className="tabular-nums text-zinc-400 dark:text-zinc-500">
                  {stage ? `${stage} · ` : ""}{Math.round(progress * 100)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-neutral-500 transition-[width] duration-300 dark:bg-neutral-400"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
                {t("export.encodingHelp")}
              </p>
            </div>
          ) : exportUrl ? (
            <div className="flex flex-col gap-2">
              <a
                href={exportUrl}
                download={mediaFileName}
                className="flex h-10 items-center justify-center gap-2 rounded-xl bg-neutral-600 px-4 text-sm font-medium text-white transition hover:bg-neutral-500 dark:bg-neutral-500 dark:hover:bg-neutral-400"
              >
                <Download size={15} className="shrink-0" />
                <span className="truncate">{t("export.downloadFile", { name: mediaFileName })}</span>
              </a>
              {extras.map((extra) => (
                <a
                  key={extra.url}
                  href={extra.url}
                  download={extra.name}
                  className="flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 px-4 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
                >
                  <Download size={15} className="shrink-0" />
                  <span className="truncate">{extra.name}</span>
                </a>
              ))}
              <button
                onClick={startMediaExport}
                className="h-10 rounded-xl text-sm font-medium text-zinc-500 transition hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                {t("export.reexport")}
              </button>
            </div>
          ) : (
            <button
              onClick={startMediaExport}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Download size={15} />
              {t("export.exportFormat", {
                format:
                  activeTab === "audio"
                    ? audioFormat.toUpperCase()
                    : videoFormat.toUpperCase(),
              })}
            </button>
          ))}

        {activeTab === "transcript" && (
          <button
            onClick={() => exportText("transcript")}
            disabled={!hasWords}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Download size={15} />
            {t("export.downloadFormat", { format: transcriptFormat })}
          </button>
        )}

        {activeTab === "subtitles" && (
          <button
            onClick={() => exportText("subtitles")}
            disabled={!hasWords}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Download size={15} />
            {t("export.downloadFormat", { format: subtitleFormat })}
          </button>
        )}

        {activeTab === "timeline" && (
          <button
            onClick={exportTimeline}
            disabled={timelineBusy || !videoFile || aafOverCap}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Download size={15} />
            {timelineBusy
              ? t("export.preparing")
              : t("export.downloadFormat", {
                  format:
                    TIMELINE_FORMATS.find((f) => f.value === timelineFormat)
                      ?.ext ?? "xml",
                })}
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-3 ${
        accent
          ? "bg-neutral-50 dark:bg-neutral-800/60"
          : "bg-zinc-50 dark:bg-zinc-800/60"
      }`}
    >
      <p
        className={`text-xs ${
          accent
            ? "text-neutral-400 dark:text-neutral-500"
            : "text-zinc-400 dark:text-zinc-500"
        }`}
      >
        {label}
      </p>
      <p
        className={`mt-0.5 text-sm font-semibold tabular-nums ${
          accent
            ? "text-neutral-700 dark:text-neutral-200"
            : "text-zinc-800 dark:text-zinc-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function OptionGroup<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      <div
        className="grid gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        role="radiogroup"
        aria-label={label}
      >
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={`flex h-8 items-center justify-center rounded-md px-1 text-xs font-medium transition disabled:opacity-40 ${
                selected
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
