class_name RemixUi
extends CanvasLayer
## The Remix window: your own settings over whatever is playing (scripts/beacon/remix.gd).
## Opened from the song panel's Remix button. Eight dials (energy, brightness,
## space, mood, tempo, key, character, width), every part's level and sound,
## Dice, Hold and Reset, saved flavours, and "Place my version here", which
## plants what you hear as a new beacon (My beacons' planting, needs your location).
##
##   var ui := RemixUi.new()
##   ui.player = player
##   add_child(ui)
##   ui.set_open(true)

const FLAVOURS_KEY := "remix_flavours"

var player: BeaconPlayer
var ui_scale := 1.0
var _panel: PanelContainer
var _scroll: ScrollContainer
var _on: CheckButton
var _hold: Button
var _dials := {} # id -> [HSlider, value Label]
var _levels := {} # part -> HSlider
var _swaps := {} # part -> Button
var _msg: Label
var _name: LineEdit
var _flavours: OptionButton
var _syncing := false


func _init() -> void:
	name = "RemixUi"
	layer = 7
	add_to_group(PopupFx.GROUP)


func _ready() -> void:
	ui_scale = FieldMenu.PHONE_SCALE if BuildInfo.is_phone() else 1.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--ui-scale="):
			ui_scale = float(a.trim_prefix("--ui-scale="))
	var menu := FieldMenu.new("grid")
	_panel = PanelContainer.new()
	_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	var sb := StyleBoxFlat.new()
	sb.bg_color = FieldMenu.POP_BG
	sb.border_color = FieldMenu.POP_BORDER
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(12)
	sb.set_content_margin_all(14)
	_panel.add_theme_stylebox_override("panel", sb)
	_panel.visible = false
	add_child(_panel)
	PopupFx.glass(_panel)
	var v := VBoxContainer.new()
	v.custom_minimum_size = Vector2(500, 0)
	v.add_theme_constant_override("separation", 6)
	_scroll = FieldMenu.scroller(v)
	_panel.add_child(_scroll)

	var head := HBoxContainer.new()
	var h := menu._heading("REMIX · MAKE IT YOURS")
	h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(h)
	_on = CheckButton.new()
	_on.text = "On"
	_on.focus_mode = Control.FOCUS_NONE
	_on.toggled.connect(func(_t): _push())
	head.add_child(_on)
	var close := menu._button("✕", func(): set_open(false))
	close.custom_minimum_size = Vector2(40, 32)
	head.add_child(close)
	v.add_child(head)
	v.add_child(menu._small("Off: everything plays as written. On: your settings shape what you hear, wherever you go."))

	# The dials.
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 10)
	for d in Remix.DIALS:
		var id: String = d[0]
		var l := Label.new()
		l.text = d[1]
		l.add_theme_font_size_override("font_size", 15)
		l.custom_minimum_size.x = 96
		grid.add_child(l)
		var s := HSlider.new()
		s.min_value = d[2]
		s.max_value = d[3]
		s.step = d[4]
		s.custom_minimum_size = Vector2(260, 30)
		s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		s.focus_mode = Control.FOCUS_NONE
		s.value_changed.connect(func(_x): _push())
		grid.add_child(s)
		var val := Label.new()
		val.add_theme_font_size_override("font_size", 14)
		val.add_theme_color_override("font_color", Color(1, 1, 1, 0.75))
		val.custom_minimum_size.x = 90
		grid.add_child(val)
		_dials[id] = [s, val]
	v.add_child(grid)

	# The parts: level and sound.
	v.add_child(menu._heading("PARTS · LEVEL AND SOUND"))
	var pg := GridContainer.new()
	pg.columns = 3
	pg.add_theme_constant_override("h_separation", 10)
	for part in Remix.PARTS:
		var l := Label.new()
		l.text = String(part).capitalize()
		l.add_theme_font_size_override("font_size", 15)
		l.custom_minimum_size.x = 96
		pg.add_child(l)
		var s := HSlider.new()
		s.min_value = 0.0
		s.max_value = Remix.LEVEL_MAX
		s.step = 0.05
		s.value = 1.0
		s.custom_minimum_size = Vector2(200, 30)
		s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		s.focus_mode = Control.FOCUS_NONE
		s.value_changed.connect(func(_x): _push())
		pg.add_child(s)
		_levels[part] = s
		var opts: Array = Remix.SWAPS[part]
		var p: String = part
		var b := menu._button("Own sound", func(): _next_swap(p))
		b.custom_minimum_size = Vector2(150, 34)
		b.add_theme_font_size_override("font_size", 13)
		b.disabled = opts.size() <= 1
		b.tooltip_text = "Swap sound: step through this part's other instruments"
		pg.add_child(b)
		_swaps[part] = b
	v.add_child(pg)

	# Dice, Hold, Reset.
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	for spec in [["🎲 Dice", func(): _dice()], ["Reset", func(): _reset()]]:
		var b := menu._button(spec[0], spec[1])
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(b)
	_hold = menu._button("Hold", func(): _push(), true)
	_hold.tooltip_text = "Freeze the blend: the music stops changing as you move"
	_hold.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_hold)
	v.add_child(row)

	# Place my version.
	var place := menu._button("Place my version here", func(): _place())
	place.tooltip_text = "Plants what you hear as a new beacon where you are (needs your location)"
	v.add_child(place)
	_msg = menu._small("")
	v.add_child(_msg)

	# Saved flavours.
	v.add_child(menu._heading("FLAVOURS"))
	var fr := HBoxContainer.new()
	fr.add_theme_constant_override("separation", 6)
	_name = LineEdit.new()
	_name.placeholder_text = "Name this flavour"
	_name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_name.custom_minimum_size.y = 36
	fr.add_child(_name)
	fr.add_child(menu._button("Save", func(): _save_flavour()))
	v.add_child(fr)
	var lr := HBoxContainer.new()
	lr.add_theme_constant_override("separation", 6)
	_flavours = OptionButton.new()
	_flavours.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_flavours.focus_mode = Control.FOCUS_NONE
	lr.add_child(_flavours)
	lr.add_child(menu._button("Load", func(): _load_flavour()))
	lr.add_child(menu._button("Delete", func(): _delete_flavour()))
	v.add_child(lr)
	menu.free()
	_list_flavours()
	var mine := get_tree().get_first_node_in_group("my_beacons")
	if mine and mine.has_signal("said"):
		mine.said.connect(func(text: String, err: bool):
			if PopupFx.is_open(_panel):
				_say(text, err))
	if player:
		player.remix_changed.connect(_pull)
	_pull()


## The settings as the window shows them.
func settings() -> Dictionary:
	var s := Remix.defaults()
	s.on = _on.button_pressed
	s.hold = _hold.button_pressed
	for id in _dials:
		s[id] = float(_dials[id][0].value)
	for part in Remix.PARTS:
		s.parts[part].level = float(_levels[part].value)
		s.parts[part].swap = int(_swaps[part].get_meta("swap", 0))
	return s


func _push() -> void:
	if _syncing:
		return
	_show_values()
	if player:
		player.set_remix(settings())


## Shows the player's settings (it may change them too: the song panel's switch, a flavour).
func _pull() -> void:
	if player == null:
		return
	_syncing = true
	var s: Dictionary = player.remix
	_on.set_pressed_no_signal(s.on)
	_hold.set_pressed_no_signal(s.hold)
	for id in _dials:
		_dials[id][0].set_value_no_signal(float(s[id]))
	for part in Remix.PARTS:
		_levels[part].set_value_no_signal(float(s.parts[part].level))
		_swaps[part].set_meta("swap", int(s.parts[part].swap))
	_syncing = false
	_show_values()


func _show_values() -> void:
	for id in _dials:
		var x: float = _dials[id][0].value
		var t := ""
		match id:
			"key":
				t = "as written" if x == 0.0 else "%+d semitones" % roundi(x)
			"mood":
				t = "as written" if x == 0.0 else ("%s, %d step%s" % ["brighter" if x > 0.0 else "darker", roundi(absf(x) * 2.0), "" if roundi(absf(x) * 2.0) == 1 else "s"])
			"tempo":
				t = "as written" if x == 0.0 else "%+d%%" % roundi(x * 15.0)
			_:
				t = "as written" if x == 0.0 else "%+d%%" % roundi(x * 100.0)
		_dials[id][1].text = t
	for part in Remix.PARTS:
		var i: int = _swaps[part].get_meta("swap", 0)
		_swaps[part].text = swap_label(Remix.SWAPS[part][i])


## "wave:sine" -> "Sine synth", "sample:flute" -> "Flute", "model:bell" -> "Bell".
static func swap_label(sw: String) -> String:
	if sw == "own":
		return "Own sound"
	if sw == "synth":
		return "Synth"
	var parts := sw.split(":")
	if parts[0] == "kit":
		return String(parts[1]) # a SynthKit preset's own name
	var n := String(parts[1]).replace("_", " ").capitalize()
	return n + " synth" if parts[0] == "wave" else n


func _next_swap(part: String) -> void:
	var i: int = (_swaps[part].get_meta("swap", 0) + 1) % Remix.SWAPS[part].size()
	_swaps[part].set_meta("swap", i)
	if not _on.button_pressed:
		_on.set_pressed_no_signal(true) # changing the sound means you want to hear it
	_push()


func _dice() -> void:
	var s := Remix.dice(settings())
	s.on = true
	if player:
		player.set_remix(s)
	_say("Rolled a new flavour. Keep turning, or Dice again.")


func _reset() -> void:
	var s := Remix.defaults()
	s.on = _on.button_pressed
	if player:
		player.set_remix(s)
	_say("Back to as written.")


func _place() -> void:
	if not _on.button_pressed or Remix.is_neutral(settings()):
		_say("Turn Remix on and change something first: then what you hear is yours to place.", true)
		return
	var mine := get_tree().get_first_node_in_group("my_beacons")
	if mine == null or not mine.has_method("place_my_version"):
		_say("Placing beacons works on the globe: open the Globe field.", true)
		return
	_say("Finding you…")
	mine.place_my_version()


func _say(text: String, err := false) -> void:
	_msg.text = text
	_msg.add_theme_color_override("font_color", Color("ff6b6b") if err else Color("8d9aab"))


# ---- flavours (FieldPrefs "remix_flavours": {name: settings})

func _all_flavours() -> Dictionary:
	var f = FieldPrefs.get_value(FLAVOURS_KEY, {})
	return f if f is Dictionary else {}


func _list_flavours() -> void:
	_flavours.clear()
	var f := _all_flavours()
	var names: Array = f.keys()
	names.sort()
	if names.is_empty():
		_flavours.add_item("No flavours saved yet")
		_flavours.disabled = true
		return
	_flavours.disabled = false
	for n in names:
		_flavours.add_item(n)


func _save_flavour() -> void:
	var n := _name.text.strip_edges().substr(0, 40)
	if n == "":
		_say("Give the flavour a name first.", true)
		return
	var f := _all_flavours()
	var s := settings()
	s.hold = false
	f[n] = s
	FieldPrefs.set_value(FLAVOURS_KEY, f)
	_name.text = ""
	_list_flavours()
	_say("Saved \"%s\"." % n)


func _load_flavour() -> void:
	if _flavours.disabled:
		return
	var n := _flavours.get_item_text(_flavours.selected)
	var s := Remix.normalize(_all_flavours().get(n, {}))
	s.on = true
	s.hold = _hold.button_pressed
	if player:
		player.set_remix(s)
	_say("Playing your \"%s\" flavour." % n)


func _delete_flavour() -> void:
	if _flavours.disabled:
		return
	var n := _flavours.get_item_text(_flavours.selected)
	var f := _all_flavours()
	f.erase(n)
	FieldPrefs.set_value(FLAVOURS_KEY, f)
	_list_flavours()
	_say("Deleted \"%s\"." % n)


# ---- the window

func set_open(open: bool, sound := true) -> void:
	if open:
		PopupFx.claim(self)
		_pull()
	PopupFx.animate(_panel, open, sound)


func is_open() -> bool:
	return PopupFx.is_open(_panel)


func close_popup(except: Object) -> void:
	if except != self and PopupFx.is_open(_panel):
		set_open(false)


## Top left, where the song panel sits (it folds away while this is open).
func _process(_delta: float) -> void:
	if not _panel.visible:
		return
	var view := get_viewport().get_visible_rect().size
	# Never under the top-right buttons (they'd take the taps meant for this window).
	var menu := get_tree().get_first_node_in_group("field_menu")
	var right: float = menu.row_left() - 12.0 if menu and menu.has_method("row_left") else view.x - 12.0
	var s := minf(ui_scale, (right - 12.0) / 540.0)
	FieldMenu.fit_scroll(_scroll, (view.y - 40.0) / s - 30.0)
	_panel.reset_size()
	PopupFx.apply(_panel, s, Vector2.ZERO, Vector2(12, 12))
