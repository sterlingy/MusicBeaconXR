# SynthKit

The AudioSyncMaster instruments as a Godot 4.5+ addon that any project can use: six live-synthesized instruments, their front panels, 48 factory presets, user presets, a step sequencer and a shared musical clock.

| Instrument | Role |
|---|---|
| Pulsar | Drums (8 synthesized voices) |
| Undertow | Mono bass (3 oscillators, ladder filter) |
| Comet | Lead (hard sync, vibrato, ping-pong delay) |
| Lumen | 8-voice poly keys and pads |
| Driftwood | Physical-model plucks and mallets |
| Tangle | Modular with patch cables |

## Install
1. Copy `addons/synthkit/` into the project.
2. Enable **SynthKit** under Project Settings → Plugins. This adds two autoloads: `Transport` (clock) and `Midi` (MIDI, computer keyboard and on-screen keys).

## Use
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

- `rig.synth` is the `JamSynth` (C++). `get_param_list()` describes every parameter (id, group, range, type), and the panels are built from it.
- `rig.sequencer` (`StepSequencer`) plays from `Transport` and saves with `to_dict()` / `from_dict()`.
- `PresetLibrary` reads factory presets from `presets/factory/` and user presets from `user://presets/`. A preset only stores values that differ from the defaults.
- Everything you play goes out through `rig.played`, so apps can add loopers, networking or recording on top.

## Layout
- `bin/` holds the compiled `jamcore` engine (Windows x86_64 debug/release, Android arm64), copied from AudioSyncMaster's build of 2026-11-21.
- `core/` has the rig, sequencer, presets, clock and MIDI input.
- `ui/` has the knobs, panels, Tangle editor, sequencer grid, keyboard and `SynthStudio`.
- `presets/` holds the factory presets, plus `make_presets.py`, which generated them.

## Known gaps
- **No engine source here.** The C++ source (`jamcore/src`) was not on this machine, so the addon ships the prebuilt binaries only. Engine changes (and builds for other platforms) need that source.
- Left out on purpose, since they're app features: the looper, jam networking/AOO session code, jam recording and QR share codes. The engine DLL still includes the AOO classes; they just go unused.
