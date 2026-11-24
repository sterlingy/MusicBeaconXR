class_name MusicInput
extends Node
## The hub of MusicInputKit: playable objects send notes and moves here, and
## whatever makes the sound listens to the signals. It doesn't know about any
## synth, so apps without SynthKit can use the objects too (send the signals to
## MIDI, a network, a sampler...).
##
## Notes belong to a `part` ("keys", "lead", "drums"...): the host decides which
## instrument plays each part. Continuous notes (the orb, the ribbon) bend away
## from the note they started on; `note_bend` gives the offset in semitones.
##
## Put the MusicInput in the tree and the objects find it through the
## "music_input" group (or set Playable.kit yourself).

signal note_on(part: String, voice: int, note: int, velocity: float)
signal note_off(part: String, voice: int, note: int)
## Offset from the voice's note, in semitones (continuous objects).
signal note_bend(part: String, voice: int, semitones: float)
## A patched source moved a knob: value is 0..1 of the knob's range.
signal control(part: String, param: String, value: float)
## Any source moved (patched or not), 0..1. Good for UI meters.
signal source_moved(source: String, value: float)
## Something that isn't a note or a knob: "lock" (on/off), "pressed" names...
signal action(name: String, arg: Variant)

## Beyond this bend the voice restarts on the nearer note (synths bend ±12).
const MAX_BEND := 11.5

var scale := ScaleLock.new()
var patches := PatchBay.new()
## Lowest note for objects laid out in steps (bars, strings, blocks).
var base_note := 60
var _voices := {} # id -> {part, note, pitch}
var _next_voice := 1
var _last_source := {} # source -> last value


func _init() -> void:
	add_to_group("music_input")


## Starts a note. `pitch` may be fractional: with the lock on it snaps to the
## scale; with it off a fractional pitch sounds as a bend. `snap` false skips
## the scale (drum notes). Returns the voice id.
func start_note(part: String, pitch: float, velocity: float, snap := true) -> int:
	var p := scale.quantize(pitch) if snap else pitch
	var n := roundi(p)
	var id := _next_voice
	_next_voice += 1
	_voices[id] = {"part": part, "note": n, "pitch": p}
	note_on.emit(part, id, n, clampf(velocity, 0.01, 1.0))
	if absf(p - n) > 1e-3:
		note_bend.emit(part, id, p - n)
	return id


## Moves a held continuous voice to a new pitch (snapped while the lock is on).
func move_note(voice: int, pitch: float) -> void:
	if not _voices.has(voice):
		return
	var v: Dictionary = _voices[voice]
	var p := scale.quantize(pitch)
	if absf(p - v.pitch) < 1e-4:
		return
	v.pitch = p
	var off: float = p - v.note
	if absf(off) > MAX_BEND:
		# Too far to bend: hand over to a fresh note (legato) at the new pitch.
		note_off.emit(v.part, voice, v.note)
		v.note = roundi(p)
		note_on.emit(v.part, voice, v.note, 0.7)
		off = p - v.note
	note_bend.emit(v.part, voice, off)


func end_note(voice: int) -> void:
	if not _voices.has(voice):
		return
	var v: Dictionary = _voices[voice]
	_voices.erase(voice)
	note_off.emit(v.part, voice, v.note)


func end_all() -> void:
	for id in _voices.keys():
		end_note(id)


func is_sounding(voice: int) -> bool:
	return _voices.has(voice)


func voice_pitch(voice: int) -> float:
	return _voices[voice].pitch if _voices.has(voice) else NAN


## Plays a short note (strikes, plucks): note on now, note off after `length` seconds.
func strike(part: String, pitch: float, velocity: float, length := 0.25, snap := true) -> int:
	var id := start_note(part, pitch, velocity, snap)
	if is_inside_tree():
		get_tree().create_timer(length).timeout.connect(end_note.bind(id))
	return id


## An object's moving part moved: tells listeners and turns every patch on it.
func send(source: String, value: float) -> void:
	value = clampf(value, 0.0, 1.0)
	if _last_source.get(source, -1.0) == value:
		return
	_last_source[source] = value
	source_moved.emit(source, value)
	for r in patches.route(source, value):
		control.emit(r.part, r.param, r.value)


## Turns a knob directly (0..1 of its range), without a patch. For objects whose
## touch always shapes their own sound, like where you hit a drum pad.
func set_knob(part: String, param: String, value: float) -> void:
	control.emit(part, param, clampf(value, 0.0, 1.0))


func last_value(source: String, default := 0.0) -> float:
	return _last_source.get(source, default)


## Re-sends every source's last value (after patches change, so knobs catch up).
func resend() -> void:
	for s in _last_source:
		for r in patches.route(s, _last_source[s]):
			control.emit(r.part, r.param, r.value)


func send_action(name: String, arg: Variant = null) -> void:
	if name == "lock":
		scale.enabled = bool(arg) if arg != null else not scale.enabled
		arg = scale.enabled
	action.emit(name, arg)
