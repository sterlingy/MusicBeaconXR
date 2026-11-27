"""Builds SynthKit sample packs (for the Sampler instrument) from free sample
libraries, in three quality tiers so each platform gets the best it can carry:

    tools/.venv/Scripts/python.exe tools/build_samples.py            # every tier
    tools/.venv/Scripts/python.exe tools/build_samples.py --tier web --only piano,strings

  full   desktop: every velocity layer and round robin, stereo, long tails, Ogg q~7
  web    browsers: loaded per instrument on demand; 3 layers, stereo, Ogg q~5
  phone  Android: 2 layers, mono, 32 kHz, shorter tails, Ogg q~4

Output: <out>/<tier>/<program>/program.json plus zNNN.sko files (Ogg Vorbis;
the .sko extension keeps Godot from importing them as audio resources), and
<out>/<tier>/index.json listing the programs with their sizes. Default out:
samples/ for full and phone (the Godot app), web/samples/ for web.

Sources (CC0): VSCO 2 Community Edition in samples_src/VSCO-2-CE
(git clone https://github.com/sgossner/VSCO-2-CE). Each sample's pitch is
measured (pYIN); the file name only settles the octave.

program.json: {id, name, role, mode ("sustain" | "one-shot"), params (Sampler
defaults), license, zones: [{file, root, tune (cents sharp), lo, hi, vlo, vhi,
loop_start, loop_end (frames, -1 = none), gain, frames, rate, channels}]}
"""
import argparse
import json
import pathlib
import re
import sys
import time
from collections import defaultdict

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT = pathlib.Path(__file__).resolve().parents[1]
VSCO = ROOT / "samples_src" / "VSCO-2-CE"
LICENSE = "CC0 1.0 - VSCO 2 Community Edition (Versilian Studios), https://github.com/sgossner/VSCO-2-CE"

TIERS = {
    #        rate   mono   ogg level  layers rr  min key gap  decay max s  loop end max s  loop len s
    "full": dict(rate=None, mono=False, level=0.3, layers=9, rr=9, gap=0, tail=14.0, sus_end=7.0, loop=2.5),
    "web": dict(rate=None, mono=False, level=0.45, layers=3, rr=2, gap=0, tail=8.0, sus_end=4.5, loop=1.8),
    "phone": dict(rate=32000, mono=True, level=0.55, layers=2, rr=2, gap=0, tail=5.0, sus_end=3.0, loop=1.2),
}

# Pitched programs: folders (with the root-note band each covers), how notes
# play, the Sampler settings that suit them, and which song part they serve.
PROGRAMS = [
    dict(id="piano", name="Upright Piano", role="keys", kind="decay", piano="Keys/Upright Piano",
         params={"amp.release": 0.45, "perf.velocity": 5}),
    dict(id="strings", name="String Section", role="pad", kind="sustain",
         dirs=[("Strings/Cello Section/susvib", 0, 54), ("Strings/Viola Section/susvib", 55, 66), ("Strings/Violin Section/susVib", 67, 127)],
         params={"amp.attack": 0.18, "amp.release": 0.9, "perf.velocity": 4}),
    dict(id="strings_pizz", name="Pizzicato Strings", role="pluck", kind="decay",
         dirs=[("Strings/Cello Section/pizzT", 0, 54), ("Strings/Viola Section/pizz", 55, 64), ("Strings/Violin Section/Pizz", 65, 127)],
         params={"amp.release": 0.3, "perf.velocity": 6}),
    dict(id="harp", name="Harp", role="pluck", kind="decay", dirs=[("Strings/Harp", 0, 127)],
         params={"amp.release": 0.8, "perf.velocity": 5}),
    dict(id="horn", name="French Horn", role="lead", kind="sustain", dirs=[("Brass/F Horn/sus", 0, 127)],
         params={"amp.attack": 0.05, "amp.release": 0.5}),
    dict(id="trumpet", name="Trumpet", role="lead", kind="sustain", dirs=[("Brass/Trumpet/sus", 0, 127)],
         params={"amp.attack": 0.02, "amp.release": 0.35}),
    dict(id="trombone", name="Trombone", role="pad", kind="sustain", dirs=[("Brass/Tenor Trombone/sus", 0, 127)],
         params={"amp.attack": 0.06, "amp.release": 0.5}),
    dict(id="tuba", name="Tuba Staccato", role="bass", kind="decay", dirs=[("Brass/Tuba/stac", 0, 127)],
         params={"amp.release": 0.15}),
    dict(id="flute", name="Flute", role="lead", kind="sustain", dirs=[("Woodwinds/Flute/susvib", 0, 127)],
         params={"amp.attack": 0.04, "amp.release": 0.35}),
    dict(id="clarinet", name="Clarinet", role="lead", kind="sustain", dirs=[("Woodwinds/Clarinet/susLong", 0, 127)],
         params={"amp.attack": 0.03, "amp.release": 0.3}),
    dict(id="oboe", name="Oboe", role="lead", kind="sustain", dirs=[("Woodwinds/Oboe/Vib", 0, 127)],
         params={"amp.attack": 0.03, "amp.release": 0.3}),
    dict(id="bassoon", name="Bassoon", role="bass", kind="sustain", dirs=[("Woodwinds/Bassoon/sus", 0, 127)],
         params={"amp.attack": 0.03, "amp.release": 0.3}),
    dict(id="contrabass", name="Contrabass", role="bass", kind="sustain", dirs=[("Strings/Solo Contrabass/SusVib", 0, 127)],
         params={"amp.attack": 0.06, "amp.release": 0.4}),
    dict(id="contrabass_pizz", name="Contrabass Pizzicato", role="bass", kind="decay", dirs=[("Strings/Solo Contrabass/Pizz", 0, 127)],
         params={"amp.release": 0.25}),
    dict(id="marimba", name="Marimba", role="pluck", kind="decay", dirs=[("Percussion/Marimba", 0, 127)],
         params={"amp.release": 0.4}),
    dict(id="glock", name="Glockenspiel", role="pluck", kind="decay", dirs=[("Percussion/Glock", 0, 127)],
         params={"amp.release": 0.8}),
    dict(id="xylo", name="Xylophone", role="pluck", kind="decay", dirs=[("Percussion/Xylo", 0, 127)],
         params={"amp.release": 0.3}),
]

# Percussion kits: note -> files (glob in a folder). Notes follow General MIDI
# where it has a match, and the songs' parts (kick 36, snare 38, clap 39, hat 42, open 46).
P1 = "VSCO 1 Percussion"
KITS = [
    dict(id="orch_kit", name="Orchestral Percussion", role="drums", kind="drum", params={"amp.release": 0.3, "perf.velocity": 5},
         notes={
             36: [(f"{P1}/drums/bass", "bdrum_*.wav")],
             35: [(f"{P1}/drums/bass", "bdrum2_*.wav")],
             38: [(f"{P1}/drums/snare/drum1", "snare1_[fmp]*.wav")],
             40: [(f"{P1}/drums/snare/OldSnare", "snare_*.wav")],
             37: [(f"{P1}/drums/snare/drum1", "snare1_click*.wav")],
             39: [(f"{P1}/varWood", "claves_*.wav")],
             42: [(f"{P1}/varWood/Camo's Shaker", "shake*.wav")],
             44: [(f"{P1}/varWood", "maraca[0-9].wav")],
             46: [("Percussion/temp", "Triangle3-Hit_v*.wav")],
             41: [(f"{P1}/drums/tenor/tenor_lower", "tenor_*.wav")],
             43: [(f"{P1}/drums/tenor/tenor_higher", "tenor_*.wav")],
             45: [(f"{P1}/drums/other/Bongos", "LowBongo*.wav")],
             48: [(f"{P1}/drums/other/Bongos", "HighBongo*.wav")],
             47: [("Percussion/Timpani", "Timpani1_Hit_*.wav")],
             50: [("Percussion/Timpani", "Timpani3_Hit_*.wav")],
             56: [(f"{P1}/varMetal/various", "agogoBell3_*.wav")],
             75: [(f"{P1}/varWood/log_drum", "slitdrum0_*.wav")],
             76: [(f"{P1}/varWood/log_drum", "slitdrum1_*.wav")],
         }),
]

NOTE_RE = re.compile(r"(?:^|[_\-\s])([A-Ga-g])(#|b|s)?(-?\d)(?=$|[_\-\s.])")
DYN = {"ppp": 1, "pp": 2, "p": 3, "mp": 4, "mf": 5, "f": 6, "ff": 7, "fff": 8, "soft": 2, "medium": 5, "loud": 7, "quiet": 3}
SEMI = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def name_note(stem: str):
    m = NOTE_RE.search(stem)
    if not m:
        return None
    n = SEMI[m.group(1).lower()] + {"#": 1, "s": 1, "b": -1}.get(m.group(2) or "", 0)
    return 12 * (int(m.group(3)) + 1) + n  # scientific: C4 = 60


def dynamic(stem: str) -> float:
    s = stem.lower()
    m = re.search(r"(?:_|^)v(\d)(?:_|$)", s) or re.search(r"dyn(\d)", s)
    if m:
        return float(m.group(1))
    for part in re.split(r"[_\-\s.]", s):
        if part in DYN:
            return DYN[part]
    m = re.search(r"_(ppp|pp|mp|mf|fff|ff|p|f)(\d)?(?:_|$)", s)
    return float(DYN[m.group(1)]) if m else 5.0


def load(path: pathlib.Path):
    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return data[:, :2], sr


def measure_pitch(mono: np.ndarray, sr: int, onset: int):
    """Median pYIN pitch (MIDI, float) over the steady part, or None."""
    import librosa
    a = onset + int(0.15 * sr)
    seg = mono[a:a + int(1.2 * sr)]
    if len(seg) < sr // 4:
        seg = mono[onset:onset + int(1.2 * sr)]
    if len(seg) < 2048:
        return None
    if sr != 22050:
        seg = resample_poly(seg, 22050, sr).astype("float32")
    f0, voiced, _ = librosa.pyin(seg, fmin=26.0, fmax=4400.0, sr=22050, frame_length=4096)
    f0 = f0[voiced & np.isfinite(f0)]
    if len(f0) < 3:
        return None
    return float(librosa.hz_to_midi(np.median(f0)))


def onset_of(x: np.ndarray, sr: int) -> int:
    env = np.abs(x).max(axis=1)
    peak = env.max() + 1e-9
    idx = np.nonzero(env > peak * 0.003)[0]
    return max(0, int(idx[0]) - int(0.004 * sr)) if len(idx) else 0


def rms_db(x: np.ndarray) -> float:
    return float(20 * np.log10(np.sqrt(np.mean(x.astype(np.float64) ** 2)) + 1e-9))


def scan(prog):
    """Every source sample of a program: dict(path, root, tune, dyn)."""
    out = []
    if "piano" in prog:
        folder = VSCO / prog["piano"]
        chart = {}
        for line in (folder / "MappingChart.txt").read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r"(\d{3})=(\d+)", line.strip())
            if m:
                chart[m.group(1)] = int(m.group(2))
        for f in sorted(folder.glob("*.wav")):
            m = re.search(r"dyn(\d)_rr(\d)_(\d{3})", f.stem)
            if m and m.group(3) in chart:
                out.append(dict(path=f, root=chart[m.group(3)], tune=0.0, dyn=float(m.group(1)), measured=False))
        return out
    for rel, lo_root, hi_root in prog["dirs"]:
        files = sorted((VSCO / rel).glob("*.wav"))
        found = []
        for f in files:
            x, sr = load(f)
            mono = x.mean(axis=1)
            pitch = measure_pitch(mono, sr, onset_of(x, sr))
            found.append(dict(path=f, named=name_note(f.stem), pitch=pitch, dyn=dynamic(f.stem)))
        # The folder's octave convention: names vs measured pitch, by majority.
        offs = [round((s["pitch"] - s["named"]) / 12) for s in found if s["pitch"] is not None and s["named"] is not None]
        off = int(np.median(offs)) * 12 if offs else 0
        for s in found:
            if s["named"] is not None:
                root = s["named"] + off
                tune = (s["pitch"] - root) * 100 if s["pitch"] is not None and abs(s["pitch"] - root) < 0.5 else 0.0
            elif s["pitch"] is not None:
                root = int(round(s["pitch"]))
                tune = (s["pitch"] - root) * 100
            else:
                print(f"  skip {s['path'].name}: no pitch")
                continue
            if lo_root <= root <= hi_root:
                out.append(dict(path=s["path"], root=int(root), tune=float(round(tune, 1)), dyn=s["dyn"], measured=s["pitch"] is not None))
    return out


def scan_kit(kit):
    out = []
    for note, sources in kit["notes"].items():
        for rel, pattern in sources:
            for f in sorted((VSCO / rel).glob(pattern)):
                out.append(dict(path=f, root=note, tune=0.0, dyn=dynamic(f.stem), note=note))
    return out


def pick_layers(samples, tier):
    """Keeps at most tier['layers'] velocity layers per key (the loudest and
    evenly spaced below it) and tier['rr'] round robins per layer."""
    by_root = defaultdict(list)
    for s in samples:
        by_root[s["root"]].append(s)
    keep = []
    for root, group in by_root.items():
        dyns = sorted({s["dyn"] for s in group})
        if len(dyns) > tier["layers"]:
            if tier["layers"] == 1:
                dyns = [dyns[-1]]
            else:
                idx = np.linspace(len(dyns) - 1, 0, tier["layers"]).round().astype(int)
                idx = sorted(set(int(i) for i in idx))
                if len(idx) > 1 and tier["layers"] == 2:
                    idx = [len(dyns) // 2 if len(dyns) > 2 else 0, len(dyns) - 1]
                dyns = [dyns[i] for i in sorted(set(idx))]
        for d in dyns:
            keep += [s for s in group if s["dyn"] == d][: tier["rr"]]
    return keep


def thin_keys(samples, gap):
    """Drops roots closer than `gap` semitones to the previous kept one."""
    if gap <= 1:
        return samples
    roots = sorted({s["root"] for s in samples})
    kept, last = set(), -99
    for r in roots:
        if r - last >= gap or r == roots[-1]:
            kept.add(r)
            last = r
    return [s for s in samples if s["root"] in kept]


def map_ranges(samples, drum=False):
    """Key ranges split halfway between roots; velocity ranges split evenly between layers."""
    roots = sorted({s["root"] for s in samples})
    rng = {}
    for i, r in enumerate(roots):
        lo = 0 if i == 0 else (roots[i - 1] + r) // 2 + 1
        hi = 127 if i == len(roots) - 1 else (r + roots[i + 1]) // 2
        rng[r] = (r, r) if drum else (lo, hi)
    by_root = defaultdict(list)
    for s in samples:
        by_root[s["root"]].append(s)
    for r, group in by_root.items():
        dyns = sorted({s["dyn"] for s in group})
        for s in group:
            k = dyns.index(s["dyn"])
            s["vlo"] = 1 if k == 0 else int(round(k * 127 / len(dyns))) + 1
            s["vhi"] = int(round((k + 1) * 127 / len(dyns)))
            s["lo"], s["hi"] = rng[r]


def find_loop(x, sr, root, tier, onset):
    """Loop points in the steady part of a sustained note, with a baked crossfade.
    Returns (audio cut just past the loop, loop_start, loop_end) or (x, -1, -1)."""
    env = np.abs(x).max(axis=1)
    win = max(1, int(0.05 * sr))
    smooth = np.convolve(env, np.ones(win) / win, mode="same")
    a = onset + int(0.45 * sr)
    if a >= len(x) - sr // 2:
        return x, -1, -1
    level = np.median(smooth[a:])
    steady = np.nonzero(smooth[a:] > level * 0.55)[0]
    b = a + (int(steady[-1]) if len(steady) else 0)
    b = min(b, onset + int(tier["sus_end"] * sr), len(x) - 8)
    if b - a < int(0.35 * sr):
        return x, -1, -1
    period = sr / (440.0 * 2 ** ((root - 69) / 12))
    length = min(b - a, int(tier["loop"] * sr))
    length = max(int(round(round(length / period) * period)), int(period * 2))
    le = b
    ls = le - length
    if ls < a:
        return x, -1, -1
    # Nudge the end within one period to where it best matches the start.
    ref = x[ls:ls + int(0.01 * sr)].mean(axis=1)
    best, best_le = -2.0, le
    for k in range(max(ls + int(0.2 * sr), le - int(period) - 1), le + 1):
        cand = x[k:k + len(ref)].mean(axis=1)
        if len(cand) < len(ref):
            break
        c = float(np.dot(ref, cand) / (np.linalg.norm(ref) * np.linalg.norm(cand) + 1e-9))
        if c > best:
            best, best_le = c, k
    le = best_le
    length = le - ls
    xf = min(int(0.3 * sr), length // 2)
    y = x[: le].copy()
    t = np.linspace(0.0, 1.0, xf, endpoint=False)[:, None]
    gin, gout = np.sqrt(t), np.sqrt(1 - t)  # equal power: the two takes are only partly correlated
    y[le - xf:le] = x[le - xf:le] * gout + x[ls - xf:ls] * gin
    return y, ls, le


def write_ogg(path, y, rate, level):
    # In blocks: libsndfile's Vorbis encoder overflows the stack on one long write.
    with sf.SoundFile(str(path), "w", samplerate=rate, channels=y.shape[1], format="OGG", subtype="VORBIS", compression_level=level) as f:
        for i in range(0, len(y), 32768):
            f.write(np.ascontiguousarray(y[i:i + 32768]))


def build_program(prog, tier_name, tier, out_dir, samples):
    t0 = time.time()
    drum = prog["kind"] == "drum"
    pick = pick_layers(samples, tier)
    if not drum:
        pick = thin_keys(pick, tier["gap"])
    map_ranges(pick, drum)
    dest = out_dir / tier_name / prog["id"]
    dest.mkdir(parents=True, exist_ok=True)
    for old in dest.glob("*.sko"):
        old.unlink()
    zones, levels = [], []
    rendered = []
    for s in pick:
        x, sr = load(s["path"])
        on = onset_of(x, sr)
        x = x[on:]
        if tier["mono"] or x.shape[1] == 1:
            x = x.mean(axis=1, keepdims=True)
        rate = sr
        if tier["rate"] and sr > tier["rate"]:
            g = np.gcd(sr, tier["rate"])
            x = resample_poly(x, tier["rate"] // g, sr // g, axis=0).astype("float32")
            rate = tier["rate"]
        ls = le = -1
        if prog["kind"] == "sustain":
            x, ls, le = find_loop(x, rate, s["root"], tier, 0)
        if ls < 0:
            cap = int(tier["tail"] * rate)
            if len(x) > cap:
                x = x[:cap].copy()
                fade = min(int(0.25 * rate), cap // 4)
                x[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
        body = x[: int(1.5 * rate)]
        rendered.append((s, x, rate, ls, le))
        levels.append(rms_db(body))
    if not rendered:
        return None
    # Level: the loudest layer sits at -16 dBFS RMS; keys within a layer even out halfway.
    layer_levels = defaultdict(list)
    for (s, *_), lv in zip(rendered, levels):
        layer_levels[s["vhi"]].append(lv)
    top = max(layer_levels)
    scale_db = -16.0 - float(np.median(layer_levels[top]))
    peak = max(float(np.abs(x).max()) for _, x, *_ in rendered)
    scale = min(10 ** (scale_db / 20), 0.97 / (peak + 1e-9))
    total = 0
    for i, ((s, x, rate, ls, le), lv) in enumerate(zip(rendered, levels)):
        med = float(np.median(layer_levels[s["vhi"]]))
        # Decaying notes (piano, harp) fall off naturally up the keyboard; only nudge them.
        k, lim = (0.5, 2.0) if prog["kind"] == "sustain" else (0.25, 1.4)
        gain = 1.0 if drum else float(np.clip(10 ** (k * (med - lv) / 20), 1 / lim, lim))
        name = f"z{i:03d}.sko"
        y = np.clip(x * scale, -1, 1)
        write_ogg(dest / name, y, rate, tier["level"])
        total += (dest / name).stat().st_size
        zones.append(dict(file=name, root=s["root"], tune=s["tune"], lo=s["lo"], hi=s["hi"], vlo=s["vlo"], vhi=s["vhi"],
                          loop_start=int(ls), loop_end=int(le), gain=round(gain, 3), frames=int(len(y)), rate=int(rate),
                          channels=int(y.shape[1]), source=str(s["path"].relative_to(VSCO)).replace("\\", "/")))
    params = dict(prog.get("params", {}))
    if prog["kind"] in ("decay", "drum"):
        params.setdefault("play.mode", 1 if drum else 0)
    meta = dict(id=prog["id"], name=prog["name"], role=prog["role"], mode="one-shot" if drum else "sustain",
                params=params, license=LICENSE, tier=tier_name, zones=zones)
    (dest / "program.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    pcm = sum(z["frames"] * z["channels"] * 2 for z in zones)
    print(f"  {tier_name}/{prog['id']}: {len(zones)} zones, {total / 1e6:.1f} MB on disk, {pcm / 1e6:.1f} MB in memory ({time.time() - t0:.0f} s)")
    return dict(id=prog["id"], name=prog["name"], role=prog["role"], zones=len(zones), bytes=total, memory=pcm)


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--tier", choices=list(TIERS) + ["all"], default="all")
    ap.add_argument("--only", default="", help="comma-separated program ids")
    ap.add_argument("--out", default="", help="output folder (default: samples/ and web/samples/)")
    args = ap.parse_args(argv)
    if not VSCO.exists():
        print(f"Missing {VSCO}: git clone https://github.com/sgossner/VSCO-2-CE there")
        return 1
    only = {s for s in args.only.split(",") if s}
    progs = [p for p in PROGRAMS + KITS if not only or p["id"] in only]
    tiers = list(TIERS) if args.tier == "all" else [args.tier]
    # Pitch detection is slow: the scan is kept in samples_src/scan.json.
    scan_file = VSCO.parent / "scan.json"
    saved = json.loads(scan_file.read_text(encoding="utf-8")) if scan_file.exists() else {}
    cache = {}
    for prog in progs:
        if prog["id"] in saved:
            cache[prog["id"]] = [dict(s, path=VSCO / s["path"]) for s in saved[prog["id"]]]
            continue
        print(f"{prog['id']}: scanning", flush=True)
        cache[prog["id"]] = scan_kit(prog) if prog["kind"] == "drum" else scan(prog)
        saved[prog["id"]] = [dict(s, path=str(s["path"].relative_to(VSCO)).replace("\\", "/")) for s in cache[prog["id"]]]
        scan_file.write_text(json.dumps(saved, indent=0), encoding="utf-8")
    for tier_name in tiers:
        out_dir = pathlib.Path(args.out) if args.out else (ROOT / "web" / "samples" if tier_name == "web" else ROOT / "samples")
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / ".gdignore").touch() if tier_name == "web" else None
        index_path = out_dir / tier_name / "index.json"
        index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"programs": []}
        entries = {p["id"]: p for p in index["programs"]}
        for prog in progs:
            info = build_program(prog, tier_name, TIERS[tier_name], out_dir, [dict(s) for s in cache[prog["id"]]])
            if info:
                entries[prog["id"]] = info
        order = [p["id"] for p in PROGRAMS + KITS]
        index = {"tier": tier_name, "license": LICENSE, "programs": sorted(entries.values(), key=lambda p: order.index(p["id"]) if p["id"] in order else 999)}
        index_path.write_text(json.dumps(index, indent=1), encoding="utf-8")
        mb = sum(p["bytes"] for p in index["programs"]) / 1e6
        print(f"{tier_name}: {len(index['programs'])} programs, {mb:.1f} MB -> {index_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
