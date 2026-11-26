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

## Keys, lead and pad play on Prism (SynthKit's deep, mobile-sized engine).
const INSTRUMENT := {"drums": "Pulsar", "bass": "Undertow", "keys": "Prism", "lead": "Prism", "pluck": "Driftwood", "texture": "Tangle", "pad": "Prism"}
const BASE_PRESET := {"drums": "Classic Eight", "bass": "Deep Current", "keys": "Prism Keys", "lead": "Comet Tail", "pluck": "Nylon Pluck", "texture": "Drone Garden", "pad": "Aurora Pad"}
## Every part the player plays: the song parts, plus a pad that holds the harmony's chords.
const PARTS := ["drums", "bass", "keys", "lead", "pluck", "texture", "pad"]
## Moods that lean on a pad (others get less of it).
const PAD_MOODS := ["Drift", "Glow", "Tide"]
const DRUM_NOTE := {"kick": 36, "snare": 38, "clap": 39, "hat": 42, "open": 46}
## The songs' part levels are mixed for SynthKit (web/src/song.js MIX). This
## sets the whole mix so the busiest songs peak just under full scale (about
## -1 dBFS; there's no compressor), and PAD_MIX is the pad's share of it.
## Same values in web/src/kit/kitplayer.js.
const KIT_GAIN_DB := 5.0
const PAD_MIX := 0.379

var field: BeaconField = BeaconField.make_grid()
var songs := {} # beacon id -> song
## Makes the song for a beacon id that has none loaded (the local grid:
## func(id) -> song, see SongGen). Songs are made as beacons come near.
var song_source := Callable()
## An extra layer crossfaded with the field (the user's own beacons on the
## globe, see BeaconDrafts): func(pos) -> {globe_share, entries: [{id, w, d,
## beacon, song}]}, or {} for none. Same as the website's engine.layer.
var layer := Callable()
## What `layer` returned last (the globe scene reads it for the status line).
var layer_info := {}
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
var _pad_notes: Array = [] # the chord the pad is holding
var _awake := {} # role -> Prism part awake (out.gain 1) or asleep (0)
var muted := {} # role -> true: silenced by the mix panel's M
var soloed := {} # role -> true: when any part is soloed, only soloed parts play


func _ready() -> void:
	var phone := OS.has_feature("mobile")
	for role in PARTS:
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
		if INSTRUMENT[role] == "Prism":
			# Phones and Quest: lighter voices and a smaller shared voice budget.
			rig.set_param("voice.quality", 0 if phone else 2)
			rig.set_param("voice.budget", 12 if phone else 24)
			_awake[role] = true
		rigs[role] = rig
		_applied[role] = {}
		_gain[role] = 0.0
		played[role] = 0
	# Beacon music is for listening: no metronome click and no count-in unless
	# someone turns the click on (the field's "Click" button, or M).
	Transport.metronome_on = false
	Transport.count_in_bars = 0
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


## The song for beacon `id`, made by song_source if it isn't loaded yet.
func song_for(id: String) -> Dictionary:
	if not songs.has(id) and song_source.is_valid():
		songs[id] = song_source.call(id)
	return songs.get(id, {})


## Moves to another field (a local grid re-centered as someone travels). The
## music carries on: beacons both fields share keep their songs.
func set_field(f: BeaconField) -> void:
	field = f
	if songs.size() > 600 and song_source.is_valid():
		songs.clear() # made again on demand
	_refresh()


func set_position(p: Vector2) -> void:
	pos = field.clamp_pos(p)
	_refresh()


func _refresh() -> void:
	if songs.is_empty() and not song_source.is_valid() and not layer.is_valid():
		return
	active = []
	for n in field.weigh(pos, active_count, sharpness):
		if not song_for(n.id).is_empty():
			active.append({"id": n.id, "w": n.w, "d": n.d, "beacon": n.beacon, "song": songs[n.id]})
	layer_info = layer.call(pos) if layer.is_valid() else {}
	if not layer_info.is_empty():
		var share := float(layer_info.globe_share)
		var both := []
		if share > 0.0:
			for a in active:
				a.w *= share
				both.append(a)
		both.append_array(layer_info.entries)
		# Loudest first, so readouts that show three show the ones you hear.
		both.sort_custom(func(x, y): return x.w > y.w)
		active = both
	mix = BeaconMixer.blend(active)
	var pad := 0.0
	for a in active:
		pad += a.w * pad_level(a.song)
	mix["pad"] = {"gain": pad, "params": {}, "sources": []}
	if harmony.id == null and not active.is_empty():
		harmony.update(active, 0)


## Mute and solo, like a mixing desk: solo wins over mute.
func audible(role: String) -> bool:
	if not soloed.is_empty():
		return soloed.has(role)
	return not muted.has(role)


func set_muted(role: String, on: bool) -> void:
	if on: muted[role] = true
	else: muted.erase(role)


func set_soloed(role: String, on: bool) -> void:
	if on: soloed[role] = true
	else: soloed.erase(role)


func _process(delta: float) -> void:
	if mix.is_empty() or rigs.is_empty():
		return
	for role in rigs:
		# Smooth level changes so walking never clicks.
		var want := float(mix[role].gain) if Transport.running and audible(role) else 0.0
		_gain[role] = lerpf(_gain[role], want, minf(1.0, delta * 6.0))
		rigs[role].set_volume_db(linear_to_db(maxf(_gain[role], 0.0001)) + KIT_GAIN_DB)
		# A Prism part faded out of the blend sleeps: no voices, no CPU.
		if _awake.has(role):
			var awake: bool = _gain[role] > 0.0005
			if awake != _awake[role]:
				_awake[role] = awake
				rigs[role].synth.set_param("out.gain", 1.0 if awake else 0.0)
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
	if step == 0:
		_play_pad(bar, beat)
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
	_pad_notes = []


## How much pad a song wants: calm, low-energy songs lean on it.
static func pad_level(song: Dictionary) -> float:
	var energy := float(song.get("energy", 0.5))
	var mood_k := 1.0 if song.get("mood", "") in PAD_MOODS else 0.6
	return clampf(0.75 - energy * 0.6, 0.12, 0.7) * mood_k * PAD_MIX


## The pad holds the harmony's chord (root, third, fifth, seventh), tied across
## bars while the chord stays the same so it swells instead of retriggering.
func _play_pad(bar: int, beat: float) -> void:
	if mix.get("pad", {}).get("gain", 0.0) <= 0.001 or harmony.song.is_empty():
		return
	var chord: Array = BeaconMixer.chord_notes(harmony.song.key, harmony.chord_degree(bar), 3, 4)
	if chord == _pad_notes:
		return
	var synth: JamSynth = rigs["pad"].synth
	var at := Transport.frame_for(synth, beat)
	for n in _pad_notes:
		synth.note_off(n, at)
	for n in chord:
		synth.note_on(n, 0.7, at)
	_pad_notes = chord
	played["pad"] += 1
	note_played.emit("pad", harmony.id)
