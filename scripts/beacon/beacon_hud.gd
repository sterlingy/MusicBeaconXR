class_name BeaconHud
extends CanvasLayer
## On-screen readout for a BeaconPlayer: key and chord, tempo, the three
## active beacons with their weights, and each part's level.

const ACCENT := Color("ffb547")
const ROLE_COLOR := {"drums": Color("ff8a3d"), "bass": Color("2ec4b6"), "keys": Color("f5c04a"), "lead": Color("ff4f9a"), "pluck": Color("9ccc65"), "texture": Color("8b6cf0")}

var player: BeaconPlayer
var help_text := ""
var title_text := "BEACON FIELD"

var _now: Label
var _sub: Label
var _rows := []
var _parts := {}
var _help: Label
var _flash := 0.0


func _init(p_player: BeaconPlayer) -> void:
	player = p_player


func _ready() -> void:
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.08, 0.1, 0.13, 0.88)
	sb.border_color = Color(0.25, 0.3, 0.38)
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(14)
	panel.add_theme_stylebox_override("panel", sb)
	panel.position = Vector2(16, 16)
	panel.custom_minimum_size = Vector2(360, 0)
	add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	panel.add_child(v)
	var title := _label(title_text, 13, ACCENT)
	v.add_child(title)
	_now = _label("", 22, Color.WHITE)
	v.add_child(_now)
	_sub = _label("", 13, Color(1, 1, 1, 0.6))
	v.add_child(_sub)
	v.add_child(HSeparator.new())
	for i in 3:
		var row := VBoxContainer.new()
		var l := _label("", 14, Color.WHITE)
		row.add_child(l)
		var bar := ProgressBar.new()
		bar.max_value = 1.0
		bar.show_percentage = false
		bar.custom_minimum_size.y = 6
		row.add_child(bar)
		v.add_child(row)
		_rows.append({"label": l, "bar": bar})
	v.add_child(HSeparator.new())
	for role in BeaconMixer.ROLES:
		var h := HBoxContainer.new()
		var l := _label(role.capitalize(), 13, Color.WHITE)
		l.custom_minimum_size.x = 70
		h.add_child(l)
		var bar := ProgressBar.new()
		bar.max_value = 1.0
		bar.show_percentage = false
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar.custom_minimum_size.y = 10
		var fill := StyleBoxFlat.new()
		fill.bg_color = ROLE_COLOR[role]
		fill.set_corner_radius_all(3)
		bar.add_theme_stylebox_override("fill", fill)
		h.add_child(bar)
		v.add_child(h)
		_parts[role] = bar
	_help = _label("", 12, Color(1, 1, 1, 0.5))
	_help.autowrap_mode = TextServer.AUTOWRAP_WORD
	_help.custom_minimum_size.x = 330
	v.add_child(_help)
	player.harmony_changed.connect(func(_i): _flash = 1.0)


func _label(t: String, size: int, color: Color) -> Label:
	var l := Label.new()
	l.text = t
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


func _process(delta: float) -> void:
	var h := player.harmony
	if h.song.is_empty():
		return
	var bar := maxi(0, floori(Transport.current_beat() / 4.0)) if Transport.running else 0
	_now.text = "%s %s  ·  %s" % [BeaconMixer.NOTE_NAMES[int(h.song.key.root)], String(h.song.key.mode), BeaconMixer.chord_name(h.song.key, h.chord_degree(bar))]
	_sub.text = "%d BPM  ·  bar %s  ·  key from %s" % [roundi(Transport.bpm), Transport.position_text() if Transport.running else "–", h.song.title]
	_flash = maxf(0.0, _flash - delta)
	_now.add_theme_color_override("font_color", Color.WHITE.lerp(ACCENT, _flash))
	for i in 3:
		var r: Dictionary = _rows[i]
		if i < player.active.size():
			var a: Dictionary = player.active[i]
			var dist := "%d m" % roundi(a.d) if player.field.kind == "grid" else "%d km" % roundi(a.d)
			r.label.text = "%s  %s  %d%%  · %s%s" % [a.beacon.label, a.song.title, roundi(a.w * 100), dist, "  · key" if a.id == h.id else ""]
			r.bar.value = a.w
		else:
			r.label.text = ""
			r.bar.value = 0
	for role in _parts:
		_parts[role].value = float(player.mix[role].gain) if not player.mix.is_empty() else 0.0
	_help.text = ("Space stop" if Transport.running else "Space PLAY") + "  ·  " + help_text
