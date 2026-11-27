class_name TravelUi
extends CanvasLayer
## Where to go, and how: the card a long press (or right-click) on the globe or
## a grid opens, with the place under your finger and two choices:
##   Jump  there at once;
##   Move  glide there, hearing the music change on the way.
## Tapping outside the card (or Android's back gesture) cancels. Also the
## "Back to me" button, shown while the view has been turned away from you.
##
##   var ui := TravelUi.new()
##   add_child(ui)
##   ui.chosen.connect(func(kind, pos): ...)   # "jump" or "move"
##   ui.open(screen_point, pos, "Neon Field", "1,240 km away")

signal chosen(kind: String, pos: Vector2)
signal closed()
signal back_pressed()

var ui_scale := 1.0
var pos := Vector2.ZERO # the place the card is about
var _at := Vector2.ZERO # screen point it opened at
var _blocker: Control
var _card: PanelContainer
var _title: Label
var _detail: Label
var _back: Button


func _init() -> void:
	name = "TravelUi"
	layer = 7
	add_to_group(PopupFx.GROUP)


func _ready() -> void:
	ui_scale = FieldMenu.PHONE_SCALE if BuildInfo.is_phone() else 1.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--ui-scale="):
			ui_scale = float(a.trim_prefix("--ui-scale="))
	var menu := FieldMenu.new("grid") # for its button and label styles
	_blocker = Control.new()
	_blocker.set_anchors_preset(Control.PRESET_FULL_RECT)
	_blocker.mouse_filter = Control.MOUSE_FILTER_STOP
	_blocker.visible = false
	_blocker.gui_input.connect(func(e: InputEvent):
		if (e is InputEventMouseButton or e is InputEventScreenTouch) and e.pressed:
			close())
	add_child(_blocker)

	_card = PanelContainer.new()
	_card.mouse_filter = Control.MOUSE_FILTER_STOP
	_card.visible = false
	var sb := StyleBoxFlat.new()
	sb.bg_color = FieldMenu.POP_BG
	sb.border_color = FieldMenu.ACCENT
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(14)
	sb.set_content_margin_all(14)
	sb.shadow_color = Color(0, 0, 0, 0.45)
	sb.shadow_size = 10
	_card.add_theme_stylebox_override("panel", sb)
	add_child(_card)
	PopupFx.glass(_card)
	var v := VBoxContainer.new()
	v.custom_minimum_size = Vector2(250, 0)
	v.add_theme_constant_override("separation", 8)
	_card.add_child(v)
	_title = Label.new()
	_title.add_theme_font_size_override("font_size", 18)
	_title.add_theme_color_override("font_color", Color.WHITE)
	v.add_child(_title)
	_detail = menu._small("")
	_detail.autowrap_mode = TextServer.AUTOWRAP_OFF # short; wrapping at zero width made the card tall
	v.add_child(_detail)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	v.add_child(row)
	for c in [["⚡ Jump", "jump", "Go there at once"], ["➜ Move", "move", "Glide there, hearing the music change on the way"]]:
		var kind: String = c[1]
		var b := menu._button(c[0], func(): _choose(kind))
		b.tooltip_text = c[2]
		b.custom_minimum_size = Vector2(112, 44)
		b.add_theme_font_size_override("font_size", 17)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(b)

	_back = menu._button("⌖ Back to me", func(): back_pressed.emit())
	_back.visible = false
	add_child(_back)
	menu.free()


## The card's words for a place: the beacon there if one is within `snap`
## (field units: km on the globe, meters on grids), else the spot itself, and
## how far it is. Returns {pos (snapped to the beacon), title, detail}.
static func describe(player: BeaconPlayer, p_pos: Vector2, snap: float) -> Dictionary:
	var f := player.field
	var near: Array = f.nearest(p_pos, 1)
	var at := p_pos
	var title := ""
	if not near.is_empty() and near[0].d <= snap:
		var b: Dictionary = near[0].beacon
		at = b.pos
		var song := player.song_for(b.id)
		title = "%s · %s" % [song.title, b.label] if not song.is_empty() else String(b.label)
	elif f.kind == "globe":
		title = "%.1f°%s %.1f°%s" % [absf(p_pos.y), "N" if p_pos.y >= 0.0 else "S", absf(p_pos.x), "E" if p_pos.x >= 0.0 else "W"]
	else:
		title = "This spot"
	var d := f.distance(player.pos, at)
	var how_far := ""
	if f.kind == "globe":
		how_far = "%d m away" % roundi(d * 1000.0) if d < 1.0 else ("%.1f km away" % d if d < 10.0 else "%s km away" % _thousands(roundi(d)))
	else:
		how_far = "%d m away" % roundi(d) if d < 1000.0 else "%.1f km away" % (d / 1000.0)
	return {"pos": at, "title": title, "detail": how_far}


static func _thousands(n: int) -> String:
	var s := str(n)
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return s + out


func is_open() -> bool:
	return PopupFx.is_open(_card)


func close_popup(except: Object) -> void:
	if except != self and is_open():
		close()


## Opens the card next to `screen` (where the finger was) about `p_pos`.
func open(screen: Vector2, p_pos: Vector2, title: String, detail: String) -> void:
	pos = p_pos
	_at = screen
	_title.text = title
	_detail.text = detail
	PopupFx.claim(self)
	_blocker.visible = true
	PopupFx.animate(_card, true)
	_card.reset_size()
	get_tree().quit_on_go_back = false


func close() -> void:
	if not is_open():
		return
	PopupFx.animate(_card, false)
	_blocker.visible = false
	get_tree().quit_on_go_back = true
	closed.emit()


func set_back_visible(on: bool) -> void:
	if _back.visible != on:
		_back.visible = on


func _choose(kind: String) -> void:
	PopupFx.animate(_card, false)
	_blocker.visible = false
	get_tree().quit_on_go_back = true
	chosen.emit(kind, pos)


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST and is_open():
		close()


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE and is_open():
		close()
		get_viewport().set_input_as_handled()


func _process(_delta: float) -> void:
	var view := get_viewport().get_visible_rect().size
	if _card.visible:
		_card.reset_size()
		# Beside the finger (above it, so the finger doesn't hide it), kept on screen.
		var s := minf(ui_scale, (view.x - 24.0) / maxf(1.0, _card.size.x))
		var sz := _card.size * s
		var p := _at + Vector2(-sz.x * 0.5, -sz.y - 28.0 * s)
		if p.y < 12.0:
			p.y = _at.y + 28.0 * s # no room above: below the finger
		var top_left := Vector2(clampf(p.x, 12.0, view.x - 12.0 - sz.x), clampf(p.y, 12.0, view.y - 12.0 - sz.y))
		PopupFx.apply(_card, s, Vector2(_card.size.x * 0.5, _card.size.y), top_left) # pops up out of the finger
	if _back.visible:
		# Bottom middle, between My beacons (left) and Walks (right).
		var bs := minf(ui_scale, (view.x * 0.3) / maxf(1.0, _back.size.x))
		_back.scale = Vector2(bs, bs)
		_back.position = Vector2((view.x - _back.size.x * bs) * 0.5, view.y - 12.0 - _back.size.y * bs)
