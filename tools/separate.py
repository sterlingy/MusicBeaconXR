"""Splits songs into their parts (stems) with Demucs, for studying their
instruments and copying their sounds onto SynthKit.

    tools/.venv/Scripts/python.exe tools/separate.py                 # every song in analysis/input/
    tools/.venv/Scripts/python.exe tools/separate.py song.mp3 --model htdemucs

Writes analysis/stems/<song>/<part>.wav (44.1 kHz, 16-bit stereo) and
analysis/stems/<song>/parts.json (how loud each part is, so near-silent ones
can be skipped).

Models (downloaded once, about 80 MB each, kept in the torch cache):
  htdemucs_6s  drums, bass, vocals, guitar, piano, other  (default)
  htdemucs     drums, bass, vocals, other  (cleaner when there's no guitar or piano)

Reads WAV, FLAC, MP3 and OGG with soundfile (no ffmpeg needed). M4A/AAC needs
converting first. Uses the NVIDIA GPU when there is one.

Setup (once): python -m venv tools/.venv, then in it:
  pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu124
  pip install demucs==4.0.1 soundfile numpy scipy
analysis/ and tools/.venv/ are kept out of git.
"""
import argparse
import json
import pathlib
import sys
import time

import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model
from scipy.signal import resample_poly

ROOT = pathlib.Path(__file__).resolve().parents[1]
INPUT = ROOT / "analysis" / "input"
STEMS = ROOT / "analysis" / "stems"
AUDIO = {".wav", ".flac", ".mp3", ".ogg", ".aiff", ".aif"}


def load(path: pathlib.Path, rate: int) -> np.ndarray:
    """The file as float32 [channels=2, samples] at `rate`."""
    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    data = data.T
    if data.shape[0] == 1:
        data = np.repeat(data, 2, axis=0)
    data = data[:2]
    if sr != rate:
        g = np.gcd(sr, rate)
        data = resample_poly(data, rate // g, sr // g, axis=1).astype("float32")
    return data


def slug(name: str) -> str:
    keep = "".join(c if c.isalnum() else "-" for c in name.lower())
    return "-".join(p for p in keep.split("-") if p)[:60] or "song"


def separate(path: pathlib.Path, model, device: str) -> pathlib.Path:
    out = STEMS / slug(path.stem)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    wav = torch.from_numpy(load(path, model.samplerate))
    # Demucs works best on a normalized mix; undo it afterwards.
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        sources = apply_model(model, ((wav - mean) / std)[None], device=device, shifts=1, split=True, overlap=0.25, progress=False)[0]
    sources = sources * std + mean
    parts = {}
    for name, src in zip(model.sources, sources):
        audio = src.cpu().numpy().T
        rms = float(np.sqrt(np.mean(audio ** 2)))
        sf.write(str(out / f"{name}.wav"), np.clip(audio, -1, 1), model.samplerate, subtype="PCM_16")
        parts[name] = {"file": f"{name}.wav", "rms_db": round(20 * np.log10(rms + 1e-12), 1)}
    mix_rms = float(np.sqrt(np.mean(wav.numpy() ** 2)))
    info = {"song": path.name, "seconds": round(wav.shape[1] / model.samplerate, 1), "model": model_name(model),
            "mix_rms_db": round(20 * np.log10(mix_rms + 1e-12), 1), "parts": parts}
    (out / "parts.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
    loud = ", ".join(f"{k} {v['rms_db']} dB" for k, v in sorted(parts.items(), key=lambda kv: -kv[1]["rms_db"]))
    print(f"{path.name}: {info['seconds']} s in {time.time() - t0:.1f} s -> {out.relative_to(ROOT)} ({loud})")
    return out


def model_name(model) -> str:
    return getattr(model, "_beacon_name", "?")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("files", nargs="*", help="songs to split (default: everything in analysis/input/)")
    ap.add_argument("--model", default="htdemucs_6s", choices=["htdemucs_6s", "htdemucs", "htdemucs_ft"])
    args = ap.parse_args(argv)
    INPUT.mkdir(parents=True, exist_ok=True)
    files = [pathlib.Path(f) for f in args.files] or sorted(p for p in INPUT.iterdir() if p.suffix.lower() in AUDIO)
    if not files:
        print(f"No songs: put WAV, FLAC, MP3 or OGG files in {INPUT}")
        return 1
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = get_model(args.model)
    model._beacon_name = args.model
    model.to(device).eval()
    print(f"{args.model} on {device}: {', '.join(model.sources)}")
    for f in files:
        if f.suffix.lower() not in AUDIO:
            print(f"skipping {f.name}: convert M4A/AAC to WAV or MP3 first")
            continue
        try:
            separate(f, model, device)
        except Exception as e:  # keep going with the other songs
            print(f"{f.name}: failed ({e})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
