/**
 * Transcription worker: runs entirely in the browser.
 *
 * 1. Silero VAD (energy fallback) finds speech segments; silence is skipped.
 * 2. ASR (Whisper via transformers.js, or Parakeet TDT v3 via parakeet.js)
 *    transcribes each segment with per-word timestamps, remapped onto the
 *    original timeline.
 * 3. CTC forced alignment (language-specific wav2vec2 / MMS) measures word
 *    boundaries against the audio; a VAD/envelope heuristic is the fallback.
 * 4. Pyannote segmentation 3.0 assigns a speaker to each word.
 *
 * ASR backends live in one weightlift ModelManager (download progress, cache
 * labeling, WebGPU→WASM fallback). The CTC aligner has its own registry so a
 * GPU loss does not unload WASM aligner weights. Weights land in Cache Storage
 * (Whisper, aligner) or IndexedDB (Parakeet); later runs are offline. ORT WASM
 * is served same-origin from /vendor/ort* .
 */
import {
  pipeline,
  AutoProcessor,
  AutoModel,
  AutoModelForAudioFrameClassification,
  AutoModelForCTC,
  AutoTokenizer,
  WhisperTextStreamer,
  Tensor,
  env,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";
import { ModelManager, type ModelDefinition } from "weightlift";
import {
  fallbackDevicePolicy,
  isTransformersModelCached,
  transformersModel,
  transformersProgress,
} from "weightlift/transformers";
import { en } from "@/rescript/lib/i18n/messages/en";
import type { Word, WorkerRequest, WorkerResponse } from "@/rescript/lib/types";
import {
  MODELS,
  isParakeetModel,
  isWhisperModel,
  isCrisperModel,
  type ModelId,
  type WhisperModel,
} from "@/rescript/lib/models";
import { cleanTranscript } from "@/rescript/lib/hallucinations";
import {
  ALIGN_LEAD_S,
  alignWordsToSpeech,
  applyAlignLead,
  speechEnvelope,
} from "@/rescript/lib/align";
import {
  ALIGN_MODELS,
  alignModelFor,
  type AlignModelInfo,
} from "@/rescript/lib/alignModels";
import { insertDisfluencyPlaceholders } from "@/rescript/lib/disfluencies";
import {
  diarizationWindows,
  stitchDiarizationWindows,
  type DiarizationSegment,
  type DiarizationWindow,
} from "@/rescript/lib/diarize";
import {
  alignBatch,
  expandToAcoustics,
  groupWordsForAlignment,
  ctcVocabFromTokenizer,
  type CtcEmission,
  type CtcTokenizerLike,
  type CtcVocab,
} from "@/rescript/lib/forcedAlign";
import {
  isSpecificLanguage,
  type TranscriptLanguage,
  type TranscriptLanguageSetting,
} from "@/rescript/lib/languages";
import { isIndicLanguage } from "@/rescript/lib/indic";
import { detectLanguageFromText } from "@/rescript/lib/scriptDetect";
import {
  VAD_FRAME_SIZE,
  VAD_SAMPLE_RATE,
  energySpeechFrames,
  speechSegmentsFromFrames,
  type SpeechSegment,
} from "@/rescript/lib/vad";
import { isNetworkError, installFetchRetry } from "@/rescript/lib/network";
import { isWebGpuDeviceLostError } from "@/rescript/lib/webgpu";

/**
 * Weight downloads are the longest-running fetches in the app (over a gigabyte
 * for Parakeet on WebGPU), so a momentary drop anywhere in one used to fail the
 * whole transcription with a bare "Failed to fetch". Retry them.
 *
 * parakeet.js and onnxruntime call the global, which the install replaces.
 * transformers.js does not: it binds `globalThis.fetch` into `env.fetch` when its
 * module is first evaluated — which, imports being hoisted, is already done by
 * the time this line runs — so it has to be pointed at the wrapper by hand.
 */
env.fetch = installFetchRetry(self as unknown as { fetch: typeof fetch });

env.allowLocalModels = false;
/**
 * Where {@link MODELS} entries flagged `local` are served from — an export that
 * has not been published to the Hub yet, sitting in public/models/<id>/.
 * Enabled only for the duration of such a load (see `servedLocally`), because
 * `allowLocalModels` is global: left on, every Hub model would probe this path
 * and 404 for each of its files before falling back.
 */
const LOCAL_MODEL_PATH = "/models/";
const ORT_WASM_PATHS = "/vendor/ort/";
/** Parakeet.js pins onnxruntime-web@1.24.1 — keep its WASM on a separate path. */
const PARAKEET_ORT_WASM_PATHS = "/vendor/ort-parakeet/";
// Serve onnxruntime-web WASM from our own origin (offline friendly).
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = ORT_WASM_PATHS;

  /**
   * Single-threaded, and this is not a performance oversight.
   *
   * onnxruntime-web serves four wasm builds; the one this version loads is
   * `ort-wasm-simd-threaded.asyncify.wasm`, and it loads that one whichever
   * device is asked for — WebGPU or plain CPU. Asyncify unwinds and rewinds the
   * wasm stack to suspend a call, and doing that across a pthread pool
   * deadlocks during session creation: the weights finish loading, the progress
   * bar sits at 100%, and `pipeline()` never settles or throws. There is
   * nothing to catch and nothing in the console — the tab just waits forever.
   *
   * ORT's own default is multi-threaded whenever the page is cross-origin
   * isolated, which this one is, so the deadlock is what you get by doing
   * nothing. Measured on this build: numThreads > 1 hangs indefinitely,
   * numThreads = 1 transcribes normally.
   *
   * Revisit when onnxruntime-web is upgraded — if it starts selecting the
   * `.jspi` build (Chrome and Edge have JSPI; check for
   * `WebAssembly.Suspending`), threads become safe again and this line should
   * go, because CPU transcription is meaningfully faster with them.
   */
  (env.backends.onnx.wasm as { numThreads?: number }).numThreads = 1;
}

/**
 * WebKit — Safari everywhere, plus every browser on iOS — kills the tab for
 * memory far sooner than Chromium ("This webpage was reloaded because it was
 * using significant memory"), and onnxruntime's WebGPU path is what pushes it
 * over. That path loads the JSEP build (26 MB of wasm against 13 MB for the
 * plain threaded one, all compiled up front by JSC) and then uploads every
 * weight into Metal buffers during session creation, which is precisely where
 * the reload lands. Staying on WASM costs throughput but is the difference
 * between finishing a transcript and losing the tab mid-run.
 *
 * Sniffed rather than feature-detected on purpose: there is nothing to detect.
 * WebGPU is present and functional here — it is the memory ceiling around it
 * that differs, and no API reports that. `vendor` is frozen to Apple's string
 * across WebKit, which is the exact set of engines affected.
 */
if (/apple/i.test(navigator.vendor)) {
  fallbackDevicePolicy.preferWasm();
}

const DIARIZATION_MODEL = "onnx-community/pyannote-segmentation-3.0";
const VAD_MODEL = "onnx-community/silero-vad";
/** Viterbi needs a frames x tokens lattice, so alignment runs in bounded batches. */
const ALIGN_BATCH_MAX_S = 20;
/** Context either side of a batch, so edge words are not clipped. */
const ALIGN_BATCH_PAD_S = 0.2;
/** Gaps longer than this split speech into separate Whisper jobs. */
const SPEECH_MAX_GAP_S = 1.5;
/** Pad each speech region so phoneme edges are not clipped. */
const SPEECH_PAD_S = 0.4;
/**
 * Whisper often emits EOS after the first speaker when a VAD slice starts on
 * speech with no leading silence. Prepend this much zero-pad before decode
 * (timestamps are remapped so the pad does not shift the timeline).
 */
const WHISPER_LEAD_PAD_S = 0.5;

type AsrChunk = { text: string; timestamp: [number, number | null] };

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

/**
 * Live progress / partial-text updates are coalesced onto a timer.
 *
 * Both fire once per decoded token — tens of thousands of times on a long
 * recording — and each one costs a structured clone across the worker
 * boundary plus a store write and a React render on the main thread. For the
 * partial text that clone is of the whole transcript so far, so the cost grows
 * with the transcript and the total work is quadratic: an hour of speech moved
 * hundreds of megabytes of short-lived strings for a preview nobody can read
 * at that rate. 10 updates a second looks identical and is O(n).
 */
const LIVE_POST_INTERVAL_MS = 50;
/**
 * The preview is a "something is happening" affordance pinned above the
 * progress bar, not a readable document — only the last few lines are ever on
 * screen. Sending the tail keeps each message a fixed size no matter how long
 * the recording is.
 */
const PARTIAL_TAIL_CHARS = 550;

let pendingProgress: WorkerResponse | null = null;
let pendingPartial: WorkerResponse | null = null;
let liveTimer: ReturnType<typeof setTimeout> | null = null;

function flushLive() {
  if (liveTimer !== null) {
    clearTimeout(liveTimer);
    liveTimer = null;
  }
  if (pendingProgress) {
    post(pendingProgress);
    pendingProgress = null;
  }
  if (pendingPartial) {
    post(pendingPartial);
    pendingPartial = null;
  }
}

/**
 * Drop queued updates without sending them. Used before a terminal message,
 * which supersedes anything still in flight.
 */
function cancelLive() {
  if (liveTimer !== null) {
    clearTimeout(liveTimer);
    liveTimer = null;
  }
  pendingProgress = null;
  pendingPartial = null;
}

/** Queue a coalescing update; the newest value for each type wins. */
function postLive(msg: WorkerResponse) {
  if (msg.type === "partial") pendingPartial = msg;
  else pendingProgress = msg;
  if (liveTimer === null) {
    liveTimer = setTimeout(flushLive, LIVE_POST_INTERVAL_MS);
  }
}

/** Queue the streaming transcript preview, trimmed to its tail. */
function postPartial(text: string) {
  postLive({
    type: "partial",
    text:
      text.length > PARTIAL_TAIL_CHARS
        ? `…${text.slice(-PARTIAL_TAIL_CHARS)}`
        : text,
  });
}

/** Device the current ASR pipeline is running on. */
let asrDevice: "webgpu" | "wasm" = "wasm";

/** The part of an onnxruntime InferenceSession we need to free one. */
type OrtSessionLike = { release?: () => Promise<void> };

type ParakeetInstance = {
  transcribe: (
    audio: Float32Array,
    sampleRate?: number,
    opts?: {
      returnTimestamps?: boolean;
      timeOffset?: number;
    }
  ) => Promise<{
    utterance_text: string;
    words: Array<{ text: string; start_time: number; end_time: number }>;
  }>;
  /**
   * parakeet.js has no dispose() of its own — it disposes per-call tensors but
   * never the sessions — so unloading it means releasing these by hand. Optional
   * because they are internals, not part of its public surface.
   */
  encoderSession?: OrtSessionLike;
  joinerSession?: OrtSessionLike;
  _onnxPreprocessor?: { session?: OrtSessionLike | null } | null;
};

const PARAKEET_CACHE_DB = "parakeet-cache-db";
const PARAKEET_CACHE_STORE = "file-store";

/** Whether Parakeet ONNX weights already sit in parakeet.js IndexedDB. */
async function isParakeetCached(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  // Avoid opening (and thereby creating) the DB when nothing has been cached.
  try {
    if (typeof indexedDB.databases === "function") {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === PARAKEET_CACHE_DB)) return false;
    }
  } catch {
    // databases() can throw in private mode; fall through to open().
  }

  const repoId = MODELS.parakeet.repoId;
  // Hub keys: `hf-${repoId}-main--${filename}` (empty subfolder).
  const candidates = [
    `hf-${repoId}-main--encoder-model.int8.onnx`,
    `hf-${repoId}-main--encoder-model.fp16.onnx`,
  ];
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(PARAKEET_CACHE_DB);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
      req.onsuccess = () => resolve(req.result);
    });
    if (!db.objectStoreNames.contains(PARAKEET_CACHE_STORE)) {
      db.close();
      return false;
    }
    const hit = await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction([PARAKEET_CACHE_STORE], "readonly");
      const store = tx.objectStore(PARAKEET_CACHE_STORE);
      let pending = candidates.length;
      let found = false;
      for (const key of candidates) {
        const req = store.get(key);
        req.onsuccess = () => {
          const blob = req.result as Blob | undefined;
          if (blob && blob.size > 1_000_000) found = true;
          pending -= 1;
          if (pending === 0) resolve(found);
        };
        req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
      }
    });
    db.close();
    return hit;
  } catch {
    return false;
  }
}

/**
 * Parakeet via parakeet.js — custom weightlift definition (not transformers.js).
 * WebGPU uses fp16 encoder; WASM int8 is the size / compatibility fallback.
 */
function parakeetModel(): ModelDefinition<ParakeetInstance> {
  return {
    isCached: isParakeetCached,
    dispose: async (model) => {
      await Promise.all([
        model.encoderSession?.release?.(),
        model.joinerSession?.release?.(),
        model._onnxPreprocessor?.session?.release?.(),
      ]);
    },
    load: async ({ progress }) => {
      const { fromHub } = await import("parakeet.js");
      const onProgress = (p: { loaded: number; total: number; file: string }) => {
        if (!p.file) return;
        progress.dispatch({
          type: "progress",
          file: p.file,
          loaded: p.loaded,
          ...(p.total > 0 ? { total: p.total } : {}),
        });
      };
      const common = {
        // nemo128.onnx is NeMo's own featurisation graph (0.1 MB). The "js"
        // alternative is a hand-written mel — its own FFT and slaney filterbank —
        // and any drift from NeMo's exact features degrades every prediction in
        // a way that reads as "the model is just worse".
        preprocessorBackend: "onnx" as const,
        progress: onProgress,
        wasmPaths: PARAKEET_ORT_WASM_PATHS,
      };

      /**
       * Encoder quantisation is a size decision; decoder quantisation is not.
       *
       * In a TDT model the decoder/joint network is what emits tokens, so
       * quantising it lands directly on word accuracy — and it is tiny next to
       * the encoder (fp32 72 MB, fp16 36 MB, int8 18 MB, against 1239 MB for
       * the fp16 encoder). parakeet.js defaults both to int8; taking that
       * default for the decoder traded measurable accuracy for ~1% of the
       * download, so it is set explicitly here instead.
       */
      const device = await fallbackDevicePolicy.pickDevice();
      if (device === "webgpu") {
        try {
          // fp16 encoder + fp32 decoder ≈ 1.31 GB. WebGPU cannot run the int8
          // encoder at all, so fp16 is the only practical encoder here.
          const model = await fromHub(MODELS.parakeet.id, {
            ...common,
            backend: "webgpu",
            encoderQuant: "fp16",
            decoderQuant: "fp32",
          });
          asrDevice = "webgpu";
          return model as ParakeetInstance;
        } catch (err) {
          console.warn(
            "Parakeet WebGPU/fp16 load failed; falling back to WASM int8.",
            err
          );
          fallbackDevicePolicy.preferWasm();
        }
      }

      // int8 encoder + fp16 decoder ≈ 690 MB: the compatibility / size fallback,
      // keeping the decoder off int8 for the reason above.
      const model = await fromHub(MODELS.parakeet.id, {
        ...common,
        backend: "wasm",
        encoderQuant: "int8",
        decoderQuant: "fp16",
      });
      asrDevice = "wasm";
      return model as ParakeetInstance;
    },
  };
}

/**
 * Flip `env.allowLocalModels` on for one model's load and back afterwards.
 *
 * transformers.js resolves local-vs-Hub from global state, so a model served
 * from public/models can only be reached by enabling it — but leaving it
 * enabled makes every Hub model try the local path first and 404 once per
 * file. Scoping it to the load keeps both paths clean.
 */
function servedLocally<T>(definition: ModelDefinition<T>): ModelDefinition<T> {
  const withLocalPath = async <R,>(fn: () => Promise<R>): Promise<R> => {
    const previousAllow = env.allowLocalModels;
    const previousPath = env.localModelPath;
    env.allowLocalModels = true;
    env.localModelPath = LOCAL_MODEL_PATH;
    try {
      return await fn();
    } finally {
      env.allowLocalModels = previousAllow;
      env.localModelPath = previousPath;
    }
  };

  return {
    ...definition,
    load: (ctx) => withLocalPath(() => definition.load(ctx)),
    ...(definition.isCached
      ? { isCached: () => withLocalPath(async () => definition.isCached!()) }
      : {}),
  };
}

/**
 * ASR registry keyed by each model's `id` from MODELS. Definitions are
 * registered up front; loaders only take an id. unloadAll() after a WebGPU
 * loss forces a clean reload on WASM.
 */
const models = new ModelManager({
  models: Object.fromEntries(
    (Object.keys(MODELS) as ModelId[]).map((choice) => {
      const info = MODELS[choice];
      if (info.backend === "parakeet") {
        return [info.id, parakeetModel()];
      }
      const definition = transformersModel<AutomaticSpeechRecognitionPipeline>({
        pipeline,
        task: "automatic-speech-recognition",
        modelId: info.id,
        dtype: info.dtype,
        cacheKey: env.cacheKey ?? "transformers-cache",
        onDevice: (device) => {
          asrDevice = device;
        },
        // Without this, unload() drops the JS reference and nothing else: the
        // ORT sessions — the weights, and on WebGPU the GPU buffers holding
        // them — stay alive with no way left to reach them. See releaseAsr().
        dispose: (transcriber) => transcriber.dispose(),
      });
      return [info.id, info.local ? servedLocally(definition) : definition];
    })
  ),
});
models.subscribe((snap) => {
  const id = snap.loading[0];
  if (!id) return;
  const rec = snap.models[id];
  if (!rec) return;
  post({
    type: "progress",
    message:
      rec.fromCache === true
        ? en["progress.loadingSpeechCache"]
        : en["progress.downloadingSpeech"],
    value: rec.indeterminate ? null : rec.percent,
  });
});

/**
 * CrisperWhisper's prompt scaffolding: mode tags plus the verbatimize / hotword
 * / continuation markers. All sit at the very top of the vocabulary, above the
 * timestamp block.
 */
const CRISPER_PROMPT_TOKENS = [
  ...[1, 2, 3, 4, 5].map((i) => `[verbatim_${i}]`),
  ...[1, 2, 3, 4, 5].map((i) => `[intended_${i}]`),
  "<vtx>",
  "<evtx>",
  "<ctx>",
  "<ectx>",
  "<htx>",
  "<ehtx>",
];

/**
 * Register CrisperWhisper's prompt scaffolding as special so it can never
 * surface as literal text in a transcript.
 *
 * These are the `[verbatim_N]` / `[intended_N]` mode tags and the
 * verbatimize / hotword / context markers — decoder-prompt machinery, not
 * speech. `_decode_asr` skips anything in `all_special_ids`, which is the only
 * hook for keeping them out of the output.
 *
 * This used to carry a second job: raising `all_special_ids.at(-1)` above the
 * whole vocabulary so `decodeWithTimestamps` would stop mistaking `[UM]` and
 * `[UH]` for timestamps. That was a workaround for an upstream bug, now fixed
 * properly in patches/@huggingface+transformers+4.2.0.patch — see
 * patches/README.md. Only the narrow purpose above remains.
 *
 * Idempotent, so re-running it after a WebGPU-to-WASM reload is harmless.
 */
function markCrisperPromptTokensSpecial(
  transcriber: AutomaticSpeechRecognitionPipeline
): void {
  try {
    // Tokenizer internals are untyped in transformers.js.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokenizer = transcriber.tokenizer as any;
    const ids = new Set<number>(tokenizer.all_special_ids ?? []);
    const before = ids.size;
    for (const token of CRISPER_PROMPT_TOKENS) {
      const encoded = tokenizer.encode(token, { add_special_tokens: false });
      // Anything that does not map to exactly one id is not the atomic token we
      // are looking for — skip rather than guess.
      if (encoded?.length === 1) ids.add(encoded[0]);
    }
    if (ids.size === before) return;
    // Sorted because the workaround depends on `.at(-1)` being the maximum.
    tokenizer.all_special_ids = [...ids].sort((a, b) => a - b);
  } catch {
    console.warn(
      "Could not mark CrisperWhisper prompt tokens as special; " +
        "word timestamps may fail on the first filler token."
    );
  }
}

type Aligner = {
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModelForCTC.from_pretrained>>;
  vocab: CtcVocab;
};

/**
 * The aligner gets its own registry rather than joining `models`.
 *
 * It is a different family — an acoustic aligner, not a transcriber, and not
 * something the user picks — but the deciding factor is lifecycle. The ASR
 * registry exists under a WebGPU→WASM fallback policy whose recovery step is
 * `unloadAll()`. The aligner never asks for a device, so transformers.js runs it
 * on WASM (`DEFAULT_DEVICE`), where a lost GPU cannot touch it. Sharing the
 * registry meant a GPU loss threw away perfectly good WASM weights.
 *
 * Multiple language-specific CTC models are registered; only the one for the
 * active transcript language is loaded.
 */
/**
 * Registry key: the weights *and* the text folding, not the weights alone.
 *
 * One CTC model can serve several languages under different normalizations —
 * the MMS aligner takes `latin-lower` for Spanish and `indic-roman` for Telugu,
 * because Telugu has to be romanized before it can meet a Latin-only vocabulary.
 * Keying by model id alone silently kept whichever language was declared first
 * and handed every other one that language's folding: Telugu text met the
 * `latin-lower` fold, which strips everything outside `[A-Za-z']`, leaving an
 * empty string. Alignment then found nothing to align and returned null, so
 * every word silently kept its estimated time and the timeline never matched
 * the audio.
 *
 * Sharing weights is not affected — both entries resolve to the same files, and
 * Cache Storage dedupes the download by URL.
 */
function alignerKey(info: AlignModelInfo): string {
  return `${info.id}#${info.normalize}`;
}

function buildAlignerRegistry(): Record<string, ModelDefinition<Aligner>> {
  const byKey = new Map<string, AlignModelInfo>();
  for (const info of Object.values(ALIGN_MODELS)) {
    const key = alignerKey(info);
    if (!byKey.has(key)) byKey.set(key, info);
  }
  return Object.fromEntries(
    [...byKey.entries()].map(([key, info]) => [key, alignerModel(info)])
  );
}

const aligners = new ModelManager({ models: buildAlignerRegistry() });

async function getAsr(choice: WhisperModel) {
  const transcriber = await models.load<AutomaticSpeechRecognitionPipeline>(
    MODELS[choice].id
  );
  // Keyed on the checkpoint, not on the prefix: the repair is required by
  // CrisperWhisper's vocabulary layout, so it applies even without one.
  if (isCrisperModel(choice)) {
    markCrisperPromptTokensSpecial(transcriber);
  }
  return transcriber;
}

async function getParakeet() {
  return models.load<ParakeetInstance>(MODELS.parakeet.id);
}

/**
 * Drop dead WebGPU pipelines and reload on WASM.
 * A lost GPU device invalidates every WebGPU session, so clear the whole
 * ASR cache — not just the model that was running. The aligner is a separate
 * registry and runs on WASM, so it is deliberately untouched.
 */
async function fallbackAsrToWasm() {
  fallbackDevicePolicy.preferWasm();
  asrDevice = "wasm";
  await models.unloadAll();
  post({
    type: "progress",
    message: en["progress.gpuFallback"],
    value: null,
  });
}

/**
 * Free the ASR model once the last segment has been decoded.
 *
 * Nothing downstream touches it, but forced alignment and diarization both run
 * their own ONNX sessions after this point — so holding the transcriber through
 * them makes the peak the sum of the two rather than the larger. That peak is
 * what WebKit kills the tab over (see the note above `preferWasm()`), and the
 * transcriber is the heaviest thing in the worker by an order of magnitude:
 * Parakeet's fp16 encoder alone is 1.31 GB, against ~240 MB for the largest
 * aligner. On WebGPU those are GPU buffers and this genuinely hands them back.
 * On WASM the heap cannot shrink, so the win is narrower — the aligner
 * allocates into the freed arena instead of growing the heap past it.
 *
 * Losing the weights costs nothing: every transcription starts a fresh worker
 * (see hooks/useTranscriber.ts), so they were never reused across runs anyway.
 * Best-effort — a failure here is wasted memory, not a failed transcript.
 */
async function releaseAsr(choice: ModelId): Promise<void> {
  try {
    await models.unload(MODELS[choice].id);
  } catch (err) {
    console.warn("Could not release the speech model after transcription.", err);
  }
}

type Diarizer = {
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModelForAudioFrameClassification.from_pretrained>>;
};

/**
 * Silero VAD: ~2 MB ONNX model that scores speech probability per 32 ms frame.
 * Used to find speech segments so Whisper never decodes long silence.
 * Falls back to energy VAD on failure.
 */
type VadModel = {
  (inputs: {
    input: InstanceType<typeof Tensor>;
    sr: InstanceType<typeof Tensor>;
    state: InstanceType<typeof Tensor>;
  }): Promise<{
    output: { data: ArrayLike<number> };
    stateN: InstanceType<typeof Tensor>;
  }>;
};

let vadPromise: Promise<VadModel | null> | null = null;
function getVad(): Promise<VadModel | null> {
  if (!vadPromise) {
    vadPromise = AutoModel.from_pretrained(VAD_MODEL, {
      // Silero ships as a custom ONNX graph without a transformers config.
      // @ts-expect-error transformers.js accepts model_type via config override
      config: { model_type: "custom" },
      dtype: "fp32",
    })
      .then((model) => model as unknown as VadModel)
      .catch((err) => {
        console.warn("Silero VAD failed to load; using energy-based silence detection.", err);
        return null;
      });
  }
  return vadPromise;
}

async function speechFramesWithSilero(
  model: VadModel,
  audio: Float32Array
): Promise<boolean[]> {
  const frameSize = VAD_FRAME_SIZE;
  const n = Math.ceil(audio.length / frameSize) || 0;
  const out: boolean[] = new Array(n);
  const sr = new Tensor("int64", [BigInt(VAD_SAMPLE_RATE)], []);
  let state = new Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
  // Fresh buffer each frame so ORT never sees a mutated shared view.
  const threshold = 0.35;

  for (let f = 0; f < n; f++) {
    const start = f * frameSize;
    const end = Math.min(audio.length, start + frameSize);
    const frameBuf = new Float32Array(frameSize);
    frameBuf.set(audio.subarray(start, end));
    const input = new Tensor("float32", frameBuf, [1, frameSize]);
    const { output, stateN } = await model({ input, sr, state });
    state = stateN;
    out[f] = Number(output.data[0] ?? 0) >= threshold;

    if (f > 0 && f % 512 === 0) {
      post({ type: "progress", message: en["progress.detectingSpeech"], value: f / n });
    }
  }
  return out;
}

/** Turn speech-frame flags into segments, with a full-audio fallback. */
function segmentsOrFull(
  frames: boolean[],
  audio: Float32Array
): SpeechSegment[] {
  const segments = speechSegmentsFromFrames(frames, audio.length, {
    maxGapS: SPEECH_MAX_GAP_S,
    padS: SPEECH_PAD_S,
  });
  if (segments.length > 0) return segments;
  console.warn("VAD found no speech; falling back to full audio.");
  return [{ startSample: 0, endSample: audio.length }];
}

/**
 * Speech segments to transcribe, plus the raw per-frame flags they came from.
 * The flags are kept because word timestamps are realigned against them once
 * decoding finishes (see lib/align.ts); `frames` is empty when detection failed
 * and the whole file is decoded as one segment, which makes that step a no-op.
 */
async function detectSpeechSegments(
  audio: Float32Array,
  vad: VadModel | null
): Promise<{ segments: SpeechSegment[]; frames: boolean[] }> {
  try {
    const frames = vad
      ? await speechFramesWithSilero(vad, audio)
      : energySpeechFrames(audio);
    return { segments: segmentsOrFull(frames, audio), frames };
  } catch (err) {
    console.warn("Speech segmentation failed; falling back to full audio.", err);
    return { segments: [{ startSample: 0, endSample: audio.length }], frames: [] };
  }
}

/** Nominal length given to a word whose end timestamp is missing or unusable. */
const FALLBACK_WORD_S = 0.5;

/** Map Whisper word chunks from a segment onto the original media timeline. */
/**
 * Split segment-level chunks into one chunk per word, with times interpolated
 * evenly across the segment.
 *
 * For a model whose export has no cross-attentions, Whisper can only say "this
 * sentence spans 2.1s–5.4s". The even split is deliberately a placeholder: CTC
 * forced alignment in {@link refineWordTimestamps} measures each boundary
 * against the audio afterwards and overwrites these. It matters only that every
 * word starts inside its own segment and in order, so the aligner has a sane
 * seed and the transcript stays clickable even if alignment is skipped.
 */
function expandSegmentChunks(
  chunks: AsrChunk[],
  segmentDuration: number
): AsrChunk[] {
  const words: string[] = [];
  for (const chunk of chunks) {
    for (const word of chunk.text.trim().split(/\s+/)) {
      if (word) words.push(word);
    }
  }
  if (words.length === 0) return [];

  /**
   * Whisper's own segment times are discarded here rather than divided up.
   *
   * A fine-tune that was not trained to emit timestamp tokens returns junk for
   * them — measured on this Telugu checkpoint, twenty-odd words all came back
   * inside 0.69s–0.71s. Seeding from that is worse than having no seed at all,
   * because CTC alignment only searches the window its seed spans: a 0.02s seed
   * gives the aligner 0.02s of audio to place the whole sentence in, and every
   * word stays stacked. Spreading across the slice hands it the real window.
   */
  const per = segmentDuration / words.length;
  return words.map((text, i) => ({
    text,
    timestamp: [per * i, per * (i + 1)] as [number, number],
  }));
}

function wordsFromChunks(
  chunks: AsrChunk[],
  offsetS: number,
  segmentDuration: number,
  mediaDuration: number
): Word[] {
  const clampLocal = (t: number) => Math.min(Math.max(t, 0), segmentDuration);
  const usable = chunks
    .map((c) => ({ text: c.text.trim(), timestamp: c.timestamp }))
    .filter((c) => c.text.length > 0);

  return usable.map((c, i) => {
    const localStart = clampLocal(c.timestamp[0] ?? 0);
    // Word timestamps come from DTW over the encoder's cross-attention, and
    // that window is always the full 30 s zero-padded input — so the last word
    // of a short slice regularly comes back ending at ~29.98 s no matter how
    // little audio there was. An end past the slice is not a long word, it is a
    // missing timestamp: fall back to a nominal length, bounded by the next
    // word. (Clamping to the media duration instead once produced a single
    // 13.7 s "word" covering the whole tail of the timeline.)
    const next = usable[i + 1];
    const nextStart = next
      ? clampLocal(next.timestamp[0] ?? segmentDuration)
      : segmentDuration;
    const rawEnd = c.timestamp[1];
    const localEnd =
      rawEnd != null && rawEnd <= segmentDuration
        ? clampLocal(rawEnd)
        : Math.min(localStart + FALLBACK_WORD_S, Math.max(localStart, nextStart));

    let start = offsetS + localStart;
    let end = offsetS + Math.max(localEnd, localStart);
    if (mediaDuration > 0) {
      start = Math.min(start, mediaDuration);
      end = Math.min(end, mediaDuration);
    }
    start = Math.max(0, start);
    return {
      id: i,
      text: c.text,
      start,
      end: Math.max(end, start + 0.02),
      speaker: 0,
      deleted: false,
    };
  });
}

/**
 * Load the diarization model. Started in the background while Whisper is
 * still transcribing, so the (small) speaker model is downloaded, cached,
 * and ready by the time the transcript lands — closing the tab right after
 * transcription no longer leaves it uncached for the next session. No
 * progress is posted here to avoid interleaving with transcription progress.
 */
let diarizerPromise: Promise<Diarizer> | null = null;
function getDiarizer(): Promise<Diarizer> {
  if (!diarizerPromise) {
    diarizerPromise = (async () => {
      const processor = await AutoProcessor.from_pretrained(DIARIZATION_MODEL, {});
      const model = await AutoModelForAudioFrameClassification.from_pretrained(
        DIARIZATION_MODEL,
        { dtype: "fp32" }
      );
      return { processor, model };
    })();
    diarizerPromise.catch(() => {
      diarizerPromise = null;
    });
  }
  return diarizerPromise;
}

/**
 * The CTC acoustic model that places word boundaries, as a weightlift
 * definition so its bytes are tracked like the ASR models rather than
 * downloading silently behind an "Aligning words…" label.
 *
 * Not `transformersModel()`: that builds a `pipeline()`, and this needs the
 * processor, model and tokenizer separately. The progress wiring is the same.
 *
 * q4 is used throughout: English wav2vec2 is ~86 MB; MMS / Chinese XLS-R are
 * ~240 MB. fp16 fails to load on onnxruntime-web.
 */
function alignerModel(info: AlignModelInfo): ModelDefinition<Aligner> {
  return {
    isCached: () =>
      isTransformersModelCached(info.id, {
        cacheKey: env.cacheKey ?? "transformers-cache",
      }),
    // Only the model owns ONNX sessions; the processor and vocab are plain JS.
    dispose: async ({ model }) => {
      await model.dispose();
    },
    load: async ({ progress }) => {
      const progress_callback = transformersProgress(progress);
      const [processor, model, tokenizer] = await Promise.all([
        AutoProcessor.from_pretrained(info.id, { progress_callback }),
        AutoModelForCTC.from_pretrained(info.id, {
          dtype: "q4",
          progress_callback,
        }),
        AutoTokenizer.from_pretrained(info.id, { progress_callback }),
      ]);
      const vocab = ctcVocabFromTokenizer(
        // Tokenizer internals are untyped in transformers.js.
        tokenizer as unknown as CtcTokenizerLike,
        info.normalize
      );
      return { processor, model, vocab };
    },
  };
}

function getAligner(language: TranscriptLanguage): Promise<Aligner> {
  const info = alignModelFor(language);
  if (!info) {
    return Promise.reject(new Error(`No CTC aligner for language: ${language}`));
  }
  return aligners.load<Aligner>(alignerKey(info));
}

/** Per-frame log-probabilities for one slice of audio. */
async function ctcEmission(aligner: Aligner, slice: Float32Array): Promise<CtcEmission> {
  const inputs = await aligner.processor(slice);
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const { logits } = await (aligner.model as any)(inputs);
  const [, frames, vocab] = logits.dims as number[];
  const data = logits.data as Float32Array;
  // The model emits raw scores; Viterbi needs log-probabilities.
  const logProbs = new Float32Array(frames * vocab);
  for (let t = 0; t < frames; t++) {
    const row = t * vocab;
    let max = -Infinity;
    for (let v = 0; v < vocab; v++) if (data[row + v] > max) max = data[row + v];
    let sum = 0;
    for (let v = 0; v < vocab; v++) sum += Math.exp(data[row + v] - max);
    const logSumExp = max + Math.log(sum);
    for (let v = 0; v < vocab; v++) logProbs[row + v] = data[row + v] - logSumExp;
  }
  return { logProbs, frames, vocab };
}

/**
 * Replace decoded word timings with boundaries measured against the audio.
 *
 * Incoming timestamps (Whisper DTW or Parakeet TDT) are only used to decide
 * which words go in which batch. Any batch that fails to align keeps the
 * timings it came in with, so a bad slice costs accuracy on those words rather
 * than losing them.
 */
async function forceAlign(
  words: Word[],
  audio: Float32Array,
  duration: number,
  language: TranscriptLanguage
): Promise<Word[]> {
  const info = alignModelFor(language);
  if (!info) return words;

  // Subscribe only while we are actually waiting. The aligner also warms in the
  // background during transcription, and those bytes must not fight the
  // "Transcribing…" line — but a wait here is worth a bar, since a cold cache
  // otherwise looks like a hang. Scoping the subscription to the await is the
  // whole gate: no shared flag to get out of step if this is ever re-entered.
  let aligner: Aligner;
  const report = (rec: ReturnType<typeof aligners.status>) => {
    if (rec.status !== "loading") return;
    post({
      type: "progress",
      message:
        rec.fromCache === true
          ? en["progress.loadingAlignCache"]
          : en["progress.downloadingAlign"],
      value: rec.indeterminate ? null : rec.percent,
    });
  };
  const key = alignerKey(info);
  const unsubscribe = aligners.subscribe((snap) => report(snap.models[key]));
  // subscribe() only fires on the next change, so prime from current state: a
  // load that has started but not yet received its first byte would otherwise
  // leave the UI sitting on "Transcribing…".
  report(aligners.status(key));
  try {
    aligner = await getAligner(language);
  } finally {
    unsubscribe();
  }
  // Switch off the download label as soon as the weights are in hand.
  post({ type: "progress", message: en["progress.aligning"], value: 0 });
  const batches = groupWordsForAlignment(words, ALIGN_BATCH_MAX_S);
  const out: Word[] = [];
  let done = 0;

  for (const batch of batches) {
    const from = Math.max(0, batch[0].start - ALIGN_BATCH_PAD_S);
    const to = Math.min(duration, batch[batch.length - 1].end + ALIGN_BATCH_PAD_S);
    const startSample = Math.floor(from * VAD_SAMPLE_RATE);
    const endSample = Math.min(audio.length, Math.ceil(to * VAD_SAMPLE_RATE));
    const slice = audio.slice(startSample, endSample);
    let aligned: Word[] | null = null;
    if (slice.length > VAD_SAMPLE_RATE / 10) {
      try {
        const emission = await ctcEmission(aligner, slice);
        aligned = alignBatch(
          batch,
          emission,
          startSample / VAD_SAMPLE_RATE,
          slice.length / VAD_SAMPLE_RATE,
          aligner.vocab
        );
      } catch (err) {
        console.warn("Forced alignment failed for one batch; keeping decoded times.", err);
      }
    }
    // alignBatch returns null rather than throwing when the transcript cannot be
    // encoded into the model's vocabulary — the whole batch then silently keeps
    // its decoded times, which for an estimated seed means evenly-spaced words
    // and a timeline that does not line up with the audio. Say so.
    if (!aligned) {
      console.warn(
        `[align] batch of ${batch.length} word(s) at ${from.toFixed(2)}s not aligned ` +
          `(slice ${(slice.length / VAD_SAMPLE_RATE).toFixed(2)}s); keeping seed times. ` +
          `First words: ${batch.slice(0, 4).map((w) => w.text).join(" ")}`
      );
    }
    out.push(...(aligned ?? batch));
    done++;
    post({ type: "progress", message: en["progress.aligning"], value: done / batches.length });
  }
  return out;
}

/**
 * Shared post-ASR timing pass for Whisper and Parakeet.
 *
 * 1. VAD / loudness-envelope heuristic (language-agnostic fallback and batch seed)
 * 2. CTC forced alignment when a model exists for `language`
 * 3. Envelope edge expansion of peaky CTC spans
 * 4. Disfluency placeholders (after alignment — "..." has no CTC spelling)
 */
/** `language` is undefined when auto-detection could not resolve one; that skips CTC. */
async function refineWordTimestamps(
  words: Word[],
  speechFrames: boolean[],
  audio: Float32Array,
  duration: number,
  language: TranscriptLanguage | undefined
): Promise<Word[]> {
  let out = alignWordsToSpeech(words, speechFrames, {
    duration,
    audio,
    sampleRate: VAD_SAMPLE_RATE,
  });

  if (language && alignModelFor(language)) {
    try {
      const measured = await forceAlign(out, audio, duration, language);
      out = expandToAcoustics(measured, speechEnvelope(audio, VAD_SAMPLE_RATE));
    } catch (err) {
      console.warn("Forced alignment unavailable; using VAD-corrected times.", err);
    }
  }

  const withPauses = insertDisfluencyPlaceholders(out, speechFrames, { duration });
  // Last, so the placeholders move with the words around them.
  return applyAlignLead(withPauses, ALIGN_LEAD_S, { duration });
}

/**
 * Segment the whole recording, one bounded window at a time.
 *
 * Feeding the model the entire file was the app's largest allocation by a wide
 * margin — see the note at the top of lib/diarize.ts. Windowing keeps every
 * forward pass the same size whatever the duration; the price is that pyannote's
 * class indices are only meaningful within a pass, which is what the overlap and
 * `stitchDiarizationWindows` are for.
 */
async function diarize(audio: Float32Array): Promise<DiarizationSegment[]> {
  const { processor, model } = await getDiarizer();
  // post_process_speaker_diarization is specific to the PyAnnote processor
  // and is not part of the generic Processor typings.
  const pyannote = processor as unknown as {
    post_process_speaker_diarization: (
      logits: unknown,
      numSamples: number
    ) => DiarizationSegment[][];
  };

  const spans = diarizationWindows(audio.length, VAD_SAMPLE_RATE);
  const windows: DiarizationWindow[] = [];
  for (let i = 0; i < spans.length; i++) {
    const { startSample, endSample } = spans[i];
    // Fresh buffer rather than a subarray: non-zero byteOffset views have
    // produced wrong results from onnxruntime-web elsewhere in this worker.
    const slice = audio.slice(startSample, endSample);
    const inputs = await processor(slice);
    const { logits } = await model(inputs);
    windows.push({
      offsetS: startSample / VAD_SAMPLE_RATE,
      durationS: slice.length / VAD_SAMPLE_RATE,
      segments: pyannote.post_process_speaker_diarization(logits, slice.length)[0] ?? [],
    });
    postLive({
      type: "progress",
      message: en["progress.speakers"],
      value: (i + 1) / spans.length,
    });
  }
  return stitchDiarizationWindows(windows);
}

/** Assign a speaker to each word from the diarization segments. */
function assignSpeakers(words: Word[], segments: DiarizationSegment[]) {
  // Segment id 0 is "no speaker" (silence/noise); ignore it.
  const speech = segments.filter((s) => s.id !== 0);
  if (speech.length === 0) {
    for (const w of words) w.speaker = 0;
    return;
  }
  // Both lists run in time order, so a single cursor walks them together.
  // Rescanning every segment per word is O(words x segments) — fine on a clip,
  // but an hour of speech is thousands of each and this used to be unreachable
  // only because diarizing a file that long failed outright.
  const byStart = [...speech].sort((a, b) => a.start - b.start);
  let cursor = 0;

  const idMap = new Map<number, number>(); // pyannote id -> sequential index
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    // Advance past segments that end before this word and can no longer be the
    // containing one. Words are in time order, so this never rewinds.
    while (cursor + 1 < byStart.length && byStart[cursor].end <= mid) cursor++;

    let seg: DiarizationSegment | undefined;
    let best = Infinity;
    // The containing segment, or failing that the nearest, is at the cursor or
    // immediately beside it — a constant-size neighbourhood, not a full scan.
    for (let i = Math.max(0, cursor - 1); i < byStart.length && i <= cursor + 1; i++) {
      const s = byStart[i];
      if (mid >= s.start && mid < s.end) {
        seg = s;
        break;
      }
      const d = mid < s.start ? s.start - mid : mid - s.end;
      if (d < best) {
        best = d;
        seg = s;
      }
    }
    const raw = seg ? seg.id : -1;
    if (raw >= 0 && !idMap.has(raw)) idMap.set(raw, idMap.size);
    w.speaker = raw >= 0 ? (idMap.get(raw) as number) : 0;
  }
}

/** Map Parakeet word timestamps onto the original media timeline. */
function wordsFromParakeet(
  words: Array<{ text: string; start_time: number; end_time: number }>,
  offsetS: number,
  segmentDuration: number,
  mediaDuration: number
): Word[] {
  const clampLocal = (t: number) => Math.min(Math.max(t, 0), segmentDuration);
  const usable = words
    .map((w) => ({
      text: w.text.trim(),
      start: w.start_time,
      end: w.end_time,
    }))
    .filter((w) => w.text.length > 0);

  return usable.map((w, i) => {
    const localStart = clampLocal(w.start);
    const next = usable[i + 1];
    const nextStart = next ? clampLocal(next.start) : segmentDuration;
    const localEnd =
      Number.isFinite(w.end) && w.end <= segmentDuration + 0.05
        ? clampLocal(w.end)
        : Math.min(localStart + FALLBACK_WORD_S, Math.max(localStart, nextStart));

    let start = offsetS + localStart;
    let end = offsetS + Math.max(localEnd, localStart);
    if (mediaDuration > 0) {
      start = Math.min(start, mediaDuration);
      end = Math.min(end, mediaDuration);
    }
    start = Math.max(0, start);
    return {
      id: i,
      text: w.text,
      start,
      end: Math.max(end, start + 0.02),
      speaker: 0,
      deleted: false,
    };
  });
}

async function finishWithDiarization(
  words: Word[],
  audio: Float32Array
): Promise<Word[]> {
  try {
    post({ type: "progress", message: en["progress.speakers"], value: 0 });
    const segments = await diarize(audio);
    assignSpeakers(words, segments);
  } catch (err) {
    console.warn("Speaker diarization failed; using a single speaker.", err);
  }
  return words;
}

async function runParakeet(
  audio: Float32Array,
  duration: number,
  setting: TranscriptLanguageSetting
): Promise<Word[]> {
  // Parakeet detects the language itself and is never told one, so "auto" just
  // means we do not know which aligner to warm yet — it is read off the
  // transcript below, exactly as the auto path in runWhisper does.
  const transcriptLanguage =
    setting === "auto" ? undefined : setting;
  // Overlap diarizer (+ language-matched aligner) with Parakeet load.
  getDiarizer().catch(() => {});
  if (transcriptLanguage && alignModelFor(transcriptLanguage)) {
    getAligner(transcriptLanguage).catch(() => {});
  }
  const [loaded, vad] = await Promise.all([getParakeet(), getVad()]);
  let model = loaded;

  post({ type: "progress", message: en["progress.detectingSpeech"], value: 0 });
  const { segments: speechSegments, frames: speechFrames } =
    await detectSpeechSegments(audio, vad);

  post({ type: "progress", message: en["progress.transcribing"], value: 0 });
  const speechSamples = speechSegments.reduce(
    (n, s) => n + (s.endSample - s.startSample),
    0
  );

  const rawWords: Word[] = [];
  let partial = "";
  let speechDone = 0;

  for (const seg of speechSegments) {
    const segmentSamples = seg.endSample - seg.startSample;
    // Fresh buffer: non-zero byteOffset views have caused incomplete ASR with
    // onnxruntime-web in the Whisper path; keep the same hygiene here.
    const slice = audio.slice(seg.startSample, seg.endSample);
    const sliceDuration = slice.length / VAD_SAMPLE_RATE;
    const offsetS = seg.startSample / VAD_SAMPLE_RATE;

    const runSlice = () =>
      model.transcribe(slice, VAD_SAMPLE_RATE, {
        returnTimestamps: true,
        timeOffset: 0,
      });

    let result: Awaited<ReturnType<ParakeetInstance["transcribe"]>>;
    try {
      result = await runSlice();
    } catch (err) {
      if (asrDevice !== "webgpu" || !isWebGpuDeviceLostError(err)) {
        throw err;
      }
      console.warn(
        "WebGPU lost during Parakeet transcription; reloading on WASM.",
        err
      );
      await fallbackAsrToWasm();
      model = await getParakeet();
      result = await runSlice();
    }

    rawWords.push(
      ...wordsFromParakeet(result.words ?? [], offsetS, sliceDuration, duration)
    );
    const piece = (result.utterance_text ?? "").trim();
    if (piece) {
      partial = partial ? `${partial} ${piece}` : piece;
      postPartial(partial);
    }

    speechDone += segmentSamples;
    const value =
      speechSamples > 0 ? Math.min(1, speechDone / speechSamples) : 1;
    postLive({ type: "progress", message: en["progress.transcribing"], value });
  }

  await releaseAsr("parakeet");

  const cleaned = cleanTranscript(rawWords);
  const words = await refineWordTimestamps(
    cleaned,
    speechFrames,
    audio,
    duration,
    transcriptLanguage ??
      detectLanguageFromText(cleaned.map((w) => w.text).join(" ")) ??
      undefined
  );
  return finishWithDiarization(words, audio);
}

/**
 * Ask Whisper which language it is hearing.
 *
 * This has to be done by hand. Omitting `language` does **not** enable
 * detection in transformers.js — `_retrieve_init_tokens` warns "No language
 * specified - defaulting to English (en)" and forces `<|en|>`, which is why an
 * unset language renders Telugu speech as English words rather than failing.
 *
 * Whisper's own detection is a single decoder step: feed `<|startoftranscript|>`
 * and the next-token distribution is over the 99 language tokens. Argmax across
 * `lang_to_id` is the model's answer, and it is what the real Whisper CLI does
 * too. Returns a Whisper language code ("te", "hi", "ur", …) — deliberately not
 * narrowed to the languages we align, because forcing the *wrong* supported
 * language is the failure this exists to prevent.
 */
async function detectSpokenLanguage(
  transcriber: AutomaticSpeechRecognitionPipeline,
  probes: Float32Array[]
): Promise<string | null> {
  try {
    const model = transcriber.model as unknown as {
      generation_config?: {
        lang_to_id?: Record<string, number>;
        decoder_start_token_id?: number;
      };
      (inputs: Record<string, unknown>): Promise<{
        logits: { data: Float32Array; dims: number[] };
      }>;
    };
    const config = model.generation_config;
    const langToId = config?.lang_to_id;
    const startId = config?.decoder_start_token_id;
    if (!langToId || startId == null) return null;

    const processor = transcriber.processor as unknown as (
      audio: Float32Array
    ) => Promise<Record<string, unknown>>;
    const tokens = Object.keys(langToId);
    /** Summed probability per language token across every probe window. */
    const totals = new Float64Array(tokens.length);
    let scored = 0;

    for (const probe of probes) {
      const features = await processor(probe);
      const decoderInputIds = new Tensor(
        "int64",
        BigInt64Array.from([BigInt(startId)]),
        [1, 1]
      );
      const output = await model({
        ...features,
        decoder_input_ids: decoderInputIds,
      });

      const { data, dims } = output.logits;
      // Score the final position: [batch, seq, vocab], and seq is 1 here.
      const vocab = dims[dims.length - 1];
      const base = data.length - vocab;

      // Softmax over the language tokens only, so each window contributes one
      // unit of confidence. Raw logits would let a single loud window dominate.
      let max = -Infinity;
      for (let i = 0; i < tokens.length; i++) {
        const v = data[base + langToId[tokens[i]]];
        if (v > max) max = v;
      }
      let sum = 0;
      const exp = new Float64Array(tokens.length);
      for (let i = 0; i < tokens.length; i++) {
        const e = Math.exp(data[base + langToId[tokens[i]]] - max);
        exp[i] = e;
        sum += e;
      }
      if (!(sum > 0) || !Number.isFinite(sum)) continue;
      for (let i = 0; i < tokens.length; i++) totals[i] += exp[i] / sum;
      scored++;
    }

    if (scored === 0) return null;

    const ranked = tokens
      .map((token, i) => ({ token, p: totals[i] / scored }))
      .sort((a, b) => b.p - a.p);

    // Log the runners-up: when detection is wrong it is almost always a near
    // miss between related languages (te/ta/ml/kn), and the margin is the thing
    // that tells you whether to trust it or pin the language by hand.
    console.info(
      `[asr] language candidates: ${ranked
        .slice(0, 4)
        .map((r) => `${r.token.slice(2, -2)} ${(r.p * 100).toFixed(1)}%`)
        .join(", ")} (${scored} window(s))`
    );

    const code = ranked[0]?.token.slice(2, -2) ?? null;
    return code && code.length >= 2 ? code : null;
  } catch (err) {
    console.warn("Language detection failed; falling back to English.", err);
    return null;
  }
}

async function runWhisper(
  audio: Float32Array,
  duration: number,
  choice: WhisperModel,
  setting: TranscriptLanguageSetting
): Promise<Word[]> {
  const wordLevelTimestamps = MODELS[choice].wordTimestamps !== false;
  const auto = setting === "auto";
  /**
   * The language token the decoder is given, as a Whisper code. On "auto" this
   * is filled in by {@link detectSpokenLanguage} once the model is loaded —
   * never left unset, because unset means English here, not detection.
   */
  let decodeLanguage: string | undefined = auto ? undefined : setting;

  // Overlap Whisper + Silero downloads; diarizer and language-matched aligner
  // warm in the background so both are cached by the time the transcript lands.
  getDiarizer().catch(() => {});
  if (decodeLanguage && alignModelFor(decodeLanguage)) {
    getAligner(decodeLanguage as TranscriptLanguage).catch(() => {});
  }
  const [asr, vad] = await Promise.all([getAsr(choice), getVad()]);
  let transcriber = asr;

  post({ type: "progress", message: en["progress.detectingSpeech"], value: 0 });
  const { segments: speechSegments, frames: speechFrames } =
    await detectSpeechSegments(audio, vad);

  const speechSamples = speechSegments.reduce(
    (n, s) => n + (s.endSample - s.startSample),
    0
  );

  /**
   * Detect once, on speech rather than on the whole file (leading silence or
   * music makes the model guess), then force that language for every segment.
   * One answer for the clip is the point: detecting per segment lets a single
   * recording come back as three different languages spliced together.
   */
  if (auto && speechSegments.length > 0) {
    // Sample the *longest* stretches of speech, not simply the first one. The
    // opening segment is often a half-second of greeting, and 30s of mostly
    // padded silence is what makes the model guess a neighbouring language.
    const probes = [...speechSegments]
      .sort(
        (a, b) => b.endSample - b.startSample - (a.endSample - a.startSample)
      )
      .slice(0, 3)
      .map((seg) =>
        audio.slice(
          seg.startSample,
          // Whisper's encoder sees 30s; the processor pads or truncates to that.
          Math.min(seg.startSample + 30 * VAD_SAMPLE_RATE, seg.endSample)
        )
      )
      .filter((probe) => probe.length >= VAD_SAMPLE_RATE * 0.5);
    const detected = await detectSpokenLanguage(transcriber, probes);
    if (detected) {
      decodeLanguage = detected;
      console.info(`[asr] detected language: ${detected}`);
      if (alignModelFor(detected)) {
        getAligner(detected as TranscriptLanguage).catch(() => {});
      }
    }
  }

  post({ type: "progress", message: en["progress.transcribing"], value: 0 });

  let partial = "";
  // Use 29s instead of 30: transformers.js has a known word-timestamp bug
  // at exactly chunk_length_s=30 (#1357 / #1358); 29 is the common workaround.
  const chunkLength = 29;
  const stride = 5;
  const timePrecision =
    // @ts-expect-error feature_extractor config is untyped
    (transcriber.processor.feature_extractor.config.chunk_length ?? 30) /
    // @ts-expect-error model config is untyped
    (transcriber.model.config.max_source_positions ?? 1500);

  let speechDone = 0;
  let transcribed = 0;
  let chunkFloor = 0;
  let chunkTokens = 0;
  let avgChunkDelta =
    speechSamples > 0
      ? Math.min(0.15, ((chunkLength - stride) * VAD_SAMPLE_RATE) / speechSamples)
      : 0.05;

  const reportProgress = (segmentLocalT: number, segmentSamples: number) => {
    const local = Math.min(
      segmentSamples,
      Math.max(0, segmentLocalT * VAD_SAMPLE_RATE)
    );
    const next = Math.max(
      transcribed,
      Math.min(1, speechSamples > 0 ? (speechDone + local) / speechSamples : 1)
    );
    const realDelta = next - chunkFloor;
    if (realDelta > 0) avgChunkDelta = avgChunkDelta * 0.5 + realDelta * 0.5;
    chunkFloor = next;
    chunkTokens = 0;
    transcribed = next;
    postLive({ type: "progress", message: en["progress.transcribing"], value: transcribed });
  };

  /** Nudge the bar forward between chunk boundaries as tokens stream in. */
  const interpolateProgress = () => {
    chunkTokens++;
    // n/(n+8): 0.11 at token 1, 0.5 at token 8, 0.9 at token 72 — strictly
    // increasing, so it can never get stuck as long as tokens keep coming.
    const frac = chunkTokens / (chunkTokens + 8);
    const interpolated = Math.min(0.999, chunkFloor + frac * avgChunkDelta);
    if (interpolated > transcribed) {
      transcribed = interpolated;
      postLive({ type: "progress", message: en["progress.transcribing"], value: transcribed });
    }
  };

  const asrOptions = () => ({
    chunk_length_s: chunkLength,
    stride_length_s: stride,
    // "word" needs cross-attentions in the export; a model without them is
    // decoded per segment and timed by CTC instead. See WhisperModelInfo.
    return_timestamps: wordLevelTimestamps ? ("word" as const) : true,
    // Anti-repetition: Whisper-base on multi-minute audio often falls into
    // loops like "little bit of a little bit of a…" near chunk boundaries
    // or silence. Keep penalty mild — 1.15 truncates multi-speaker clips
    // mid-utterance (second speaker dropped on continuous speech).
    no_repeat_ngram_size: MODELS[choice].noRepeatNgramSize ?? 4,
    repetition_penalty: 1.05,
    // Plain decoding — no forced decoder prefix. Priming the decoder collapses
    // short VAD segments on every model here, whether with Whisper's
    // <|startofprev|> filler prompt or CrisperWhisper's mode tags. See the note
    // above MODELS in lib/models.ts; vad-regression-test.ts guards it.
    language: decodeLanguage,
    // Always transcribe. Left unset the model may predict <|translate|> and
    // silently hand back an English translation instead of the source language.
    task: "transcribe" as const,
  });

  const rawWords: Word[] = [];
  const leadPadSamples = Math.floor(WHISPER_LEAD_PAD_S * VAD_SAMPLE_RATE);
  for (const seg of speechSegments) {
    const segmentSamples = seg.endSample - seg.startSample;
    // Copy into a fresh buffer with leading silence. Views with a non-zero
    // byteOffset have caused incomplete ASR with onnxruntime-web; starting
    // mid-speech with no lead-in also drops later speakers on mixed clips.
    const slice = new Float32Array(leadPadSamples + segmentSamples);
    slice.set(audio.subarray(seg.startSample, seg.endSample), leadPadSamples);
    const sliceDuration = slice.length / VAD_SAMPLE_RATE;
    const offsetS = seg.startSample / VAD_SAMPLE_RATE - WHISPER_LEAD_PAD_S;

    // Snapshot progress so a failed WebGPU attempt can be rolled back before
    // the WASM retry of this same segment.
    const partialBefore = partial;
    const progressBefore = { transcribed, chunkFloor, chunkTokens };

    const runSlice = async () => {
      // Each generate() window consumes `chunkLength - 2 * stride` seconds of
      // new audio, and the streamer's timestamps rewind to ~0 when the next
      // window starts. A timestamp lower than the last one seen marks that
      // boundary; accumulate the offset to recover segment-local time.
      const windowJumpS = chunkLength - 2 * stride;
      let windowOffsetS = 0;
      let lastChunkStartT = 0;
      const tokenizer = transcriber.tokenizer as ConstructorParameters<
        typeof WhisperTextStreamer
      >[0];
      const streamer = new WhisperTextStreamer(tokenizer, {
        skip_prompt: true,
        time_precision: timePrecision,
        on_chunk_start: (t: number) => {
          if (t < lastChunkStartT) windowOffsetS += windowJumpS;
          lastChunkStartT = t;
          reportProgress(
            Math.max(0, windowOffsetS + t - WHISPER_LEAD_PAD_S),
            segmentSamples
          );
        },
        callback_function: (text: string) => {
          partial += text;
          postPartial(partial);
          interpolateProgress();
        },
      });
      const output = await transcriber(slice, { ...asrOptions(), streamer });
      const result = Array.isArray(output) ? output[0] : output;
      return (result.chunks ?? []) as AsrChunk[];
    };

    let chunks: AsrChunk[];
    try {
      chunks = await runSlice();
    } catch (err) {
      // Windows screen lock tears down WebGPU mid-OrtRun. Fall back to WASM
      // and retry this segment once so the job can finish.
      if (asrDevice !== "webgpu" || !isWebGpuDeviceLostError(err)) throw err;
      console.warn(
        "WebGPU lost during transcription (often after screen lock); falling back to WASM.",
        err
      );
      partial = partialBefore;
      transcribed = progressBefore.transcribed;
      chunkFloor = progressBefore.chunkFloor;
      chunkTokens = progressBefore.chunkTokens;
      postPartial(partial);
      await fallbackAsrToWasm();
      transcriber = await getAsr(choice);
      chunks = await runSlice();
    }

    const words = wordsFromChunks(
      wordLevelTimestamps ? chunks : expandSegmentChunks(chunks, sliceDuration),
      offsetS,
      sliceDuration,
      duration
    );
    // A segment that decodes to nothing is the signature of a model or prompt
    // that has collapsed on this slice — the timeline fills with "..." VAD
    // placeholders and the transcript silently loses a stretch of speech. It is
    // indistinguishable from genuine silence downstream, so say so here, and
    // report enough to tell "ASR returned nothing" apart from "words were
    // produced and then dropped in post-processing".
    if (chunks.length === 0 || words.length === 0) {
      console.warn(
        `[asr] ${choice}: segment ${offsetS.toFixed(2)}s +${sliceDuration.toFixed(2)}s ` +
          `produced ${chunks.length} chunk(s) → ${words.length} word(s).`,
        chunks.length > 0
          ? { text: chunks.map((c) => c.text).join(""), chunks }
          : "(model returned no chunks)"
      );
    }
    rawWords.push(...words);
    speechDone += segmentSamples;
    reportProgress(0, 0);
  }

  await releaseAsr(choice);

  // Post-process: collapse leftover n-gram loops and drop known hallucination
  // phrases ("I'm sorry", "thanks for watching", …) that slip past decoding.
  const cleaned = cleanTranscript(rawWords);
  /**
   * Whisper may have detected any of 99 languages; we align a handful. When the
   * detected one is not among them, fall back to reading the script off the
   * transcript, and failing that skip CTC entirely (undefined) so the envelope
   * heuristic does the timing rather than a model that cannot read the text.
   */
  const alignLanguage = isSpecificLanguage(decodeLanguage)
    ? decodeLanguage
    : (detectLanguageFromText(cleaned.map((w) => w.text).join(" ")) ?? undefined);
  const words = await refineWordTimestamps(
    cleaned,
    speechFrames,
    audio,
    duration,
    alignLanguage
  );

  return finishWithDiarization(words, audio);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { audio, duration, model, language } = event.data;
  try {
    let choice: ModelId = model ?? "base";
    let transcriptLanguage: TranscriptLanguageSetting = language ?? "auto";

    // A single-language fine-tune has one right answer, so detection can only
    // lose here — and it loses in a specific way: Whisper routinely picks a
    // neighbouring Dravidian language (ml, ta, kn) for Telugu speech.
    if (choice === "teluguSmall") transcriptLanguage = "te";

    // Parakeet TDT covers 25 European languages only — it has no Indic support,
    // so on an Indic transcript it would auto-detect the wrong language and emit
    // garbage. Route those runs to Whisper (multilingual) instead.
    if (isParakeetModel(choice) && isIndicLanguage(transcriptLanguage)) {
      console.warn(
        `[asr] Parakeet cannot transcribe ${transcriptLanguage}; using Whisper small instead.`
      );
      choice = "small";
    }

    let words: Word[];
    if (isParakeetModel(choice)) {
      words = await runParakeet(audio, duration, transcriptLanguage);
    } else if (isWhisperModel(choice)) {
      words = await runWhisper(audio, duration, choice, transcriptLanguage);
    } else {
      throw new Error(`Unknown speech model: ${String(choice)}`);
    }

    // Drop anything still queued: a stale "Transcribing… 99%" landing after
    // "complete" would put the UI back into its busy state.
    cancelLive();
    post({ type: "complete", words });
  } catch (err) {
    console.error(err);
    cancelLive();
    if (isNetworkError(err)) {
      // The retries in installFetchRetry are already spent by here, so this is
      // a connection that stayed down. "Failed to fetch" is what the browser
      // says and it means nothing to the person waiting on a transcript — name
      // the download, and say that the finished files are kept so a retry
      // resumes rather than starting the gigabyte over.
      post({
        type: "error",
        message: en["error.modelDownload"],
        cause: "network",
      });
      return;
    }
    post({
      type: "error",
      message: isWebGpuDeviceLostError(err)
        ? en["error.gpuReset"]
        : err instanceof Error
          ? err.message
          : "Transcription failed.",
    });
  }
};
