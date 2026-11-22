class_name StepSequencer
extends RefCounted
## A per-instrument step sequencer that plays its InstrumentRig in time with
## the Transport. Each step holds any number of notes (chords for Lumen, drum
## voices for Pulsar), plus gate length, accent and slide.
##
## Step i of the pattern starts at beat  loop * length + i * division
## (+ swing on odd steps), counted from beat 0 of the transport.

signal changed
signal step_played(index: int)

const DIVISIONS := [["1/4", 1.0], ["1/8", 0.5], ["1/16", 0.25], ["1/32", 0.125], ["1/8T", 1.0 / 3.0], ["1/16T", 1.0 / 6.0]]

var rig: InstrumentRig
var enabled := true
var recording := false
var steps := 16
var division := 0.25 # beats per step
var swing := 0.0 # 0..0.5 of a step, applied to odd steps
var gate := 0.5 # default gate for newly set steps (fraction of a step)
var pattern: Array[Dictionary] = []

var _sounding := {} # note -> true (for stop)


func _init(p_rig: InstrumentRig = null) -> void:
	rig = p_rig
	resize(64)
	steps = 16


static func empty_step() -> Dictionary:
	return {"notes": {}, "gate": 0.5, "accent": false, "slide": false}


func resize(n: int) -> void:
	while pattern.size() < n:
		pattern.append(empty_step())


func length_beats() -> float:
	return steps * division


func set_note(step: int, note: int, on: bool, velocity := 0.8) -> void:
	var s: Dictionary = pattern[step]
	if on:
		s.notes[note] = velocity
		if s.notes.size() == 1:
			s.gate = gate
	else:
		s.notes.erase(note)
	changed.emit()


func has_note(step: int, note: int) -> bool:
	return pattern[step].notes.has(note)


func clear() -> void:
	for i in pattern.size():
		pattern[i] = empty_step()
	changed.emit()


func step_beat(loop: int, i: int) -> float:
	var b := loop * length_beats() + i * division
	if i % 2 == 1:
		b += swing * division
	return b


## Which step is under `beat` (for the playhead), or -1.
func step_at(beat: float) -> int:
	if beat < 0.0:
		return -1
	return int(fposmod(beat, length_beats()) / division) % steps


func schedule(from_beat: float, to_beat: float) -> void:
	if not enabled or rig == null:
		return
	var L := length_beats()
	var loop := int(floorf(from_beat / L))
	while loop * L < to_beat:
		for i in steps:
			var b := step_beat(loop, i)
			if b < from_beat or b >= to_beat:
				continue
			_play_step(loop, i, b)
		loop += 1


func _play_step(loop: int, i: int, b: float) -> void:
	var s: Dictionary = pattern[i]
	if s.notes.is_empty():
		return
	var synth := rig.synth
	var on_frame := Transport.frame_for(synth, b)
	var next_i := (i + 1) % steps
	var tie: bool = s.slide and not pattern[next_i].notes.is_empty()
	# A slide holds the note until just after the next step starts (legato).
	var off_beat: float = step_beat(loop + (1 if next_i == 0 else 0), next_i) + 0.01 if tie else b + s.gate * division
	var off_frame := Transport.frame_for(synth, off_beat)
	for note in s.notes:
		var v: float = s.notes[note]
		if s.accent:
			v = minf(1.0, v * 1.3)
		synth.note_on(note, v, on_frame)
		synth.note_off(note, off_frame)
		_sounding[note] = true
	step_played.emit(i)


func transport_stopped() -> void:
	if rig:
		for note in _sounding:
			rig.synth.note_off(note)
	_sounding.clear()


## Records a live note into the pattern at the quantized step.
func record_note(note: int, velocity: float, beat: float) -> void:
	if not recording or beat < 0.0:
		return
	var q := Transport.quantize(beat)
	var i := int(roundf(fposmod(q, length_beats()) / division)) % steps
	set_note(i, note, true, velocity)


func to_dict() -> Dictionary:
	var pat := []
	for i in steps:
		var s: Dictionary = pattern[i]
		var notes := {}
		for n in s.notes:
			notes[str(n)] = s.notes[n]
		pat.append({"notes": notes, "gate": s.gate, "accent": s.accent, "slide": s.slide})
	return {"steps": steps, "division": division, "swing": swing, "enabled": enabled, "pattern": pat}


func from_dict(d: Dictionary) -> void:
	steps = int(d.get("steps", 16))
	division = float(d.get("division", 0.25))
	swing = float(d.get("swing", 0.0))
	enabled = bool(d.get("enabled", true))
	clear()
	var pat: Array = d.get("pattern", [])
	for i in mini(pat.size(), pattern.size()):
		var src: Dictionary = pat[i]
		var notes := {}
		for k in src.get("notes", {}):
			notes[int(k)] = float(src.notes[k])
		pattern[i] = {"notes": notes, "gate": float(src.get("gate", 0.5)), "accent": bool(src.get("accent", false)), "slide": bool(src.get("slide", false))}
	changed.emit()
