# Telugu Whisper → ONNX

Builds `public/models/whisper-telugu-small/` from
[`vasista22/whisper-telugu-small`](https://huggingface.co/vasista22/whisper-telugu-small),
the Telugu fine-tune from Speech Lab, IIT Madras.

```bash
python tools/export-telugu-onnx/export.py     # from the repo root
```

Output is ~310 MB and **gitignored** (`/public/models/`). It is rebuilt, never
committed. `MODELS.teluguSmall` in `src/rescript/lib/models.ts` is flagged
`local: true`, which serves it from `/models/<id>/`.

## Why this model exists at all

Stock multilingual Whisper cannot write Telugu. At `small` it exceeds 100% WER —
the documented insertion-error failure for low-resource Indic languages — and
emits a run of Telugu syllables with no word boundaries:

```
న్రిల్లు మ్నులోలేలీలూడినోట్స్త్టుర్క్ప్చిసెలెనెటెరోదికోగ్యారె…
```

The fine-tune reports **9.47% WER on FLEURS Telugu**, which is better than any
cloud ASR measured on the language (Google STT is 33.2%, Meta MMS 67.5%), and it
keeps code-mixed English in Telugu script — `ట్రై` (try), `బ్యాట్` (bat).

## Dependencies

The versions matter, and the reason is not portability pedantry:

```bash
pip install "torch==2.2.2" "transformers==4.40.2" "optimum==1.20.0" \
            onnx onnxruntime "numpy<2"
```

* **torch 2.2.2** is the last release with macOS **x86_64** wheels. On an Intel
  Mac there is nothing newer to install, and 2.2.2 in turn caps Python at
  **3.12** — Python 3.13 has no wheel at all, so a 3.11/3.12 environment is
  required there. Apple Silicon and Linux are unconstrained.
* **transformers 4.40.2** because optimum otherwise pulls a version calling
  `torch.rms_norm`, which does not exist before torch 2.4.
* **numpy < 2** because torch 2.2 was built against numpy 1.x and otherwise
  fails to initialise with `_ARRAY_API not found`.

## What the script does, and why

1. **Checks the fine-tune against `openai/whisper-small`** and refuses to
   continue unless vocab size, `d_model` and layer counts match — the next step
   is only valid for an identical architecture.
2. **Exports to ONNX** via optimum (encoder + merged decoder).
3. **Grafts the generation config.** The fine-tune ships a bare one: no
   `alignment_heads`, `lang_to_id`, `task_to_id` or `is_multilingual`.
   transformers.js *refuses* `language` and `task` without the last three, and
   word timestamps need the first.
4. **Quantizes both halves to q4**, asymmetric.

## Three things that do not work

Recorded so they are not retried:

| Attempt | Result |
| --- | --- |
| **int8 decoder** | Silently emits an **unquantized** file (774.7 MB in, 775.0 MB out). Dynamic quantization cannot reach weights inside the merged decoder's control-flow subgraphs. |
| **fp16 decoder** | Loads, then fails session creation: `Type parameter (T) of Optype (Concat) bound to different types (tensor(float) and tensor(float16))` at the KV-cache concat. |
| **Cross-attentions** | Needed for Whisper's own word timestamps, but declaring them breaks the merged-decoder export: *"The second ModelProto should not have more outputs than the first."* |

The last one is why the model is flagged `wordTimestamps: false`. It decodes at
segment level and **CTC forced alignment measures the word boundaries** instead,
against the audio — which is more accurate than attention-derived timing anyway.

q4 is not a quality compromise, either: decoded at **fp32 in the browser this
model produced the same output as q4**, so the extra precision bought nothing.
The thing that actually ruined its transcripts was `no_repeat_ngram_size`, now
disabled per-model — see `MODELS.teluguSmall.noRepeatNgramSize`.

## Deploying it

The weights are not in the repo, so a deployment ships the *option* without the
*files*. The app handles that honestly — the row renders disabled and marked
"Not installed" rather than failing after the user picks it — but to actually
ship Telugu you need one of:

1. **Publish the export to a Hugging Face repo** (recommended). Upload the
   contents of `public/models/whisper-telugu-small/`, then in `models.ts` set
   `id` to that repo and drop `local: true`. transformers.js fetches and caches
   it like any other model, and nothing needs to be in the image.
2. **Run this script during the build**, which costs the full Python toolchain
   plus a ~1 GB download in the build image.
3. **Mount the directory** at `public/models/` from a persistent volume.

Option 1 is the only one that keeps deploys small and the browser cache warm
across releases.
