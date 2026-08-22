# Chalkline

> Describe an idea. Get a world-class narrated explainer video — script, visual scenes and a natural voice — that plays smoothly in the browser and exports to a 60 FPS video file.

[![Next.js](https://img.shields.io/badge/Next.js-16.3-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## ✨ What It Does

Chalkline is an AI-powered video studio that converts a single sentence into a fully narrated explainer video — complete with AI-written scripts, hand-drawn whiteboard sketches or cinematic modern visuals, and natural text-to-speech — all assembled in the browser and exportable as a 60 FPS MP4.

### Two Production Styles

| Style | Visual Engine |
|---|---|
| **🎨 Hand-Drawn Whiteboard** | A chisel-tip marker draws one stroke at a time, lifts, travels to the next, and writes captions. Paper grain, a rostrum camera that drifts over the work, a highlighter pass across the heading. |
| **⚡ Modern Video (Hyperframes)** | Seven cinematic shot types chosen from what each scene contains: kinetic type revealed word by word from behind a mask, Ken Burns plates under a colour grade, film grain, and weighted cuts. |

### Five Creation Modes

| Mode | Does |
|---|---|
| **🎬 Create Video** | Idea → AI storyboard → visual scenes (Whiteboard or Hyperframes) → narration → 60 FPS playable & exportable video |
| **✍️ Write** | Idea → polished long-form copy, streamed token by token |
| **🖼️ Image** | Prompt → a generated image, with the prompt auto-rewritten for quality |
| **🎙️ Voice** | Text → natural narration in any language the chosen voice speaks |
| **✂️ Edit** ([`/rescript`](#-editing-real-footage--the-transcript--composition-editor)) | Footage you already have → transcript-based cutting, on-video text/image/shape overlays, transitions, burned-in subtitles — driven by hand or by prompt |

---

## 🏗 Architecture

```
                      ┌─ /api/create ──→ Omega ──→ storyboard JSON (Zod-validated)
                      │
prompt ──→ studio ────┼─ /api/scene ───→ Omega ──→ board layout + icon geometry
                      │
                      ├─ /api/tts ─────→ Deepgram ──→ audio + word timings
                      │
                      ├─ /api/visual ──→ Tavily ──→ a real photo, vision-checked
                      │
                      └─ /api/image ───→ Pollinations ──→ bytes ──→ asset store
                            ▲
                            └── browser tries Puter first, falls back here

finished video ──→ /editor/[id] ──→ instruction ──→ /api/edit ──→ Omega ──→ ops
                                                                            │
                                        the browser runs them ──────────────┘
                                        against the same routes above
```

### Project Structure

```
src/
  app/
    (chalkline)/          the generator, under the Chalkline root layout
      page.tsx              studio: hero, composer, results, examples
      editor/[id]/page.tsx  the editor for a finished video
      history/page.tsx      gallery of past generations
    (rescript)/           the transcript editor, under its own root layout
      rescript/page.tsx     mounts the editor at /rescript, client-only
      rescript.css          Rescript's own Tailwind layer and dark variant
    api/
      generate/           Omega text, streaming or whole
      create/             storyboard planning, with one JSON repair round
      scene/              board layout: which of seven, and what sits in it
      board/              re-resolves icon geometry after a board is hand-edited
      edit/               plans a plain-language edit into a list of operations
      visual/             Tavily photo search, curated by a vision model
      image/              Pollinations, prompt rewritten first
      tts/                narration and word timings
      models/             live catalogue discovery
      capabilities/       which providers this deployment can run
      asset/[id]/         serves generated media, same-origin
      rescript/agent/      plans an overlay/cut edit; browser executes and validates
  components/
    ui/                   button, card, field, badge, skeleton
    site/                 top bar, navigation
    studio/               composer, modes, settings, results, actions
    studio/editor/        the editor: scene rail, inspector, JSON panel, ask
    whiteboard/           board renderer, stroke drawing, player, export
  lib/
    ai/                   omega, deepgram, cartesia, editor agent, image/*,
                          rescript-agent (the transcript editor's AI planner)
    video/                easing, word timings and cue planning, film grade
    hyperframes/          modern engine: shots, themes, kinetic type
    studio/               state, history, IndexedDB media cache, API client,
                          edit operations and the hand-edited-JSON schema
    validation/           Zod schemas and limits
    utils/                errors, http, rate limiting, asset store, markdown
  rescript/               the ported transcript editor, extended with a
                          composition layer, self-contained
    components/           Editor, TranscriptPanel, Timeline, ExportDialog, ...
    components/overlay/   Sidebar (AI/Add/Style/Subs/Cuts), OverlayStage (the
                          draggable/resizable canvas), OverlayTrack (the
                          timeline lane), the panels behind each tab
    hooks/                transcriber, selection, cut ranges, appearance,
                          the output-clock timeline
    lib/                  whisper/parakeet models, alignment, VAD, diarization,
                          ffmpeg, edits, waveform, NLE + AAF serialization, i18n
    lib/overlay/           types, one shared canvas renderer (preview + export),
                          animation easing, output-clock ↔ source-clock mapping,
                          subtitle-cue generation, the collision-avoidance
                          layout engine, the AI op schema + executor, footage
                          analysis, and the WebCodecs export compositor
    workers/              transcription.worker.ts (ASR off the main thread)
    LICENSE               PolyForm Noncommercial 1.0.0 — see License, below
  instrumentation-client.ts  boots the editor's crash reporter (inert w/o a DSN)
tests/                    the ported editor's suite, plus overlay-test.ts and
                          overlay-placement-test.ts for the composition layer
                          (all tsx, no runner)
assets/aaf/               metadata-only AAF scaffold, copied to public/vendor
patches/                  @huggingface/transformers timestamp-range fix
```

---

## 🔧 Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 16.3](https://nextjs.org/) (App Router) |
| **Runtime** | [React 19.2](https://react.dev/) with Server Components |
| **Language** | [TypeScript 5](https://www.typescriptlang.org/) (strict) |
| **Styling** | [Tailwind CSS 4](https://tailwindcss.com/) |
| **Validation** | [Zod 4](https://zod.dev/) |
| **Video Export** | [mp4-muxer](https://github.com/nicknisi/mp4-muxer) (client-side WebCodecs → MP4) |
| **Icons** | [Lucide React](https://lucide.dev/) |
| **Text AI** | Omega C (OpenAI-compatible API) — also plans the transcript editor's overlay/cut edits |
| **Voice AI** | [Deepgram](https://deepgram.com/) (aura-2, leads when configured) + [Cartesia](https://cartesia.ai/) (sonic-3, fallback) — both give word-level timings |
| **Image AI** | [Puter](https://puter.com/) (browser-side, primary) + [Pollinations](https://pollinations.ai/) (server fallback) for generated art; [Tavily](https://tavily.com/) for real photos |
| **Transcript editor state** | [Zustand](https://zustand-demo.pmnd.rs/) — one store for the cut, a second for the composition layer, independent undo stacks |
| **On-device ASR** | [transformers.js](https://github.com/huggingface/transformers.js) (Whisper) or [parakeet.js](https://github.com/wassgha/parakeet.js), plus `pyannote-segmentation-3.0` for diarization, all via [onnxruntime-web](https://onnxruntime.ai/) in a Web Worker |
| **Media processing** | [ffmpeg.wasm](https://ffmpegwasm.netlify.app/) — cut, re-encode, and audio graft, all client-side |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 22 (the transcript editor's toolchain — `@ffmpeg/core-mt`, `onnxruntime-web` — requires it)
- **npm** ≥ 9
- API keys (see [Environment Variables](#-environment-variables))

### Installation

```bash
# Clone the repository
git clone git@github.com:avinashwendor/whiteboard-video.git
cd whiteboard-video

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Fill in your API keys in .env.local

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🎨 The Modern look

One design system, four palettes, and every palette is built from the same five
roles: **paper, ink, one accent, one tinted surface, one highlight marker**. Nothing
in a frame uses a colour that is not one of those five. The failure mode of generated
video is four hues and a gradient fighting inside one frame, and restraint is the
whole difference between "designed" and "assembled".

The vocabulary is printed rather than cinematic:

- **Paper with a ruled grid** as the ground, drifting a few pixels a minute — too slow
  to read as motion, fast enough that the background is never a still image behind
  moving type.
- **Hard offset shadows.** A blurred drop shadow reads as a template; a solid offset
  one reads as something printed and stacked. This is the single biggest reason these
  frames don't look generic.
- **A marker swipe** behind the words that carry the point, wiping in on the word the
  narrator is actually saying — the one piece of motion that means something.
- **Outlined numerals** with an offset fill, for chapter plates and comparisons.
- **Photographs mounted in a frame**, drifting inside it (Ken Burns, direction set by
  scene index so no two consecutive shots move alike), rather than bled behind type.

Deliberately absent: vignette, film grain, letterbox bars, glass panels, neon glow,
and dips to black between scenes. They are the house style of every generated video,
they fight flat printed work, and a frame that needs them to look finished was not
composed properly. Scenes hand over through the paper instead.

Shot selection reads the scene's own content — a stat becomes a metric plate, three
bullets a step rail, two a comparison, the last scene a chapter plate — and **never
runs the same composition twice in a row**; the second one steps sideways to whatever
else the content supports.

---

## ✏️ Editing a finished video

A finished video opens at `/editor/<generation id>` — its own address, reloadable, reachable again from
History. Everything the generator produced is editable there, three ways:

- **Scene** — every field of the open scene, including **Board**: the title, captions, icons, badges and
  colours actually drawn on the canvas. Plus the four pipelines that can refill it: a real photo (Tavily),
  generated artwork, a new board layout, a new recording.
- **JSON** — the whole project as text. It is validated before it reaches the renderer, so a mistyped brace
  costs nothing; unknown keys survive the round trip.
- **Ask** — describe the change. `/api/edit` plans it into operations and the browser runs them against the
  routes above. Every step is named in the log and one Undo steps back.

The planner reaches everything the panels do:

| op | what it changes |
|---|---|
| `set` | any field of the video or a scene, including `boardTitle` |
| `setBoard` | the whole board — layout, items, pie slices, bar values, compare columns |
| `setBoardItem` | one drawn caption, icon, badge or colour |
| `relayout` | hands the board back to the scene writer to recompose |
| `findPhoto` / `generateImage` / `removeImage` | the picture beside the drawing |
| `setVoice` | re-casts the narrator (one scene or the whole video) and re-records |
| `speak` | re-records one scene |
| `addScene` / `removeScene` / `moveScene` | the storyboard |

It is told what the deployment can actually do (photo search, image generation, whether the image model can
do line art) and which narrators exist, so it never plans a step that cannot run. A plan is sifted op by op:
one malformed operation is reported in the log and skipped, and the rest still run.

Rules the executor keeps, because breaking any of them desynchronises the video: editing a narration always
drags a fresh recording along with it (the animation is scheduled against `audio.words`); a re-layout is
told whether a photograph shares the board and which layouts the other scenes already used; a renamed icon
is resolved board-wide so no two items come back the same picture; and removing a picture recomposes the
board to use the full width again.

### Two engines, two halves of a scene

Which engine a project uses decides which half of a scene is real, and the editor follows it:

- **Whiteboard** draws the composed board and ignores `heading` and `bullets` entirely.
- **Modern frames** draw `heading`, `bullets`, `keywords` and `stat` as kinetic type and ignore the board
  entirely — the shot is picked from what the scene carries (a stat makes a metric, three bullets a
  process, two a contrast).

So on a Modern video the inspector shows **Shot** instead of Board, hides the re-layout button, and flips
its field hints. The planner is told the engine too, and `setBoard`, `setBoardItem`, `relayout` and
`boardTitle` are refused there with a reason rather than silently editing data nothing renders.

Output is 1280×720. There is no portrait mode: every layout in `scene.ts` and `hyperframes/` composes
against those fixed dimensions, so a 9:16 switch would need all of them re-composed, not a resized canvas.

### Two sets of words

A whiteboard scene carries the scene's own `heading` and `bullets` **and** a composed `scene` spec — a board
title and a handful of captions. Only the second is drawn. Editing a bullet and watching the canvas not
change is the most confusing thing this editor can do, so:

- The **Board** section edits `scene.scene` directly — `boardTitle` and each item's caption and icon — and
  the canvas updates as you type.
- An icon is a *name*, not a drawing. Renaming one posts the whole board to `/api/board`, which resolves it
  through the hand-drawn set, then the 1700-icon Lucide catalogue, then a model shortlist — board-wide, so
  no two items come back as the same picture. The field then shows the name that actually matched
  ("stopwatch" comes back as "timer").
- The AI speaks the same vocabulary: `set boardTitle` and `setBoardItem` change drawn words without
  throwing the board away, which is what a `relayout` does.

Placement lives in the layout system — seven whiteboard compositions and a photo column, seven modern shots.
`relayout` is how positions, ordering and arrangement change; there are no free coordinates.

---

## 🎞️ Editing real footage — the transcript & composition editor

`/rescript` is [Rescript](https://github.com/wassgha/rescript) ported into this app end to end, then
extended into a full composition tool: a transcript-based editor for video and audio you already have,
as opposed to video Chalkline generated. Drop in a file, it is transcribed **on device** with per-word
timestamps, and deleting words in the transcript cuts the matching span out of the media. Nothing is
uploaded — there is no route behind it, only the browser.

- **Word-level editing** — select words, press ⌫, the cut follows the text
- **Import a transcript** — skip Whisper entirely and edit against an SRT, VTT, or JSON caption file
- **Filler and silence removal** — one click each for "um"/"uh" and for pauses ≥0.3s
- **Speaker diarization** — the transcript is grouped by speaker
- **Timeline** — waveform, wordbar with draggable timing handles, split, cut regions, playhead
- **Export hub** — MP4/WebM (720p–4K), M4A/MP3/WAV, TXT/MD, SRT/VTT/JSON, or an NLE timeline
  (Resolve/Premiere XML, FCPXML, Pro Tools/Logic AAF)

It runs entirely client-side: `transformers.js` (Whisper) or `parakeet.js` for ASR in a Web Worker,
`pyannote-segmentation-3.0` for speaker labels, and `ffmpeg.wasm` for audio extraction and the final
re-encode. Both wasm runtimes need `SharedArrayBuffer`, which the browser only grants to a
**cross-origin-isolated** document.

### On top of the cut: elements, transitions, subtitles

A composition layer (`src/rescript/lib/overlay/`) sits over the trimmed footage, sharing one renderer
between the live preview and the export — what you see while editing is pixel-for-pixel what ships:

- **Elements** — text, images, and shapes. Drag to move, 8-handle resize, rotate (Shift snaps to 15°),
  snap-to-centre guides, double-click to edit text in place. A layer list handles lock/hide/reorder/duplicate.
- **Generate & drop** — a tray for AI artwork (Pollinations) and real photos (Tavily); drag a result onto
  the frame, or a local image file straight from the desktop.
- **Transitions** — 11 kinds across two families that are both duration-preserving and audio-safe: a
  *dip* (fade, blur, zoom-in) treats the live clip and sits symmetrically across the cut; a *push*
  (dissolve, slide, zoom-out) holds the outgoing clip's last frame and moves it off after the cut.
  Neither borrows frames across a cut or shortens the video, so a transition can never clip speech or
  bring back a deleted word.
- **Subtitles** — burned-in captions built from the transcript's own word timings, five presets
  (Clean, Broadcast, Shorts, Word-pop karaoke, Minimal), fully restylable.
- **Collision-free by construction** — new elements, and anything moved through a placement preset, are
  nudged clear of the burned-in subtitle band and of whatever else is on screen in that moment
  (`lib/overlay/layout.ts`). This runs for every caller — the toolbar and the AI planner alike — so two
  things can't end up sharing the same pixels no matter which one put them there. A direct drag is never
  overridden: that placement was deliberate.

### The AI sidebar: analyse, propose, apply

Prompting the editor doesn't fire operations blind. For a whole-edit request it first **measures** the
footage — filler count and seconds, pause count and total dead air, words-per-minute, the longest
pauses — with the same functions the manual Tools menu uses (`lib/overlay/analysis.ts`), then returns a
**named, reviewable plan**: findings grounded in those numbers, grouped into steps you can tick on or off
before anything runs. Only accepted steps execute, one at a time, each reporting what it did.

The planner works from a house style (one accent colour per edit, one transition style for the whole
video, restrained caption density, contrast rules for text over footage) so an automatic edit reads as
produced rather than automatic. Operations include cutting by the finished video's own clock
(`deleteRange`, `keepOnly`, `splitAt` — a highlight reel or a Short is one call, not twenty), and
`captionPhrase`, which finds a phrase in the transcript and times the caption from its real word
timings rather than a guessed timestamp — the difference between a kinetic caption that lands on the
beat and one that's a quarter-second off.

Export burns the whole composition into the file: the cut is rendered by ffmpeg as before, then a
canvas pass composites every element and transition frame-by-frame through WebCodecs, and the
**original audio is grafted back with a stream copy** — re-encoding it was never on the table.

Three things follow from all of this, and they are where the port and its extensions deviate from upstream:

- **The isolation headers are scoped to `/rescript`, `/vendor/*`, and `/_next/*`** — not `/(.*)` as
  upstream sets them. Chalkline's studio pulls images straight from Pollinations and Tavily, and a
  blanket `Cross-Origin-Embedder-Policy: require-corp` would block every one of them. The narrower scope
  still isolates the editor's own document *and* the worker scripts it spawns — a dedicated worker
  inherits its creating document's policy container, and its own response needs the same header or the
  browser silently refuses to start it. See `next.config.ts`.
- **`/rescript` has its own root layout** (`src/app/(rescript)/layout.tsx`). The editor owns the whole
  viewport and carries its own light/dark toggle, so it cannot sit inside Chalkline's dark-only chrome.
  Navigating between the two is a full page load, by design.
- **ASR runs single-threaded** (`numThreads = 1` in `transcription.worker.ts`). The onnxruntime-web
  build this pulls in loads its asyncify wasm regardless of device, and asyncify plus a pthread pool
  deadlocks during session creation — the model reaches 100% and `pipeline()` never settles or throws.
  Single-threaded costs some throughput; the alternative is a transcript that never arrives.

Upstream's Google Analytics, Vercel Analytics, and the default telemetry collector at `getrescript.com`
were left out — those are the upstream project's accounts. `src/rescript/lib/telemetry.ts` stays inert
unless you point `NEXT_PUBLIC_TELEMETRY_ENDPOINT` at your own, and `src/rescript/lib/sentry.ts` never
initialises without `NEXT_PUBLIC_SENTRY_DSN`.

The wasm runtimes are not committed — they'd add ~185 MB to the repo. `npm install` runs `patch-package`
and `scripts/copy-assets.mjs`, which copy ffmpeg core, both onnxruntime builds, and the AAF scaffold into
`public/vendor/`. This also runs on every fresh install on a deploy host, Railway included.

---

## 🔑 Environment Variables

Server secrets are read **server-side only**. None of them is prefixed with `NEXT_PUBLIC_` — no key ever
reaches the client bundle. Generated media is served back from `/api/asset/:id` on the app's own origin.
The `NEXT_PUBLIC_*` rows at the bottom are the sole exception: they configure the transcript editor's
telemetry/crash-reporting, are meaningless without a value, and are inert by default.

| Variable | Required | Description |
|---|---|---|
| `OMEGA_API_KEY` | **Yes** | Omega C API key for text generation, storyboard planning, and the transcript editor's AI sidebar. Keys start with `oc_`. Get one at [omegaplusapi.com](https://omegaplusapi.com). |
| `OMEGA_BASE_URL` | No | Override the Omega API host. Default: `https://api.omegaplusapi.com` |
| `DEEPGRAM_API_KEY` | Recommended | Deepgram key for voice narration — leads over Cartesia when both are set, since its word timings come from transcribing the actual audio rather than an estimate. Get one at [console.deepgram.com](https://console.deepgram.com). |
| `DEEPGRAM_MODEL` | No | Deepgram TTS model override. Default: `aura-2-hera-en` |
| `DEEPGRAM_ALIGN_MODEL` | No | Deepgram model used to time the narration's words. Default: `nova-3` |
| `CARTESIA_API_KEY` | Recommended | Cartesia API key for voice narration — used when Deepgram isn't configured. Get one at [play.cartesia.ai/keys](https://play.cartesia.ai/keys). Without either key, videos still render silently. |
| `CARTESIA_MODEL` | No | Cartesia TTS model override. Default: `sonic-3` |
| `CARTESIA_VERSION` | No | Cartesia API version override. Default: `2026-08-14` |
| `CARTESIA_TIMESTAMPS` | No | Set to `0` to opt out of word timings (falls back to mp3, smaller files). |
| `TAVILY_API_KEY` | Recommended | Tavily key for real-photo search (Modern Video's supporting visuals, and the transcript editor's b-roll). Without it, `findPhoto`/`addImage` with a photo query fails cleanly and the planner is told not to plan it. Get one at [tavily.com](https://tavily.com). |
| `POLLINATIONS_API_KEY` | No | Pollinations API key for premium image models. Images work with no key (free tier, photographic only). Get one at [enter.pollinations.ai/keys](https://enter.pollinations.ai/keys). |
| `PORT` | No | Server port. Default: `3000` |
| `NEXT_PUBLIC_SITE_URL` | No | Absolute origin the transcript editor's Open Graph tags resolve against. Default: `http://localhost:3000`. |
| `NEXT_PUBLIC_TELEMETRY_ENDPOINT` | No | Where the transcript editor's anonymous usage pings go. Unset (the default) means telemetry never fires. |
| `NEXT_PUBLIC_SENTRY_DSN` | No | Crash reporting for the transcript editor. Unset (the default) means Sentry never initialises. |

---

## 🧠 How It Works

### The Narration Is the Clock

Everything visual is scheduled against **when each word was actually spoken**.

Cartesia reports word timings over its SSE route, and `lib/ai/cartesia.ts` streams the scene, collects the audio and the word timings in one pass, then assembles the WAV. The video engine uses those timings to:

- **Pin visual beats** to the exact moment their words are spoken, bounded to prevent all-at-once pileups.
- **Break subtitles** on sentences, clauses, and audible gaps — not every N words.
- **Synthesise timings** from transcripts (weighted by syllable count and punctuation) when a clip has no word-level data.

The player keeps audio and canvas in sync by nudging its virtual clock toward `audio.currentTime` each frame. `MediaRecorder` captures that same canvas and audio graph, so **Export Video** is a genuine recording of what you watched.

### Shots, Not Slides

The modern engine (Hyperframes) has seven compositions — title, statement, split, metric, process, contrast, close — and picks one from what each scene actually holds:

- A scene with a stat → counting metric
- Three or more beats → step rail
- Two beats → contrast
- One beat → held statement

One accent colour per video, neutrals everywhere else. The storyboard returns art direction that is prefixed onto every scene's image prompt, so six shots read as one film — not six stock pictures.

### Why the Sketches Are Vectors

SVG over diffusion for whiteboard scenes because:
- **Speed**: ~7s vs 45–80s on keyless Pollinations
- **Style consistency**: Always on-brand marker line art
- **Animatable**: Stroke paths have start and end points, so the marker can *draw*
- SVG is parsed server-side into a validated path list — model SVG is never inserted into the DOM

### Providers Are Swappable

`src/lib/ai/types.ts` defines `TextProvider`, `ImageProvider`, and `TTSProvider`. Every adapter implements one of them and nothing in `components/` imports a provider directly. Swapping Cartesia for another TTS is a new file plus one line in a registry.

No model ID is hardcoded. Catalogues are fetched at runtime from `/api/models?provider=…`, and pickers are filled from whatever comes back.

---

## 📦 Scripts

```bash
npm run dev             # Start development server (hot reload)
npm run build           # Create production build
npm run start           # Start production server
npm run lint            # Run ESLint
npm run test:i18n       # Transcript editor: locale catalogue coverage
npm run test:timeline   # Transcript editor: NLE + AAF serialization
npm run test:overlay    # Transcript editor: cuts, transitions, subtitles, timeline maths
npm run test:placement  # Transcript editor: collision-free element placement
```

The rest of the transcript editor's suite runs the same way — `npx tsx tests/<name>-test.ts`. They are
plain assertion scripts with no runner.

---

## 🌐 Deployment

### Railway (Recommended)

This project is deployed on [Railway](https://railway.com) at
[whiteboard-video-production.up.railway.app](https://whiteboard-video-production.up.railway.app), tracking
the `main` branch of this repo.

1. **Connect your GitHub repo** at [railway.com/new](https://railway.com/new)
2. **Set environment variables** in the Railway dashboard — at minimum `OMEGA_API_KEY`; add
   `DEEPGRAM_API_KEY` and/or `CARTESIA_API_KEY` for narration and `TAVILY_API_KEY` for real-photo search.
   See [Environment Variables](#-environment-variables) for the full list.
3. Railway (Nixpacks) detects Next.js, runs `npm install` — which runs this repo's `postinstall`
   (`patch-package` + `scripts/copy-assets.mjs`, restoring the transcript editor's ~185 MB of wasm
   runtime into `public/vendor/`) — then `npm run build` → `npm run start`.
4. The healthcheck hits `/api/capabilities`; a deploy that can't reach Omega, Deepgram/Cartesia, or
   Tavily still passes it; those degrade per-feature rather than failing the boot.
5. Push to `main` and Railway redeploys automatically.

Build settings live in `.railway/railway.ts` (Infrastructure as Code, the current Railway convention).
A `railway.json` is also kept alongside it for tooling that still reads Config as Code; the two describe
the same build.

### Other Platforms

The app is a standard Next.js application and deploys to any platform that supports Node.js:

| Platform | Deploy Command |
|---|---|
| **Vercel** | Connect repo → auto-detected |
| **Render** | Build: `npm run build` · Start: `npm run start` |
| **Fly.io** | `fly launch` → `fly deploy` |
| **Docker** | See Dockerfile (if added) |

---

## 🛡️ Security & Abuse Protection

- **Per-IP rate limiting** with token buckets and concurrency caps on every generating route
- **Prompt and transcript length limits** to prevent abuse
- **Image dimensions bounded** to 256–1536px in multiples of 8
- **Provider and model IDs** constrained to closed sets or conservative charsets
- **Hard timeouts** on every outbound API call
- **No client-exposed URLs** — the browser can never name a backend provider URL
- **Provider errors mapped** to one of eight codes with a plain sentence; raw provider text stays server-side

> Rate limiting is per-process (suited for single-instance deploy). Use Redis before scaling horizontally.

---

## 💾 Storage

| What | Where |
|---|---|
| History metadata | `localStorage` |
| Images, audio, poster frames | `IndexedDB` |
| Server-side generated media | In-process asset store (volatile) |

Narration is WAV (not mp3) whenever word timings are present — roughly 175 KB per spoken second. That is the deliberate trade: timings are what every animation in both engines is scheduled against.

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

Chalkline is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

**The transcript editor under `src/rescript/` is not MIT.** It is ported from
[Rescript](https://github.com/wassgha/rescript), which is licensed under **PolyForm Noncommercial
1.0.0** — see [src/rescript/LICENSE](src/rescript/LICENSE). That license permits use for noncommercial
purposes only and carries a required notice:

> Copyright (c) 2026 Wassim Gharbi and Rescript contributors (https://github.com/wassgha/rescript)

If this app is ever used commercially, `/rescript` and `src/rescript/` have to come out, or a separate
license has to be obtained from the upstream author.

---

## 🙏 Acknowledgements

- **[Omega C](https://omegaplusapi.com)** — text generation, storyboard planning, and the transcript editor's AI sidebar
- **[Deepgram](https://deepgram.com)** — voice narration with word-level timings, from transcribing the actual audio
- **[Cartesia](https://cartesia.ai)** — voice narration fallback, also with word-level timings
- **[Puter](https://puter.com)** — browser-side image generation
- **[Pollinations](https://pollinations.ai)** — server-side image fallback
- **[Tavily](https://tavily.com)** — real-photo search
- **[Rescript](https://github.com/wassgha/rescript)** by Wassim Gharbi — the transcript-based editor `/rescript` is ported from (PolyForm Noncommercial 1.0.0, see [src/rescript/LICENSE](src/rescript/LICENSE))
- **[transformers.js](https://github.com/huggingface/transformers.js)**, **[parakeet.js](https://github.com/wassgha/parakeet.js)** & **[onnxruntime-web](https://onnxruntime.ai)** — on-device transcription and speaker diarization
- **[ffmpeg.wasm](https://ffmpegwasm.netlify.app)** — client-side media cutting, re-encoding, and audio graft
- **[Lucide](https://lucide.dev)** — beautiful open-source icons
