#!/usr/bin/env python3
"""Writes the factory presets to presets/factory/<Instrument>/<name>.json.

Each preset lists only the parameters that differ from the instrument's
defaults; loading a preset resets everything else first. Run from the
project root:  python tools/make_presets.py
"""
import json
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), "..", "presets", "factory")

P = {}

P["Undertow"] = [
    ("Deep Current", "Fat three-oscillator bass.", {}),
    ("Riptide Pluck", "Short, snappy filter pluck.", {
        "osc2.wave": 4, "filter.cutoff": 280, "filter.emphasis": 5, "filter.contour": 8,
        "fenv.decay": 0.18, "fenv.sustain": 0, "lenv.decay": 0.45, "lenv.sustain": 0, "out.decay_switch": 1}),
    ("Sub Floor", "Pure low end: one triangle at 32'.", {
        "osc1.range": 1, "osc1.wave": 0, "mix.osc1": 10, "mix.osc2_on": 0, "mix.osc3_on": 0,
        "filter.cutoff": 420, "filter.emphasis": 0, "filter.contour": 1, "ctrl.legato": 1}),
    ("Acid Tide", "Squelchy single saw with glide.", {
        "mix.osc2_on": 0, "mix.osc3_on": 0, "filter.cutoff": 330, "filter.emphasis": 8, "filter.contour": 7,
        "fenv.decay": 0.25, "fenv.sustain": 0, "ctrl.glide": 0.08, "ctrl.legato": 1, "lenv.sustain": 7}),
    ("Growler", "Detuned saws, feedback loop and noise.", {
        "osc2.freq": 0.15, "osc3.range": 2, "osc3.wave": 2, "osc3.freq": -0.15, "mix.ext_on": 1, "mix.ext": 6,
        "mix.noise_on": 1, "mix.noise": 2, "filter.cutoff": 1500, "filter.emphasis": 3, "filter.contour": 4}),
    ("Hollow Reed", "Square and narrow pulse with a slow filter swell.", {
        "osc1.range": 3, "osc1.wave": 4, "osc2.range": 3, "osc2.wave": 6, "mix.osc3_on": 0,
        "filter.cutoff": 1100, "filter.emphasis": 4, "fenv.attack": 0.08, "fenv.decay": 0.5, "fenv.sustain": 5, "lenv.attack": 0.03}),
    ("Wobble Deep", "Osc 3 as a slow LFO on the filter.", {
        "osc3.range": 0, "osc3.wave": 0, "osc3.freq": 2, "ctrl.osc3_kbd": 0, "mix.osc3_on": 0,
        "ctrl.mod_amount": 6, "ctrl.filter_mod": 1, "filter.cutoff": 600, "filter.emphasis": 6, "filter.contour": 2}),
    ("Fifths Lead", "8' saws a fifth apart: the bass that thinks it's a lead.", {
        "osc1.range": 3, "osc2.range": 3, "osc2.freq": 7, "osc3.range": 4, "osc3.freq": 0, "mix.osc3": 3,
        "filter.cutoff": 2000, "filter.emphasis": 3, "ctrl.glide": 0.05, "lenv.sustain": 9}),
]

P["Comet"] = [
    ("Fifth Flight", "Two saws a fifth apart.", {}),
    ("Solo Saw", "Detuned unison saw, vibrato on the mod wheel.", {
        "osc2.semi": 0, "osc2.fine": 8, "osc2.level": 7, "filter.cutoff": 3000, "filter.resonance": 3, "delay.division": 4}),
    ("Sync Scream", "Hard-synced osc 2 swept by the filter envelope.", {
        "osc2.sync": 1, "osc2.semi": 12, "osc2.level": 8, "osc1.level": 2, "filter.env": 6, "fenv.decay": 0.6, "filter.drive": 4}),
    ("Square Whistle", "Hollow square with sub and delayed vibrato.", {
        "osc1.wave": 1, "osc2.level": 0, "mix.sub": 3, "filter.cutoff": 5000, "vibrato.depth": 3, "vibrato.delay": 0.5}),
    ("Pulse Runner", "Narrow pulse, resonant 12 dB filter, 1/16 echoes.", {
        "osc1.wave": 2, "osc1.pw": 0.2, "osc2.level": 0, "filter.mode": 1, "filter.resonance": 6, "filter.env": 5,
        "delay.division": 7, "delay.feedback": 5}),
    ("Glass Sine", "Sine and octave sine with long echoes.", {
        "osc1.wave": 4, "osc2.wave": 4, "osc2.semi": 12, "osc2.fine": 0, "filter.cutoff": 18000, "delay.division": 1, "delay.mix": 4}),
    ("Hollow Flute", "Breathy triangle with a soft attack.", {
        "osc1.wave": 3, "osc2.level": 0, "mix.noise": 1, "filter.mode": 1, "filter.cutoff": 1800, "aenv.attack": 0.06,
        "vibrato.depth": 2, "delay.mix": 1.5}),
    ("Laser Comet", "Band-pass zap with long portamento.", {
        "filter.mode": 2, "filter.env": 10, "fenv.decay": 0.15, "fenv.sustain": 1, "filter.resonance": 7,
        "perf.glide": 0.15, "perf.glide_mode": 1}),
]

P["Lumen"] = [
    ("Glow Pad", "Warm detuned saws, slow attack.", {
        "aenv.attack": 0.6, "aenv.release": 2, "fenv.attack": 0.5, "filter.cutoff": 1800, "reverb.mix": 4}),
    ("Soft Keys", "Gentle velocity-sensitive keys.", {
        "osc1.wave": 3, "osc2.wave": 4, "osc2.semi": 12, "osc2.fine": 0, "osc2.level": 3, "filter.cutoff": 3000,
        "aenv.decay": 1.2, "aenv.sustain": 3, "aenv.release": 0.5, "aenv.velocity": 8, "chorus.mix": 3, "reverb.mix": 2}),
    ("Brass Stab", "Punchy filter-envelope brass.", {
        "osc2.fine": 6, "filter.mode": 0, "filter.cutoff": 600, "filter.env": 7, "fenv.attack": 0.03, "fenv.decay": 0.3,
        "fenv.sustain": 4, "aenv.attack": 0.01, "aenv.sustain": 8, "aenv.release": 0.2, "reverb.mix": 1.5}),
    ("Glass Choir", "Shimmering pulse-width pad.", {
        "osc1.wave": 2, "osc1.pw": 0.3, "osc2.wave": 4, "osc2.semi": 12, "lfo.pwm": 4, "lfo.rate": 0.4,
        "aenv.attack": 0.3, "aenv.release": 1.5, "reverb.mix": 6}),
    ("String Ensemble", "Wide, chorused strings.", {
        "osc2.fine": 14, "aenv.attack": 0.35, "aenv.release": 1, "filter.cutoff": 4000, "chorus.mix": 7, "chorus.depth": 7, "reverb.mix": 4}),
    ("Electric Dream", "Bell-like electric piano.", {
        "osc1.wave": 4, "osc2.wave": 3, "osc2.semi": 12, "osc2.level": 4, "filter.cutoff": 2500, "fenv.decay": 0.8,
        "aenv.decay": 2.5, "aenv.sustain": 2, "filter.velocity": 8, "chorus.mix": 5, "chorus.rate": 0.8, "reverb.mix": 2}),
    ("Night Organ", "Square-wave organ with vibrato.", {
        "osc1.wave": 1, "osc2.wave": 1, "osc2.semi": 12, "osc2.fine": 0, "filter.cutoff": 5000, "filter.env": 0,
        "aenv.attack": 0.005, "aenv.decay": 0.1, "aenv.sustain": 10, "aenv.release": 0.05, "lfo.pitch": 1, "lfo.rate": 6}),
    ("Aurora Sweep", "Slowly breathing resonant pad.", {
        "osc2.wave": 1, "osc2.semi": -12, "filter.mode": 0, "filter.cutoff": 400, "filter.resonance": 5, "lfo.filter": 6,
        "lfo.rate": 0.15, "aenv.attack": 1, "aenv.release": 3, "reverb.mix": 5, "reverb.decay": 6}),
]

P["Pulsar"] = [
    ("Classic Eight", "The basic kit.", {}),
    ("Tight Funk", "Short and snappy.", {
        "kick.decay": 3, "snare.tone": 7, "snare.snap": 7, "snare.decay": 3, "chat.decay": 3, "ohat.decay": 3, "master.drive": 1}),
    ("Boom Bap", "Fat, dusty hip-hop kit.", {
        "kick.decay": 6, "kick.tone": 6, "master.kick_sweep": 4, "snare.decay": 6, "snare.tone": 3, "snare.snap": 4,
        "chat.tone": 3, "master.drive": 4}),
    ("Deep House", "Long kick, wide clap, airy hats.", {
        "kick.decay": 7, "kick.tune": -2, "master.kick_sweep": 6, "clap.snap": 6, "clap.level": 7, "ohat.decay": 4}),
    ("Trap Thunder", "Booming long kick and crisp hats.", {
        "kick.decay": 10, "kick.tune": -3, "master.kick_sweep": 7, "kick.tone": 8, "snare.tune": 2, "snare.decay": 4,
        "chat.tune": 3, "chat.decay": 2, "chat.tone": 8, "master.drive": 3}),
    ("Lo-Fi Dust", "Dark and saturated.", {
        "kick.tone": 2, "snare.tone": 2, "chat.tone": 2, "ohat.tone": 2, "cymbal.tone": 2, "cymbal.level": 3, "master.drive": 6}),
    ("Industrial", "Distorted, metallic, loud.", {
        "master.drive": 9, "kick.tone": 10, "kick.snap": 9, "snare.snap": 10, "snare.tone": 9, "clap.snap": 9,
        "ltom.tone": 8, "htom.tone": 8, "master.volume": 4}),
    ("Hand Toms", "Tuned tom-heavy percussion kit.", {
        "kick.level": 6, "kick.tone": 3, "ltom.tune": 3, "htom.tune": 5, "ltom.level": 9, "htom.level": 9,
        "ltom.decay": 6, "htom.decay": 6, "chat.level": 4}),
]

P["Driftwood"] = [
    ("Nylon Pluck", "Warm plucked string.", {"model.brightness": 5, "model.damping": 5, "body.amount": 4}),
    ("Steel Harp", "Bright, long-ringing strings.", {
        "model.brightness": 8, "model.damping": 2, "model.decay": 6, "body.amount": 2, "reverb.mix": 4}),
    ("Muted Pluck", "Palm-muted, woody and short.", {
        "model.brightness": 3, "model.damping": 8, "model.decay": 0.6, "model.hardness": 3, "body.amount": 5}),
    ("Marimba", "Rosewood bars.", {"model.type": 1, "model.decay": 1.2, "reverb.mix": 2}),
    ("Vibes", "Metal bars with the motor on.", {"model.type": 2, "model.decay": 4, "perf.tremolo": 5, "reverb.mix": 3}),
    ("Kalimba", "Thumb piano tines.", {"model.type": 3, "model.decay": 1.5, "model.brightness": 6, "body.amount": 3}),
    ("Temple Bell", "Big, slowly fading bell.", {
        "model.type": 4, "model.decay": 8, "model.brightness": 7, "model.inharmonicity": 2, "reverb.mix": 4, "reverb.decay": 6}),
    ("Glass Drops", "Hard mallet on glass.", {
        "model.type": 5, "model.decay": 3, "model.brightness": 9, "model.hardness": 9, "reverb.mix": 5}),
]


# ---------------------------------------------------------------- Tangle patches

class Patch:
    def __init__(self):
        self.modules = []
        self.cables = []

    def add(self, type_, x, y, **params):
        mid = len(self.modules)
        self.modules.append({"id": mid, "type": type_, "position": [x, y], "params": params})
        return mid

    def cable(self, a, out, b, inp):
        self.cables.append({"from": a, "out": out, "to": b, "in": inp})

    def to_dict(self):
        return {"modules": self.modules, "cables": self.cables}


def basic_voice():
    p = Patch()
    midi = p.add("midi", 0, 0)
    vco = p.add("vco", 1, 0)
    vco2 = p.add("vco", 1, 1, fine=7.0)
    mix = p.add("util", 2, 1, a=0.6, b=0.45)
    vcf = p.add("vcf", 2, 0, cutoff=500, cv=4.0, res=0.35)
    env = p.add("adsr", 3, 1)
    vca = p.add("vca", 3, 0)
    out = p.add("output", 4, 0)
    p.cable(midi, "pitch", vco, "pitch"); p.cable(midi, "pitch", vco2, "pitch")
    p.cable(vco, "saw", mix, "a"); p.cable(vco2, "pulse", mix, "b"); p.cable(mix, "mix", vcf, "in")
    p.cable(midi, "gate", env, "gate"); p.cable(env, "env", vcf, "cutoff"); p.cable(vcf, "lp24", vca, "a")
    p.cable(env, "env", vca, "a_cv"); p.cable(vca, "a", out, "l")
    return p


def sequenced_bass():
    p = Patch()
    clk = p.add("clock", 0, 0)
    seq = p.add("seq", 1, 0, steps=16, octave=-2, scale=2)
    vco = p.add("vco", 2, 0, octave=0)
    vcf = p.add("vcf", 3, 0, cutoff=300, res=0.6, cv=5.0)
    env = p.add("adsr", 2, 1, attack=0.002, decay=0.18, sustain=0.2, release=0.1)
    vca = p.add("vca", 4, 0)
    out = p.add("output", 5, 0, mix=0.1)
    p.cable(clk, "16", seq, "clock"); p.cable(clk, "reset", seq, "reset")
    p.cable(seq, "pitch", vco, "pitch"); p.cable(vco, "saw", vcf, "in")
    p.cable(seq, "gate", env, "gate"); p.cable(env, "env", vcf, "cutoff"); p.cable(env, "env", vca, "a_cv")
    p.cable(vcf, "lp24", vca, "a"); p.cable(vca, "a", out, "l")
    return p


def acid_line():
    p = Patch()
    clk = p.add("clock", 0, 0, swing=58)
    seq = p.add("seq", 1, 0, steps=16, octave=-1, scale=2, length=0.4,
                note1=0, note2=7, note3=0, note4=10, note5=3, note6=0, note7=12, note8=5,
                note9=0, note10=7, note11=3, note12=14, note13=0, note14=5, note15=10, note16=7)
    vco = p.add("vco", 2, 0, octave=-1)
    lfo = p.add("lfo", 1, 1, sync=3, unipolar=1)
    mixcv = p.add("util", 2, 1, a=1.0, b=0.6)
    vcf = p.add("vcf", 3, 0, cutoff=250, res=0.82, cv=4.0, drive=4)
    env = p.add("adsr", 2, 2, attack=0.001, decay=0.15, sustain=0.0, release=0.05)
    vca = p.add("vca", 4, 0)
    dly = p.add("delay", 5, 0, sync=6, feedback=0.35, mix=0.25)
    out = p.add("output", 6, 0, mix=0.1)
    p.cable(clk, "16", seq, "clock"); p.cable(clk, "reset", seq, "reset")
    p.cable(seq, "pitch", vco, "pitch"); p.cable(vco, "saw", vcf, "in")
    p.cable(seq, "gate", env, "gate"); p.cable(env, "env", mixcv, "a"); p.cable(lfo, "tri", mixcv, "b")
    p.cable(mixcv, "mix", vcf, "cutoff"); p.cable(vcf, "lp24", vca, "a"); p.cable(env, "env", vca, "a_cv")
    p.cable(vca, "a", dly, "in"); p.cable(dly, "out", out, "l")
    return p


def random_bleeps():
    p = Patch()
    clk = p.add("clock", 0, 0)
    sh = p.add("noise", 1, 0)
    att = p.add("util", 2, 0, atten=1.2, offset=0.5)
    vco = p.add("vco", 3, 0, octave=0)
    env = p.add("adsr", 2, 1, attack=0.001, decay=0.08, sustain=0.0, release=0.05)
    vca = p.add("vca", 4, 0)
    dly = p.add("delay", 5, 0, sync=9, feedback=0.55, mix=0.5)
    out = p.add("output", 6, 0, mix=0.35, size=0.8)
    p.cable(clk, "8", sh, "trig"); p.cable(sh, "sh", att, "x"); p.cable(att, "x", vco, "pitch")
    p.cable(clk, "8", env, "gate"); p.cable(vco, "sine", vca, "a"); p.cable(env, "env", vca, "a_cv")
    p.cable(vca, "a", dly, "in"); p.cable(dly, "out", out, "l")
    return p


def drone_garden():
    p = Patch()
    midi = p.add("midi", 0, 0)
    vco1 = p.add("vco", 1, 0, octave=-1)
    vco2 = p.add("vco", 1, 1, octave=-1, fine=9)
    mix = p.add("util", 2, 0, a=0.5, b=0.5)
    lfo = p.add("lfo", 2, 1, rate=0.07)
    vcf = p.add("vcf", 3, 0, cutoff=700, res=0.5, cv=1.5)
    env = p.add("adsr", 3, 1, attack=2.5, decay=1.0, sustain=0.9, release=4.0)
    vca = p.add("vca", 4, 0)
    out = p.add("output", 5, 0, mix=0.5, decay=8, size=0.9)
    p.cable(midi, "pitch", vco1, "pitch"); p.cable(midi, "pitch", vco2, "pitch")
    p.cable(vco1, "saw", mix, "a"); p.cable(vco2, "saw", mix, "b"); p.cable(mix, "mix", vcf, "in")
    p.cable(lfo, "sine", vcf, "cutoff"); p.cable(midi, "gate", env, "gate"); p.cable(env, "env", vca, "a_cv")
    p.cable(vcf, "lp24", vca, "a"); p.cable(vca, "a", out, "l")
    return p


def wind_and_waves():
    p = Patch()
    midi = p.add("midi", 0, 0)
    nz = p.add("noise", 1, 0)
    lfo = p.add("lfo", 1, 1, rate=0.12)
    vcf = p.add("vcf", 2, 0, cutoff=900, res=0.7, cv=2.5)
    env = p.add("adsr", 2, 1, attack=1.5, decay=1.0, sustain=1.0, release=3.0)
    vca = p.add("vca", 3, 0)
    out = p.add("output", 4, 0, mix=0.45, size=0.9, decay=6)
    p.cable(nz, "pink", vcf, "in"); p.cable(lfo, "sine", vcf, "cutoff")
    p.cable(midi, "gate", env, "gate"); p.cable(vcf, "bp", vca, "a"); p.cable(env, "env", vca, "a_cv")
    p.cable(vca, "a", out, "l")
    return p


def fm_bell():
    p = Patch()
    midi = p.add("midi", 0, 0)
    mod = p.add("vco", 1, 1, octave=1, semi=2, fine=0)
    menv = p.add("adsr", 1, 2, attack=0.001, decay=1.2, sustain=0.0, release=0.8)
    mvca = p.add("vca", 2, 1)
    car = p.add("vco", 2, 0, octave=0, fm=2.0)
    env = p.add("adsr", 3, 1, attack=0.001, decay=2.5, sustain=0.0, release=1.5)
    vca = p.add("vca", 3, 0)
    out = p.add("output", 4, 0, mix=0.3)
    p.cable(midi, "pitch", mod, "pitch"); p.cable(midi, "pitch", car, "pitch")
    p.cable(mod, "sine", mvca, "a"); p.cable(midi, "gate", menv, "gate"); p.cable(menv, "env", mvca, "a_cv")
    p.cable(mvca, "a", car, "fm"); p.cable(midi, "gate", env, "gate")
    p.cable(car, "sine", vca, "a"); p.cable(env, "env", vca, "a_cv"); p.cable(vca, "a", out, "l")
    return p


def arp_echo():
    p = Patch()
    midi = p.add("midi", 0, 0)
    clk = p.add("clock", 0, 1)
    seq = p.add("seq", 1, 1, steps=8, octave=0, scale=1, note1=0, note2=2, note3=4, note4=7, note5=9, note6=7, note7=4, note8=2)
    add = p.add("util", 2, 0, a=1.0, b=1.0)
    vco = p.add("vco", 3, 0, octave=0)
    vcf = p.add("vcf", 4, 0, cutoff=1800, res=0.3, cv=2.0)
    env = p.add("adsr", 3, 1, attack=0.002, decay=0.2, sustain=0.3, release=0.15)
    vca = p.add("vca", 5, 0)
    dly = p.add("delay", 6, 0, sync=6, feedback=0.45, mix=0.4)
    out = p.add("output", 7, 0, mix=0.2)
    p.cable(clk, "16", seq, "clock"); p.cable(midi, "pitch", add, "a"); p.cable(seq, "pitch", add, "b")
    p.cable(add, "mix", vco, "pitch"); p.cable(vco, "pulse", vcf, "in"); p.cable(seq, "gate", env, "gate")
    p.cable(env, "env", vcf, "cutoff"); p.cable(vcf, "lp24", vca, "a"); p.cable(env, "env", vca, "a_cv")
    p.cable(vca, "a", dly, "in"); p.cable(dly, "out", out, "l")
    return p


P["Tangle"] = [
    ("Basic Voice", "Two VCOs, ladder filter, envelope: the classic starting patch.", {"patch": basic_voice().to_dict()}),
    ("Sequenced Bass", "Clock-driven 16-step bass line.", {"patch": sequenced_bass().to_dict()}),
    ("Acid Line", "Swung 16ths through a screaming ladder.", {"patch": acid_line().to_dict()}),
    ("Random Bleeps", "Sample & hold melodies with triplet echoes.", {"patch": random_bleeps().to_dict()}),
    ("Drone Garden", "Slow detuned drone with a breathing filter.", {"patch": drone_garden().to_dict()}),
    ("Wind and Waves", "Filtered pink noise.", {"patch": wind_and_waves().to_dict()}),
    ("FM Bell", "One VCO frequency-modulating another.", {"patch": fm_bell().to_dict()}),
    ("Arp Echo", "Keyboard transposes a sequenced arpeggio.", {"patch": arp_echo().to_dict()}),
]


def slug(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def main():
    total = 0
    for inst, presets in P.items():
        assert len(presets) == 8, inst
        d = os.path.join(ROOT, inst)
        os.makedirs(d, exist_ok=True)
        for f in os.listdir(d):
            if f.endswith(".json"):
                os.remove(os.path.join(d, f))
        for i, (name, desc, params) in enumerate(presets):
            data = {"format": 1, "instrument": inst, "name": name, "description": desc,
                    "author": "AudioSyncMaster", "order": i, "params": params}
            with open(os.path.join(d, "%02d_%s.json" % (i + 1, slug(name))), "w", newline="\n") as fh:
                json.dump(data, fh, indent=1)
                fh.write("\n")
            total += 1
    print("wrote", total, "presets")


if __name__ == "__main__":
    main()
