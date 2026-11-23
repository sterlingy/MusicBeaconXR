class_name InstrumentRig
extends Node
## One playable instrument: a JamSynth, the player that sounds it, and the
## wiring from MIDI / keyboard / on-screen input. Every note or control the
## player makes goes out through `played`, so apps can add loopers, networking
## or recording on top. Part of the SynthKit addon.
##
## Loopers: set InstrumentRig.looper_factory (a Callable taking the rig and
## returning an object with capture(event), poll(), schedule(from_beat, to_beat)
## and transport_stopped()) before rigs are created; each rig then makes one.
##
## MIDI learn: call learn(param_id), then move a knob on the controller.

signal played(event: Dictionary) # {type: "on"/"off"/"cc"/"bend", ...}
signal instrument_changed(type: String)
signal preset_changed(preset: Dictionary)
signal learn_changed(param_id: String) # "" when learning finished
signal param_changed(id: String, value: float) # from MIDI learn mappings

const COLORS := {
	"Pulsar": Color("ff8a3d"),
	"Undertow": Color("2ec4b6"),
	"Comet": Color("ff4f9a"),
	"Lumen": Color("ffd166"),
	"Driftwood": Color("9ccc65"),
	"Tangle": Color("9b7bff"),
}
const MAP_PATH := "user://midi_map.cfg"

@export var instrument := "Undertow":
	set = set_instrument
## Listen to the Midi autoload (the local player's own instrument).
@export var local_input := true
## Play through an AudioStreamPlayer3D at this node's parent (XR), or flat.
@export var spatial := false
## Driven from outside (e.g. another player's instrument mirrored over a
## network): no local input, no recording.
var remote := false

var synth := JamSynth.new()
var player: Node
var clip_player: Node # plays audio loops (created on first use)
var _clips: JamSynth
var sequencer: StepSequencer
## Made by looper_factory when an app sets one (null otherwise).
var looper: Object
## func(rig: InstrumentRig) -> Object: see the class notes. Empty = no looper.
static var looper_factory := Callable()
var _patterns := {} # instrument type -> sequencer dict (each instrument keeps its own pattern)
var _seq_loaded := false
var _live_shift := {} # note -> frames a live-quantized note was delayed by
var current_preset: Dictionary = {}
var learning := ""

var _map := ConfigFile.new() # [instrument] cc -> param id


func _ready() -> void:
	_map.load(MAP_PATH)
	if spatial:
		var p := AudioStreamPlayer3D.new()
		p.stream = synth
		p.unit_size = 4.0
		player = p
	else:
		var p := AudioStreamPlayer.new()
		p.stream = synth
		player = p
	add_child(player)
	sequencer = StepSequencer.new(self)
	if looper_factory.is_valid():
		looper = looper_factory.call(self)
		played.connect(looper.capture)
	Transport.register(self)
	# Methods, not lambdas: Godot drops these connections when the rig is freed.
	Transport.tempo_changed.connect(_on_tempo)
	synth.tempo = Transport.bpm
	set_instrument(instrument)
	player.play()
	if local_input:
		Midi.note_on.connect(_on_midi_note_on)
		Midi.note_off.connect(release_note.bind(-1))
		Midi.control_change.connect(_on_cc)
		Midi.pitch_bend.connect(bend)
		Midi.pressure.connect(_on_pressure)


func _on_tempo(bpm: float) -> void:
	synth.tempo = bpm
	if _clips:
		_clips.tempo = bpm


func _on_midi_note_on(note: int, velocity: int) -> void:
	play_note(note, velocity / 127.0)


func _on_pressure(value: float) -> void:
	synth.control_change(128, value)
	played.emit({"type": "cc", "cc": 128, "value": value})


func _exit_tree() -> void:
	Transport.unregister(self)


func _process(_delta: float) -> void:
	if looper:
		looper.poll()


## The Clips synth that plays this player's audio loops (made on first use).
func clip_synth() -> JamSynth:
	if _clips == null:
		_clips = JamSynth.new()
		_clips.instrument = "Clips"
		if is_inside_tree():
			var p: Node = AudioStreamPlayer3D.new() if spatial else AudioStreamPlayer.new()
			p.stream = _clips
			add_child(p)
			p.play()
			clip_player = p
			if player:
				p.volume_db = player.volume_db
	return _clips


func has_clips() -> bool:
	return _clips != null


## Volume for everything this player makes here (instrument and audio loops).
func set_volume_db(db: float) -> void:
	player.volume_db = db
	if clip_player:
		clip_player.volume_db = db


func set_instrument(type: String) -> void:
	instrument = type
	if not is_inside_tree():
		return
	synth.all_notes_off()
	if sequencer:
		sequencer.transport_stopped()
		if _seq_loaded:
			_patterns[synth.instrument] = sequencer.to_dict()
		_seq_loaded = true
		if _patterns.has(type):
			sequencer.from_dict(_patterns[type])
		else:
			sequencer.from_dict(DefaultPatterns.for_instrument(type))
	# JamSynth swaps instruments while playing; no need to restart the player.
	synth.instrument = type
	synth.tempo = Transport.bpm
	instrument_changed.emit(type)
	var presets := PresetLibrary.list(type)
	if presets.size() > 0:
		load_preset(presets[0])


func load_preset(preset: Dictionary) -> void:
	if PresetLibrary.apply(synth, preset):
		current_preset = preset
		preset_changed.emit(preset)


func color() -> Color:
	return COLORS.get(instrument, Color.WHITE)


## The beat the player is hearing right now (what they play along to).
func heard_beat() -> float:
	return Transport.beat_at(Transport.now() - AudioServer.get_output_latency())


func play_note(note: int, velocity: float, frame := -1) -> void:
	var beat := heard_beat()
	var quantized := false
	if frame < 0 and Transport.running and Transport.live_quantize and beat >= 0.0:
		var target := Transport.next_grid(beat)
		frame = Transport.frame_for(synth, target)
		_live_shift[note] = frame - synth.get_frame_position()
		beat = target
		quantized = true
	synth.note_on(note, velocity, frame)
	if Transport.running:
		sequencer.record_note(note, velocity, beat)
	played.emit({"type": "on", "note": note, "velocity": velocity, "beat": beat, "quantized": quantized})


func release_note(note: int, frame := -1) -> void:
	if frame < 0 and _live_shift.has(note):
		# Keep the note's length when its start was delayed to the grid.
		frame = synth.get_frame_position() + int(_live_shift[note])
	_live_shift.erase(note)
	synth.note_off(note, frame)
	played.emit({"type": "off", "note": note, "beat": heard_beat()})


# ---- Transport client

func schedule(from_beat: float, to_beat: float) -> void:
	# Keep Tangle's clock modules locked to the shared clock (cheap: one event per frame).
	synth.sync_transport(from_beat, Transport.frame_for(synth, from_beat))
	sequencer.schedule(from_beat, to_beat)
	if looper:
		looper.schedule(from_beat, to_beat)


func transport_stopped() -> void:
	sequencer.transport_stopped()
	if looper:
		looper.transport_stopped()


func bend(value: float) -> void:
	synth.pitch_bend(value)
	played.emit({"type": "bend", "value": value})


func set_param(id: String, value: float) -> void:
	if instrument == "Tangle" and id.contains("/"):
		var parts := id.split("/")
		synth.tangle_set_param(int(parts[0]), parts[1], value)
	else:
		synth.set_param(id, value)
	played.emit({"type": "param", "id": id, "value": value})


func _on_cc(cc: int, value: int) -> void:
	if learning != "":
		if cc != 64 and cc != 1: # keep the pedal and mod wheel for their usual jobs
			_map.set_value(instrument, str(cc), learning)
			_map.save(MAP_PATH)
			learning = ""
			learn_changed.emit("")
			return
	var target: String = _map.get_value(instrument, str(cc), "")
	if target != "":
		var info := _param_info(target)
		if not info.is_empty():
			var t := value / 127.0
			var v: float = info.min + (info.max - info.min) * t
			if info.log and info.min > 0.0:
				v = info.min * pow(info.max / info.min, t)
			set_param(target, v)
			param_changed.emit(target, synth.get_param(target))
		return
	synth.control_change(cc, value / 127.0)
	played.emit({"type": "cc", "cc": cc, "value": value / 127.0})


func learn(param_id: String) -> void:
	learning = param_id
	learn_changed.emit(param_id)


func forget(param_id: String) -> void:
	if not _map.has_section(instrument):
		return
	for cc in _map.get_section_keys(instrument):
		if _map.get_value(instrument, cc) == param_id:
			_map.erase_section_key(instrument, cc)
	_map.save(MAP_PATH)


func mapped_cc(param_id: String) -> int:
	if _map.has_section(instrument):
		for cc in _map.get_section_keys(instrument):
			if _map.get_value(instrument, cc) == param_id:
				return int(cc)
	return -1


func _param_info(id: String) -> Dictionary:
	for p in synth.get_param_list():
		if p.id == id:
			return p
	return {}
