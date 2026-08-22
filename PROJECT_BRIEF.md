# 🎬 Chalkline: AI Explainer Video Engine — Technical Specification & Research Brief

> **Document Purpose**: This document provides a comprehensive technical breakdown of Chalkline, its core architecture, data schemas, problem statement, target audience, rendering engines, and roadmap. It is designed to enable external contributors, researchers, and engineers to build new integrations, add visual templates, and extend rendering capabilities without needing upfront access to the source code.

---

## 📌 Table of Contents
1. [Executive Summary & Problem Statement](#1-executive-summary--problem-statement)
2. [Target Audience & Use Cases](#2-target-audience--use-cases)
3. [Core Philosophy & Architecture](#3-core-philosophy--architecture)
4. [The Two Visual Rendering Engines](#4-the-two-visual-rendering-engines)
5. [The Video Project JSON Schema & Data Model](#5-the-video-project-json-schema--data-model)
6. [Narration-As-Clock Synchronization System](#6-narration-as-clock-synchronization-system)
7. [Current AI Provider Layer](#7-current-ai-provider-layer)
8. [Research Areas, Integrations & Template Roadmap](#8-research-areas-integrations--template-roadmap)

---

## 1. Executive Summary & Problem Statement

### ❌ The Problem
Creating high-quality explainer videos traditionally requires:
1. **Scriptwriting & Storyboarding** (copywriters, prompt engineers)
2. **Graphic Design & Asset Creation** (illustrators, animators, vector artists)
3. **Voice Recording & Audio Timing** (voice artists, studio mastering)
4. **Video Editing & Keyframing** (After Effects / Premiere timelines, manually syncing visual elements with vocal cues)
5. **Slow Cloud Rendering** (FFmpeg farm queues, high compute costs, rigid template limitations)

Existing AI video tools often produce **disconnected slide decks with robotic TTS** or **uncontrollable 4-second video diffusion clips** that cannot convey structured diagrams, kinetic concepts, or exact step-by-step logic.

### 💡 The Solution: Chalkline
Chalkline takes **one prompt** (e.g. *"Explain how Distributed Consensus algorithms like Raft work"*) and autonomously:
1. Directs a **Zod-validated multi-scene storyboard** with structured kinetic metadata.
2. Generates **natural voice narration** and extracts **sub-millisecond word timings**.
3. **Locks the visual clock to the vocal clock**: visual strokes, keyword reveals, numbers, and diagram cues trigger precisely when the narrator utters the corresponding word.
4. Renders 100% in-browser on HTML5 `<canvas>` at **60 FPS** with zero cloud rendering lag, and exports pristine **MP4 files via WebCodecs + `mp4-muxer`**.

---

## 2. Target Audience & Use Cases

| Target Persona | Key Pain Point Solved | Typical Output |
|---|---|---|
| **Tech Educators & DevRel** | Making complex algorithms, system architectures, and code understandable | Hand-drawn whiteboard flowcharts with live marker drawing |
| **SaaS & Startup Founders** | High cost of animated product explainer videos | Modern cinematic pitch videos with kinetic type and metric counters |
| **Course Creators & Teachers** | Takes hours to produce animated slide videos | Chaptered narrated lesson modules with auto-generated visual notes |
| **Marketing & Social Teams** | Need high-volume short/long-form explainer content | Dynamic kinetic typography videos with synced subtitles & b-roll plates |

---

## 3. Core Philosophy & Architecture

### High-Level Data Flow
```
                                 ┌──→ [1. Omega C / LLM] ──→ Storyboard JSON (Scenes, Keywords, Cues)
                                 │
User Prompt ──→ Studio State ────┼──→ [2. Cartesia / Deepgram] ──→ Audio WAV + Word Timings Array
                                 │
                                 ├──→ [3. Vector & Image Engine] ──→ Lucide Vectors / Puter / Tavily
                                 │
                                 └──→ [4. Canvas Engine] ──→ 60 FPS Sync Loop ──→ WebCodecs MP4 Export
```

### Architectural Principles
1. **The Narration Is the Clock**: Animations do not run on arbitrary timer loops. A scene's visual state is a mathematical function of `audio.currentTime`.
2. **Vectors Over Bitmaps for Whiteboards**: Instead of waiting 60s for slow image diffusion models that hallucinate messy text, Chalkline parses vector strokes and Lucide SVG geometries so markers physically draw strokes in real time.
3. **Swappable Provider Interfaces**: Text, image, and speech providers implement strict TypeScript interfaces (`TextProvider`, `ImageProvider`, `TTSProvider`), decoupling business logic from external vendor APIs.
4. **Zero Cloud Video Infrastructure**: Rendering occurs on the client GPU via HTML5 Canvas 2D / WebGL and encodes to MP4 locally, eliminating expensive cloud GPU rendering bills.

---

## 4. The Two Visual Rendering Engines

Chalkline features two production rendering pipelines:

### Engine A: 🎨 Hand-Drawn Whiteboard (`src/lib/whiteboard/`)
* **Chisel-Tip Marker Physics**: Renders smooth Bézier paths stroke-by-stroke with simulated marker pressure, lifting, travelling, and ink bleeding.
* **Rostrum Camera**: Drifts smoothly across the board with pan/zoom easing to focus on whichever quadrant is being actively drawn.
* **Handwritten Typography**: Integrated with SVG letterforms and handwritten fonts (`Permanent Marker`).
* **Accent Highlighting**: Automatically adds soft highlighter passes across headings and key takeaways.
* **1770+ Built-In Vector Icons**: Direct Lucide SVG path data dictionary stored in normalized 24x24 coordinate space for stroke-by-stroke drawing.

### Engine B: ⚡ Hyperframes Modern Video (`src/lib/hyperframes/`)
* **7 Algorithmic Shot Compositions**:
  1. `Hero/Title`: Kinetic headline with staggered word mask reveal and accent rule.
  2. `Statement`: Big bold single-focus takeaway with high-contrast background.
  3. `Split`: Editorial layout with media plate on one side, kinetic text hierarchy on the other.
  4. `Metric`: Counting animated stat ticker with contextual caption.
  5. `Process / Step Rail`: Numbered horizontal or vertical journey track showing sequence of events.
  6. `Contrast`: Side-by-side comparative cards (e.g. *Before vs After*, *Problem vs Solution*).
  7. `Close`: Summary takeaway with logo/brand badge and clear call-to-action.
* **Kinetic Typography Engine**: Word-by-word reveal masks, animated pill badges, accent color weighting.
* **Cinematic Camera Grading**: Ken Burns pan/zoom plates, customizable color grading overlays, film grain, and subtle vignette scrims.

---

## 5. The Video Project JSON Schema & Data Model

Below is the complete data structure that defines a Chalkline video project. Any external template engine or integration should consume or emit this JSON schema.

### Core JSON Data Structure

```json
{
  "id": "gen_8f93a1c2",
  "title": "How Distributed Consensus Works",
  "description": "A 4-scene explainer illustrating the Raft consensus algorithm, leader election, and log replication.",
  "videoStyle": "whiteboard",
  "visualTheme": "studio-dark",
  "musicMood": "curious",
  "introDuration": 2.5,
  "voiceDelay": 0.5,
  "scenes": [
    {
      "heading": "The Challenge of Distributed Agreement",
      "bullets": [
        "Multiple independent nodes across a network",
        "Network partitions and server crashes can happen anytime",
        "Must agree on a single source of truth"
      ],
      "narration": "In a distributed system, computers must agree on shared state even when network cables fail and servers crash.",
      "imagePrompt": "minimalist network diagram showing connected servers with data packets",
      "photoQuery": "server room glowing network switches",
      "supportVisual": "photo",
      "keywords": ["distributed system", "agree", "crash"],
      "stat": "99.999%",
      "statCaption": "Target Uptime Reliability",
      "icon": "server",
      "status": "done",
      "audio": {
        "url": "/api/asset/audio_scene_1.wav",
        "provider": "cartesia",
        "model": "sonic-3",
        "voiceId": "4459a9a5-69d6-4680-b970-e13dc51845b6",
        "duration": 6.84,
        "words": [
          { "word": "In", "start": 0.00, "end": 0.18 },
          { "word": "a", "start": 0.19, "end": 0.28 },
          { "word": "distributed", "start": 0.29, "end": 0.82 },
          { "word": "system,", "start": 0.83, "end": 1.34 },
          { "word": "computers", "start": 1.48, "end": 1.95 },
          { "word": "must", "start": 1.96, "end": 2.22 },
          { "word": "agree", "start": 2.23, "end": 2.68 },
          { "word": "on", "start": 2.69, "end": 2.85 },
          { "word": "shared", "start": 2.86, "end": 3.25 },
          { "word": "state", "start": 3.26, "end": 3.75 },
          { "word": "even", "start": 3.90, "end": 4.15 },
          { "word": "when", "start": 4.16, "end": 4.38 },
          { "word": "network", "start": 4.39, "end": 4.78 },
          { "word": "cables", "start": 4.79, "end": 5.12 },
          { "word": "fail", "start": 5.13, "end": 5.58 },
          { "word": "and", "start": 5.70, "end": 5.88 },
          { "word": "servers", "start": 5.89, "end": 6.32 },
          { "word": "crash.", "start": 6.33, "end": 6.84 }
        ]
      },
      "image": {
        "url": "/api/asset/img_scene_1.png",
        "provider": "tavily",
        "model": "search-photo",
        "width": 1280,
        "height": 720,
        "canvasSafe": true,
        "kind": "photo"
      }
    }
  ]
}
```

---

## 6. Narration-As-Clock Synchronization System

### Cue Scheduling Equation
Given an array of `WordTiming { word, start, end }`, visual beats are computed using bounded cue windows:

$$\text{IdealCue}(i) = \text{SceneStartTime} + \text{WordTimestamp}(\text{bullet}_i)$$

1. **Window Bounding**: If the script mentions all 3 items in one hurried sentence, cues are bounded so elements don't overlap or appear all at once.
2. **Phrase-Level Subtitling**: Subtitles do not break arbitrarily every $N$ words; they break on sentence boundaries, punctuation pauses ($> 180\text{ms}$), and clauses.
3. **Frame Drifting Compensation**: In every 60 FPS animation tick:
   $$\text{VirtualClock}_{t+1} = \text{VirtualClock}_t + \alpha \cdot (\text{AudioElement.currentTime} - \text{VirtualClock}_t)$$
   This ensures that even during audio buffer stalls or background tab throttles, visual rendering automatically locks back onto the audio waveform.

---

## 7. Current AI Provider Layer

All providers implement strict contracts in `src/lib/ai/types.ts`:

```typescript
export interface TextProvider {
  id: string;
  isConfigured(): boolean;
  listModels(): Promise<ModelInfo[]>;
  generateText(input: TextGenerationInput): Promise<TextGenerationResult>;
  streamText(input: TextGenerationInput): AsyncIterable<string>;
}

export interface TTSProvider {
  id: string;
  isConfigured(): boolean;
  listVoices(): Promise<VoiceInfo[]>;
  listLanguages(): Promise<string[]>;
  generateSpeech(input: TTSInput): Promise<TTSResult>;
}

export interface ImageProvider {
  id: ImageProviderId;
  runsOn: "server" | "browser";
  isConfigured(): boolean;
  listModels(): Promise<ModelInfo[]>;
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}
```

### Active Provider Integrations
- **Text & Storyboarding**: Omega C (OpenAI-compatible endpoints).
- **TTS & Word Timings**: Cartesia Sonic-3 (SSE PCM audio + word metadata) & Deepgram Aura-2 + Nova-3.
- **Image Generation & Sourcing**:
  - **Puter.js** (Client-side free AI image generator).
  - **Pollinations.ai** (Server-side keyless fallback / premium catalog).
  - **Tavily Image Search** (Real verified photographs).
  - **Chalkline Vector Sketch** (SVG marker stroke synthesis).

---

## 8. Research Areas, Integrations & Template Roadmap

### 🔬 Priority 1: New AI & Tool Integrations to Research
1. **TTS Providers**:
   - **ElevenLabs** (WebSocket streaming API with timestamp alignment).
   - **OpenAI TTS** (whisper timestamp alignment integration).
   - **Edge-TTS** (free Microsoft Edge speech synthesizer with SRT/VTT timings).
2. **Image & Diagram Engines**:
   - **Recraft.ai** (Vector SVG generator API).
   - **Excalidraw / Mermaid.js AST compiler** (Convert LLM mermaid syntax into animated canvas strokes).
   - **FLUX.1-schnell / SDXL Turbo** on Replicate / Together AI.
3. **Export & Audio Enhancements**:
   - Background music auto-ducking when narrator speaks.
   - WebCodecs H.264 / AV1 hardware accelerated encoding presets.

### 🎨 Priority 2: New Visual Templates & Shot Types to Add
1. **Code Walkthrough Shot**:
   - Syntax-highlighted code editor plate with typing animation and line-by-line highlight markers synced to speech.
2. **Architecture / Flow Diagram Shot**:
   - Node-and-arrow graph that animates data flow pulses along connector lines.
3. **Interactive 2x2 Matrix & Venn Diagram**:
   - Quadrant comparison charts with animated pins and labeled circles.
4. **Isometric / 2.5D Whiteboard Projection**:
   - Pseudo-3D whiteboard angle with camera parallax movement.

---

## 💡 How to Contribute / Collaborate
- Review `src/lib/validation/schemas.ts` for schema boundaries.
- Inspect `src/lib/hyperframes/modern-renderer.ts` to see how shot layout functions (`shotHero`, `shotSplit`, `shotMetric`) are built.
- Inspect `src/lib/whiteboard/renderer.ts` for marker path rendering physics.
