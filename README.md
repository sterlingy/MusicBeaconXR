# MusicBeaconXR

Generative music driven by where you are. Beacons are placed in a space (a 100 m test grid now, later a beacon every 10° of latitude and longitude around the globe). Each beacon has its own song. As you move, the three closest beacons' songs blend into one track, and the blended sound parameters keep shifting.

## What's here

| Folder | What it is | Run / test |
|---|---|---|
| `web/` | **Beacon Field**, the browser playfield: test grid, globe, and a 50 × 50 mile local grid that follows your location, Web Audio synths, song editor, shared songs. See [web/README.md](web/README.md). | `python web/serve.py`, then http://127.0.0.1:8765 · `node --test web/tests` |
| `addons/synthkit/` | **SynthKit**, the AudioSyncMaster instruments as a Godot addon (engine, panels, presets, sequencer, clock). See [addons/synthkit/README.md](addons/synthkit/README.md). | `godot --headless --path . res://tests/synthkit_check.tscn` |
| `scripts/beacon/` | The Godot beacon player: the same fields, weights and blending as the browser, playing on SynthKit's engine. | `godot --headless --path . res://tests/beacon_check.tscn` |
| `scenes/beacon_field.tscn` | **3D test grid** (main scene): pillars per beacon, a listener to walk, blend lines, HUD. WASD walk, click to go, T auto-walk, Space play, G globe. | F5 in Godot |
| `scenes/globe_field.tscn` | **3D globe**: 614 beacons on a sphere, great-circle blend arcs. WASD walk, 1–9 jump to cities, G back to grid. | open the scene, F6 |
| `scenes/studio.tscn` | SynthKit studio page, to try the instruments by hand. | open the scene, F6 |
| `songs/` | Song packs (25 grid, 614 globe) exported from the browser generator, so both versions play identical songs. | `node web/tools/export_songs.mjs` regenerates them |

Published browser page (private until shared): https://claude.ai/artifact/FjUKz2qaULZhrvxKuq7EbN

## One song format, two players

Songs are `beacon-song` v1 JSON (documented in web/README.md). The browser plays them on its Web Audio instruments. Godot plays them on SynthKit, where `scripts/beacon/param_map.gd` translates sound parameters onto the engine's own controls (Tangle uses its base patch). Weights match between the two to within 1e-5 (`tests/fixtures/weights.json`).

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

- The C++ engine source isn't on this PC, so SynthKit ships prebuilt binaries (Windows, Android arm64).
- The browser synths are ports of the instrument designs, not the C++ engine.
- AudioSyncMaster (`C:\ASM\project`) is untouched. Everything here is a copy.
