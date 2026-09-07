"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Music, Play, Plus, Search, Square, Trash2 } from "lucide-react";
import { useEditorStore } from "@/rescript/lib/store";
import { useOverlayStore } from "@/rescript/lib/overlay/store";
import { useOutputTime, useOutputTimeline } from "@/rescript/hooks/useOverlayTimeline";
import {
  creditText,
  defaultGainFor,
  type AudioKind,
} from "@/rescript/lib/overlay/audio";
import { runPlan } from "@/rescript/lib/overlay/ops";
import { Button, Empty, Row, Section, Segmented, Slider, TextInput, Toggle, formatSeconds } from "./ui";

/**
 * Music and sound effects.
 *
 * Search is server-side — the keys live there — and everything picked is
 * proxied onto our own origin before it is placed, because the editor is
 * cross-origin isolated and cross-origin audio cannot be read into the mix.
 *
 * The licence is shown on every result rather than buried in a detail view. It
 * is the thing that decides whether someone can use a track at all, and a panel
 * that hides it is a panel that gets people claimed.
 */

interface Result {
  id: string;
  provider: string;
  kind: string;
  title: string;
  artist: string;
  downloadUrl: string;
  previewUrl?: string;
  duration?: number;
  licence: {
    name: string;
    attributionRequired: boolean;
    commercialUse: boolean;
    url?: string;
  };
  pageUrl?: string;
}

/** A bed runs under everything unless told otherwise. */
const FULL_LENGTH_KINDS = new Set<AudioKind>(["music"]);

/**
 * What this panel can search.
 *
 * Video is not an `AudioKind` and never will be, but the *panel* is a media
 * search — one query box, one licence-bearing result list, one Place button —
 * and b-roll wants exactly that. Splitting it into a second panel would mean
 * two copies of the licence handling, which is the part that must not drift.
 */
type SearchKind = AudioKind | "video";

export default function MusicPanel() {
  const [kind, setKind] = useState<SearchKind>("music");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [placing, setPlacing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auditioning, setAuditioning] = useState<HTMLAudioElement | null>(null);
  const [can, setCan] = useState<Record<string, boolean>>({});
  /** The automatic pass, which is several catalogue fetches and takes a moment. */
  const [sounding, setSounding] = useState<"subtle" | "energetic" | "comedic" | null>(null);
  const [sounded, setSounded] = useState<string | null>(null);
  /**
   * Where audio comes from.
   *
   * Offered only when both are actually available — a choice between one thing
   * and a thing that is not configured is not a choice, it is a disabled
   * control that needs explaining.
   */
  const [source, setSource] = useState<"generated" | "catalogue">("generated");
  const [canGenerate, setCanGenerate] = useState<Record<string, boolean>>({});

  const clips = useOverlayStore((s) => s.audio);
  const addAudio = useOverlayStore((s) => s.addAudio);
  const addVideo = useOverlayStore((s) => s.addVideo);
  const updateAudio = useOverlayStore((s) => s.updateAudio);
  const removeAudio = useOverlayStore((s) => s.removeAudio);
  const timeline = useOutputTimeline();
  const playhead = useOutputTime();
  // Only needed so `runPlan` has a complete context; nothing about sound uses
  // it, but the shape is shared with every other operation and stays shared.
  const aspect = useOverlayStore((s) => s.aspect);

  // What this deployment can search, so the picker offers what works rather
  // than letting someone search a catalogue that will always come back empty.
  useEffect(() => {
    let alive = true;
    fetch("/api/capabilities")
      .then((r) => r.json())
      .then(
        (json: {
          media?: { kinds?: Record<string, boolean>; generate?: Record<string, boolean> };
        }) => {
          if (!alive) return;
          setCan(json.media?.kinds ?? {});
          const generate = json.media?.generate ?? {};
          setCanGenerate(generate);
          // Fall back to the catalogue when nothing can be generated, so the
          // default is always something this deployment can actually do.
          if (!generate.sfx && !generate.music) setSource("catalogue");
        }
      )
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // An audition is a plain <audio> on the *preview* URL, deliberately: it costs
  // no proxy round trip and no decode, and nothing is fetched onto our origin
  // until somebody actually chooses a track.
  const audition = useCallback(
    (result: Result) => {
      auditioning?.pause();
      if (auditioning?.dataset.id === result.id) {
        setAuditioning(null);
        return;
      }
      const el = new Audio(result.downloadUrl);
      el.dataset.id = result.id;
      el.volume = 0.7;
      el.play().catch(() => setError("That preview wouldn't play."));
      el.onended = () => setAuditioning(null);
      setAuditioning(el);
    },
    [auditioning]
  );

  useEffect(() => () => auditioning?.pause(), [auditioning]);

  /** Both available for this kind, so the choice is a real one. */
  const choosable =
    kind !== "video" &&
    (canGenerate[kind] ?? false) &&
    (can[kind] ?? false);

  const search = useCallback(async () => {
    const text = query.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Generation returns one thing that did not exist a moment ago, so there
      // is nothing to browse: it goes straight onto the timeline. Searching a
      // catalogue and choosing from results is the other shape entirely, and
      // conflating them would give a result list of one with a Place button
      // that regenerates every time it is pressed.
      if (choosable && source === "generated") {
        const audioKind = kind as AudioKind;
        const isBed = FULL_LENGTH_KINDS.has(audioKind);
        const start = isBed ? 0 : playhead;
        const end = isBed
          ? timeline.duration
          : Math.min(timeline.duration, playhead + 2.5);
        const res = await fetch("/api/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "generate",
            kind: audioKind,
            prompt: text,
            seconds: Math.max(1, end - start),
          }),
        });
        const json = (await res.json()) as {
          success?: boolean;
          url?: string;
          error?: { message?: string };
        };
        if (!json.success || !json.url) {
          throw new Error(json.error?.message ?? "That couldn't be generated.");
        }
        addAudio({
          kind: audioKind,
          name: `${text} (generated)`,
          src: json.url,
          start,
          end: Math.max(start + 0.2, end),
          trimIn: 0,
          gain: defaultGainFor(audioKind),
          fadeIn: isBed ? 1.5 : 0,
          fadeOut: isBed ? 2 : 0,
          duck: isBed,
          loop: false,
          muted: false,
          credit: {
            title: text,
            artist: "Generated",
            licence: "Generated — no attribution required",
            attributionRequired: false,
          },
        });
        setResults([]);
        return;
      }

      const res = await fetch("/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, kind, limit: 24 }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        results?: Result[];
        error?: { message?: string };
      };
      if (!json.success) throw new Error(json.error?.message ?? "That search didn't work.");
      setResults(json.results ?? []);
      if ((json.results ?? []).length === 0) {
        setError("Nothing came back. Try a broader word — “calm”, “drums”, “whoosh”.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That search didn't work.");
      setResults([]);
    } finally {
      setBusy(false);
    }
  }, [query, kind, busy, choosable, source, addAudio, playhead, timeline.duration]);

  /** Proxy the file onto our origin, then put it on the timeline. */
  const place = useCallback(
    async (result: Result) => {
      setPlacing(result.id);
      setError(null);
      try {
        const res = await fetch("/api/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "fetch",
            url: result.downloadUrl,
            filename: `${result.title.slice(0, 40)}`,
          }),
        });
        const json = (await res.json()) as {
          success?: boolean;
          url?: string;
          error?: { message?: string };
        };
        if (!json.success || !json.url) {
          throw new Error(json.error?.message ?? "That file couldn't be fetched.");
        }

        if (kind === "video") {
          // Three seconds from the playhead: a b-roll insert is a punctuation
          // mark, and a clip that runs its full fifteen seconds over a talking
          // head has stopped being b-roll and become the video.
          const start = playhead;
          const end = Math.min(timeline.duration, start + 3.5);
          addVideo(json.url, {
            name: query.trim().slice(0, 28) || result.title.slice(0, 28),
            query: query.trim(),
            start,
            end: Math.max(start + 0.5, end),
            // Down the right by default, clear of a centred speaker.
            rect: { x: 0.56, y: 0.1, w: 0.38, h: (0.38 * aspect) / (16 / 9) },
          });
          return;
        }

        const isBed = FULL_LENGTH_KINDS.has(kind as AudioKind);
        // A bed runs the length of the video from where you are; an effect is a
        // moment. Placing a sting across the whole cut is never what anyone
        // meant, and placing a bed as a three-second snippet never is either.
        const start = isBed ? 0 : playhead;
        const end = isBed
          ? timeline.duration
          : Math.min(timeline.duration, playhead + (result.duration ?? 2));

        addAudio({
          kind: kind as AudioKind,
          name: `${result.title} — ${result.artist}`,
          src: json.url,
          start,
          end: Math.max(start + 0.2, end),
          trimIn: 0,
          gain: defaultGainFor(kind as AudioKind),
          // A bed that starts and stops dead is the giveaway of an automatic
          // edit; a sting does not want a fade at all.
          fadeIn: isBed ? 1.5 : 0,
          fadeOut: isBed ? 2 : 0,
          duck: isBed,
          loop: isBed && (result.duration ?? 0) < timeline.duration,
          muted: false,
          credit: {
            title: result.title,
            artist: result.artist,
            licence: result.licence.name,
            url: result.pageUrl,
            attributionRequired: result.licence.attributionRequired,
          },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "That couldn't be added.");
      } finally {
        setPlacing(null);
      }
    },
    [addAudio, addVideo, aspect, kind, query, playhead, timeline.duration]
  );

  const credits = useMemo(() => creditText(clips), [clips]);
  const mediaKind = useEditorStore((s) => s.mediaKind);

  const KINDS: { value: SearchKind; label: string }[] = [
    { value: "music", label: "Music" },
    { value: "sfx", label: "Effects" },
    { value: "video", label: "B-roll" },
  ];

  /**
   * Sound the edit, in one go.
   *
   * Runs the same `autoSfx` operation the agent does — not a second
   * implementation of it. Placement is the hard part of a sound effect and it
   * is frame-accurate work off the cuts, the punch-ins and the captions; a
   * panel that only offered a search box was asking somebody to do that by
   * hand, one effect at a time, against a waveform.
   */
  const sound = useCallback(
    async (style: "subtle" | "energetic" | "comedic") => {
      if (sounding) return;
      setSounding(style);
      setError(null);
      setSounded(null);
      try {
        const results = await runPlan([{ op: "autoSfx", style }], {
          playhead,
          duration: timeline.duration,
          timeline,
          aspect,
        });
        const first = results[0];
        if (first?.ok) setSounded(first.message);
        else setError(first?.message ?? "Nothing could be placed.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "That didn't work.");
      } finally {
        setSounding(null);
      }
    },
    [sounding, playhead, timeline, aspect]
  );

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <Section
        title="Sound the edit"
      >
        <p className="mb-2 px-1 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-600">
          Puts effects on the moments the edit already made — the cuts, the
          punch-ins, the captions — spaced so they stay punctuation. Do the
          cutting first.
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {(["subtle", "energetic", "comedic"] as const).map((style) => (
            <Button
              key={style}
              onClick={() => void sound(style)}
              disabled={!!sounding || can.sfx === false}
            >
              {sounding === style ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                style.charAt(0).toUpperCase() + style.slice(1)
              )}
            </Button>
          ))}
        </div>
        {sounded && (
          <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-600">
            {sounded}
          </p>
        )}
      </Section>

      <Section title="Find">
        <Segmented value={kind} options={KINDS} onChange={setKind} />
        {choosable && (
          <div className="mt-2">
            <Row
              label="Source"
              hint="Generated audio matches the description exactly and needs no credit"
            >
              <Segmented
                value={source}
                onChange={setSource}
                options={[
                  { value: "generated" as const, label: "Generated" },
                  { value: "catalogue" as const, label: "Catalogue" },
                ]}
              />
            </Row>
          </div>
        )}
        {can[kind] === false && (
          <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-600">
            {kind === "sfx"
              ? "Sound effects need FREESOUND_API_KEY on the server."
              : kind === "video"
                ? "B-roll clips need PEXELS_API_KEY on the server. Free from pexels.com/api."
                : "No catalogue is configured for this."}
          </p>
        )}
        <div className="mt-2 flex items-center gap-1.5">
          <Search size={12} className="shrink-0 text-zinc-400" />
          <TextInput
            value={query}
            onChange={setQuery}
            placeholder={
              kind === "music"
                ? "calm piano, upbeat…"
                : kind === "sfx"
                  ? "whoosh, click…"
                  : "city traffic, rain, hands typing…"
            }
          />
          <Button onClick={() => void search()} disabled={busy || !query.trim()}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : "Go"}
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-600">
          Only tracks you are allowed to publish commercially are shown.
        </p>
        {error && (
          <p className="mt-1.5 px-1 text-[11px] leading-relaxed text-red-500">{error}</p>
        )}
      </Section>

      {results.length > 0 && (
        <Section title={`Results (${results.length})`}>
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
            {results.map((result) => (
              <li key={`${result.provider}-${result.id}`} className="flex items-center gap-1 p-1.5">
                {result.kind === "video" ? (
                  // A clip's preview is its poster frame, not a sound. Feeding
                  // an MP4 to `new Audio` decodes an audio track most stock
                  // footage does not have, and reports "that preview wouldn't
                  // play" for a clip that is perfectly fine.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={result.previewUrl}
                    alt=""
                    className="h-7 w-10 shrink-0 rounded-md bg-zinc-200 object-cover dark:bg-zinc-800"
                  />
                ) : (
                  <button
                    type="button"
                    title="Listen"
                    onClick={() => audition(result)}
                    className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    {auditioning?.dataset.id === result.id ? (
                      <Square size={12} />
                    ) : (
                      <Play size={12} />
                    )}
                  </button>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium text-zinc-800 dark:text-zinc-100">
                    {result.title}
                  </span>
                  <span className="block truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                    {result.artist}
                    {result.duration ? ` · ${formatSeconds(result.duration)}` : ""}
                    {` · ${result.licence.name}`}
                  </span>
                </span>
                <Button
                  onClick={() => void place(result)}
                  disabled={placing !== null}
                  title="Add to the timeline"
                >
                  {placing === result.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Plus size={12} />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`On the timeline (${clips.length})`}>
        {clips.length === 0 ? (
          <Empty>
            <Music size={12} /> Nothing added yet. The video plays with its own
            sound only.
          </Empty>
        ) : (
          <div className="space-y-2">
            {clips.map((clip) => (
              <div
                key={clip.id}
                className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700"
              >
                <div className="mb-1.5 flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-800 dark:text-zinc-100">
                    {clip.name}
                  </span>
                  <Button
                    variant="ghost"
                    title="Remove"
                    onClick={() => removeAudio(clip.id)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
                <Row label="Level">
                  <Slider
                    value={clip.gain}
                    min={0}
                    max={1}
                    step={0.02}
                    onChange={(gain) => updateAudio(clip.id, { gain })}
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                </Row>
                <Toggle
                  label="Duck under speech"
                  checked={clip.duck}
                  onChange={(duck) => updateAudio(clip.id, { duck })}
                />
                <Toggle
                  label="Loop to fill"
                  checked={clip.loop}
                  onChange={(loop) => updateAudio(clip.id, { loop })}
                />
                <p className="px-1 pt-1 text-[10px] text-zinc-400 dark:text-zinc-600">
                  {formatSeconds(clip.start)} – {formatSeconds(clip.end)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {credits && (
        <Section title="Credits owed">
          <p className="px-1 pb-1 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-600">
            These licences require attribution. Paste this wherever the video is
            published.
          </p>
          <pre className="scrollbar-thin overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-[10px] leading-relaxed whitespace-pre-wrap text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
            {credits}
          </pre>
          <Button
            onClick={() => void navigator.clipboard?.writeText(credits)}
            title="Copy the credits"
          >
            Copy
          </Button>
        </Section>
      )}

      {mediaKind === "audio" && (
        <p className="px-3 pb-3 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          This is an audio project, so anything added here mixes with the
          recording rather than sitting under a picture.
        </p>
      )}
    </div>
  );
}
