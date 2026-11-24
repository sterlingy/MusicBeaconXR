# ListenerKit (Godot)

Where the listener is, and every way to move them. No audio, no SynthKit, no scene assumptions: anything that needs a position (a BeaconPlayer, an AudioListener3D, a minimap, a game character) connects to one signal.

The browser has the same kit in `web/src/input/` with the same names and rules.

## Pieces

| Class | What it does |
|---|---|
| `ListenerSpace` | What a position means and how a step moves it. `planar(bounds)` for meters on a floor, `geo()` for (lon, lat) on a sphere. Move directions are always (right, forward). |
| `ListenerInput` | The listener. Holds `position`, a walk `target`, `wander`; asks its child sources for movement each frame; emits `moved(pos)`, `action(name, arg)` and `wander_changed(on)`. |
| `ListenerSource` | Base class for sources. Return a direction from `move_intent()`, or set `drives_position` and return a position from `driven_position()`. |
| `KeyboardSource` | WASD / arrows / gamepad stick and d-pad walk; Space, T, G, 1–9, wheel and pad buttons send actions. Uses `lk_*` InputMap actions, made on first use, so they can be rebound. |
| `PointerSource` | Click or tap to walk there, drag to steer, tap sends `select`. `ground_picker()` for floors, `sphere_picker()` for globes. |
| `XRLocomotionSource` | OpenXR: the headset's position is the listener; the thumbstick glides, the other stick snap-turns, the trigger ray picks a spot to walk to, grip toggles tabletop scale. See `scenes/xr_field.tscn`. |

## Priority each frame

1. A source with `drives_position` that returns a position (XR head tracking).
2. The first source with a non-zero move intent (keys, stick). This cancels any walk target.
3. The walk target (from a click, tap, trigger ray or `set_target`).
4. Wander.

## Actions

`toggle_play`, `toggle_wander` (also flips `wander`), `switch_scene`, `jump` (arg: 0–8), `zoom` (arg: 0.9 or 1.1), `select` (arg: position), plus anything you send with `send_action()`.

## Use

```gdscript
var li := ListenerInput.new()
li.space = ListenerSpace.planar(Rect2(-250, -250, 500, 500), 55.0)
li.add_child(KeyboardSource.new())
var ptr := PointerSource.new()
ptr.camera = $Camera3D
ptr.pick = PointerSource.ground_picker()
li.add_child(ptr)
add_child(li)
li.moved.connect(player.set_position)
li.action.connect(func(name, arg): if name == "toggle_play": Transport.toggle())
```

Test: `godot --headless --path . res://tests/listener_check.tscn`
