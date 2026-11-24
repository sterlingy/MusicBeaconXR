# Beacon Field (browser)

The test playfield for MusicBeaconXR. You walk a listener between music beacons; the three closest beacons' songs blend into one live track. Everything runs in the browser with Web Audio, with no samples and no server.

- **Published page:** https://claude.ai/artifact/FjUKz2qaULZhrvxKuq7EbN (private to you until you share it)
- **User manual:** [manual.html](manual.html), served with the page (the **Manual ↗** button). It is built from the Claude Docs source (https://claude.ai/artifact/1MCvFAJCSEtb4kNtWKFcrr) with `python web/tools/build-manual.py <doc.xml>`; edit the doc, then rebuild.
- **Run locally:** `python web/serve.py`, then open http://127.0.0.1:8765. Running locally is also the only way to use your location (**My location**, and **Local grid** following you), because published pages can't read GPS.
- **On a phone or tablet:** `python web/serve.py --https`, then open the https address it prints (same Wi-Fi, or ZeroTier). Accept the certificate warning once, tap **Local grid**, and allow location. Phones only share location with HTTPS pages; the certificate is self-signed, made on first run in `web/.cert/` (kept out of git, never served). Tested on iPad Safari: a fix accurate to 15 m. **Android Chrome** also needs **Settings → Apps → Chrome → Permissions → Nearby devices → Allow** to reach this PC's local or ZeroTier address (otherwise it fails with ERR_TOO_MANY_RETRIES), and another VPN, such as VPN by Google, must be off while ZeroTier is used.
- **Screen off:** phones pause web audio when the screen turns off, so while the music plays the page keeps the screen on (Screen Wake Lock: Chrome on Android, Safari on iOS 16.4 and later; HTTPS or localhost only). If the music still stops (another app, a call, locking the phone by hand), it picks up again when you come back to the page. Following your location needs the page on screen anyway.
- **Location problems:** pages from `serve.py` report each location attempt (secure or not, permission state, error, accuracy; never coordinates) to the server's console, so a phone's problem can be read on the PC.
- **Tests:** `node --test web/tests`
- **Install on a phone:** pages from `serve.py` carry a web app manifest (`manifest.webmanifest`, `icon.svg`), so phones offer **Add to Home Screen** / **Install**, with AR / VR and Synths shortcuts.
- **Gamepads:** a connected gamepad walks the listener (left stick or d-pad), A plays, Y toggles auto-walk.
- **Godot song packs:** `node web/tools/export-songs.mjs` rebuilds `songs/grid.json` and `songs/globe.json` from the browser's generator. The Godot player plays each song's verse patterns as a loop and maps only the sound settings it knows; sections, presets' extra controls and automation are browser-only for now.

## Three fields

- **Test grid:** 5×5 beacons, 100 m apart. Drag, tap or use WASD to walk.
- **Globe:** a beacon every 10° of latitude and longitude (614 in all).
- **Local grid:** a square of beacons centered on you. **Local grid, each side** sets the length of each side: 1, 5, 10, 50 (the default) or 100 km. **Beacon every** sets the spacing in kilometers, decimals allowed, from 0.01 km (10 m) to 100 km; the default is 1 km, and it's rounded to the meter. With the defaults that's 51 × 51 = 2,601 beacons; 100 km with a beacon every 5 km is 441. The side is rounded to a whole number of spacings, at least one and at most 150 (151 × 151 = 22,801 beacons). When the spacing is too fine for the chosen side, the grid shrinks to 150 spacings and the page says so: a beacon every 10 m gives a 1.5 km grid. Set both before starting, or change them any time; the page remembers them. It asks for your location, then **Follow me** keeps the listener on your real position as you move. Walking by hand, dragging or Auto-walk turns following off. **Center on me** starts it again. If location isn't available, the grid starts on London, and the city list or typed coordinates move it.
  - All local grids sit on one worldwide 1 m lattice, and each spacing uses every n-th lattice point. So the same street always has the same songs, a beacon keeps its ID and song across sizes, and spacings that line up share beacons (every 2 km beacon is also a 1 km beacon, and every 1 km beacon is also a 250 m one). Songs people share land on the same beacons for everyone. Beacon labels count kilometers from the middle ("3N 2E", "0.01E").
  - The grid centers on the lattice point nearest you (within half a spacing). With an odd number of spacings per side it's centered on the middle of a lattice square instead.
  - Once you travel 40% of the side from the middle (20 km on the 50 km grid, at least 0.6 of a spacing), the grid re-centers on you. The beacons you're near keep their IDs and songs, so the music carries on. A jump somewhere that doesn't overlap the old grid starts fresh.
  - Distances are measured on a flat map of the area, where neighbouring beacons are exactly one spacing apart (under 1% off the true distance over 40 km, about 1% at the edge of a 100 km grid). Columns are measured at the whole degree of latitude nearest the center.
  - **Nearby** shows about 8 spacings around you; **Whole grid** shows all of it. Distances under 1 km show in meters.

## AR and VR page

`ar.html` (the **AR / VR ↗** button) shows the test grid in 3D and lets you walk it with your body.

- **AR** (Chrome on Android, Quest Browser with passthrough): pick a scale, tap **Start AR**. The field is laid out around you with you standing on the listener and the map's north straight ahead. Walk to move between beacons. Tap a spot on the floor to move the field's middle there; **Re-center** lays it out around you again.
- **VR** (Quest Browser, PC VR browsers, Vision Pro): the same in a dark room. Trigger re-centers, grip steps through the scales.
- **Scale:** life size (the grid is 500 m across), or 1:10 to 1:200. 1:50 (the default) fits it in a 10 m room; 1:100 in 5 m.
- **Preview** (any browser, or before starting XR): first person. WASD / arrows walk the way you look, drag to look around, Space plays, T auto-walks.
- WebXR needs a secure page: run `python web/serve.py --https` and open the https address on the phone or headset (localhost also counts as secure on the PC itself).
- No libraries: a small WebGL renderer in `src/ar/gl.js`; placement math in `src/ar/placement.js`.

## ListenerKit (input)

`src/input/listener.js` holds the listener position and every way to move it, with no audio or page code, so other web apps can use it. It mirrors the Godot kit in `addons/listener_kit` (same names and rules).

- **Spaces:** `planarSpace` (meters, the test grid), `localSpace(field)` (a local grid's flat map), `geoSpace` (lat/lon on the globe). A move direction is always (right, forward).
- **ListenerInput:** position, walk target, wander; events `moved`, `action`, `wander`, `manual`. Each tick: a source that drives the position (an XR pose, GPS) wins, then the first source with a move intent (which cancels the target), then the target, then wander.
- **Sources:** `keyboardSource` (WASD / arrows, gamepad stick and d-pad; Space, T and 1–9 as actions; ignores typing in form fields), `pointerSource` (press to walk there, drag to steer, tap to select), `geolocationSource` (follows the device; stops on a hand move), `poseSource` (a WebXR or other tracked pose).
- Beacon Field (`app.js`) and the AR page (`ar.js`) both walk through it. Tests: `web/tests/input.test.mjs`.

## Synths page

`synths.html` (the **Synths ↗** button in Beacon Field's header) has a front panel for each of the six instruments: every sound control, an on-screen keyboard (or drum pads for Pulsar), a computer-keyboard row (A W S E D F T G Y H U J K; Z and X change octave), a 4-bar demo loop with tempo, a waveform scope, and Reset, Random, Copy JSON and Paste JSON. Link straight to one with `synths.html#Lumen` (or any instrument name).

- **Presets:** 20 factory presets per instrument (`src/presets.js`), in a picker under the instrument's name with ◀ ▶ to step through them. **Save as…** keeps your own presets in this browser (they appear under "Yours"); **Delete** removes one of yours. Any change shows the sound as "(edited)".
- **Automation:** the ∿ button beside a control animates it. Pick a shape (sine, triangle, saw up, saw down, square, random steps, drift), how long one cycle takes (1/4 bar to 32 bars) and how far it swings (a share of the control's range; frequencies swing evenly in octaves). Animations follow the tempo; an animated control shows its live value and a marker on its slider. Every continuous control can be animated: filters, resonance, envelopes, detune, levels, FM depths, LFOs, drum tunes and decays, sends, chorus and drive. Steps (semitones, octaves, FM ratios), choices and glide times can't.
- **Glide:** Undertow and Comet slide between notes; Lumen slides each voice of a chord to the next chord; Tangle slides its drone to the next note.
- **Random** starts from a random preset, moves every control somewhere new and sometimes animates one or two of them.

- It uses the same instrument code as the field (`src/synths.js`), so a sound made here plays the same in a song. Copy JSON gives `{instrument, params}`; the `params` block drops into a song track.
- In Beacon Field, click an instrument's name under **Instruments** to open it on the Synths page with the sound it's playing right then (the current blend).
- Each instrument's settings are kept in the browser (localStorage) until you reset them.
- The Godot versions of the panels (the real C++ SynthKit engine, with presets and a sequencer) are in `scenes/studio.tscn`: open it in Godot and press F6.

## How it works

| Piece | File | What it does |
|---|---|---|
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

The browser instruments are ports of the SynthKit designs, not the C++ engine itself:

| Role | Instrument | Browser version |
|---|---|---|
| Drums | Pulsar | Kick (tune, punch, decay), snare (tone, snap, decay), closed and open hat, clap (tone, decay), from oscillators and noise, with drive |
| Bass | Undertow | Two detuned oscillators plus a sub (three waves) into a two-stage low-pass with filter envelope, attack, drive and glide |
| Keys | Lumen | Polyphonic, two drifting oscillators per note (separate waves, second one an octave up or down), filter envelope, chord glide, chorus and reverb |
| Lead | Comet | Two oscillators (second one tuned in semitones, with its own wave and level), filter envelope, fade-in vibrato, glide, drive, tempo-synced delay |
| Pluck | Driftwood | Karplus-Strong string (plain, steel, nylon), or modal marimba, kalimba, vibes, glass and bell, through a resonant body filter with an attack click |
| Texture | Tangle | A carrier (four waves) with two FM modulators, an LFO on the first modulator's depth, glide and a resonant low-pass (the modular as one patch) |

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

- **Not the C++ engine.** The browser synths sound like the SynthKit instruments but aren't identical. If one engine has to run in both places, it would need a WebAssembly build of `jamcore`, and that needs the engine source.
- **Animation pauses in background tabs.** The music keeps playing, but the listener only moves while the page is visible.
- **No GPS on the published page** (the platform doesn't offer location to pages). Use the city list or type coordinates, or run it locally.
- **Away from home, the phone needs another way in.** `serve.py --https` is reachable on your own network or ZeroTier. Anywhere else needs the page hosted on a public HTTPS address.
- **Local grid is browser-only for now.** The Godot player has the test grid and the globe.
