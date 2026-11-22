extends Node
## MIDI input for playing the instruments. Autoloaded as `Midi`.
## Part of the synthkit addon (from AudioSyncMaster, adapted from ChordMasterXR).
##
## Sources, all merged into the same signals:
## - USB MIDI on desktop (Godot's MIDI API; hot-plug rescans every 2 s).
## - USB and Bluetooth LE MIDI on Android, through the ChordMasterMidi Android
##   plugin (addons/chordmaster_midi; source in android_plugin/).
## - The computer keyboard (home row = white keys, row above = black keys,
##   Z/X octave down/up, C/V velocity down/up).
## - On-screen keys and pads through inject_*.
##
## Unlike ChordMasterXR this forwards everything a synth needs: velocity,
## control changes (incl. sustain), pitch bend and channel pressure.

signal note_on(pitch: int, velocity: int)
signal note_off(pitch: int)
signal control_change(cc: int, value: int)
signal pitch_bend(value: float) # -1..1
signal pressure(value: float) # 0..1
signal devices_changed(names: PackedStringArray)
signal raw_event(text: String) # for a MIDI monitor
signal bluetooth_status(text: String)
## Messages from local sources (not ones passed in with from_network), as
## (status, data1, data2), so an app can forward them, e.g. over Wi-Fi.
signal outgoing(status: int, d1: int, d2: int)

const QWERTY := {
	KEY_A: 0, KEY_W: 1, KEY_S: 2, KEY_E: 3, KEY_D: 4, KEY_F: 5, KEY_T: 6,
	KEY_G: 7, KEY_Y: 8, KEY_H: 9, KEY_U: 10, KEY_J: 11, KEY_K: 12, KEY_O: 13,
	KEY_L: 14, KEY_P: 15, KEY_SEMICOLON: 16, KEY_APOSTROPHE: 17,
}

var held: Dictionary = {} # pitch -> velocity
var devices: PackedStringArray = []
var qwerty_octave := 3 # A key = C3, a good default for bass and leads
var qwerty_velocity := 100
## The computer keyboard plays notes (home row) when true.
var qwerty_input := true
## -1 = omni, else only this channel (0-15).
var midi_channel := -1

var _poll_t := 0.0
var _android: Object = null
var _qwerty_down := {} # keycode -> midi note


func _ready() -> void:
	if Engine.has_singleton("ChordMasterMidi"):
		_android = Engine.get_singleton("ChordMasterMidi")
		_android.connect("midi_message", _on_android_message)
		_android.connect("devices_changed", _on_android_devices)
		_android.connect("bluetooth_status", func(t: String): bluetooth_status.emit(t))
		_android.call("start")
		return
	OS.open_midi_inputs()
	_refresh_devices()


func _exit_tree() -> void:
	if _android == null:
		OS.close_midi_inputs()


func has_android_plugin() -> bool:
	return _android != null


## Android: scan for Bluetooth LE MIDI devices and connect them.
func scan_bluetooth(seconds := 15) -> void:
	if _android:
		_android.call("scanBluetooth", seconds)
	else:
		bluetooth_status.emit("Bluetooth MIDI scanning is only needed on Android. On Windows, pair the device in Bluetooth settings (or use a BLE-MIDI driver).")


func _process(delta: float) -> void:
	if _android:
		return
	_poll_t += delta
	if _poll_t >= 2.0:
		_poll_t = 0.0
		var now := OS.get_connected_midi_inputs()
		if now != devices:
			OS.close_midi_inputs()
			OS.open_midi_inputs()
			_refresh_devices()


func _refresh_devices() -> void:
	devices = OS.get_connected_midi_inputs()
	devices_changed.emit(devices)


func rescan() -> void:
	if _android:
		_on_android_devices(str(_android.call("getDeviceNames")))
		return
	OS.close_midi_inputs()
	OS.open_midi_inputs()
	_refresh_devices()


func _on_android_devices(names: String) -> void:
	devices = PackedStringArray(names.split("\n", false))
	devices_changed.emit(devices)


func _on_android_message(status: int, d1: int, d2: int) -> void:
	_dispatch_raw(status & 0x0F, status >> 4, d1, d2, false)


## Raw channel message (channel, type nibble, data bytes), e.g. from an app's
## network relay (from_network = true keeps it from going back out).
func dispatch_raw(channel: int, type: int, d1: int, d2: int, from_network := true) -> void:
	_dispatch_raw(channel, type, d1, d2, from_network)


func _dispatch_raw(channel: int, type: int, d1: int, d2: int, from_network: bool) -> void:
	match type:
		MIDI_MESSAGE_CONTROL_CHANGE:
			handle_message(channel, type, 0, 0, d1, d2, 0, 0, from_network)
		MIDI_MESSAGE_PITCH_BEND:
			handle_message(channel, type, 0, 0, 0, 0, (d2 << 7) | d1, 0, from_network)
		MIDI_MESSAGE_CHANNEL_PRESSURE:
			handle_message(channel, type, 0, 0, 0, 0, 0, d1, from_network)
		_:
			handle_message(channel, type, d1, d2, 0, 0, 0, 0, from_network)


func _input(event: InputEvent) -> void:
	if event is InputEventKey and qwerty_input:
		_qwerty(event as InputEventKey)
		return
	if not event is InputEventMIDI:
		return
	var e := event as InputEventMIDI
	# Godot puts the 14-bit bend value in `pitch` for pitch-bend messages.
	handle_message(e.channel, e.message, e.pitch, e.velocity, e.controller_number, e.controller_value, e.pitch, e.pressure, false)


## Shared by every input source. `bend14` is 0..16383 (8192 = centre).
func handle_message(channel: int, message: int, pitch: int, velocity: int, cc_num := 0, cc_val := 0, bend14 := 8192, press := 0, from_network := false) -> void:
	if not from_network and message >= 0x8 and message <= 0xE:
		match message:
			MIDI_MESSAGE_CONTROL_CHANGE: outgoing.emit((message << 4) | channel, cc_num, cc_val)
			MIDI_MESSAGE_PITCH_BEND: outgoing.emit((message << 4) | channel, bend14 & 0x7F, (bend14 >> 7) & 0x7F)
			MIDI_MESSAGE_CHANNEL_PRESSURE: outgoing.emit((message << 4) | channel, press, 0)
			_: outgoing.emit((message << 4) | channel, pitch, velocity)
	var ch_setting := midi_channel
	raw_event.emit("ch%d msg%d pitch%d vel%d cc%d=%d bend%d press%d" % [channel + 1, message, pitch, velocity, cc_num, cc_val, bend14, press])
	if ch_setting >= 0 and channel != ch_setting:
		return
	match message:
		MIDI_MESSAGE_NOTE_ON:
			if velocity == 0:
				_release(pitch)
			else:
				_press(pitch, velocity)
		MIDI_MESSAGE_NOTE_OFF:
			_release(pitch)
		MIDI_MESSAGE_CONTROL_CHANGE:
			if cc_num == 123 or cc_num == 120:
				release_all()
			control_change.emit(cc_num, cc_val)
		MIDI_MESSAGE_PITCH_BEND:
			pitch_bend.emit(clampf((bend14 - 8192) / 8191.0, -1.0, 1.0))
		MIDI_MESSAGE_CHANNEL_PRESSURE:
			pressure.emit(press / 127.0)


func _qwerty(e: InputEventKey) -> void:
	if e.echo or e.ctrl_pressed or e.alt_pressed or e.meta_pressed:
		return
	var focus := get_viewport().gui_get_focus_owner()
	if focus is LineEdit or focus is TextEdit or focus is SpinBox:
		return
	var key := e.physical_keycode
	if e.pressed:
		match key:
			KEY_Z:
				qwerty_octave = maxi(0, qwerty_octave - 1)
				get_viewport().set_input_as_handled()
				return
			KEY_X:
				qwerty_octave = mini(8, qwerty_octave + 1)
				get_viewport().set_input_as_handled()
				return
			KEY_C:
				qwerty_velocity = maxi(1, qwerty_velocity - 15)
				get_viewport().set_input_as_handled()
				return
			KEY_V:
				qwerty_velocity = mini(127, qwerty_velocity + 15)
				get_viewport().set_input_as_handled()
				return
	if e.pressed and QWERTY.has(key):
		var m: int = 12 * (qwerty_octave + 1) + QWERTY[key]
		_qwerty_down[key] = m
		_press(m, qwerty_velocity)
		get_viewport().set_input_as_handled()
	elif not e.pressed and _qwerty_down.has(key):
		_release(_qwerty_down[key])
		_qwerty_down.erase(key)
		get_viewport().set_input_as_handled()


func _press(pitch: int, velocity: int) -> void:
	held[pitch] = velocity
	note_on.emit(pitch, velocity)


func _release(pitch: int) -> void:
	if held.erase(pitch):
		note_off.emit(pitch)


func release_all() -> void:
	for p in held.keys():
		note_off.emit(p)
	held.clear()


func inject_note_on(pitch: int, velocity := 100) -> void:
	_press(pitch, velocity)


func inject_note_off(pitch: int) -> void:
	_release(pitch)


func inject_control_change(cc: int, value: int) -> void:
	control_change.emit(cc, value)
