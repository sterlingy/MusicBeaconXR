# Music Beacon XR

Generative music driven by where you are. Beacons are placed in a space: a 100 m test grid, a beacon every 10° of latitude and longitude around the globe, or a local grid around your real location. Each beacon has its own song, a full 2 to 5 minute piece with verses, choruses and a bridge. As you move, the three closest beacons' songs blend into one track, and the blended sound parameters keep shifting.

## What's here

| Folder | What it is | Run / test |
|---|---|---|
| `web/` | **Music Beacon XR**, the browser playfield: test grid, globe, and a local grid (1 to 100 km a side, any beacon spacing) that follows your location; Web Audio synths with 20 presets each and parameter automation (the Synths page, `web/synths.html`); song editor with form and arrangement; shared songs. See [web/README.md](web/README.md). | `python web/serve.py`, then http://127.0.0.1:8765 (`--https` for phones) · `node --test web/tests` |
| `addons/synthkit/` | **SynthKit**, the AudioSyncMaster instruments as a Godot addon (engine, panels, presets, sequencer, clock). See [addons/synthkit/README.md](addons/synthkit/README.md). | `godot --headless --path . res://tests/synthkit_check.tscn` |
| `scripts/beacon/` | The Godot beacon player: the same fields, weights and blending as the browser, playing on SynthKit's engine. Keys, lead and a pad part (which holds the blended harmony's chords) play on SynthKit's **Prism** engine. | `godot --headless --path . res://tests/beacon_check.tscn` |
| `scenes/beacon_field.tscn` | **3D test grid** (main scene): pillars per beacon, a listener to walk, blend lines, HUD. WASD walk, drag to pan, tap a beacon or long-press (right-click) to Jump or Move there, T auto-walk, Space play, G globe. | F5 in Godot |
| `scenes/globe_field.tscn` | **3D globe**: 614 beacons on a sphere, great-circle blend arcs. WASD walk, 1–9 jump to cities, G back to grid. | open the scene, F6 |
| `scenes/studio.tscn` | SynthKit studio page, to try the instruments by hand. | open the scene, F6 |
| `addons/listener_kit/` | **ListenerKit**, where the listener is and every way to move them: keyboard / gamepad, click / tap / pinch, wander, OpenXR locomotion. No SynthKit, no scene code, so other apps can use it. See [addons/listener_kit/README.md](addons/listener_kit/README.md). The browser twin is `web/src/input/listener.js`. | `godot --headless --path . res://tests/listener_check.tscn` |
| `scenes/xr_field.tscn` | **OpenXR field**: you are the listener. Room-scale walking, left-stick glide, right-stick snap turn, trigger to walk where you point, grip for life size / tabletop, A play, B auto-walk, passthrough toggle (menu) where the headset has it. Falls back to the flat view without a headset. | `godot --path . --xr-mode on res://scenes/xr_field.tscn` |
| `web/ar.html` | **WebXR** AR (Chrome on Android, Quest Browser) and VR, plus a first-person preview for screens. | open from the **AR / VR ↗** button |
| `addons/music_input_kit/` | **MusicInputKit**: 3D objects you play instead of a piano keyboard. Note objects: chime bars, light strings, theremin orb, pitch ribbon, drum pads, chord blocks, music-box wheel. Shaping objects: dial, fader / spring lever, XY pad, flywheel, tilt cube, scale buttons. A patch bay connects any moving part to any synth knob, and a scale lock keeps notes in key or not. Mouse, multi-touch and OpenXR hands. No SynthKit inside; `scripts/play/synth_bridge.gd` plays it on SynthKit. See [addons/music_input_kit/README.md](addons/music_input_kit/README.md). The browser twin is `web/src/play/`. | `godot --headless --path . res://tests/music_input_check.tscn` |
| `scenes/instrument_table.tscn` | **Instrument Table**: every object on one table, played on SynthKit. Mouse / touch on screens, hands in OpenXR (touch to play, grip to twist, trigger from afar, right stick table height). **I** from the beacon field, left stick click from the XR field; **G** goes back. | `godot --path . res://scenes/instrument_table.tscn` (add `--xr-mode on` for VR) · `res://tests/instrument_table_check.tscn -- --shot=none` |
| `web/play.html` | **Instrument Table in the browser**, with WebXR VR and AR. | open from the **Instruments ↗** button |
| `songs/` | Song packs (25 grid, 614 globe) exported from the browser generator, so both versions start from the same songs, and the generator's preset and control tables (`gen_tables.json`) for the app's own copy of the generator (local grid). | `node web/tools/export_songs.mjs` regenerates them, with the fixtures the app is checked against |

Published browser page (private until shared): https://claude.ai/artifact/FjUKz2qaULZhrvxKuq7EbN · User manual: [web/manual.html](web/manual.html), served at /manual.html (built from the Claude Docs source, https://claude.ai/artifact/1MCvFAJCSEtb4kNtWKFcrr, with `web/tools/build-manual.py`)

## Platforms

| Platform | How | Status |
|---|---|---|
| Windows desktop | Godot, `Windows Desktop` preset, or F5 in the editor | Built and run here |
| PC VR (SteamVR, Oculus / Link, any OpenXR runtime) | Godot, `Windows VR (OpenXR)` preset (opens `xr_field` with OpenXR on), or `--xr-mode on` | Built; tested without a headset (falls back to flat), the XR rig tested with `--fake-xr` |
| Meta Quest (standalone) | Godot, `Quest (OpenXR)` preset | APK builds, but needs the OpenXR vendors plugin and a gradle build to run as XR on the headset (see Known gaps) |
| Android phone | Godot, `Android phone (flat)` preset (landscape, tap to go, pinch zoom) | v0.10 (code 10): `build/MusicBeaconXR-android-v0.10.apk`; needs the INTERNET permission (shared map, sign-in, flights) and location. Earlier versions ran on a Pixel; v0.8–v0.10 not yet run on a device |
| Any browser, desktop or phone | `web/` (Music Beacon XR, Synths, AR / VR preview) | Tested here |
| WebAR | `web/ar.html` → Start AR (Chrome on Android, Quest Browser) | Needs a device; preview tested here |
| WebVR | `web/ar.html` → Start VR (Quest Browser, PC VR browsers, Vision Pro) | Needs a device; preview tested here |
| Instruments, everywhere | Godot `instrument_table.tscn` (desktop, Android, PC VR, Quest) and `web/play.html` (browsers, phones, WebXR VR and AR) | Desktop and browser (mouse, touch, phone layout) tested here; XR hands tested with simulated input, not on a headset |

Export presets live in `export_presets.template.cfg` (copy it to `export_presets.cfg`, which stays out of git because it can hold signing passwords). OpenXR is off for flat builds and on for the `pcvr` and `quest` feature tags, which also make `xr_field` the main scene.

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

- SynthKit is shared with AudioSyncMaster and lives in its own private repo (github.com/sterlingy/SynthKit), included here as a git submodule at `addons/synthkit`. Clone with `git clone --recurse-submodules`, or run `git submodule update --init` in an existing checkout. Change the instruments in SynthKit, push there, then bump the submodule here (`git -C addons/synthkit pull` and commit the new pointer); don't edit `addons/synthkit` in this repo. Building the engine needs its third-party libraries and VS 2022 (see SynthKit's README).
- MusicInputKit (`addons/music_input_kit`) is also its own private repo (github.com/sterlingy/MusicInputKit) and a git submodule, shared with JamSyncXR (formerly AudioSyncMaster). Change it in its own clone (`D:\MusicInputKit` on music-machine), push, then bump the submodule here (`git submodule update --remote addons/music_input_kit`) and commit the new pointer. Don't edit `addons/music_input_kit` here.
- The browser synths are ports of the instrument designs, not the C++ engine.
- The Godot player doesn't follow song forms or automation yet.

### The app's fields

The app opens on the **local grid** the first time, centered on the phone's location (it asks for location permission; desktops have no location, so it starts on London), and after that on whichever field was used last. **☰ Options** at the top right switches between the test grid, the globe and the local grid, sets the local grid's size and spacing (shown on the local grid only), turns following your location on or off (local grid and globe), follows a flight (globe), picks the sound quality and opens the manual. Options that don't apply to the field you're on are hidden, not greyed out. On the Instrument Table and the Synths, **Map** (or Android's back gesture) returns to the field.

**The song panel** (top left of every field, `scripts/beacon/beacon_hud.gd`) shows the key and tempo, the three beacons you hear and how much of each, and every part's live level with **M** (mute) and **S** (solo). Its left column also holds **Orchestral samples** (off: every part plays its own synth sound) and **Metronome click** (M too), and the sound line with its quality button. **Instruments** and **Synths** sit in its top row, centred over the parts, and open the Instrument Table and SynthKit's studio. The chevron folds it; phones start folded, and it folds when another window opens.

- **My beacons on the globe** (step 1 of [docs/beacon-database-plan.md](docs/beacon-database-plan.md)): the ★ My beacons button (bottom left of the globe) generates a grid where you are (anywhere in the world; its size, 1 to 100 km a side, and spacing, 100 m to 10 km, are chosen apart, from 3 × 3 to 51 × 51 beacons), plants the song you hear most, starts custom maps (tap the globe to place beacons), and lists your grids and maps to turn on and off, go to, copy, regenerate or delete. Everything stays in `user://beacon_drafts.json`, in the same `beacon-drafts` format as the website, and **Export all** / **Import** go through `Documents/MusicBeaconXR/*.beacons.json` to move it between the two. Zoom in close (to about 1 km) to see them. The rules live in `scripts/beacon/beacon_drafts.gd`, a port of `web/src/drafts.js`; `tests/drafts_check.gd` checks it against the website's answers in `tests/fixtures/drafts.json` (`node web/tools/export_drafts.mjs`). Dev: `-- --fakegps=lat,lon` stands in for GPS, `--drafts-demo` fills in a demo (not saved). Other people's shared beacons (step 2) come from the Supabase project in 1° tiles around you (`scripts/beacon/shared_map.gd`), cached in `user://shared/` for offline; see [supabase/README.md](supabase/README.md). Sharing (step 3): **Account** in the panel signs in with the 6-digit code from an email (`scripts/beacon/beacon_account.gd`), then **Share** / **Unshare** on grids and maps, **Share all** on planted songs, and **Report what's playing** for shared beacons; the terms show once before the first share. `tests/account_check.gd` checks the calls against a fake server.
- **Walks** (● Walks, bottom right of every field): the trail of where you've been, **Record walk** / **▶ Replay** in the same `beacon-walk` format as the website (so walks move between them as `.walk.json` files through `Documents/MusicBeaconXR`), **Export WAV** (plays the walk through once and records the Master bus) and **Record what I hear (WAV)**. The app has no MP3 encoder; the website exports MP3. Replays use the recorded blend (`scripts/beacon/beacon_walks.gd`, maths in `walk_math.gd`, checked against the website by `tests/walk_check.gd`). Song editing during a replay is website-only (the app has no song editor yet).
- **Following a flight** (Options panel on the globe): type a tail or flight number and **✈ Follow**, or **🎲 Random** for a random flight in the air anywhere in the world (busy hubs on every continent, daytime first, airliners first); the aircraft's live position (adsb.lol, asked directly by `scripts/beacon/flight_follow.gd`) drives the listener, with the same dead reckoning as the website. A plane shows on the globe (`plane_model.gd`, a smooth airliner built in code: rounded fuselage, swept wings, engines, tail; on the website a shaded one drawn to match, `web/src/plane.js`), amber while its data is fresh and red when stale, up in the air: riding just above a green arc from its origin to its destination once the route is known and confirmed (else well clear of the ground), nose tilted with the climb and descent, with a faint line down to where you are. Tap it for a card (`flight_card.gd`) with the airline, route as airport codes with a progress track, estimated time to go, landing time and time in the air, altitude, speed, heading, Mach, outside air, squawk and the aircraft (route and aircraft from adsbdb.com; a schedule route the plane isn't flying is marked unconfirmed). Dev: `-- --flight=SWA550`, `-- --random-flight`.
- **Same songs as the website.** Local-grid songs are made as beacons come near by `scripts/beacon/song_gen.gd`, a line-for-line port of the browser's generator (its tables come from `songs/gen_tables.json`). `tests/song_gen_check.gd` checks it against browser-made songs, and `tests/local_grid_check.gd` checks the grid's beacon ids, labels, places and weights against `web/src/beacons.js`.
- **Location** comes from Android's LocationManager through Godot's Java bridge (`scripts/beacon/geo_location.gd`): no plugin or custom build. The grid re-centers when you get 40% of a side from its middle, as on the website, and beacons the old and new grids share keep their songs.
- Settings live in `user://field.cfg` (`scripts/beacon/field_prefs.gd`); `scenes/start.tscn` opens the right field.
- **Android XR (XREAL Project Aura and other Android XR devices):** the `Android XR (OpenXR)` preset builds a gradle APK with the Android XR OpenXR loader from the Godot OpenXR vendors plugin (`addons/godotopenxrvendors`, Apache 2.0, the same copy JamSyncXR uses). Its `androidxr` feature tag turns OpenXR on and opens `xr_field` (hand tracking optional, tracked controllers optional). Gradle builds need the Android build template in `android/` (git-ignored): in the editor, Project > Install Android Build Template, or unzip the 4.7.2 export templates' `android_source.zip` into `android/build` with `android/.build_version` = `4.7.2.stable`. On this PC, run the export with a short `TEMP`/`TMP` (for example `C:\gtmp`): Java can't open its loopback socket from a very long temp path ("Unable to establish loopback connection").
- Quest standalone: the plain export has no OpenXR loader or Quest manifest entries. The vendors plugin and build template are now in place (see Android XR); turn on gradle build and the Meta plugin in the `Quest (OpenXR)` preset. PC VR (including Quest over Link) uses the Windows VR build instead; not tried on a headset yet.
- No Godot web export. SynthKit now has a web build (`addons/synthkit/web/`, the same C++ compiled to WebAssembly), but the Godot app itself isn't exported to the web; the browser version is `web/`, which still uses its own Web Audio instruments.

## Studying songs' instruments (audio analysis)

`tools/separate.py` splits songs into their parts with Demucs (drums, bass, vocals, guitar, piano, other), on the NVIDIA GPU, so their instruments can be studied and their sounds copied onto SynthKit. Put WAV, FLAC, MP3 or OGG files in `analysis/input/` and run:

```bash
tools/.venv/Scripts/python.exe tools/separate.py
```

Parts land in `analysis/stems/<song>/<part>.wav`, with `parts.json` giving how loud each is. Then `tools/.venv/Scripts/python.exe tools/analyze.py` measures each song (tempo, key, chords by bar, rough sections) and each part (tone balance, brightness, attack and decay, how busy and wide, pitch range, the drums' typical bar) into `analysis/stems/<song>/report.json`, the numbers SynthKit presets get matched against. The Python environment (`tools/.venv/`, PyTorch with CUDA, Demucs 4.0.1, soundfile) and `analysis/` stay out of git; setup steps are at the top of the script.

## Sampled instruments

Some parts of a song can play a recorded instrument instead of a synth: piano, string section, pizzicato, harp, horn, trumpet, trombone, tuba, flute, clarinet, oboe, bassoon, contrabass, marimba, glockenspiel, xylophone and an orchestral percussion kit, all from VSCO 2 Community Edition (CC0). Each song rolls its sampled parts from its own seed (`SAMPLE_CHOICES` and `SAMPLE_ODDS` in `web/src/song.js`, mirrored in `scripts/beacon/song_gen.gd`), ambient and journey songs most often; the notes and synth sounds are unchanged. The loudest song in a part picks its sound, and a part plays its synth until its samples have loaded. They play on SynthKit's Sampler.

Each platform gets its own quality tier:

| Tier | Where | What | Size |
|---|---|---|---|
| full | desktops, and phones and Quest that can carry it (`samples/full`) | every velocity layer and round robin, stereo, long tails | 72 MB |
| web | the website (`web/samples/web`), loaded per instrument on demand | 3 layers, stereo | 41 MB |
| phone | other phones (`samples/phone`) | 2 layers, mono, 32 kHz | 12 MB |

The app picks the tier and synth quality per device (`scripts/beacon/audio_quality.gd`): desktops and phones with 7+ GB of memory and 8+ cores get the full pack and High quality, phones with 5+ GB and 6+ cores the phone pack at Medium, smaller ones Light. While it plays it watches the audio load: when that stays above 70% for 2 seconds (a busy blend, or a phone getting hot and slowing down) it steps the synths down a level (Prism's voice quality and voice budget, the Sampler's interpolation and voices) before the sound can crackle, and steps back up after 30 calm seconds, never above where it started. The panel shows the level and load, and its button switches between Auto, High (full pack, best quality) and Light (phone pack, saves battery), remembered between launches. **Orchestral samples** in the song panel (the website's Instruments panel) turns the sampled instruments off altogether: every part then plays its own synth sound, and no samples load. Android and Quest builds carry both packs (about 84 MB).

Build them from the source library (cloned to `samples_src/VSCO-2-CE`, git-ignored), then match their loudness to the synths they replace:

```bash
tools/.venv/Scripts/python.exe tools/build_samples.py
```

```bash
node web/tools/calibrate_samples.mjs
```

The export presets carry the right packs (desktop: full; Android and Quest: both). The built packs are committed, so a fresh checkout builds and the website serves the web pack. `web/tools/sampler_render.mjs` renders a program offline for checking, and `tests/sampler_check.gd` checks the Sampler in the app.

## Getting around: Jump and Move

On the globe and the grids, one finger (or the mouse) turns the globe or pans the map without moving you; a flick keeps it going. Tap a beacon, or long-press (right-click on a desktop) anywhere, and a card offers two ways to go:

- **Jump:** there at once.
- **Move:** glide there along the great circle (a straight line on a grid), hearing the music change through every beacon on the way. About 3 seconds for a short hop, up to 12 across the world. Tap the map to stop.

**Wander** (the button beside Walks, `scripts/beacon/speed_ui.gd`) shows the travel speed under its name (for example "Bike · 10 m/s") and lights amber while auto-walk is on. Its pop-up holds the **auto-walk** switch (T too), which lets the listener wander between beacons by itself, and the **travel speed** slider: 1 m/s (walking) to 250 m/s (a jet cruising) on a log scale, snapping to 1, 2, 5, 10, 25, 50, 100 and 250 m/s and naming the ranges (walk, jog, run, bike, drive, train, bullet train, prop plane, jet), remembered between launches. The website's **Speed** slider (under the map, `web/src/speed.js`) works the same way. It's the real speed everywhere, the globe included (from the whole Earth even 100 m/s barely moves: long-press to Move or Jump far). ListenerKit steps the position in full precision, since a 32-bit degree is too coarse for a frame's step at walking pace. A Jump or a Move ends auto-walk. While it wanders you can still turn the globe or pan the map: wandering steps don't pull the view back to you (`ListenerInput.moved_by_wander`; on the web the `moved` event's second argument), while walking, travel and following do.

**One thing moves you at a time:** wandering, following a flight and following your location each drive the listener, so turning one on turns the other two off, in the app and on the website. Going somewhere yourself stops all three: Jump, Move, Center on me / My location, a city (1-9 or the list), typed coordinates, Go on your beacons and Walk here. Wandering starts from where you are; after a flight, that's the plane's last spot. **Back to me** (bottom middle) returns the view after you've turned it away. Going somewhere stops following your location. Pinch or the wheel zooms; keys still walk. In a headset, tap the right trigger on a beacon or hold it on any spot, and the card floats there: point at Jump or Move and pull the trigger. The website's flat maps and 3D globe work the same way. Code: ListenerKit (`PointerSource` mode `explore`, `ListenerInput.travel_to`), `scripts/beacon/travel_ui.gd`, `xr_travel_card.gd`; on the web `src/input/listener.js` and `src/travelcard.js`.

**The beacons you hear glow** in their mood colour, by how much each drives the music: the pillar lights up and a soft halo grows and brightens with its share, out on the world and on your own grids (sized to the grid's spacing there). Code: `_update_active` in `scripts/beacon/globe_scene.gd`; on the website `web/src/glow.js` (the 3D globe, the flat maps and your own beacons).

## Windows and sounds

Pop-out windows (Options, Walks, My beacons, the Jump / Move card, the flight card) are one at a time: opening one closes the others. Each pops open from its own corner with a slight overshoot and fades in, shrinks away on close, and is frosted glass (the world shows through, blurred). A swoosh plays each way, and when the readout folds. Code: `scripts/beacon/popup_fx.gd`; on the website `web/src/popup.js` and the `.pop-in` / `.pop-out` styles in `web/index.html`.

Buttons share one look (`FieldMenu.style_button`): a slate fill a little lighter than the panels, a brighter border and white text, amber when on. On phones the corner buttons (Play, Options, My beacons, Wander, Walks) are all the same size.

The swooshes (`sfx/ui_open.ogg`, `sfx/ui_close.ogg`, and MP3 copies in `web/sfx/`) are trimmed, faded, mono, level-matched derivatives of two clips from SoundMorph's Motion Graphics library ("Whoosh 1" and "Whoosh 2", Buttons), used under SoundMorph's single-user licence, which allows its sounds inside games and websites. The library's original recordings are not in this repository and must not be added: the licence forbids sharing them on a public server.

## Map outlines

The globes show the continents' coastlines (Natural Earth 1:110m, public domain, simplified to about 2,400 points: `data/coastlines.json` for the app, `web/data/coastlines.json` for the website) as thin solid lines; the US is drawn like every other coast. Beacons can be made and shared anywhere. The land is shaded a little lighter than the sea, from a land mask (Natural Earth 1:110m land, rasterised to 2048x1024 equirectangular, white = land: `data/land_mask.png` and `web/data/land_mask.png`).
