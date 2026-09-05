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

The weights are not in the repo — the decoder alone is 260 MB, past what GitHub
accepts as a file at all — so a deployment has an **empty `public/models/`**.
Production serves the same `/models/<id>/...` paths from object storage instead,
through `src/app/models/[...path]/route.ts`. Same-origin on purpose: the model
id stays a plain path, `localModelPresent` keeps probing the same URL, the
editor's cross-origin isolation has nothing to negotiate, and the bucket stays
private with its keys server-side.

With no bucket configured that route 404s, which the UI already reads as "not
installed" — the row disables itself rather than failing after the user picks it
and waits. So an unconfigured deploy degrades, it does not break.

### Publishing a new export

```sh
railway bucket create rescript-models --region sjc      # once per project
eval "$(railway bucket credentials --bucket rescript-models --json | jq -r '
  "export AWS_ACCESS_KEY_ID=\(.accessKeyId)
   export AWS_SECRET_ACCESS_KEY=\(.secretAccessKey)
   export BUCKET=\(.bucketName) ENDPOINT=\(.endpoint) AWS_REGION=auto"')"

aws s3 sync public/models/whisper-telugu-small "s3://$BUCKET/whisper-telugu-small" \
  --endpoint-url "$ENDPOINT"
```

Then set `MODEL_BUCKET_ENDPOINT`, `MODEL_BUCKET_NAME`, `MODEL_BUCKET_ACCESS_KEY_ID`
and `MODEL_BUCKET_SECRET_ACCESS_KEY` on the service (`railway variables --set`),
and check it end to end — this calls the real route against the real bucket,
which nothing in development exercises because `public/models/` shadows it:

```sh
railway run npm run probe:models
```

### The alternatives, and why not

* **A Hugging Face repo.** Free CDN, browser-cached across releases, and
  transformers.js fetches it natively — genuinely the better host. It needs a
  write token this project does not have. Swapping to it later is two lines in
  `models.ts`: set `id` to the repo and drop `local: true`.
* **Running this script during the build.** Costs the full Python toolchain plus
  a ~1 GB download in every build image, to reproduce identical weights.
* **A persistent volume mounted at `public/models/`.** Works, but the weights
  then live outside both the repo and any versioning, and have to be re-uploaded
  by hand per environment.
