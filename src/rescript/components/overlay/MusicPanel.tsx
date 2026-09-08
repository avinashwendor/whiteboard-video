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
import {
  Button,
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

/* -------------------------------- voiceover -------------------------------- */

interface VoiceEngine {
  id: string;
  label: string;
}

interface VoiceOption {
  id: string;
  name: string;
  accent?: string;
  isIndian?: boolean;
}

/**
 * Narration, spoken into the cut.
 *
 * The audio layer has had a `voice` kind since it was written and nothing in
 * this editor could ever make one: speech was something the studio did to a
 * script, and this side of the app only ever cut speech that already existed.
 * But an edit made here is full of places where there is picture and no voice —
 * a b-roll insert, an opening title, a stretch where the tangent was cut out —
 * and "say this over that" is the obvious thing to want there.
 *
 * The engine is picked before the voice, in that order, because the second
 * depends on the first: no two engines share a voice id, and a voice chosen
 * from one engine's catalogue and sent to another resolves to that engine's
 * default without saying so.
 */
function VoiceoverSection({
  playhead,
  duration,
  onPlaced,
}: {
  playhead: number;
  duration: number;
  onPlaced: (clip: {
    src: string;
    name: string;
    seconds: number;
    engine: string;
  }) => void;
}) {
  const [engines, setEngines] = useState<VoiceEngine[]>([]);
  const [engine, setEngine] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The catalogue for whichever engine is selected. Refetched on a change of
  // engine rather than filtered client-side: the voices are the engine's, and
  // there is no shared list to filter.
  useEffect(() => {
    let alive = true;
    fetch(`/api/models?provider=${encodeURIComponent(engine || "voice")}`)
      .then((r) => r.json())
      .then(
        (json: {
          provider?: string;
          voices?: VoiceOption[];
          engines?: VoiceEngine[];
          notice?: string;
        }) => {
          if (!alive) return;
          setError(null);
          setEngines(json.engines ?? []);
          setNotice(json.notice ?? null);
          setVoices(json.voices ?? []);
          // Whatever the server resolved, so the label matches what will speak.
          if (!engine && json.provider) setEngine(json.provider);
          setVoiceId((current) =>
            json.voices?.some((v) => v.id === current)
              ? current
              : (json.voices?.[0]?.id ?? "")
          );
        }
      )
      .catch(() => {
        if (alive) setError("Couldn't reach the voice catalogue.");
      });
    return () => {
      alive = false;
    };
  }, [engine]);

  const speak = useCallback(async () => {
    const transcript = line.trim();
    if (!transcript || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          ...(engine ? { provider: engine } : {}),
          ...(voiceId ? { voiceId } : {}),
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        audioUrl?: string;
        duration?: number;
        provider?: string;
        error?: { message?: string };
      };
      if (!json.success || !json.audioUrl) {
        throw new Error(json.error?.message ?? "The voice came back empty.");
      }

      // Engines that return word timings hand back a duration; the rest do not,
      // and a clip whose length is a guess either cuts the last word off or
      // holds silence after it. Reading it off the file is exact and costs one
      // metadata fetch of something already in the browser's cache.
      const seconds = json.duration ?? (await audioDuration(json.audioUrl));
      onPlaced({
        src: json.audioUrl,
        name: transcript.slice(0, 32),
        seconds,
        engine: json.provider ?? engine ?? "voice",
      });
      setLine("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That couldn't be spoken.");
    } finally {
      setBusy(false);
    }
  }, [busy, engine, line, onPlaced, voiceId]);

  const room = Math.max(0, duration - playhead);

  return (
    <Section title="Voiceover">
      {engines.length > 1 && (
        <Row label="Engine" hint="The voices below belong to it">
          <Select
            value={engine}
            options={engines.map((e) => ({ value: e.id, label: e.label }))}
            onChange={setEngine}
          />
        </Row>
      )}
      {voices.length > 0 && (
        <Row label="Voice">
          <Select
            value={voiceId}
            options={voices.map((v) => ({
              value: v.id,
              label: `${v.name}${v.isIndian ? " 🇮🇳" : ""}${v.accent ? ` · ${v.accent}` : ""}`,
            }))}
            onChange={setVoiceId}
          />
        </Row>
      )}
      <textarea
        value={line}
        onChange={(e) => setLine(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        rows={3}
        placeholder="What should be said here?"
        className="mt-1.5 w-full resize-none rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] leading-relaxed text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="min-w-0 text-[10px] leading-tight text-zinc-400 dark:text-zinc-600">
          {notice ??
            `Lands at ${formatSeconds(playhead)}, over the ${formatSeconds(room)} that follows.`}
        </p>
        <Button
          variant="solid"
          onClick={() => void speak()}
          disabled={busy || !line.trim() || voices.length === 0}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : "Speak it here"}
        </Button>
      </div>
      {error && (
        <p className="mt-1.5 px-1 text-[11px] leading-relaxed text-red-500">{error}</p>
      )}
    </Section>
  );
}

/** Length of an audio file, read off the file rather than estimated. */
function audioDuration(src: string): Promise<number> {
  return new Promise((resolve) => {
    const probe = new Audio();
    const done = (value: number) => {
      probe.src = "";
      resolve(value);
    };
    probe.addEventListener("loadedmetadata", () =>
      done(Number.isFinite(probe.duration) ? probe.duration : 4)
    );
    // A file that will not report its length still has to place *something*,
    // and four seconds of narration is a sentence.
    probe.addEventListener("error", () => done(4));
    probe.preload = "metadata";
    probe.src = src;
  });
}

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

  /**
   * Drop a spoken line into the mix where the playhead is.
   *
   * No credit and no ducking. It was generated for this video so there is
   * nobody to attribute, and it is the thing being listened to — a narration
   * that pulls itself down under the speech it is narrating over would be
   * fighting the mix rather than sitting in it. What *should* duck is the bed,
   * and the bed already does.
   */
  const placeVoiceover = useCallback(
    ({
      src,
      name,
      seconds,
      engine,
    }: {
      src: string;
      name: string;
      seconds: number;
      engine: string;
    }) => {
      const start = playhead;
      addAudio({
        kind: "voice",
        name: `${name}${name.length >= 32 ? "…" : ""}`,
        src,
        start,
        // Never clipped short by the end of the video: a line that is cut off
        // mid-word is worse than one that runs to the last frame.
        end: Math.max(start + 0.2, start + seconds),
        trimIn: 0,
        gain: defaultGainFor("voice"),
        fadeIn: 0.05,
        fadeOut: 0.15,
        duck: false,
        loop: false,
        muted: false,
        credit: {
          title: name,
          artist: engine,
          licence: "Generated for this video",
          attributionRequired: false,
        },
      });
    },
    [addAudio, playhead]
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

      <VoiceoverSection
        playhead={playhead}
        duration={timeline.duration}
        onPlaced={placeVoiceover}
      />

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
