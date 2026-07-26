"""
Generate an instrumental music track from a text prompt with Meta's MusicGen.
Runs fully locally (PyTorch + transformers). Used by the AI Stories app to build
per-user background-music beds.

  python musicgen_generate.py --prompt "..." --duration 25 --out track.wav

NOTE: MusicGen model weights are CC-BY-NC 4.0 (non-commercial). Use accordingly.
"""
import argparse
import sys

import torch
from transformers import AutoProcessor, MusicgenForConditionalGeneration
import scipy.io.wavfile


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--duration", type=float, default=25.0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="facebook/musicgen-small")
    args = ap.parse_args()

    # MusicGen is trained on ~30s; keep generations in that range (the app loops
    # the track to any clip length at render time).
    duration = max(5.0, min(30.0, args.duration))
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"loading {args.model} on {device}...", flush=True)

    processor = AutoProcessor.from_pretrained(args.model)
    model = MusicgenForConditionalGeneration.from_pretrained(args.model).to(device)

    inputs = processor(text=[args.prompt], padding=True, return_tensors="pt").to(device)
    max_new_tokens = int(duration * 50)  # MusicGen decodes ~50 tokens/sec of audio
    with torch.no_grad():
        audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=max_new_tokens)

    sr = model.config.audio_encoder.sampling_rate
    data = audio[0, 0].detach().cpu().numpy()
    scipy.io.wavfile.write(args.out, rate=sr, data=data)
    print(f"OK dur={len(data) / sr:.1f}s sr={sr} out={args.out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
