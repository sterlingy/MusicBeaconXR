# MusicBeaconXR

Generative music driven by where you are. Beacons are placed in a space: a 100 m test grid, a beacon every 10° of latitude and longitude around the globe, or a local grid around your real location. Each beacon has its own song, a full 2 to 5 minute piece with verses, choruses and a bridge. As you move, the three closest beacons' songs blend into one track, and the blended sound parameters keep shifting.

## What's here

| Folder | What it is | Run / test |
|---|---|---|
| `web/` | **Beacon Field**, the browser playfield: test grid, globe, and a local grid (1 to 100 km a side, any beacon spacing) that follows your location; Web Audio synths with 20 presets each and parameter automation (the Synths page, `web/synths.html`); song editor with form and arrangement; shared songs. See [web/README.md](web/README.md). | `python web/serve.py`, then http://127.0.0.1:8765 (`--https` for phones) · `node --test web/tests` |
| `addons/synthkit/` | **SynthKit**, the AudioSyncMaster instruments as a Godot addon (engine, panels, presets, sequencer, clock). See [addons/synthkit/README.md](addons/synthkit/README.md). | `godot --headless --path . res://tests/synthkit_check.tscn` |
| `scripts/beacon/` | The Godot beacon player: the same fields, weights and blending as the browser, playing on SynthKit's engine. | `godot --headless --path . res://tests/beacon_check.tscn` |
| `scenes/beacon_field.tscn` | **3D test grid** (main scene): pillars per beacon, a listener to walk, blend lines, HUD. WASD walk, click to go, T auto-walk, Space play, G globe. | F5 in Godot |
| `scenes/globe_field.tscn` | **3D globe**: 614 beacons on a sphere, great-circle blend arcs. WASD walk, 1–9 jump to cities, G back to grid. | open the scene, F6 |
| `scenes/studio.tscn` | SynthKit studio page, to try the instruments by hand. | open the scene, F6 |
| `songs/` | Song packs (25 grid, 614 globe) exported from the browser generator, so both versions start from the same songs. | `node web/tools/export-songs.mjs` regenerates them |

Published browser page (private until shared): https://claude.ai/artifact/FjUKz2qaULZhrvxKuq7EbN · User manual: https://claude.ai/artifact/1MCvFAJCSEtb4kNtWKFcrr

## One song format, two players

Songs are `beacon-song` v2 JSON (documented in web/README.md): key, tempo, chords, six instrument parts, plus a form (sections and which instruments play in each) and parameter automation. The browser plays all of it on its Web Audio instruments. Godot plays each song's verse patterns as a loop on SynthKit, where `scripts/beacon/param_map.gd` translates the sound parameters it knows onto the engine's own controls (Tangle uses its base patch); song forms, the newer sound controls and automation are browser-only for now. Version 1 songs (single loops) still play in both. Weights match between the two to within 1e-5 (`tests/fixtures/weights.json`).

## Godot player in brief

```gdscript
var player := BeaconPlayer.new()
player.field = BeaconField.make_grid()   # or BeaconField.make_globe() with songs/globe.json
add_child(player)
player.load_songs("res://songs/grid.json")
player.set_position(Vector2(-38, 27))     # meters on the grid; (lon, lat) on the globe
Transport.start()
```

## Known gaps

- SynthKit is shared with AudioSyncMaster. Its home on this PC is `D:\SynthKit` (engine source, build scripts, binaries, scripts, presets). Change the instruments there, then run `powershell -ExecutionPolicy Bypass -File tools\sync_synthkit.ps1`; don't edit `addons/synthkit` here. Building the engine needs its third-party libraries and VS 2022 (see SynthKit's README).
- The browser synths are ports of the instrument designs, not the C++ engine.
- The Godot player doesn't follow song forms or automation yet, and the local grid is browser-only.
