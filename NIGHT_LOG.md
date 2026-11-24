# Night log: 2026-11-23 → 24 (branch `input-kits`)

You asked for everything I could build without you, on as many platforms as possible, including WebAR and OpenXR. All of it is on the local branch `input-kits` (from `beacon-field-updates`), one commit per milestone. Nothing is pushed or merged.

## What's new

1. **ListenerKit for Godot** (`addons/listener_kit/`). Listener position plus the ways to move it: keyboard and gamepad, click / tap / drag / pinch, wander, scripted jumps, OpenXR. Planar and geo spaces. No SynthKit dependency. The grid and globe scenes walk through it; the globe gains click-to-go and gamepad.
2. **ListenerKit for the browser** (`web/src/input/listener.js`). Same names and rules: keyboard and gamepad, pointer, geolocation and pose sources. Beacon Field (`app.js`) uses it; gamepads now work there.
3. **OpenXR** (`scenes/xr_field.tscn`, `XRLocomotionSource`). Room-scale listener, left-stick glide, right-stick snap turn, trigger to walk where you point, grip for life size / tabletop, A/X play, B/Y auto-walk, wrist panel, and passthrough on the left menu button where supported. Falls back to the flat view without a headset.
4. **Export presets** (`export_presets.template.cfg`): Windows, Windows VR (OpenXR), Quest (OpenXR), Android phone. OpenXR turns on only for the `pcvr` and `quest` feature tags. App icon added.
5. **WebXR** (`web/ar.html`). AR on your floor (hit-test placement, 1:1 to 1:200 scales), VR, and a first-person preview for screens. Dependency-free WebGL. Linked from the main page header.
6. **Phones**: pinch zoom and landscape / stretch settings in Godot; web app manifest + icon so phones can install the web app.
7. **Docs**: README (platform table, new folders, known gaps), web/README (AR/VR page, ListenerKit, install, gamepads), addons/listener_kit/README.

## Verified here

- `node --test web/tests`: 48 pass (13 new: spaces, priority, wander bounds, keyboard, geolocation, AR placement).
- `tests/listener_check.tscn` (new): spaces, targets, wander, priority, and the XR locomotion logic without a headset. `beacon_check` still passes.
- Grid, globe and XR scenes run and screenshot correctly; `--fake-xr` shows the XR rig (hands, laser, panel, tabletop scale).
- Windows and Windows VR builds export and run. The VR build asks for OpenXR and, with no headset connected, falls back to the flat view.
- Quest and Android phone APKs export (about 30 MB, debug-signed).
- In the browser: keys, click-to-go, tap-to-select, auto-walk, globe and local walking through the kit; AR page preview renders and walks; manifest served. No console errors.

## Not verified (needs hardware)

- A real OpenXR headset (PC VR or Quest): controller bindings, comfort, passthrough.
- WebXR sessions on a phone or headset: AR hit-test, VR controllers, DOM overlay.
- The Android phone APK on a device.

## Needs you

- **Quest standalone.** The plain APK has no OpenXR loader or Quest manifest entries, so it won't start in XR on the headset. Fix: copy `addons/godotopenxrvendors` (SolfegeXR has it, about 50 MB), install the Android build template (`android/`, about 210 MB), and enable gradle build and the Meta plugin in the Quest preset. That's a lot of binaries for the repo, and the gradle build downloads dependencies, so I left it for you to decide.
- **Published artifact** (https://claude.ai/artifact/FjUKz2qaULZhrvxKuq7EbN) still has the old web app. It needs `src/input/listener.js` (and `ar.html` if you want AR there) before it can be republished. I didn't republish anything.
- **User manual.** Its source is the Claude Docs artifact, so I didn't edit it. It needs sections for AR / VR, gamepads and installing on a phone.
- **Package names** in the Android presets are placeholders (`org.musicbeacon.xr`, `org.musicbeacon.app`).
- **Port 8765** was taken by another session's server tonight, so I added a `beacon-field-alt` launch config on 8777.

## Ideas for next

- A local-grid AR mode outdoors: GPS-follow at 1:1, with the beacons drawn around you.
- A globe in XR (stand on a 1 m globe, walk across continents).
- Godot GPS on Android (needs a plugin) so the Godot app can follow real location.
