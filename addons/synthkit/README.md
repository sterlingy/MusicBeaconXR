# SynthKit

Shivoo Studios' live-synthesized instruments as a Godot 4.5+ addon, shared
between projects (AudioSyncMaster, MusicBeaconXR): seven instruments with a C++
engine, their front panels, 48 factory presets, user presets, a step sequencer
and a shared musical clock.

| Instrument | Role |
|---|---|
| Pulsar | Drums (8 synthesized voices) |
| Undertow | Mono bass (3 oscillators, ladder filter) |
| Comet | Lead (hard sync, vibrato, ping-pong delay) |
| Lumen | 8-voice poly keys and pads |
| Driftwood | Physical-model plucks and mallets |
| Tangle | Modular with patch cables |
| Prism | Deep keys / lead / pad engine, sized to run several at once on phones and Quest |

This folder is the one place the instruments live. Projects copy its addon
part to `addons/synthkit` (AudioSyncMaster: `tools/sync_synthkit.ps1`). Git
stays local (no remotes), so projects take updates by syncing, not by
submodule.

## Use in a project
1. Copy this folder into the project as `addons/synthkit/`, without `engine/`,
   `docs/` and `.git/` (or use a sync script like AudioSyncMaster's).
2. Enable **SynthKit** under Project Settings → Plugins. This adds two
   autoloads: `Transport` (clock) and `Midi` (MIDI, computer keyboard and
   on-screen keys). Projects that already declare them keep theirs.

```gdscript
# A whole instrument page (pickers, panel, sequencer, keys):
var studio := SynthStudio.new()
add_child(studio)

# Or just an instrument, driven from code:
var rig := InstrumentRig.new()
rig.instrument = "Lumen"
rig.local_input = false
add_child(rig)
rig.load_preset(PresetLibrary.list("Lumen")[0])
rig.set_param("filter.cutoff", 2400.0)
rig.play_note(60, 0.8)
```

- `rig.synth` is the `JamSynth` (C++). `get_param_list()` describes every
  parameter (id, group, range, type, unit); the panels are built from it.
- `rig.sequencer` (`StepSequencer`) plays from `Transport` and saves with
  `to_dict()` / `from_dict()`.
- `rig.clip_synth()` plays recorded audio clips on the clock (the engine's
  `Clips` instrument).
- `PresetLibrary` reads factory presets from `presets/factory/` and user
  presets from `user://presets/`. A preset only stores values that differ from
  the defaults.
- Everything played goes out through `rig.played`, so apps add loopers,
  networking or recording on top. For a looper, set
  `InstrumentRig.looper_factory` (a Callable taking the rig and returning an
  object with `capture(event)`, `poll()`, `schedule(from_beat, to_beat)` and
  `transport_stopped()`) before rigs are created.
- `Midi` has no app settings of its own: set `Midi.midi_channel`,
  `Midi.qwerty_input` and `Midi.qwerty_velocity` from your settings, listen to
  `Midi.outgoing` to forward played MIDI (e.g. a Wi-Fi relay), and feed remote
  MIDI in with `Midi.dispatch_raw(...)`. On Android it uses the ChordMasterMidi
  plugin (USB and Bluetooth LE MIDI) when the project includes it.
- `Transport` can follow another clock (`follower`, `apply_state`,
  `clock_offset`) for networked sessions.

## Prism
One engine for keys, leads and pads (8 factory presets: 3 keys, 2 leads, 3 pads).
- **Sound:** two engines per voice (Analog with up to 4-voice unison, Wavetable
  with 8 built-in tables and warp, two-operator FM with feedback, Harmonic),
  sub, noise, B->A FM, ring mod and a wavefolder; two filters (12/24 dB SVF modes,
  notch, ladder, comb, formant) in series, parallel or split.
- **Motion:** three envelopes, a per-voice LFO with a vibrato knob, two global
  LFOs (tempo sync, sample & hold, smooth random), four macros and a 12-slot mod
  matrix (sources include velocity, key, mod wheel, pressure and per-note random).
- **Effects:** two insert slots (chorus, phaser, drive, crush) and sends to a
  space (reverb) and echo shared by every Prism instance.
- **Built for several at once:** modulation, envelopes and filter coefficients
  run every 32 samples; wavetables are built once (`dsp/wavetables.cpp`, our own
  FFT) and shared; one voice budget across all instances (`voice.budget`,
  `voice.priority` decides who gives way); `out.gain` 0 puts an instance to sleep;
  `voice.quality` Low trims unison, the ladder and the serial second filter.
- MusicBeaconXR's `tests/prism_check.gd` checks every engine, filter, effect and
  mod target, and benchmarks keys + lead + pad in a full mix (about 4% of one
  desktop core for the three Prisms at their busiest).

## Layout
- `bin/` — the compiled engine (Windows x86_64 debug/release, Android arm64).
- `core/` — instrument rig, step sequencer, default patterns, presets, clock,
  MIDI input, audio helpers.
- `ui/` — knobs (mouse and touch), panels, Tangle editor, sequencer grid,
  keyboard and drum pads (multi-touch), `SynthStudio`.
- `presets/` — factory presets, and `make_presets.py` that generated them.
- `engine/` — the C++ engine source (`src/`), `SConstruct`, build scripts
  (`tools/`), and git-ignored third-party clones (`thirdparty/`) and builds
  (`build/`). Hidden from Godot (`.gdignore`).
- `docs/THIRDPARTY.md` — third-party sources, versions and licenses.

## Building the engine
From a VS 2022 developer environment (Windows), with Python and SCons:

```
engine\tools\build_aoo.ps1                 # once: AOO + Opus (audio streaming)
engine\tools\build.ps1                     # Windows debug -> bin\
engine\tools\build.ps1 -Target release
engine\tools\build.ps1 -Platform android   # arm64; needs ANDROID_HOME with an NDK
```

The third-party clones go in `engine/thirdparty/` (see `docs/THIRDPARTY.md`).
Without AOO the engine builds without the network audio classes
(`JamAudioLink`), which only AudioSyncMaster's sessions use.

## Rules
- Synth DSP lives in C++, never per-sample GDScript; no allocation or locks on
  the audio thread.
- Our own code or permissive libraries only; never compile DaisySP-LGPL; no
  GPL code (Jamulus, SonoBus, NINJAM, VCV Rack).
- Original instrument names and panels; no trademarked names or look-alikes.
