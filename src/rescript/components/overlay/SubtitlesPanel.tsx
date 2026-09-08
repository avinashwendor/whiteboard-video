"use client";

import { useCallback, useMemo } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { useEditorStore } from "@/rescript/lib/store";
import { useCutRanges } from "@/rescript/hooks/useCutRanges";
import { useOutputTime } from "@/rescript/hooks/useOverlayTimeline";
import { useOverlayStore } from "@/rescript/lib/overlay/store";
import {
  cuesAreStale,
  cuesFromStyle,
  SUBTITLE_PRESETS,
} from "@/rescript/lib/overlay/subtitles";
import type { SubtitleAnimation } from "@/rescript/lib/overlay/types";
import {
  TYPEFACES,
  typefaceOf,
  typefaceStack,
  type TypefaceId,
} from "@/rescript/lib/overlay/typefaces";
import {
  Button,
  ColorInput,
  Empty,
  Row,
  Section,
  Segmented,
  Select,
  Slider,
  TextInput,
  Toggle,
  formatSeconds,
} from "./ui";

/**
 * Burned-in captions.
 *
 * The cues come from the transcript the editor already produced, mapped onto
 * the finished video's clock — so there is nothing to transcribe again and the
 * timings are the same ones the cut was made from. Editing a cue's text here
 * changes the caption only; it is not a way to edit the video, which is what
 * the transcript panel is for.
 */
export default function SubtitlesPanel() {
  const words = useEditorStore((s) => s.words);
  const cuts = useCutRanges();
  const at = useOutputTime();

  const subtitles = useOverlayStore((s) => s.subtitles);
  // Cue length is capped by how much fits across the output frame, so a change
  // of frame restyles the captions as much as a change of font size does.
  const aspect = useOverlayStore((s) => s.aspect);
  const setEnabled = useOverlayStore((s) => s.setSubtitleEnabled);
  const setStyle = useOverlayStore((s) => s.setSubtitleStyle);
  const setCues = useOverlayStore((s) => s.setCues);
  const updateCue = useOverlayStore((s) => s.updateCue);
  const removeCue = useOverlayStore((s) => s.removeCue);

  const hasTranscript = words.some((w) => !w.deleted);

  const regenerate = useCallback(
    (overrides?: Parameters<typeof setStyle>[0]) => {
      const style = { ...useOverlayStore.getState().subtitles.style, ...overrides };
      setCues(cuesFromStyle(words, cuts, style, aspect));
    },
    [words, cuts, setCues, aspect]
  );

  /**
   * Whether the captions still say what the transcript says.
   *
   * Timings *and* text. Comparing only the timings was wrong in the one case
   * that matters most: correcting a misheard word, or switching the transcript
   * between its native script and Hinglish, changes what every caption should
   * read while leaving the count and the timings exactly as they were — so the
   * video burned in captions that disagreed with the transcript on screen
   * beside them, and nothing anywhere said so.
   */
  // Timings and text both — see `cuesAreStale`, which the export dialog also
  // asks, because somebody who never opens this tab still has to be told.
  const stale = useMemo(
    () => cuesAreStale(subtitles.cues, words, cuts, subtitles.style, aspect),
    [words, cuts, subtitles.cues, subtitles.style, aspect]
  );

  const activeIndex = subtitles.cues.findIndex(
    (cue) => at >= cue.start && at < cue.end
  );

  if (!hasTranscript) {
    return (
      <Empty>
        Subtitles are built from the transcript. Transcribe or import one first.
      </Empty>
    );
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <Section title="Captions">
        <Toggle
          checked={subtitles.enabled}
          label="Burn subtitles into the video"
          onChange={(enabled) => {
            if (enabled && !useOverlayStore.getState().subtitles.cues.length) {
              regenerate();
            }
            setEnabled(enabled);
          }}
        />
        {subtitles.cues.length > 0 && (
          <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
            {subtitles.cues.length} cues from the current cut.
          </p>
        )}
        {stale && (
          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 dark:border-amber-800/60 dark:bg-amber-950/30">
            <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
              The cut has changed since these cues were made.
            </p>
            <Button className="mt-1.5 w-full" onClick={() => regenerate()}>
              <RefreshCw size={12} /> Rebuild from the transcript
            </Button>
          </div>
        )}
      </Section>

      <Section title="Look">
        <div className="mb-2 grid grid-cols-1 gap-1.5">
          {SUBTITLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                setStyle(preset.style);
                // Line length and line count decide where cues break, so a
                // preset that changes them has to rebuild them too.
                if (
                  preset.style.maxCharsPerLine !== undefined ||
                  preset.style.maxLines !== undefined
                ) {
                  regenerate(preset.style);
                }
                setEnabled(true);
              }}
              className="cursor-pointer rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-left transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <span className="block text-[12px] font-medium text-zinc-800 dark:text-zinc-100">
                {preset.label}
              </span>
              <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                {preset.description}
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Style">
        <Row label="Size">
          <Slider
            value={subtitles.style.fontSize}
            min={0.02}
            max={0.12}
            step={0.002}
            onChange={(fontSize) => setStyle({ fontSize })}
            format={(v) => `${Math.round(v * 1000)}`}
          />
        </Row>
        <Row label="Colour">
          <ColorInput
            value={subtitles.style.color}
            onChange={(color) => setStyle({ color: color ?? "#ffffff" })}
          />
        </Row>
        <Row label="Highlight" hint="The word being spoken, under Word pop">
          <ColorInput
            value={subtitles.style.highlight}
            onChange={(highlight) => setStyle({ highlight: highlight ?? "#ffd60a" })}
          />
        </Row>
        <Row label="Behind">
          <ColorInput
            value={subtitles.style.background}
            allowNone
            onChange={(background) => setStyle({ background })}
          />
        </Row>
        <Row label="Where">
          <Segmented
            value={subtitles.style.position}
            onChange={(position) => setStyle({ position })}
            options={[
              { value: "top" as const, label: "Top" },
              { value: "center" as const, label: "Middle" },
              { value: "bottom" as const, label: "Bottom" },
            ]}
          />
        </Row>
        <Row label="Inset">
          <Slider
            value={subtitles.style.margin}
            min={0.01}
            max={0.3}
            step={0.005}
            onChange={(margin) => setStyle({ margin })}
          />
        </Row>
        <Row label="Motion">
          <Select
            value={subtitles.style.animation}
            options={[
              { value: "none" as SubtitleAnimation, label: "None" },
              { value: "fade" as SubtitleAnimation, label: "Fade" },
              { value: "pop" as SubtitleAnimation, label: "Pop" },
              { value: "karaoke" as SubtitleAnimation, label: "Word pop" },
              { value: "bounce" as SubtitleAnimation, label: "Bounce" },
            ]}
            onChange={(animation) => setStyle({ animation })}
          />
        </Row>
        <Row label="Typeface" hint="Captions are type. A condensed face fits twice the words">
          <Select
            value={typefaceOf(subtitles.style.fontFamily) ?? ("" as TypefaceId)}
            options={[
              ...(typefaceOf(subtitles.style.fontFamily)
                ? []
                : [{ value: "" as TypefaceId, label: "Custom" }]),
              ...TYPEFACES.map((face) => ({ value: face.id, label: face.label })),
            ]}
            onChange={(id) => {
              if (!id) return;
              setStyle({ fontFamily: typefaceStack(id) });
            }}
          />
        </Row>
        <Row
          label="Words a cue"
          hint="1-3 is the short-form look. Auto lets the line length decide"
        >
          <Slider
            value={subtitles.style.maxWords}
            min={0}
            max={8}
            step={1}
            onChange={(maxWords) => setStyle({ maxWords })}
            // The cue *breaks* change, so the track has to be rebuilt — unlike
            // colour or weight, which only restyle what is already there.
            onCommit={() => regenerate()}
            format={(v) => (v === 0 ? "auto" : `${v}`)}
          />
        </Row>
        <Row
          label="Stress"
          hint="Colours figures, amounts and shouted words as they go by"
        >
          <Segmented
            value={subtitles.style.emphasis}
            onChange={(emphasis) => setStyle({ emphasis })}
            options={[
              { value: "off" as const, label: "Off" },
              { value: "auto" as const, label: "Auto" },
            ]}
          />
        </Row>
        {subtitles.style.emphasis === "auto" ? (
          <Row label="Stress colour">
            <ColorInput
              value={subtitles.style.emphasisColor ?? subtitles.style.highlight}
              onChange={(emphasisColor) => setStyle({ emphasisColor })}
            />
          </Row>
        ) : null}
        <Row
          label="Grow on speech"
          hint="How much the spoken word swells. Above 1.2 it wobbles"
        >
          <Slider
            value={subtitles.style.activeScale}
            min={1}
            max={1.3}
            step={0.01}
            onChange={(activeScale) => setStyle({ activeScale })}
            format={(v) => (v <= 1.001 ? "off" : `${v.toFixed(2)}×`)}
          />
        </Row>
        <Row label="Line length">
          <Slider
            value={subtitles.style.maxCharsPerLine}
            min={12}
            max={70}
            step={1}
            onChange={(maxCharsPerLine) => setStyle({ maxCharsPerLine })}
            onCommit={() => regenerate()}
            format={(v) => `${v}`}
          />
        </Row>
        <Row label="Lines">
          <Slider
            value={subtitles.style.maxLines}
            min={1}
            max={4}
            step={1}
            onChange={(maxLines) => setStyle({ maxLines })}
            onCommit={() => regenerate()}
            format={(v) => `${v}`}
          />
        </Row>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Button
            variant={subtitles.style.uppercase ? "solid" : "ghost"}
            onClick={() => setStyle({ uppercase: !subtitles.style.uppercase })}
          >
            CAPS
          </Button>
          <Button
            variant={subtitles.style.outline ? "solid" : "ghost"}
            onClick={() => setStyle({ outline: !subtitles.style.outline })}
          >
            Outline
          </Button>
        </div>
      </Section>

      <Section
        title={`Cues (${subtitles.cues.length})`}
        action={
          <button
            type="button"
            onClick={() => regenerate()}
            title="Rebuild from the transcript"
            className="cursor-pointer text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <RefreshCw size={12} />
          </button>
        }
      >
        {subtitles.cues.length === 0 ? (
          <Empty>No cues yet. Turn subtitles on to build them.</Empty>
        ) : (
          <ul className="space-y-1">
            {subtitles.cues.map((cue, i) => (
              <li
                key={cue.id}
                className={`rounded-lg border px-2 py-1.5 transition ${
                  i === activeIndex
                    ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500/70 dark:bg-indigo-950/30"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      useEditorStore.getState().seekTo(
                        // Cue times are on the output clock; seekTo takes source
                        // time, so nudge into the cue and let the player's own
                        // cut-skipping land it on the right frame.
                        cue.start
                      )
                    }
                    className="cursor-pointer text-[10px] tabular-nums text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    {formatSeconds(cue.start)} – {formatSeconds(cue.end)}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCue(cue.id)}
                    title="Remove this cue"
                    className="cursor-pointer text-zinc-300 transition hover:text-red-600 dark:text-zinc-600 dark:hover:text-red-400"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <TextInput
                  value={cue.text}
                  onChange={(text) => updateCue(cue.id, { text })}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
