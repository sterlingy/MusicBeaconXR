"""Measures a separated song (tools/separate.py): tempo, key, chords and
sections from the mix, and for each part how it sounds and plays: tone
balance, brightness, attack and decay, how busy and how wide it is, pitch
range, and the drums' typical bar. The numbers are what SynthKit presets are
matched against.

    tools/.venv/Scripts/python.exe tools/analyze.py                # every song in analysis/stems/
    tools/.venv/Scripts/python.exe tools/analyze.py sowing-the-seeds-of-love

Writes analysis/stems/<song>/report.json and prints a summary.
"""
import json
import pathlib
import sys
import warnings

import librosa
import numpy as np
import soundfile as sf

warnings.filterwarnings("ignore")
ROOT = pathlib.Path(__file__).resolve().parents[1]
STEMS = ROOT / "analysis" / "stems"
SR = 22050
NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
# Krumhansl-Kessler key profiles.
MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def load(path, sr=SR, mono=True):
    y, file_sr = sf.read(str(path), dtype="float32", always_2d=True)
    stereo = y.T
    m = stereo.mean(0)
    if file_sr != sr:
        m = librosa.resample(m, orig_sr=file_sr, target_sr=sr)
    return m, stereo, file_sr


def db(x):
    return float(20 * np.log10(max(x, 1e-12)))


# ---------------------------------------------------------------- the mix

def key_of(chroma):
    prof = chroma.mean(1)
    best = None
    for i in range(12):
        for mode, p in (("major", MAJ), ("minor", MIN)):
            r = np.corrcoef(prof, np.roll(p, i))[0, 1]
            if best is None or r > best[0]:
                best = (r, i, mode)
    return {"root": NOTES[best[1]], "mode": best[2], "confidence": round(float(best[0]), 2)}


def chord_templates():
    names, temps = [], []
    for i in range(12):
        for q, iv in (("", (0, 4, 7)), ("m", (0, 3, 7))):
            t = np.zeros(12)
            t[[(i + k) % 12 for k in iv]] = 1
            names.append(NOTES[i] + q)
            temps.append(t / np.linalg.norm(t))
    return names, np.array(temps)


def chords_by_bar(y, beats_t, harm_chroma_fn):
    """One chord per bar (4 beats), from harmonic chroma averaged over the bar."""
    names, temps = chord_templates()
    chroma = harm_chroma_fn
    times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=SR, hop_length=512)
    out = []
    for b in range(0, len(beats_t) - 4, 4):
        t0, t1 = beats_t[b], beats_t[b + 4]
        sel = (times >= t0) & (times < t1)
        if not sel.any():
            continue
        v = chroma[:, sel].mean(1)
        if np.linalg.norm(v) < 1e-6:
            continue
        s = temps @ (v / np.linalg.norm(v))
        out.append({"t": round(float(t0), 2), "chord": names[int(np.argmax(s))], "fit": round(float(s.max()), 2)})
    return out


def sections(y, n=10):
    """Rough sections: agglomerative segmentation on chroma + timbre, with loudness."""
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=hop)
    mfcc = librosa.feature.mfcc(y=y, sr=SR, hop_length=hop, n_mfcc=13)
    feat = np.vstack([librosa.util.normalize(chroma, axis=0), librosa.util.normalize(mfcc, axis=1)])
    # Average over ~1 s blocks so sections aren't split on single notes.
    block = int(SR / hop)
    nb = feat.shape[1] // block
    fb = feat[:, : nb * block].reshape(feat.shape[0], nb, block).mean(2)
    bounds = librosa.segment.agglomerative(fb, n)
    bounds = sorted(set([0] + list(bounds) + [nb]))
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    out = []
    for a, b in zip(bounds[:-1], bounds[1:]):
        if b - a < 3:
            continue
        r = rms[a * block: b * block]
        out.append({"start": round(a * block * hop / SR, 1), "end": round(b * block * hop / SR, 1), "level_db": round(db(float(np.sqrt(np.mean(r ** 2)))), 1)})
    return out


def tempo_over_time(onset_env, window_s=30):
    hop_t = 512 / SR
    w = int(window_s / hop_t)
    out = []
    for i in range(0, len(onset_env) - w, w // 2):
        t = librosa.feature.tempo(onset_envelope=onset_env[i: i + w], sr=SR, hop_length=512)[0]
        out.append({"t": round(i * hop_t, 1), "bpm": round(float(t), 1)})
    return out


# ---------------------------------------------------------------- a part

def part_profile(y, stereo, name, beats_t):
    hop = 512
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    if rms.max() < 1e-4:
        return {"silent": True}
    gate = rms > max(rms.max() * 0.05, 1e-4)
    active = float(gate.mean())
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=SR, n_fft=2048)
    Sa = S[:, gate] if gate.any() else S
    power = (Sa ** 2).sum(1)
    tot = power.sum() + 1e-12
    band = lambda lo, hi: float(power[(freqs >= lo) & (freqs < hi)].sum() / tot)
    cent = librosa.feature.spectral_centroid(S=Sa, sr=SR)[0]
    roll = librosa.feature.spectral_rolloff(S=Sa, sr=SR, roll_percent=0.85)[0]
    flat = librosa.feature.spectral_flatness(S=Sa)[0]
    harm, perc = librosa.effects.hpss(y)
    hp = float(np.sum(harm ** 2) / (np.sum(harm ** 2) + np.sum(perc ** 2) + 1e-12))
    # Attack and decay: around each onset, time to the peak and time to fall 20 dB.
    onsets = librosa.onset.onset_detect(y=y, sr=SR, hop_length=hop, units="frames", backtrack=True)
    att, dec = [], []
    for o in onsets[:400]:
        seg = rms[o: o + int(2.0 * SR / hop)]
        if len(seg) < 4 or seg.max() < rms.max() * 0.1:
            continue
        pk = int(np.argmax(seg[: max(2, int(0.25 * SR / hop))]))
        att.append(pk * hop / SR)
        after = seg[pk:]
        below = np.where(after < seg[pk] * 0.1)[0]
        if len(below):
            dec.append(below[0] * hop / SR)
    dur = len(y) / SR
    prof = {
        "level_db": round(db(float(np.sqrt(np.mean(y ** 2)))), 1),
        "active_share": round(active, 2),
        "onsets_per_s": round(len(onsets) / max(1e-6, dur * active), 2),
        "brightness_hz": round(float(np.median(cent)), 0),
        "rolloff85_hz": round(float(np.median(roll)), 0),
        "noisiness": round(float(np.median(flat)), 3),
        "tonal_share": round(hp, 2),
        "bands": {"sub_<60": round(band(0, 60), 3), "low_60-250": round(band(60, 250), 3), "lowmid_250-1k": round(band(250, 1000), 3),
                  "mid_1-2k": round(band(1000, 2000), 3), "presence_2-5k": round(band(2000, 5000), 3), "air_5k+": round(band(5000, SR / 2), 3)},
        "attack_ms": round(1000 * float(np.median(att)), 0) if att else None,
        "decay_to_-20db_ms": round(1000 * float(np.median(dec)), 0) if dec else None,
    }
    if stereo.shape[0] == 2:
        mid, side = (stereo[0] + stereo[1]) / 2, (stereo[0] - stereo[1]) / 2
        prof["stereo_width"] = round(float(np.sqrt(np.mean(side ** 2)) / (np.sqrt(np.mean(mid ** 2)) + 1e-12)), 2)
    # Pitch for bass-like and melodic parts.
    if name in ("bass", "vocals", "guitar", "piano", "other"):
        fmin, fmax = (30, 400) if name == "bass" else (70, 1400)
        seg = y[: SR * 120]
        f0, vflag, _ = librosa.pyin(seg, fmin=fmin, fmax=fmax, sr=SR, frame_length=2048)
        f0 = f0[vflag & ~np.isnan(f0)]
        if len(f0) > 20:
            midi = librosa.hz_to_midi(f0)
            prof["pitch"] = {"low": librosa.midi_to_note(int(np.percentile(midi, 5))), "high": librosa.midi_to_note(int(np.percentile(midi, 95))),
                             "median": librosa.midi_to_note(int(np.median(midi))), "voiced_share": round(float(vflag.mean()), 2)}
            # Glide: how much the pitch moves within notes (cents per frame, median of small steps).
            steps = np.abs(np.diff(midi)) * 100
            prof["pitch"]["slide_cents_per_frame"] = round(float(np.median(steps[steps < 100])) if (steps < 100).any() else 0.0, 1)
    if name == "drums":
        prof["kit"] = drum_pattern(y, beats_t)
    return prof


def drum_pattern(y, beats_t):
    """Kick (low), snare (mid noise) and hats (high): where they hit in a bar of 16 steps, as a share of bars."""
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=256))
    freqs = librosa.fft_frequencies(sr=SR, n_fft=2048)
    times = librosa.frames_to_time(np.arange(S.shape[1]), sr=SR, hop_length=256)
    out = {}
    for voice, (lo, hi) in {"kick": (30, 120), "snare": (180, 2500), "hats": (6000, 11000)}.items():
        env = S[(freqs >= lo) & (freqs < hi)].sum(0)
        env = np.maximum(0, np.diff(env, prepend=env[0]))
        peaks = librosa.util.peak_pick(env, pre_max=3, post_max=3, pre_avg=10, post_avg=10, delta=env.mean() * 1.5, wait=4)
        hits = times[peaks]
        grid = np.zeros(16)
        bars = 0
        for b in range(0, len(beats_t) - 4, 4):
            t0, t1 = beats_t[b], beats_t[b + 4]
            bars += 1
            for h in hits[(hits >= t0) & (hits < t1)]:
                grid[min(15, int(round((h - t0) / (t1 - t0) * 16)) % 16)] += 1
        share = grid / max(1, bars)
        out[voice] = {"steps": [round(float(v), 2) for v in share], "hits_per_bar": round(float(share.sum()), 1)}
    return out


# ---------------------------------------------------------------- report

def analyze(song_dir: pathlib.Path) -> dict:
    info = json.loads((song_dir / "parts.json").read_text(encoding="utf-8"))
    src = ROOT / "analysis" / "input" / info["song"]
    y, stereo, _ = load(src)
    onset_env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=512)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=SR, hop_length=512)
    beats_t = librosa.frames_to_time(beats, sr=SR, hop_length=512)
    harm = librosa.effects.harmonic(y)
    chroma = librosa.feature.chroma_cqt(y=harm, sr=SR, hop_length=512)
    rep = {
        "song": info["song"], "seconds": info["seconds"],
        "tempo_bpm": round(float(np.atleast_1d(tempo)[0]), 1),
        "tempo_over_time": tempo_over_time(onset_env),
        "key": key_of(chroma),
        "sections": sections(y),
        "chords_by_bar": chords_by_bar(y, beats_t, chroma),
        "parts": {},
    }
    for name, p in info["parts"].items():
        if p["rms_db"] < -60:
            rep["parts"][name] = {"silent": True}
            continue
        py, pst, _ = load(song_dir / p["file"])
        rep["parts"][name] = part_profile(py, pst, name, beats_t)
    (song_dir / "report.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")
    return rep


def summary(rep: dict) -> str:
    lines = [f"{rep['song']} · {rep['seconds']} s · {rep['tempo_bpm']} BPM · key {rep['key']['root']} {rep['key']['mode']} (fit {rep['key']['confidence']})"]
    bpms = [t["bpm"] for t in rep["tempo_over_time"]]
    if bpms:
        lines.append(f"tempo across the song: {min(bpms)}–{max(bpms)} BPM")
    lines.append("sections: " + ", ".join(f"{s['start']:.0f}–{s['end']:.0f}s ({s['level_db']} dB)" for s in rep["sections"]))
    # Most common chords and the commonest 4-bar loop.
    ch = [c["chord"] for c in rep["chords_by_bar"]]
    if ch:
        from collections import Counter
        lines.append("commonest chords: " + ", ".join(f"{c} ×{n}" for c, n in Counter(ch).most_common(8)))
        loops = Counter(tuple(ch[i:i + 4]) for i in range(len(ch) - 3))
        lines.append("commonest 4-bar runs: " + " | ".join(" ".join(l) + f" ×{n}" for l, n in loops.most_common(3)))
    for name, p in rep["parts"].items():
        if p.get("silent"):
            lines.append(f"  {name}: silent")
            continue
        b = p["bands"]
        s = (f"  {name}: {p['level_db']} dB, playing {int(p['active_share'] * 100)}% of the time, {p['onsets_per_s']} notes/s, "
             f"brightness {p['brightness_hz']:.0f} Hz, tonal {p['tonal_share']}, noisy {p['noisiness']}, "
             f"attack {p['attack_ms']} ms, decay {p['decay_to_-20db_ms']} ms, width {p.get('stereo_width')}; "
             f"bands low {b['low_60-250']:.0%} lowmid {b['lowmid_250-1k']:.0%} mid {b['mid_1-2k']:.0%} presence {b['presence_2-5k']:.0%} air {b['air_5k+']:.0%}")
        if "pitch" in p:
            s += f"; pitch {p['pitch']['low']}–{p['pitch']['high']} (median {p['pitch']['median']})"
        lines.append(s)
        if "kit" in p:
            for v, d in p["kit"].items():
                lines.append(f"    {v:5} {d['hits_per_bar']:>4}/bar  " + " ".join("█" if x > 0.6 else "▓" if x > 0.35 else "░" if x > 0.15 else "·" for x in d["steps"]))
    return "\n".join(lines)


def main(argv):
    dirs = [STEMS / a for a in argv] or sorted(d for d in STEMS.iterdir() if (d / "parts.json").exists())
    for d in dirs:
        rep = analyze(d)
        print(summary(rep))
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
