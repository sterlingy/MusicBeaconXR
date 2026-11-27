# Music Beacon XR (browser)

The test playfield for Music Beacon XR. You walk a listener between music beacons; the three closest beacons' songs blend into one live track. Everything runs in the browser with Web Audio, with no samples and no server.

- **Published page:** https://claude.ai/artifact/FjUKz2qaULZhrvxKuq7EbN (private to you until you share it)
- **User manual:** [manual.html](manual.html), served with the page (the **Manual ↗** button). It is built from the Claude Docs source (https://claude.ai/artifact/1MCvFAJCSEtb4kNtWKFcrr) with `python web/tools/build-manual.py <doc.xml>`; edit the doc, then rebuild.
- **Run locally:** `python web/serve.py`, then open http://127.0.0.1:8765. Running locally is also the only way to use your location (**My location**, and **Local grid** following you), because published pages can't read GPS.
- **On a phone or tablet:** `python web/serve.py --https`, then open the https address it prints (same Wi-Fi, or ZeroTier). Accept the certificate warning once, tap **Local grid**, and allow location. Phones only share location with HTTPS pages; the certificate is self-signed, made on first run in `web/.cert/` (kept out of git, never served). Tested on iPad Safari: a fix accurate to 15 m. **Android Chrome** also needs **Settings → Apps → Chrome → Permissions → Nearby devices → Allow** to reach this PC's local or ZeroTier address (otherwise it fails with ERR_TOO_MANY_RETRIES), and another VPN, such as VPN by Google, must be off while ZeroTier is used.
- **Screen off:** phones pause web audio when the screen turns off, so while the music plays the page keeps the screen on (Screen Wake Lock: Chrome on Android, Safari on iOS 16.4 and later; HTTPS or localhost only). If the music still stops (another app, a call, locking the phone by hand), it picks up again when you come back to the page. Following your location needs the page on screen anyway.
- **Location problems:** pages from `serve.py` report each location attempt (secure or not, permission state, error, accuracy; never coordinates) to the server's console, so a phone's problem can be read on the PC.
- **Tests:** `node --test web/tests`
- **Install on a phone:** pages from `serve.py` carry a web app manifest (`manifest.webmanifest`, `icon.svg`), so phones offer **Add to Home Screen** / **Install**, with AR / VR and Synths shortcuts.
- **Gamepads:** a connected gamepad walks the listener (left stick or d-pad), A plays, Y toggles auto-walk.
- **Godot song packs:** `node web/tools/export_songs.mjs` rebuilds them (and the generator tables and fixtures the app's local grid is checked against); `node web/tools/export-songs.mjs` rebuilds just `songs/grid.json` and `songs/globe.json` from the browser's generator. The Godot player plays each song's verse patterns as a loop and maps only the sound settings it knows; sections, presets' extra controls and automation are browser-only for now.

## Three fields

- **Test grid:** 5×5 beacons, 100 m apart. Drag, tap or use WASD to walk.
- **Globe:** a beacon every 10° of latitude and longitude (614 in all). **3D globe** (the default) or **Flat map**, beside the zoom buttons: the 3D globe is lit by the real sun (the day/night line is where it is right now), with a starfield, an atmosphere and the lower 48 outline (where beacons can be made for now). Beacons glow in their mood colours and pulse as they sound; your own beacons show as one tinted square per grid when far away and as single beacons up close; arcs lift off the surface to the beacons you're hearing. Drag to turn (a flick keeps it turning), wheel or pinch to zoom from the whole Earth to about a kilometre, double-tap to zoom in; tap a beacon, or long-press / right-click anywhere, for the Jump / Move card (`src/travelcard.js`). It spins slowly when left alone; walking, jumping or following your location brings the camera back to you. Local, World and Close fly the camera. Code: `src/globe3d.js` (canvas, no libraries; tests in `web/tests/globe3d.test.mjs`).
- **Local grid:** a square of beacons centered on you. **Local grid, each side** sets the length of each side: 1, 5, 10, 50 (the default) or 100 km. **Beacon every** sets the spacing in kilometers, decimals allowed, from 0.01 km (10 m) to 100 km; the default is 1 km, and it's rounded to the meter. With the defaults that's 51 × 51 = 2,601 beacons; 100 km with a beacon every 5 km is 441. The side is rounded to a whole number of spacings, at least one and at most 150 (151 × 151 = 22,801 beacons). When the spacing is too fine for the chosen side, the grid shrinks to 150 spacings and the page says so: a beacon every 10 m gives a 1.5 km grid. Set both before starting, or change them any time; the page remembers them. It asks for your location, then **Follow me** keeps the listener on your real position as you move. Walking by hand, dragging or Auto-walk turns following off. **Center on me** starts it again. If location isn't available, the grid starts on London, and the city list or typed coordinates move it.
  - All local grids sit on one worldwide 1 m lattice, and each spacing uses every n-th lattice point. So the same street always has the same songs, a beacon keeps its ID and song across sizes, and spacings that line up share beacons (every 2 km beacon is also a 1 km beacon, and every 1 km beacon is also a 250 m one). Songs people share land on the same beacons for everyone. Beacon labels count kilometers from the middle ("3N 2E", "0.01E").
  - The grid centers on the lattice point nearest you (within half a spacing). With an odd number of spacings per side it's centered on the middle of a lattice square instead.
  - Once you travel 40% of the side from the middle (20 km on the 50 km grid, at least 0.6 of a spacing), the grid re-centers on you. The beacons you're near keep their IDs and songs, so the music carries on. A jump somewhere that doesn't overlap the old grid starts fresh.
  - Distances are measured on a flat map of the area, where neighbouring beacons are exactly one spacing apart (under 1% off the true distance over 40 km, about 1% at the edge of a 100 km grid). Columns are measured at the whole degree of latitude nearest the center.
  - **Nearby** shows about 8 spacings around you; **Whole grid** shows all of it. Distances under 1 km show in meters.

## My beacons (Globe tab)

Step 1 of the beacon database ([docs/beacon-database-plan.md](../docs/beacon-database-plan.md)): your own beacons, kept on this device (IndexedDB) with no server yet. The **My beacons** panel shows on the Globe tab, and **Close** zoom (the mouse wheel zooms from 1 to 400 km) shows them on the map.

- **Generate grid here:** a square of beacons centered where you really are (your location, not where you're looking). As with the local grid, **New grid, each side** (1, 5, 10, 50 or 100 km) and **Beacon every** (100 m, 200 m, 500 m, 1, 2 or 5 km) are chosen apart; spacings that don't fit the size are greyed out (at most 51 × 51 beacons, and at least 3 × 3). Grids made before sizes stay 21 × 21. A second grid in the same spot needs a different size or spacing. Each starts with the song the local grid plays at that spot.
- **Plant this song where I am** (under the beacon song): the song in the inspector (edited, pasted or generated) goes on the 100 m lattice point where you stand, heard within its **range** (500 m by default, 100 m to 10 km).
- Both need your location, accurate to 250 m or better, and for now only work in the lower 48 United States (a coarse outline, within about 20 km of the borders). The globe plays everywhere.
- **New map:** a custom map. Tap the map to put beacons on it anywhere, at exact spots, with no location needed (lower 48 only for now). **Exclusive** makes it the only thing playing while it's on, with silence away from its beacons.
- Each grid, map and the planted songs can be turned on and off (several at once, merged into one pool, each in its own tint), gone to, renamed, duplicated, exported or deleted. **Import…** adds a file's grids, maps and songs as copies. **Export all** saves everything (the `beacon-drafts` format the app uses too).
- **New songs** on a grid regenerates every generated beacon (edited songs stay); **New song** in the inspector regenerates one. Edit song or Paste JSON on one of your beacons stores the full song.
- **Several songs at one spot** (up to 20 per 100 m point): the inspector lists them, and **Where several songs share a spot, play** picks one: random (changes daily, the same for everyone there), my favorite (★ in the inspector; the latest when you haven't picked one), mine, original (first) or latest.
- **Generate more:** walking out of your grid offers the next grid along, on the same lattice and spacing (you need to be inside it to make it).
- **How it sounds:** your beacons blend nearest-3 among those whose range reaches you, at full strength out to 75% of their range, easing to nothing at the edge, while the globe fades in. The line under **Now playing** shows the sources and their shares, for example `User 70% · Global 30%`, `Lakeside walk 60% · User 25% · Global 15%`, or `Lakeside walk (exclusive) · outside`.
- **Testing without walking:** on `serve.py` only, `?fakegps=30.2672,-97.7431` (optionally `,accuracy`) stands in for your location.
- Code: `src/drafts.js` (the rules and the format, no DOM; tests in `web/tests/drafts.test.mjs`), `src/draftstore.js` (IndexedDB), `src/draftsui.js` (panel, map, inspector).
- **Shared map** (step 2): beacons other people shared play too, read from the Supabase project in 1° tiles around you (the 3 × 3 tiles around the listener, checked every minute and soon after you move), and saved on this device so they still play offline. A shared song's body loads only when you come within 1.5 times its range. Shared beacons blend with yours as "User" in the status line, draw in grey, and can't be edited or removed; "Mine" prefers your own songs at a shared spot. **Shared map** in the panel shows what's nearby and turns it off. Code: `src/shared.js` (tiles, fetcher, cache rules; tests in `web/tests/shared.test.mjs`), `src/config.js` (the public address and key). The server side is in [supabase/](../supabase/README.md).
- **Sharing** (step 3): **Account (for sharing)** at the bottom of My beacons signs in with your email, with no password: the email holds a link back to this page and a 6-digit code to type here. Listening never needs it. Then **Share** on a grid or map, **Share all** on planted songs, or **Share this song** on one planted song puts it on the shared map; **Unshare** takes it off. The first share shows the terms once (shared songs are CC BY 4.0; a shared beacon shows a place you've been, dated to the day, never with your name; you can unshare or delete everything any time). Shared beacons from other people have **Report** in the inspector (after 3 people report one, it hides until it's reviewed) and show how many people favorited them; your ★ on a shared beacon counts toward that when you're signed in. **Shared maps near you** lists public maps around you to add as your own copy. **Delete my account…** removes your account and everything you shared. The server enforces the limits (5 grids, 20 songs a day) and the lower-48 rule. Code: `src/auth.js` (sign-in), `src/submit.js` (sharing, reports, favorites; tests in `web/tests/submit.test.mjs`).

## Following a flight

On the Globe tab, type a tail number (like `N733YX`), a flight number as on a ticket (`DL934`) or as planes broadcast it (`DAL934`; about 120 airlines' two-letter codes are converted), or a transponder code, and press **✈ Follow flight**: a real aircraft's live position drives the listener, so you hear the beacons it flies over. A plane marker points along its track on the 3D globe and the flat map, and the status line shows registration, flight, type, altitude and speed. Positions update every 20 seconds; in between, the plane is carried along its speed and heading, and each new fix is eased in, so the music glides. Walking by hand or **■ Stop flight** ends it. Record a walk while following to keep the flight's soundtrack.

- Data: [adsb.lol](https://adsb.lol) (ODbL 1.0). adsb.lol doesn't allow calls from web pages, so the website asks the database's `flight_lookup` function (`supabase/migrations/0003_flights.sql`), which caches each aircraft for 10 seconds and spaces requests out. The free tier is 500 requests a day for the database's one address, so heavy use needs an adsb.lol key in `private.settings` (see the migration).
- **🎲 Random flight** asks the database's `flight_random` (`supabase/migrations/0005_flight_random.sql`): one of 46 busy hubs on every continent, daytime first, cruising planes only, airliners first; each hub's list is cached 5 minutes and a quiet hub answers "retry" (the page asks again, up to six times).
- **Tap the plane** (3D globe or flat map) for its card (`src/flightcard.js`): airline and flight number, the route as airport codes with a progress track, estimated time to go, landing (your time) and time in the air, altitude, speed, heading, Mach, outside air, squawk and the aircraft. Route and aircraft come from [adsbdb.com](https://www.adsbdb.com) (it allows calls from web pages); its routes come from schedules, so one the plane isn't flying is marked unconfirmed and its airline isn't named.
- Code: `src/flight.js` (lookup, random, details, card words, dead reckoning, easing; tests in `web/tests/flight.test.mjs`).

## Walks: trail, recordings, audio

The **Walks** panel (every field):

- **Trail:** a line of where you've been, coloured by the song you heard most there, fading over six hours. One per field, kept only on this device; **Clear trail** wipes it.
- **Record walk:** keeps your path, the blend at each moment (which beacons, how loud), a copy of every song you heard and the music clock (`beacon-walk` format, a few KB a minute, in IndexedDB). **▶ Replay** plays it again with the same music: the songs' shared clock is set back to when you walked, and the listener follows the recorded path. Drag the slider to jump. While it replays, **Edit song** or **Paste JSON** on a beacon changes the song in the recording, so the replay plays it changed (the recording keeps the change). **Trim** keeps a part as a new walk; **Download** / **Import a walk…** move recordings as `.walk.json` files.
- **Export WAV / Export MP3:** plays the walk through once in real time while recording the final mix, then saves the file. MP3 uses lamejs, loaded from jsDelivr the first time (WAV needs nothing).
- **Record what I hear:** records the music live until you press it again, then saves WAV or MP3.
- Replays use the instruments as they are at replay time (improvements apply to old walks too), and tiny random details in the sound differ.
- Code: `src/walk.js` (trail, recording, replay maths, WAV; tests in `web/tests/walk.test.mjs`), `src/walkui.js` (panel, drawing, export), `engine.tapOutput()` and the engine's `replay` / `timeOffset`.

## AR and VR page

`ar.html` (the **AR / VR ↗** button) shows the test grid in 3D and lets you walk it with your body.

- **AR** (Chrome on Android, Quest Browser with passthrough): pick a scale, tap **Start AR**. The field is laid out around you with you standing on the listener and the map's north straight ahead. Walk to move between beacons. Tap a spot on the floor to move the field's middle there; **Re-center** lays it out around you again.
- **VR** (Quest Browser, PC VR browsers, Vision Pro): the same in a dark room. Trigger re-centers, grip steps through the scales.
- **Scale:** life size (the grid is 500 m across), or 1:10 to 1:200. 1:50 (the default) fits it in a 10 m room; 1:100 in 5 m.
- **Preview** (any browser, or before starting XR): first person. WASD / arrows walk the way you look, drag to look around, Space plays, T auto-walks.
- WebXR needs a secure page: run `python web/serve.py --https` and open the https address on the phone or headset (localhost also counts as secure on the PC itself).
- No libraries: a small WebGL renderer in `src/ar/gl.js`; placement math in `src/ar/placement.js`.

## Instrument Table (MusicInputKit)

`play.html` (the **Instruments ↗** button) is a table of 3D instruments you play with your hands instead of a piano keyboard. It is the browser twin of the Godot Instrument Table and of `addons/music_input_kit`: same objects, names, patches and rules.

- **Notes:**
  - chime bars (strike; sweep for a glissando)
  - light strings (pluck, pull to bend, sweep to strum)
  - the theremin orb (left to right is pitch; height and depth shape the sound)
  - a pitch ribbon (slide)
  - drum pads (the rim is brighter than the middle)
  - chord blocks (hold a chord, lift to open it up)
  - a music-box wheel (tap to place pegs, flick to spin)
- **Shaping:**
  - a twist dial
  - a fader
  - a spring lever (a whammy on the lead's pitch)
  - an XY pad
  - a flywheel (flick it; its speed drives tremolo)
  - a tilt cube
  - LOCK / KEY / SCALE buttons
- **Keep notes in key:** the checkbox, `L`, or the LOCK button. On: everything snaps to the key and scale, and the orb and ribbon move in steps. Off: all 12 notes, and the orb and ribbon slide freely.
- **Patches ▸** connects any moving part to any knob of any part (filter, resonance, vibrato, reverb, delay, tremolo, bend, volume...). Layout and scale are saved in the browser.
- **Mouse and touch:**
  - Click or tap to play, and drag to slide, bend and strum.
  - The wheel turns dials and spins wheels.
  - Drag empty space to look around; `R` resets the view.
  - Several fingers play at once.
  - Phones in portrait see the table from above, long side up the screen.
- **VR / AR** (Quest Browser, Chrome on Android with a headset or AR):
  - The table appears in front of you, at arm's length.
  - Hit and touch the objects with your controllers or fingers (hand tracking). How fast you hit sets how loud the note is.
  - Grip to hold and twist; the trigger plays objects out of reach.
  - Right stick sets the table height; left stick press brings the table to you.
  - Haptics where the controller has them.
- **Code:**
  - `src/play/kit.js`: the kit, with no audio and no DOM. Objects describe themselves as shapes, and drivers turn the mouse, touch and XR hands into touches.
  - `src/play/sound.js`: plays the kit on the Web Audio synths. Strikes use Driftwood and Pulsar; held notes use a small live voice that bends and follows knobs while it sounds.
  - `src/play.js`: the page.
  - Tests: `web/tests/play.test.mjs`.

## ListenerKit (input)

`src/input/listener.js` holds the listener position and every way to move it, with no audio or page code, so other web apps can use it. It mirrors the Godot kit in `addons/listener_kit` (same names and rules).

- **Spaces:** `planarSpace` (meters, the test grid), `localSpace(field)` (a local grid's flat map), `geoSpace` (lat/lon on the globe). A move direction is always (right, forward).
- **ListenerInput:** position, walk target, wander; events `moved`, `action`, `wander`, `manual`. Each tick: a source that drives the position (an XR pose, GPS) wins, then the first source with a move intent (which cancels the target), then the target, then wander.
- **Sources:** `keyboardSource` (WASD / arrows, gamepad stick and d-pad; Space, T and 1–9 as actions; ignores typing in form fields), `pointerSource` (press to walk there, drag to steer, tap to select; or `mode: "explore"`: drag pans the view through `onOrbit`, tap selects, long press or right-click sends `point`), `ListenerInput.travelTo` (Move: an eased glide along the space's own path, great circles on the globe; `travelSeconds` picks the time), `geolocationSource` (follows the device; stops on a hand move), `poseSource` (a WebXR or other tracked pose).
- Music Beacon XR (`app.js`) and the AR page (`ar.js`) both walk through it. Tests: `web/tests/input.test.mjs`.

## Sound: SynthKit

The songs play on SynthKit's own instruments through its web module (`addons/synthkit/web/`, the same C++ engine as the Godot app compiled to WebAssembly), with Prism on keys, lead and a pad, like the app. The songs' part levels are mixed for SynthKit (`MIX` in `src/song.js`; `KIT_GAIN_DB` and `PAD_MIX` in `src/kit/kitplayer.js` and `scripts/beacon/beacon_player.gd`). The **Sound** menu can still switch to the **Old browser synths** (`src/synths.js`) for comparing until they're retired; they no longer match the mix. `?synth=kit` or `?synth=web` in the address picks one too, and the choice is remembered. There's no fallback: if SynthKit can't load, Start says why.

- `src/kit/kitplayer.js` is the browser twin of `scripts/beacon/beacon_player.gd`: the same instrument and base preset per part, and the pad. Phones get Prism's light voices.
- `src/kit/parammap.js` is a port of `scripts/beacon/param_map.gd`. `web/tests/kit.test.mjs` checks it against the app's own output (`tests/fixtures/param_map.json`; after changing `param_map.gd`, re-run `godot --headless --path . -s res://tests/dump_param_map.gd`), and plays every part of every grid song through the web engine under the same shrillness limits as `tools/tone_check.gd`.
- Not yet in SynthKit mode, as in the app: song automation, and the browser's drive and chorus channels. The Synths page and the Instrument Table still use the browser synths.
- `web/serve.py` and `web/tools/build_site.py` serve SynthKit's engine files and factory presets under `synthkit/`.

## Synths page

`synths.html` (the **Synths ↗** button in Music Beacon XR's header) has a front panel for each of the six instruments: every sound control, an on-screen keyboard (or drum pads for Pulsar), a computer-keyboard row (A W S E D F T G Y H U J K; Z and X change octave), a 4-bar demo loop with tempo, a waveform scope, and Reset, Random, Copy JSON and Paste JSON. Link straight to one with `synths.html#Lumen` (or any instrument name).

- **Presets:** 20 factory presets per instrument (`src/presets.js`), in a picker under the instrument's name with ◀ ▶ to step through them. **Save as…** keeps your own presets in this browser (they appear under "Yours"); **Delete** removes one of yours. Any change shows the sound as "(edited)".
- **Automation:** the ∿ button beside a control animates it. Pick a shape (sine, triangle, saw up, saw down, square, random steps, drift), how long one cycle takes (1/4 bar to 32 bars) and how far it swings (a share of the control's range; frequencies swing evenly in octaves). Animations follow the tempo; an animated control shows its live value and a marker on its slider. Every continuous control can be animated: filters, resonance, envelopes, detune, levels, FM depths, LFOs, drum tunes and decays, sends, chorus and drive. Steps (semitones, octaves, FM ratios), choices and glide times can't.
- **Glide:** Undertow and Comet slide between notes; Lumen slides each voice of a chord to the next chord; Tangle slides its drone to the next note.
- **Random** starts from a random preset, moves every control somewhere new and sometimes animates one or two of them.

- It uses the same instrument code as the field (`src/synths.js`), so a sound made here plays the same in a song. Copy JSON gives `{instrument, params}`; the `params` block drops into a song track.
- In Music Beacon XR, click an instrument's name under **Instruments** to open it on the Synths page with the sound it's playing right then (the current blend).
- Each instrument's settings are kept in the browser (localStorage) until you reset them.
- The Godot versions of the panels (the real C++ SynthKit engine, with presets and a sequencer) are in `scenes/studio.tscn`: open it in Godot and press F6.

## How it works

| Piece | File | What it does |
|---|---|---|
| My beacons | `src/drafts.js`, `src/draftsui.js`, `src/draftstore.js` | Your own grids, planted songs and custom maps on the Globe tab, kept on this device, crossfaded with the globe. |
| Beacon fields | `src/beacons.js` | The 5×5 test grid (100 m apart), the globe (a beacon every 10°, 614 in all, great-circle distance) and the local grid (1 to 100 km a side around you, a beacon every 10 m to 100 km). All have the same shape, so swapping one for the other changes nothing else. |
| Weights | `src/beacons.js` → `weigh()` | The 3 closest beacons, each weighted `(1/d − 1/d4)^sharpness`, normalized. A beacon fades to exactly 0 as it swaps with the 4th closest, so the music never jumps. Standing on a beacon gives it 100%. |
| Songs | `src/song.js` | The song format (below), music theory helpers, and a seeded generator that gives every beacon its own song (mood, key, tempo, chords, six parts, and a 2 to 5 minute form). |
| Song form | `src/form.js` | Sections (intro, verse, pre-chorus, chorus, bridge, breakdown, outro), where each song is on the shared clock, and how each section shapes the arrangement. |
| Blending | `src/mixer.js` | Per instrument: level = sum of weight × the song's level. Numeric sound parameters are averaged by each song's share (log scale for frequencies), clamped to the song's morph range. Each 16th step, each part takes its notes from one song, picked with odds equal to its share. Patterns are written in scale degrees, so any song's part plays in the current key. |
| Harmony | `src/mixer.js` → `Harmony` | The strongest song sets key, chords (from its current section) and phrase position. It changes only on a bar line, and only when another song leads by the "key change margin" (default 8%). |
| Tempo | `src/mixer.js` → `targetTempo()` | Heads for the weighted average of the songs' tempos, gliding a set fraction per bar. |
| Audio | `src/engine.js`, `src/synths.js` | A look-ahead scheduler (25 ms tick, 120 ms ahead) plays the steps sample-accurately on Web Audio versions of the six SynthKit instruments. |
| UI | `index.html`, `src/app.js` | Map, listener, readouts, beacon song inspector, song import/export. |
| Synths page | `synths.html`, `src/synthpage.js` | A front panel, keyboard and demo loop for each instrument. |
| Instrument Table | `play.html`, `src/play.js`, `src/play/` | 3D instruments played by hand (mouse, touch, WebXR), patchable to any knob. |

The browser instruments are ports of the SynthKit designs, not the C++ engine itself:

| Role | Instrument | Browser version |
|---|---|---|
| Drums | Pulsar | Kick (tune, punch, decay), snare (tone, snap, decay), closed and open hat, clap (tone, decay), from oscillators and noise, with drive |
| Bass | Undertow | Two detuned oscillators plus a sub (three waves) into a two-stage low-pass with filter envelope, attack, drive and glide |
| Keys | Lumen | Polyphonic, two drifting oscillators per note (separate waves, second one an octave up or down), filter envelope, chord glide, chorus and reverb |
| Lead | Comet | Two oscillators (second one tuned in semitones, with its own wave and level), filter envelope, fade-in vibrato, glide, drive, tempo-synced delay |
| Pluck | Driftwood | Karplus-Strong string (plain, steel, nylon), or modal marimba, kalimba, vibes, glass and bell, through a resonant body filter with an attack click |
| Texture | Tangle | A carrier (four waves) with two FM modulators, an LFO on the first modulator's depth, glide and a resonant low-pass (the modular as one patch) |

## Song families and borrowed chords (generator v2)

The generator was reshaped by six reference songs studied with `tools/analyze.py` (warm chord-rich songs, drone journeys, an ambient piece, a downtempo groove). Every song now belongs to a **family**, shown in the Beacon song panel, and each mood leans towards some of them:

| Family | Tempo | Harmony | Beat and bass | Shape |
|---|---|---|---|---|
| Song | the mood's | the mode's progressions, half the time with borrowed chords | the classic styles | verses, choruses, a bridge |
| Journey | 120–132 | one chord or a slow two-chord sway | four-on-the-floor, off-beat open hats, a rolling 16th bass | builds from a lone pad to a big peak, a deep drop, and back |
| Ambient | 64–92 | gentle, sometimes borrowed | usually none; at most a soft kick heartbeat; rare long bass notes | long pads, no chorus |
| Groove | 104–122 | minor 4-bar loops, often borrowed | a busy syncopated kick with ghosted snares, a held sub-bass | the beat, bass and synth bed stay on; tops come and go |

**Borrowed chords:** a progression entry can be `{ "d": 6, "m": "mixolydian" }`, degree d of mode m on the key's root (here B♭ in C major, ♭VII). The generator uses ♭VII, ♭III, iv, v, ♭VI and II in major keys, and IV and V in minor ones; melodies over a borrowed chord follow its scale, the readouts name it (♭VII), and the song editor's chord picker offers them.

## Presets matched to reference songs

`node web/tools/match_presets.mjs` builds presets that copy sounds measured in the reference songs: it plays candidate settings through SynthKit's own engine (the WebAssembly build, as the website and app play songs), measures brightness, tone balance and attack and decay the way `tools/analyze.py` measures a song's parts, and searches until they match. Every result must pass the "never shrill" limit for its part. The results (`src/presets_matched.js`, generated) join the factory presets, so the song generator picks them too:

| Preset | Part | Matched to | How close |
|---|---|---|---|
| Round Low | bass (8') | Sowing the Seeds of Love, Woman in Chains | tone balance and attack match; slightly longer decay |
| Sub Hold | bass | Stoned | close |
| Rolling Low | bass (8') | Shpongle, The Aquatic Garden | very close |
| Wide Warm Pad | keys | Sowing, Woman in Chains, Pier (pads) | close |
| Downtempo Bed | keys | Stoned (synth bed) | close |
| Choir Haze | keys | Pier (choir-like layer) | close, a little darker |
| Clean Strum | pluck | Sowing, Woman in Chains (guitar) | darker than the guitars: Driftwood's brightness is at its maximum, so it's the mellow version |
| Psy Arp | lead | Shpongle (arps) | very close |

Along the way: bass presets gained an **octave** choice (Undertow's oscillators sit at 16', an octave under the note; 8' plays the note itself, as the reference basses do); bass attack and release and lead attack now reach SynthKit (Undertow's loudness contour; Prism's envelope, at least 20 ms); the lead stops at D6 (higher notes fold down an octave); and the factory lead "Sync Scream" was tamed. All keep every part of every song under the "never shrill" limits on both platforms.

## Song structure

Every generated song is a full song, 2 to 5 minutes long, with a form such as intro, verse, chorus, verse, chorus, bridge, chorus, outro (four templates, some with a pre-chorus, a breakdown or a double last chorus). Sections are 4, 8 or 16 bars, fitted so the whole song lands between 2:00 and 5:00.

- **A shared clock.** Each beacon "broadcasts" its song: where a song is comes from the time of day and the song itself, so everyone at a beacon hears the same section, and the song carries on while nobody is there. Songs move on at bar lines.
- **What changes by section**, following common arranging practice (chorus as the high point, the bridge as contrast, energy built by adding and removing layers, tension rising before a lift, repetition with variation):
  - which parts play: no fixed rule. Each song uses its own palette of 2 to 6 instruments, and every section, each repeat included, gets its own lineup from it. An intro can open with one instrument or all six; a chorus can be stripped back; a breakdown can be a single part. The generator only leans: choruses tend to be fuller, breakdowns sparser, repeats usually echo the earlier section with one part swapped, the last chorus usually has everything, and sometimes a part comes in partway through a section. Most outros fade out; some just stop;
  - chords: verse, pre-chorus, chorus and bridge each have their own progression;
  - material: choruses and the outro play each part's chorus patterns (busier drums, a lead hook every bar, more rhythmic keys); other sections play the verse patterns;
  - energy: filters open up in choruses and close down in quiet sections; low energy thins the hats and drops kick, open hats, claps and ghost notes;
  - drums: a snare fill leads into a bigger section, a crash marks the top of each chorus, the bridge can be half time or have no drums;
  - the last chorus is the biggest, with the lead an octave up.
- **Readouts.** Now playing shows the leading song's section and bar. Each row in The blend shows its song's section, bar, time (for example 1:42 / 3:36), energy, and a strip of its form with a playhead. The beacon inspector shows the length, bar count, each section's chords and a labelled form strip.
- **Editing.** The song editor has a Form field (`intro 8, verse 16, chorus 8, ...`; clear it to make the song one loop; sections that stay keep their lineups), an **Arrangement** grid (sections down, parts across; click a cell to turn that part on or off in that section, ↗ marks a part that comes in partway), a chord picker per section, and Verse and Chorus material for every part's patterns.

## Making and sharing songs

- **Edit song** opens an editor for the selected beacon: title, mood, key, mode, tempo, the four chords, and for each part its level, a few sound controls and a 16-step grid per bar. Changes play right away.
- **Copy JSON** / **Paste JSON** move songs in and out as text. The page checks pasted songs with `validateSong()` before loading them.
- **Share with everyone** (published page only) saves the song to the page's shared store at `songs/<field>-<beacon id>`. Everyone who opens the page then hears it on that beacon, live. By default people with Contributor access or above can share; viewers only listen. **Remove shared song** puts the beacon back to its generated song.

## Song format (version 2)

```json
{
  "format": "beacon-song",
  "version": 2,
  "title": "Velvet Hollow",
  "author": "generator",
  "mood": "Glow",
  "key": { "root": 6, "mode": "major" },
  "bpm": 92,
  "bars": 4,
  "steps": 16,
  "progression": [0, 4, 5, 3],
  "tracks": {
    "bass": {
      "instrument": "Undertow",
      "level": 0.8,
      "params": { "filter.cutoff": 600, "filter.emphasis": 4 },
      "pattern": [[{ "d": 0, "o": 0, "v": 0.9, "g": 2 }, null, "...16 steps"], "...one entry per bar"]
    }
  },
  "morph": { "bass": { "filter.cutoff": [120, 3000] } },
  "form": [{ "section": "intro", "bars": 8 }, { "section": "verse", "bars": 16 }, { "section": "chorus", "bars": 8 }, "..."],
  "sections": { "chorus": { "progression": [5, 3, 0, 4] }, "bridge": { "progression": [3, 4, 5, 4], "layers": { "drums": 0 } } }
}
```

- `key.root` is 0–11 (0 = C). Modes: `major`, `minor`, `dorian`, `mixolydian`, `lydian`, `phrygian`, `harmonicMinor`.
- `progression` holds one scale degree per bar, 0-based (0 = I, 4 = V).
- Roles: `drums`, `bass`, `keys`, `lead`, `pluck`, `texture`. `level` 0 leaves the role out.
- Melodic steps are `null` (rest) or `{d, o, v, g}`: scale degree above the chord root, octave offset, velocity 0–1, gate in steps. Key steps are `{v, g}` and play the whole chord.
- Drums: `{kick, snare, hat, open, clap}`, each 16 velocities (0 = no hit).
- `morph` sets how far blending may push each parameter while this song leads a part.
- `form` lists the sections in order: `intro`, `verse`, `pre`, `chorus`, `bridge`, `break` or `outro`, each 1 to 64 bars. An entry can carry its own `layers` (0 to 1 per part, the lineup for that one section) and `enter` (part → how far through the section it comes in, e.g. `{ "bass": 0.5 }`).
- `sections` overrides what a kind of section does: `progression`, `energy` (relative to the song's), `layers` (0 to 1 per part, used where a form entry has none), `material` (`"A"` verse patterns or `"B"` chorus patterns), `feel` (`"half"`) and `fade` (outro fades out). Anything left out uses the defaults in `src/form.js`.
- Each track's `patternB` is its chorus material, in the same shape as `pattern`.
- A track's `automation` animates its params: `{ "filter.cutoff": { "shape": "sine", "bars": 4, "depth": 0.4, "phase": 0 } }` (see `src/params.js` for what can be animated). When songs blend, each part's automation comes from the song loudest in that part. `preset` names the factory preset a generated sound started from.
- Generated songs pick each part's sound from the presets that suit the song's energy, nudge every setting by up to 12% of its range, and often animate one or two more controls, so no two beacons sound alike.
- Version 1 songs (no form) still work: they play as one 4-bar loop. The Godot player accepts version 2 and plays the verse material as a loop.

## Known limits

- **The old browser synths aren't the C++ engine.** The default sound, SynthKit, is the app's own engine compiled to WebAssembly; the **Old browser synths** in the Sound menu are Web Audio copies kept for comparing, and they no longer match the mix.
- **Animation pauses in background tabs.** The music keeps playing, but the listener only moves (and a followed flight only updates on screen) while the page is visible.
- **No GPS on the Claude-published copy** (the platform doesn't offer location to pages). The public site, https://sterlingy.github.io/MusicBeaconXR/, is HTTPS, so location works there anywhere; so does `serve.py` on your own network.
- **Walk exports play in real time.** Exporting a 10-minute walk takes 10 minutes.
- **Flight data is shared and limited.** adsb.lol's free tier is 500 requests a day for the database's one address (a few hours of following in total) unless a key is added.
- **Sign-in needs the project's email settings** (see [supabase/README.md](../supabase/README.md)): until then, sign-in emails only reach the project team.
- **The app plays the local grid too,** with the same songs (its own copy of the generator, checked against this one), but not yet song forms or automation.
