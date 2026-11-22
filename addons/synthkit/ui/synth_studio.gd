class_name SynthStudio
extends VBoxContainer
## A complete instrument page: instrument and preset pickers, save, transport,
## Sound / Sequencer tabs and on-screen keys. Drop it into any scene; it makes
## its own InstrumentRig unless you set `rig` before it enters the tree.

signal preset_saved(preset: Dictionary)

@export var instrument := "Lumen"
@export var show_transport := true
@export var show_keyboard := true

var rig: InstrumentRig
var panel: SynthPanel
var tangle: TangleEditor
var seq_view: SequencerView
var keys: KeyboardView

var _tabs: TabBar
var _inst_select: OptionButton
var _preset_select: OptionButton
var _add_module: MenuButton
var _presets: Array[Dictionary] = []
var _play: Button
var _pos: Label
var _tempo: SpinBox
var _meter: ProgressBar
var _status: Label
var _save_dialog: ConfirmationDialog
var _save_name: LineEdit
var _ext_conns: Array = []


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	if rig == null:
		rig = InstrumentRig.new()
		rig.name = "Instrument"
		rig.instrument = instrument
		add_child(rig)
	add_child(_build_top_bar())
	if show_transport:
		add_child(_build_transport_bar())
	_tabs = TabBar.new()
	_tabs.add_tab("Sound")
	_tabs.add_tab("Sequencer")
	_tabs.tab_changed.connect(func(_i): _show_body())
	add_child(_tabs)
	var body := Control.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(body)
	panel = SynthPanel.new()
	panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	body.add_child(panel)
	panel.bind(rig)
	tangle = TangleEditor.new()
	tangle.set_anchors_preset(Control.PRESET_FULL_RECT)
	body.add_child(tangle)
	seq_view = SequencerView.new()
	seq_view.set_anchors_preset(Control.PRESET_FULL_RECT)
	body.add_child(seq_view)
	keys = KeyboardView.new()
	keys.custom_minimum_size.y = 120
	keys.visible = show_keyboard
	add_child(keys)
	_status = Label.new()
	_status.add_theme_font_size_override("font_size", 12)
	_status.add_theme_color_override("font_color", Color(1, 1, 1, 0.6))
	add_child(_status)
	_build_save_dialog()
	rig.instrument_changed.connect(func(_t): _on_instrument_changed())
	rig.preset_changed.connect(func(_p): _sync_preset_select())
	rig.learn_changed.connect(func(id): set_status("Move a knob on your MIDI controller to map it to %s" % id if id != "" else ""))
	_link(Midi.devices_changed, func(_d): set_status())
	_on_instrument_changed()
	set_status()


func _build_top_bar() -> Control:
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 8)
	_inst_select = OptionButton.new()
	for t in JamSynth.get_instrument_types():
		if t != "Metronome" and t != "Clips":
			_inst_select.add_item(t)
	_inst_select.item_selected.connect(func(i): rig.set_instrument(_inst_select.get_item_text(i)))
	bar.add_child(_inst_select)
	bar.add_child(_button("◀", func(): _step_preset(-1), "Previous preset"))
	_preset_select = OptionButton.new()
	_preset_select.custom_minimum_size.x = 220
	_preset_select.item_selected.connect(func(i): rig.load_preset(_presets[i]))
	bar.add_child(_preset_select)
	bar.add_child(_button("▶", func(): _step_preset(1), "Next preset"))
	bar.add_child(_button("Save…", _open_save, "Save the current sound as your own preset"))
	_add_module = MenuButton.new()
	_add_module.text = "+ Module"
	_add_module.flat = false
	_add_module.get_popup().id_pressed.connect(func(id): tangle.add_module(_add_module.get_popup().get_item_metadata(id)))
	bar.add_child(_add_module)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.add_child(spacer)
	_meter = ProgressBar.new()
	_meter.custom_minimum_size = Vector2(90, 14)
	_meter.max_value = 1.0
	_meter.show_percentage = false
	_meter.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	bar.add_child(_meter)
	return bar


func _build_transport_bar() -> Control:
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 8)
	_play = _button("▶ Play", func(): Transport.toggle(), "Start/stop the clock (Space)")
	_play.custom_minimum_size.x = 90
	_link(Transport.state_changed, func(r): _play.text = "■ Stop" if r else "▶ Play")
	bar.add_child(_play)
	_pos = Label.new()
	_pos.custom_minimum_size.x = 60
	_pos.text = "1.1"
	bar.add_child(_pos)
	_tempo = SpinBox.new()
	_tempo.min_value = 30
	_tempo.max_value = 300
	_tempo.value = Transport.bpm
	_tempo.suffix = "BPM"
	_tempo.custom_minimum_size.x = 120
	_tempo.value_changed.connect(func(v): Transport.set_tempo(v))
	_link(Transport.tempo_changed, func(b): _tempo.set_value_no_signal(b))
	bar.add_child(_tempo)
	var met := CheckButton.new()
	met.text = "Metronome"
	met.button_pressed = Transport.metronome_on
	met.toggled.connect(func(t): Transport.metronome_on = t)
	bar.add_child(met)
	return bar


func _build_save_dialog() -> void:
	_save_dialog = ConfirmationDialog.new()
	_save_dialog.title = "Save preset"
	_save_name = LineEdit.new()
	_save_name.placeholder_text = "Preset name"
	_save_dialog.add_child(_save_name)
	_save_dialog.confirmed.connect(_save_preset)
	add_child(_save_dialog)


func _open_save() -> void:
	_save_name.text = String(rig.current_preset.get("name", "My Sound")) + " (mine)"
	_save_dialog.popup_centered(Vector2i(420, 120))


func _save_preset() -> void:
	var n := _save_name.text.strip_edges()
	if n == "":
		return
	var preset := PresetLibrary.capture(rig.synth, n)
	preset["path"] = PresetLibrary.save_user(preset)
	preset["factory"] = false
	rig.current_preset = preset
	_refresh_presets()
	preset_saved.emit(preset)
	set_status("Saved preset '%s'" % n)


func _button(text: String, cb: Callable, tip := "") -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.pressed.connect(cb)
	return b


## Connects to an autoload's signal and undoes it when this page leaves the tree.
func _link(sig: Signal, cb: Callable) -> void:
	sig.connect(cb)
	_ext_conns.append([sig, cb])


func _exit_tree() -> void:
	for c in _ext_conns:
		if c[0].is_connected(c[1]):
			c[0].disconnect(c[1])
	_ext_conns.clear()


func _show_body() -> void:
	var is_tangle := rig.instrument == "Tangle"
	var sound := _tabs.current_tab == 0
	panel.visible = sound and not is_tangle
	tangle.visible = sound and is_tangle
	seq_view.visible = _tabs.current_tab == 1
	if seq_view.visible:
		seq_view.bind(rig.sequencer, rig.color(), rig.instrument == "Pulsar")


func _on_instrument_changed() -> void:
	var t := rig.instrument
	for i in _inst_select.item_count:
		if _inst_select.get_item_text(i) == t:
			_inst_select.select(i)
	var is_tangle := t == "Tangle"
	_add_module.visible = is_tangle
	if is_tangle:
		if tangle.rig == null:
			tangle.bind(rig)
		else:
			tangle.rebuild()
		var popup := _add_module.get_popup()
		popup.clear()
		var i := 0
		for m in tangle.module_types():
			popup.add_item(m.name, i)
			popup.set_item_metadata(i, m.type)
			popup.set_item_tooltip(i, m.description)
			i += 1
	else:
		panel.rebuild()
	_show_body()
	keys.accent = rig.color()
	keys.drum_mode = t == "Pulsar"
	keys.queue_redraw()
	_refresh_presets()


func _refresh_presets() -> void:
	_presets = PresetLibrary.list(rig.instrument)
	_preset_select.clear()
	for p in _presets:
		_preset_select.add_item(("" if p.factory else "★ ") + String(p.name))
	_sync_preset_select()


func _sync_preset_select() -> void:
	for i in _presets.size():
		if _presets[i].get("path", "") == rig.current_preset.get("path", "-"):
			_preset_select.select(i)
			return


func _step_preset(d: int) -> void:
	if _presets.is_empty():
		return
	var i := (_preset_select.selected + d + _presets.size()) % _presets.size()
	_preset_select.select(i)
	rig.load_preset(_presets[i])


func set_status(extra := "") -> void:
	var dev := "No MIDI devices" if Midi.devices.is_empty() else "MIDI: " + ", ".join(Midi.devices)
	var help := "Keys: A–L play, W E T Y U O P sharps, Z/X octave (%d), C/V velocity (%d)" % [Midi.qwerty_octave, Midi.qwerty_velocity]
	_status.text = "  •  ".join([extra, dev, help].filter(func(s): return s != ""))


func _process(_delta: float) -> void:
	var pk := rig.synth.take_peak()
	_meter.value = maxf(_meter.value * 0.85, maxf(pk.x, pk.y))
	if _pos:
		_pos.text = Transport.position_text() if Transport.running else "1.1"


func _unhandled_key_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed):
		return
	if show_transport and not event.echo and event.physical_keycode == KEY_SPACE:
		Transport.toggle()
		get_viewport().set_input_as_handled()
	else:
		set_status()
