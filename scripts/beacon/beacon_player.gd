class_name BeaconPlayer
extends Node
## Plays the beacon blend on the SynthKit instruments: one InstrumentRig per
## part, scheduled from the shared Transport clock. Same songs, weights and
## blending rules as the browser playfield (web/), so songs made there play here.
##
##   var p := BeaconPlayer.new()
##   p.field = BeaconField.make_grid()
##   add_child(p)
##   p.load_songs("res://songs/grid.json")
##   p.set_position(Vector2(-38, 27))
##   Transport.start()

signal harmony_changed(info: Dictionary)
## A note was scheduled (it sounds a moment later, at the clock's look-ahead).
signal note_played(role: String, beacon_id: String)

const INSTRUMENT := {"drums": "Pulsar", "bass": "Undertow", "keys": "Lumen", "lead": "Comet", "pluck": "Driftwood", "texture": "Tangle"}
const BASE_PRESET := {"drums": "Classic Eight", "bass": "Deep Current", "keys": "Glow Pad", "lead": "Fifth Flight", "pluck": "Nylon Pluck", "texture": "Drone Garden"}
const DRUM_NOTE := {"kick": 36, "snare": 38, "clap": 39, "hat": 42, "open": 46}

var field: BeaconField = BeaconField.make_grid()
var songs := {} # beacon id -> song
var pos := Vector2.ZERO
var active_count := 3
var sharpness := 1.5
var harmony := BeaconMixer.Harmony.new()
var active: Array = []
var mix: Dictionary = {}
var rigs := {} # role -> InstrumentRig
var played := {} # role -> notes played (for tests and meters)

var _applied := {} # role -> {synth param id: value}
var _param_t := 0.0
var _gain := {} # role -> smoothed linear gain


func _ready() -> void:
	for role in BeaconMixer.ROLES:
		var rig := InstrumentRig.new()
		rig.name = role.capitalize()
		rig.instrument = INSTRUMENT[role]
		rig.local_input = false
		add_child(rig)
		rig.sequencer.enabled = false # the beacon blend plays these, not their own sequencers
		for p in PresetLibrary.list(INSTRUMENT[role]):
			if p.name == BASE_PRESET[role]:
				rig.load_preset(p)
		rig.set_volume_db(-80.0)
		rigs[role] = rig
		_applied[role] = {}
		_gain[role] = 0.0
		played[role] = 0
	Transport.register(self)
	_refresh()


func _exit_tree() -> void:
	Transport.unregister(self)


## Loads a song pack ({field, songs: {id: song}}) as exported by web/tools/export_songs.mjs.
func load_songs(path: String) -> int:
	var data = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(data) != TYPE_DICTIONARY or not data.has("songs"):
		push_error("BeaconPlayer: no song pack at %s" % path)
		return 0
	songs.clear()
	for id in data.songs:
		if BeaconMixer.validate(data.songs[id]).is_empty():
			songs[id] = data.songs[id]
	_refresh()
	return songs.size()


## Replaces one beacon's song (e.g. a contributed one).
func set_song(id: String, song: Dictionary) -> bool:
	if not BeaconMixer.validate(song).is_empty():
		return false
	songs[id] = song
	_refresh()
	return true


func set_position(p: Vector2) -> void:
	pos = field.clamp_pos(p)
	_refresh()


func _refresh() -> void:
	if songs.is_empty():
		return
	active = []
	for n in field.weigh(pos, active_count, sharpness):
		if songs.has(n.id):
			active.append({"id": n.id, "w": n.w, "d": n.d, "beacon": n.beacon, "song": songs[n.id]})
	mix = BeaconMixer.blend(active)
	if harmony.id == null and not active.is_empty():
		harmony.update(active, 0)


func _process(delta: float) -> void:
	if mix.is_empty() or rigs.is_empty():
		return
	for role in rigs:
		# Smooth level changes so walking never clicks.
		_gain[role] = lerpf(_gain[role], float(mix[role].gain) if Transport.running else 0.0, minf(1.0, delta * 6.0))
		rigs[role].set_volume_db(linear_to_db(maxf(_gain[role], 0.0001)))
	_param_t -= delta
	if _param_t <= 0.0:
		_param_t = 0.1
		for role in rigs:
			_apply_params(role)


func _apply_params(role: String) -> void:
	var synth: JamSynth = rigs[role].synth
	var target := ParamMap.to_synth(role, mix[role].params)
	var done: Dictionary = _applied[role]
	for id in target:
		var v: float = target[id]
		if not done.has(id) or absf(done[id] - v) > 0.002 * maxf(1.0, absf(v)):
			synth.set_param(id, v)
			done[id] = v


# ---- Transport client

func schedule(from_beat: float, to_beat: float) -> void:
	if active.is_empty():
		return
	var i := ceili(from_beat * 4.0 - 1e-6)
	while i * 0.25 < to_beat:
		_play_step(i, i * 0.25)
		i += 1


func _play_step(index: int, beat: float) -> void:
	var bar := index / 16
	var step := index % 16
	if step == 0:
		if harmony.update(active, bar):
			harmony_changed.emit({"id": harmony.id, "title": harmony.song.title,
				"chord": BeaconMixer.chord_name(harmony.song.key, harmony.chord_degree(bar))})
		var target := BeaconMixer.target_tempo(active)
		if absf(target - Transport.bpm) > 0.5:
			# Glide: close a third of the gap per bar (Transport applies it on the next bar line).
			Transport.set_tempo(Transport.bpm + (target - Transport.bpm) * 0.35)
	for ev in BeaconMixer.step_events(active, mix, harmony, bar, step):
		var synth: JamSynth = rigs[ev.role].synth
		var on := Transport.frame_for(synth, beat)
		if ev.role == "drums":
			var n: int = DRUM_NOTE[ev.voice]
			synth.note_on(n, ev.vel, on)
			synth.note_off(n, Transport.frame_for(synth, beat + 0.2))
		else:
			var off := Transport.frame_for(synth, beat + ev.gate * 0.25 * 0.95)
			for n in ev.notes:
				synth.note_on(n, ev.vel, on)
				synth.note_off(n, off)
		played[ev.role] += 1
		note_played.emit(ev.role, ev.id)


func transport_stopped() -> void:
	for role in rigs:
		rigs[role].synth.all_notes_off()
