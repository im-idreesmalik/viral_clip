#!/usr/bin/env python
"""
Generate an instrumental music track with Stability AI's Stable Audio Open.

Unlike MusicGen (whose weights are CC-BY-NC / non-commercial), Stable Audio
Open is released under the Stability AI Community License, which PERMITS
commercial use for individuals and organizations under $1M annual revenue.
That makes tracks generated here usable on monetized channels (at that scale).

The model is *gated* on Hugging Face: you must (one time) accept the license at
https://huggingface.co/stabilityai/stable-audio-open-1.0 and provide an access
token via the HF_TOKEN environment variable. Weights then cache locally and no
network is needed for later runs.

Usage:
  python stable_audio_generate.py --prompt "cinematic ..." --duration 20 --out out.wav
"""
import argparse
import os
import sys


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--duration", type=float, default=20.0)
    ap.add_argument("--model", default=os.environ.get("STABLE_AUDIO_MODEL", "stabilityai/stable-audio-open-1.0"))
    ap.add_argument("--steps", type=int, default=int(os.environ.get("STABLE_AUDIO_STEPS", "100")))
    ap.add_argument("--negative", default="Low quality, distorted, harsh, vocals, singing, speech.")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    # Stable Audio Open is trained for up to ~47s; clamp to a safe window.
    duration = max(3.0, min(float(args.duration), 47.0))

    import torch
    from diffusers import StableAudioPipeline
    import soundfile as sf

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    log(f"[stable-audio] device={device} model={args.model} steps={args.steps} duration={duration:.1f}s")

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    try:
        pipe = StableAudioPipeline.from_pretrained(args.model, torch_dtype=dtype, token=token)
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if "gated" in msg.lower() or "401" in msg or "restricted" in msg.lower() or "authoriz" in msg.lower():
            log(
                "[stable-audio] ERROR: model is gated. Accept the license at "
                "https://huggingface.co/stabilityai/stable-audio-open-1.0 and set HF_TOKEN in .env."
            )
        raise
    pipe = pipe.to(device)

    generator = torch.Generator(device).manual_seed(int(args.seed))
    log("[stable-audio] generating…")
    result = pipe(
        prompt=args.prompt,
        negative_prompt=args.negative,
        num_inference_steps=int(args.steps),
        audio_end_in_s=duration,
        num_waveforms_per_prompt=1,
        generator=generator,
    )

    # (channels, samples) float tensor -> (samples, channels) for soundfile.
    audio = result.audios[0].to(torch.float32).cpu().numpy().T
    sr = int(pipe.vae.sampling_rate)  # 44100
    sf.write(args.out, audio, sr)
    log(f"[stable-audio] wrote {args.out} ({audio.shape[0] / sr:.2f}s @ {sr}Hz, {audio.shape[1]}ch)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
