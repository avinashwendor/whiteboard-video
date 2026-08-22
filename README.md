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

### Four Creation Modes

| Mode | Does |
|---|---|
| **🎬 Create Video** | Idea → AI storyboard → visual scenes (Whiteboard or Hyperframes) → narration → 60 FPS playable & exportable video |
| **✍️ Write** | Idea → polished long-form copy, streamed token by token |
| **🖼️ Image** | Prompt → a generated image, with the prompt auto-rewritten for quality |
| **🎙️ Voice** | Text → natural narration in any language the chosen voice speaks |

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
    page.tsx              studio: hero, composer, results, examples
    editor/[id]/page.tsx  the editor for a finished video
    history/page.tsx      gallery of past generations
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
  components/
    ui/                   button, card, field, badge, skeleton
    site/                 top bar, navigation
    studio/               composer, modes, settings, results, actions
    studio/editor/        the editor: scene rail, inspector, JSON panel, ask
    whiteboard/           board renderer, stroke drawing, player, export
  lib/
    ai/                   omega, deepgram, cartesia, editor agent, image/*
    video/                easing, word timings and cue planning, film grade
    hyperframes/          modern engine: shots, themes, kinetic type
    studio/               state, history, IndexedDB media cache, API client,
                          edit operations and the hand-edited-JSON schema
    validation/           Zod schemas and limits
    utils/                errors, http, rate limiting, asset store, markdown
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
| **Text AI** | Omega C (OpenAI-compatible API) |
| **Voice AI** | [Cartesia](https://cartesia.ai/) (sonic-3, word-level timings) |
| **Image AI** | [Puter](https://puter.com/) (browser-side, primary) + [Pollinations](https://pollinations.ai/) (server fallback) |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18.17
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

## 🔑 Environment Variables

All keys are read **server-side only**. Nothing is prefixed with `NEXT_PUBLIC_` — no key ever reaches the client bundle. Generated media is served back from `/api/asset/:id` on the app's own origin.

| Variable | Required | Description |
|---|---|---|
| `OMEGA_API_KEY` | **Yes** | Omega C API key for text generation and storyboard planning. Keys start with `oc_`. Get one at [omegaplusapi.com](https://omegaplusapi.com). |
| `OMEGA_BASE_URL` | No | Override the Omega API host. Default: `https://api.omegaplusapi.com` |
| `CARTESIA_API_KEY` | **Yes** | Cartesia API key for voice narration. Get one at [play.cartesia.ai/keys](https://play.cartesia.ai/keys). Without it, videos still render silently. |
| `CARTESIA_MODEL` | No | Cartesia TTS model override. Default: `sonic-3` |
| `CARTESIA_VERSION` | No | Cartesia API version override. Default: `2026-08-14` |
| `CARTESIA_TIMESTAMPS` | No | Set to `0` to opt out of word timings (falls back to mp3, smaller files). |
| `POLLINATIONS_API_KEY` | No | Pollinations API key for premium image models. Images work with no key (free tier). Get one at [enter.pollinations.ai/keys](https://enter.pollinations.ai/keys). |
| `PORT` | No | Server port. Default: `3000` |

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
npm run dev      # Start development server (hot reload)
npm run build    # Create production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

---

## 🌐 Deployment

### Railway (Recommended)

This project is optimised for [Railway](https://railway.com) deployment.

1. **Connect your GitHub repo** at [railway.com/new](https://railway.com/new)
2. **Set environment variables** in the Railway dashboard:
   - `OMEGA_API_KEY` — your Omega C key
   - `CARTESIA_API_KEY` — your Cartesia key
   - `POLLINATIONS_API_KEY` — (optional) for premium image models
3. Railway auto-detects Next.js and runs `npm run build` → `npm run start`
4. The app is live at your Railway-provided URL

> **Note**: A `railway.json` config is included in this repo for optimal build settings. See [Railway Deployment](#railway-deployment-config) below for details.

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

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgements

- **[Omega C](https://omegaplusapi.com)** — text generation and storyboard planning
- **[Cartesia](https://cartesia.ai)** — natural voice narration with word-level timings
- **[Puter](https://puter.com)** — browser-side image generation
- **[Pollinations](https://pollinations.ai)** — server-side image fallback
- **[Lucide](https://lucide.dev)** — beautiful open-source icons
