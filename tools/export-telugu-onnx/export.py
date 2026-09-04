#!/usr/bin/env python3
"""Export the IIT-Madras Telugu Whisper fine-tune to ONNX for transformers.js.

    python tools/export-telugu-onnx/export.py

Writes public/models/whisper-telugu-small/, which the app serves for the
`teluguSmall` entry in src/rescript/lib/models.ts (flagged `local`). Those
weights are gitignored — ~310 MB — so this script is how they come back.

Why each step exists, since none of it is obvious:

* **The generation_config is grafted.** The fine-tune ships a bare one: no
  `alignment_heads`, no `lang_to_id`, no `task_to_id`, no `is_multilingual`.
  transformers.js refuses `language` and `task` without the last three, and
  word timestamps need the first. They are copied from openai/whisper-small,
  which is safe because the fine-tune is architecturally identical to it —
  vocab 51865, d_model 768, 12 encoder + 12 decoder layers. The script asserts
  that rather than assuming it.

* **q4 on both halves.** Not a size compromise chosen over quality: decoded at
  fp32 in the browser this model produced the same output as q4, so the
  precision was buying nothing. int8 is not an option — dynamic quantization
  cannot reach weights inside the merged decoder's control-flow subgraphs and
  silently emits an unquantized file (774.7 MB in, 775.0 MB out). fp16 loads
  but fails session creation with a float/float16 type conflict at the
  KV-cache concat.

* **No cross-attentions.** Exporting them is what transformers.js needs for
  word timestamps, and the merged-decoder export fails when they are declared
  ("The second ModelProto should not have more outputs than the first"). The
  app handles this: the model is flagged `wordTimestamps: false` and CTC forced
  alignment measures the word boundaries instead, which is more accurate than
  attention-derived timing anyway.

Dependencies (see README.md — the versions matter on Intel macOS):

    pip install "torch==2.2.2" "transformers==4.40.2" "optimum==1.20.0" \
                onnx onnxruntime "numpy<2"
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import urllib.request
import warnings

warnings.filterwarnings("ignore")

MODEL = "vasista22/whisper-telugu-small"
BASE = "openai/whisper-small"
OUT_DIR = os.path.join("public", "models", "whisper-telugu-small")
WORK = os.path.join(".cache", "telugu-onnx-export")

STATIC_FILES = (
    "config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
    "special_tokens_map.json",
    "normalizer.json",
)


def log(step: str) -> None:
    print(f"\n=== {step} ===", flush=True)


def fetch_json(repo: str, name: str) -> dict:
    url = f"https://huggingface.co/{repo}/raw/main/{name}"
    with urllib.request.urlopen(url) as response:
        return json.load(response)


def export_onnx() -> None:
    from optimum.exporters.onnx import main_export

    main_export(
        model_name_or_path=MODEL,
        output=WORK,
        task="automatic-speech-recognition-with-past",
        opset=14,
        do_validation=False,
    )


def quantize_q4(src: str, dst: str) -> None:
    """4-bit weight-only quantization, asymmetric.

    Asymmetric fits the scale to each block's real min/max instead of forcing
    the zero point to the middle. It costs nothing in file size and matters
    more here than it would for English Whisper, because a low-resource
    fine-tune has less redundancy in its weights to give away.
    """
    import onnx

    # Renamed across onnxruntime versions.
    try:
        from onnxruntime.quantization.matmul_nbits_quantizer import (
            MatMulNBitsQuantizer as Quantizer,
            DefaultWeightOnlyQuantConfig,
        )
    except ImportError:  # older onnxruntime
        from onnxruntime.quantization.matmul_4bits_quantizer import (
            MatMul4BitsQuantizer as Quantizer,
            DefaultWeightOnlyQuantConfig,
        )

    model = onnx.load(src)
    try:
        config = DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=False, bits=4)
    except TypeError:  # older signature without `bits`
        config = DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=False)
    quantizer = Quantizer(model, algo_config=config)
    quantizer.process()
    quantizer.model.save_model_to_file(dst, use_external_data_format=False)
    before = os.path.getsize(src) / 1e6
    after = os.path.getsize(dst) / 1e6
    print(f"  {os.path.basename(dst)}: {before:.0f} MB -> {after:.0f} MB")


def build_generation_config() -> dict:
    base = fetch_json(BASE, "generation_config.json")
    fine = json.load(open(os.path.join(WORK, "generation_config.json")))

    merged = dict(base)
    # The fine-tune's own token ids win where it sets them.
    for key in ("decoder_start_token_id", "eos_token_id", "bos_token_id", "pad_token_id"):
        if key in fine:
            merged[key] = fine[key]
    # Telugu-only checkpoint: never let a stale prefix force another language.
    merged["forced_decoder_ids"] = None

    for key in ("alignment_heads", "lang_to_id", "task_to_id", "is_multilingual"):
        if key not in merged:
            sys.exit(f"{BASE} generation_config is missing {key}; cannot graft.")
    return merged


def assert_same_architecture() -> None:
    fine = fetch_json(MODEL, "config.json")
    base = fetch_json(BASE, "config.json")
    for key in ("vocab_size", "d_model", "encoder_layers", "decoder_layers"):
        if fine.get(key) != base.get(key):
            sys.exit(
                f"{MODEL} and {BASE} differ on {key} "
                f"({fine.get(key)} vs {base.get(key)}). The generation_config "
                "graft is only valid for an identical architecture."
            )
    print("  architectures match; the graft is valid")


def main() -> None:
    if not os.path.isdir("public"):
        sys.exit("Run this from the repository root (no public/ directory here).")

    log("checking the fine-tune against its base")
    assert_same_architecture()

    log(f"exporting {MODEL} to ONNX (slow: downloads ~1 GB, then traces)")
    if os.path.exists(WORK):
        shutil.rmtree(WORK)
    export_onnx()

    log("quantizing to q4")
    onnx_out = os.path.join(OUT_DIR, "onnx")
    os.makedirs(onnx_out, exist_ok=True)
    quantize_q4(
        os.path.join(WORK, "encoder_model.onnx"),
        os.path.join(onnx_out, "encoder_model_q4.onnx"),
    )
    quantize_q4(
        os.path.join(WORK, "decoder_model_merged.onnx"),
        os.path.join(onnx_out, "decoder_model_merged_q4.onnx"),
    )

    log("writing the grafted generation_config")
    config = build_generation_config()
    with open(os.path.join(OUT_DIR, "generation_config.json"), "w") as handle:
        json.dump(config, handle, indent=2)
    print(
        f"  alignment_heads={len(config['alignment_heads'])} "
        f"languages={len(config['lang_to_id'])} multilingual={config['is_multilingual']}"
    )

    log("copying tokenizer and config")
    for name in STATIC_FILES:
        source = os.path.join(WORK, name)
        if os.path.exists(source):
            shutil.copy(source, os.path.join(OUT_DIR, name))

    total = sum(
        os.path.getsize(os.path.join(root, f))
        for root, _, files in os.walk(OUT_DIR)
        for f in files
    )
    log(f"done — {OUT_DIR} is {total / 1e6:.0f} MB")
    print("Pick 'Telugu (IIT Madras)' in the model dropdown to use it.")


if __name__ == "__main__":
    main()
