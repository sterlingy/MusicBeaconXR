# MusicInputKit

3D objects you play: strike, pluck, slide, twist, tilt and spin them to make notes
and shape the sound. Works with the mouse, touch screens (several fingers at
once) and OpenXR hands or controllers. No SynthKit inside: the objects send
notes and knob moves to a hub, and the app decides what makes the sound.
SynthKit is one option (`scripts/play/synth_bridge.gd`); MIDI out, a sampler or
a network session are others.

Try it: `godot --path . res://scenes/instrument_table.tscn` (add `--xr-mode on`
with a headset connected). From the beacon field press **I**; in the XR field
press the left stick.

## Objects

**Notes**

| Object | Play it | Shapes the sound with |
|---|---|---|
| `ChimeBars` | Strike a bar; sweep across for a glissando. Hit harder for louder. | Where along the bar you hit (`spot`). |
| `LightStrings` | Touch a string to pluck; sweep across to strum. | Pull the string to bend it up (`pull`). |
| `ThereminOrb` | Hand in the field: left to right is pitch over two octaves. | Height (`height`), near to far (`depth`). |
| `PitchRibbon` | Press and slide: a continuous glide, wiggle for vibrato. | Across the width (`across`), press depth in XR (`press`). |
| `DrumPads` | Hit a pad (eight drum voices). | Centre is darker, rim is brighter: sets that voice's tone. |
| `ChordBlocks` | Touch a block to hold its chord (I, ii, iii... of the key). | Lift your hand above it (`lift`). |
| `MusicBoxWheel` | Tap to place pegs, flick to spin; pegs play as they pass the comb. | Spin speed (`speed`). |

**Shaping** (no notes of their own; patch them to any knob)

| Object | Move it | Sends |
|---|---|---|
| `TwistDial` | Drag around it, mouse wheel, or grip and twist your wrist. | `turn` |
| `SlideFader` | Slide the cap. With `spring_back` it's a lever that returns to rest: patch it to `@bend` for a whammy bar. | `slide` |
| `XYPad` | Slide the puck. | `x`, `y` |
| `Flywheel` | Flick it; it slows down by itself. Touch to brake. | `speed` |
| `TiltCube` | Grip and tilt it (XR follows your hand), or drag it. | `pitch`, `roll` |
| `ScaleSwitch` | Buttons: LOCK on/off, KEY up a semitone, next SCALE. | (changes the scale lock) |

## Pieces

- `MusicInput` (the hub, a Node in group `music_input`):
  - **Signals**
    - `note_on(part, voice, note, velocity)`
    - `note_off(part, voice, note)`
    - `note_bend(part, voice, semitones)`
    - `control(part, param, value 0..1)`
    - `source_moved(source, value)`
    - `action(name, arg)`
  - **Methods**: `start_note`, `move_note`, `end_note`, `strike`, `send(source, value)`, `set_knob`, `send_action("lock")`.
  - **Part**: a role such as "keys", "lead" or "drums". The host maps each part to an instrument.
- `ScaleLock` (`kit.scale`): the key and scale, and the on/off toggle for keeping notes in key.
  - **Lock on**: pitches snap to the scale, bars, strings and blocks step through the scale, and the orb and ribbon move in steps.
  - **Lock off**: everything is chromatic, and the orb and ribbon slide freely.
  - Scales: major, minor, dorian, mixolydian, phrygian, harmonic minor, major and minor pentatonic, blues.
- `PatchBay` (`kit.patches`): connects sources to knobs.
  - A source is an object's moving part, named `<node name>.<what>`, for example `Dial.turn`.
  - A target is a part plus a parameter id, with a lo..hi window inside the knob's range.
  - One source can feed several knobs.
  - Patches save to an array with `to_array()` and load with `from_array()`.
  - `cycle()` steps a source through a list of targets, which suits a headset button.
- `Playable`: the base class for the objects. It has a touchable `box` in the object's own space.
  - Drivers call `hand_down`, `hand_move`, `hand_up` and `wheel`.
  - `drag_plane()` sets which plane a pointer drags on after pressing the object.
  - In a subclass, `declare(what, label, part, param, lo, hi)` names a source and patches it by default, unless a saved layout already patched it.
- `PlayHand`: one mouse, finger or controller. It carries:
  - position, velocity and an aim ray
  - pressed, grip and squeeze
  - basis (orientation)
  - `pulse()` for haptics
  - `strike_strength()`, which in XR comes from hand speed into the surface
- `PlayPointer`: the mouse and multi-touch driver. It ray-picks objects from a camera and drags on each object's plane, ignoring Godot's emulated mouse and touch duplicates.
- `PlayXRHands`: the XR driver.
  - Each controller's tip touches objects; hand speed sets velocity.
  - Grip holds on, for twisting and tilting.
  - The trigger plays objects out of reach by pointing.
  - Haptics fire on hits.

## A new object in five lines

```gdscript
class_name Cowbell extends Playable
func _build(): box = AABB(Vector3(-0.05, 0, -0.05), Vector3(0.1, 0.1, 0.1)); add_box(box.size, tint, Vector3(0, 0.05, 0))
func hand_down(h): kit.strike(part, 56, h.strike_strength(Vector3.UP), 0.1, false)
```

## Using it without SynthKit

```gdscript
var kit := MusicInput.new()
add_child(kit)
kit.note_on.connect(func(part, voice, note, vel): my_sampler.play(note, vel))
kit.control.connect(func(part, param, v): my_mixer.set(param, v))
var bars := ChimeBars.new(); add_child(bars)
var ptr := PlayPointer.new(); ptr.camera = $Camera3D; add_child(ptr)
```

The browser twin lives in `web/src/play/` (same objects, names and rules).

Test: `godot --headless --path . res://tests/music_input_check.tscn`
