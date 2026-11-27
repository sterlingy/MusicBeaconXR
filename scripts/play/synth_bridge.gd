class_name SynthBridge
extends Node
## Plays MusicInputKit's notes and knob moves on SynthKit instruments. This is
## the only place the two kits meet: the objects never see SynthKit, and
## SynthKit never sees the objects.
##
## Each part ("keys", "lead"...) gets its own InstrumentRig with a starting
## preset. Knob values arrive as 0..1 and are turned into the knob's real range
## here (log knobs sweep in octaves). Two extra targets work on every part:
## "@bend" (0.5 = no bend) and "@volume". The "remix" targets turn Remix's
## dials (scripts/beacon/remix.gd): patch a dial to remix · brightness, say,
## and Remix turns on with that setting for the beacon music (remembered).

## part -> [instrument, factory preset name (or "")]
const PARTS := {
	"mallet": ["Driftwood", "Marimba"],
	"harp": ["Driftwood", "Steel Harp"],
	"lead": ["Prism", "Comet Tail"],
	"bass": ["Undertow", "Deep Current"],
	"drums": ["Pulsar", "Classic Eight"],
	"keys": ["Prism", "Prism Keys"],
	"pad": ["Prism", "Aurora Pad"],
}
## Generic knob names the objects patch to by default (shared with the browser
## twin), and what they mean on an instrument whose own ids differ.
const ALIASES := {
	"Prism": {"filter.cutoff": "f1.cutoff", "filter.resonance": "f1.resonance", "filter.emphasis": "f1.resonance",
		"reverb.mix": "send.space", "delay.mix": "send.echo", "chorus.mix": "fx1.amount", "vibrato.depth": "lfo1.vibrato"},
}
const BEND_PARAMS := ["perf.bend_range", "ctrl.bend_range", "voice.bend_range"]

var kit: MusicInput
var _remix_pending := {} # Remix settings waiting to be saved (twisting sends many moves)
var _remix_save_in := 0.0
var rigs := {} # part -> InstrumentRig
var _notes := {} # voice -> [part, note]
var _info := {} # part -> {param id -> info}
var _bend_range := {} # part -> semitones the synth bends at ±1


func _init(k: MusicInput = null) -> void:
	kit = k


func _ready() -> void:
	if kit == null:
		kit = get_tree().get_first_node_in_group("music_input") as MusicInput
	for p in PARTS:
		_make_rig(p, PARTS[p][0], PARTS[p][1])
	kit.note_on.connect(_on_note_on)
	kit.note_off.connect(_on_note_off)
	kit.note_bend.connect(_on_bend)
	kit.control.connect(_on_control)
	kit.resend()


func _make_rig(part: String, instrument: String, preset_name: String) -> void:
	var rig := InstrumentRig.new()
	rig.name = "Rig_" + part
	rig.instrument = instrument
	rig.local_input = false
	add_child(rig)
	for pr in PresetLibrary.list(instrument):
		if pr.get("name", "") == preset_name:
			rig.load_preset(pr)
			break
	var info := {}
	for p in rig.synth.get_param_list():
		info[p.id] = p
	_info[part] = info
	_bend_range[part] = 2.0
	if instrument == "Prism":
		rig.set_param("voice.quality", 0 if OS.has_feature("mobile") else 2)
		rig.set_param("voice.budget", 12 if OS.has_feature("mobile") else 24)
	for b in BEND_PARAMS:
		if info.has(b):
			# Continuous objects bend up to an octave either way.
			rig.set_param(b, 12.0)
			_bend_range[part] = 12.0
	rigs[part] = rig


func set_part_instrument(part: String, instrument: String, preset: Dictionary = {}) -> void:
	if rigs.has(part):
		rigs[part].queue_free()
		rigs.erase(part)
	_make_rig(part, instrument, preset.get("name", ""))
	if not preset.is_empty():
		rigs[part].load_preset(preset)


## Every knob a patch can reach: [[part, param, label], ...], parts in order.
func targets() -> Array:
	var out := []
	for part in PARTS:
		out.append([part, "@volume", "%s · volume" % part])
		out.append([part, "@bend", "%s · pitch bend" % part])
		var inst: String = PARTS[part][0]
		for alias in ALIASES.get(inst, {}):
			out.append([part, alias, "%s · %s" % [part, alias]])
		for id in _info.get(part, {}):
			out.append([part, id, "%s · %s" % [part, id]])
	for d in Remix.DIALS:
		out.append(["remix", "remix." + String(d[0]), "remix · %s" % String(d[1]).to_lower()])
	return out


func _on_note_on(part: String, voice: int, note: int, velocity: float) -> void:
	var rig: InstrumentRig = rigs.get(part)
	if rig == null:
		return
	rig.play_note(note, velocity)
	_notes[voice] = [part, note]


func _on_note_off(part: String, voice: int, note: int) -> void:
	var rig: InstrumentRig = rigs.get(part)
	_notes.erase(voice)
	if rig == null:
		return
	# Another voice on the same part may hold the same note (two hands): keep it.
	for v in _notes:
		if _notes[v][0] == part and _notes[v][1] == note:
			return
	rig.release_note(note)


func _on_bend(part: String, _voice: int, semitones: float) -> void:
	var rig: InstrumentRig = rigs.get(part)
	if rig:
		rig.bend(clampf(semitones / _bend_range.get(part, 2.0), -1.0, 1.0))


func _on_control(part: String, param: String, value: float) -> void:
	if part == "remix":
		_remix_control(param.trim_prefix("remix."), value)
		return
	var rig: InstrumentRig = rigs.get(part)
	if rig == null:
		return
	match param:
		"@bend":
			rig.bend(value * 2.0 - 1.0)
		"@volume":
			rig.set_volume_db(linear_to_db(maxf(value, 0.0001)))
		_:
			param = ALIASES.get(rig.instrument, {}).get(param, param)
			var info: Dictionary = _info[part].get(param, {})
			if info.is_empty():
				return
			rig.set_param(param, real_value(info, value))


## A patched object turning one of Remix's dials: 0..1 across the dial's range,
## Remix on. The beacon player (if one is playing) hears it at once; it's saved
## for the beacon music a moment later.
func _remix_control(id: String, value: float) -> void:
	var dial: Array = []
	for d in Remix.DIALS:
		if d[0] == id:
			dial = d
	if dial.is_empty():
		return
	var player := get_tree().get_first_node_in_group("beacon_player") as BeaconPlayer if is_inside_tree() else null
	var s: Dictionary = _remix_pending if not _remix_pending.is_empty() else (player.remix.duplicate(true) if player else Remix.normalize(FieldPrefs.get_value("remix", {})))
	s.on = true
	s[id] = snappedf(lerpf(dial[2], dial[3], clampf(value, 0.0, 1.0)), dial[4])
	_remix_pending = s
	_remix_save_in = 0.3
	if player:
		player.set_remix(s)


func _process(delta: float) -> void:
	if _remix_pending.is_empty():
		return
	_remix_save_in -= delta
	if _remix_save_in <= 0.0:
		var keep := Remix.normalize(_remix_pending)
		keep.hold = false
		FieldPrefs.set_value("remix", keep)
		_remix_pending = {}


## 0..1 -> the knob's own units (log knobs sweep evenly in octaves).
static func real_value(info: Dictionary, t: float) -> float:
	var lo: float = info.min
	var hi: float = info.max
	if info.get("log", false) and lo > 0.0:
		return lo * pow(hi / lo, t)
	return lerpf(lo, hi, t)
