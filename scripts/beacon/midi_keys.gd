class_name MidiKeys
extends Node
## Play along on a MIDI keyboard: a Prism keys instrument that plays whatever
## comes in through SynthKit's MIDI input (Midi: USB on desktop; USB and
## Bluetooth LE on Android through the ChordMasterMidi plugin from
## ChordMasterXR), mixed with the beacon music. Velocity, sustain, pitch bend
## and the mod wheel all work. On Android it asks for Bluetooth and connects
## MIDI keyboards: ones already paired with the headset open by themselves,
## and until one is connected it scans for new ones every RESCAN_S seconds.
##
##   var keys := MidiKeys.new()
##   add_child(keys)
##   label.text = keys.status

const INSTRUMENT := "Prism"
const PRESET := "Prism Keys"
const VOLUME_DB := -4.0
const SCAN_SECONDS := 20
const RESCAN_S := 45.0

## One line saying what's connected ("MIDI: KORG nanoKEY" / "Looking for Bluetooth MIDI…").
var status := ""
var rig: InstrumentRig
var _bt := ""
var _was_qwerty := true
var _rescan_in := RESCAN_S


func _ready() -> void:
	name = "MidiKeys"
	rig = InstrumentRig.new()
	rig.name = "MidiKeysRig"
	rig.instrument = INSTRUMENT
	rig.local_input = true # plays Midi's notes, bends and pedals
	add_child(rig)
	rig.sequencer.enabled = false
	for p in PresetLibrary.list(INSTRUMENT):
		if p.name == PRESET:
			rig.load_preset(p)
	rig.set_volume_db(VOLUME_DB)
	# The computer keyboard walks here (WASD), so it doesn't play notes too.
	_was_qwerty = Midi.qwerty_input
	Midi.qwerty_input = false
	Midi.devices_changed.connect(func(_d): _show())
	Midi.bluetooth_status.connect(func(t: String):
		_bt = t
		_show())
	if Midi.has_android_plugin():
		Midi.rescan()
		# Nothing connected yet: look for Bluetooth MIDI (asks for the permission the first time).
		get_tree().create_timer(1.5).timeout.connect(func():
			if is_inside_tree() and Midi.devices.is_empty():
				connect_bluetooth())
	_show()


func _process(delta: float) -> void:
	if not Midi.has_android_plugin() or not Midi.devices.is_empty():
		return
	_rescan_in -= delta
	if _rescan_in <= 0.0:
		_rescan_in = RESCAN_S
		connect_bluetooth()


func _exit_tree() -> void:
	Midi.qwerty_input = _was_qwerty


## Scans for Bluetooth MIDI keyboards and connects them (Android).
func connect_bluetooth() -> void:
	if Midi.has_android_plugin():
		_bt = "Looking for Bluetooth MIDI keyboards…"
		Midi.scan_bluetooth(SCAN_SECONDS)
	else:
		_bt = "Plug a MIDI keyboard in by USB (Bluetooth MIDI needs the Android build)."
	_show()


func _show() -> void:
	if not Midi.devices.is_empty():
		status = "MIDI: " + ", ".join(Midi.devices)
	elif _bt != "":
		status = _bt
	else:
		status = "No MIDI keyboard connected"
