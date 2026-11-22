# Beacon Field (browser)

The test playfield for MusicBeaconXR. You walk a listener between music beacons; the three closest beacons' songs blend into one live track. Everything runs in the browser with Web Audio, with no samples and no server.

- **Published page:** https://claude.ai/artifact/FjUKz2qaULZhrvxKuq7EbN (private to you until you share it)
- **Run locally:** `python web/serve.py`, then open http://127.0.0.1:8765. Running locally is also the only way to use **My location**, because published pages can't read GPS.
- **Tests:** `node --test web/tests`

## How it works

| Piece | File | What it does |
|---|---|---|
| Beacon fields | `src/beacons.js` | The 5×5 test grid (100 m apart) and the globe (a beacon every 10°, 614 in all, great-circle distance). Both have the same shape, so swapping one for the other changes nothing else. |
| Weights | `src/beacons.js` → `weigh()` | The 3 closest beacons, each weighted `(1/d − 1/d4)^sharpness`, normalized. A beacon fades to exactly 0 as it swaps with the 4th closest, so the music never jumps. Standing on a beacon gives it 100%. |
| Songs | `src/song.js` | The song format (below), music theory helpers, and a seeded generator that gives every beacon its own song (mood, key, tempo, chords, six parts). |
| Blending | `src/mixer.js` | Per instrument: level = sum of weight × the song's level. Numeric sound parameters are averaged by each song's share (log scale for frequencies), clamped to the song's morph range. Each 16th step, each part takes its notes from one song, picked with odds equal to its share. Patterns are written in scale degrees, so any song's part plays in the current key. |
| Harmony | `src/mixer.js` → `Harmony` | The strongest song sets key, chords and phrase position. It changes only on a bar line, and only when another song leads by the "key change margin" (default 8%). |
| Tempo | `src/mixer.js` → `targetTempo()` | Heads for the weighted average of the songs' tempos, gliding a set fraction per bar. |
| Audio | `src/engine.js`, `src/synths.js` | A look-ahead scheduler (25 ms tick, 120 ms ahead) plays the steps sample-accurately on Web Audio versions of the six SynthKit instruments. |
| UI | `index.html`, `src/app.js` | Map, listener, readouts, beacon song inspector, song import/export. |

The browser instruments are ports of the SynthKit designs, not the C++ engine itself:

| Role | Instrument | Browser version |
|---|---|---|
| Drums | Pulsar | Kick, snare, closed and open hat, clap from oscillators and noise, with drive |
| Bass | Undertow | Two detuned oscillators plus sub into a two-stage low-pass with filter envelope and glide |
| Keys | Lumen | Polyphonic, two drifting oscillators per note, chorus and reverb |
| Lead | Comet | Two oscillators (second one tuned in semitones), fade-in vibrato, portamento, tempo-synced delay |
| Pluck | Driftwood | Karplus-Strong string, or modal marimba, kalimba and bell |
| Texture | Tangle | An FM patch with an LFO on the modulation depth (the modular as one fixed patch) |

## Making and sharing songs

- **Edit song** opens an editor for the selected beacon: title, mood, key, mode, tempo, the four chords, and for each part its level, a few sound controls and a 16-step grid per bar. Changes play right away.
- **Copy JSON** / **Paste JSON** move songs in and out as text. The page checks pasted songs with `validateSong()` before loading them.
- **Share with everyone** (published page only) saves the song to the page's shared store at `songs/<field>-<beacon id>`. Everyone who opens the page then hears it on that beacon, live. By default people with Contributor access or above can share; viewers only listen. **Remove shared song** puts the beacon back to its generated song.

## Song format (version 1)

```json
{
  "format": "beacon-song",
  "version": 1,
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
  "morph": { "bass": { "filter.cutoff": [120, 3000] } }
}
```

- `key.root` is 0–11 (0 = C). Modes: `major`, `minor`, `dorian`, `mixolydian`, `lydian`, `phrygian`, `harmonicMinor`.
- `progression` holds one scale degree per bar, 0-based (0 = I, 4 = V).
- Roles: `drums`, `bass`, `keys`, `lead`, `pluck`, `texture`. `level` 0 leaves the role out.
- Melodic steps are `null` (rest) or `{d, o, v, g}`: scale degree above the chord root, octave offset, velocity 0–1, gate in steps. Key steps are `{v, g}` and play the whole chord.
- Drums: `{kick, snare, hat, open, clap}`, each 16 velocities (0 = no hit).
- `morph` sets how far blending may push each parameter while this song leads a part.

## Known limits

- **Not the C++ engine.** The browser synths sound like the SynthKit instruments but aren't identical. If one engine has to run in both places, it would need a WebAssembly build of `jamcore`, and that needs the engine source.
- **Animation pauses in background tabs.** The music keeps playing, but the listener only moves while the page is visible.
- **No GPS on the published page** (the platform doesn't offer location to pages). Use the city list or type coordinates, or run it locally.
