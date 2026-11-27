class_name BeaconWalks
extends CanvasLayer
## Walks in the app: the trail of where you've been, walk recordings,
## replaying them, and recording the sound as WAV. The app twin of
## web/src/walk.js and web/src/walkui.js, with the same "beacon-walk" file
## format, so a walk recorded on the website replays here and the other way
## round (Download / Import go through Documents/MusicBeaconXR/*.walk.json).
## tests/walk_check.gd checks the replay maths against the website's.
##
## Sound is recorded from the Master bus (AudioEffectRecord) to WAV. The app
## has no MP3 encoder; the website exports MP3.
##
##   var walks := BeaconWalks.new()
##   walks.player = player; walks.input = input
##   add_child(walks)
##   walks.lines()   # trail stretches for the scene to draw

const WALK_FORMAT := "beacon-walk"
const WALK_VERSION := 1
const SAMPLE_MIN_S := 0.25
const SAMPLE_MAX_S := 2.0
const TRAIL_MAX := 6000
const WALK_DIR := "user://walks"

var player: BeaconPlayer
var input: Node # ListenerInput: paused while a replay drives the listener
var show_trail := true
var trails := {} # field kind -> [{p, m, t, b}]
var walks: Array = []
var recording := {} # the walk being recorded ({} when not)
var replay := {} # {rec, start, from, export: bool}
var ui_scale := 1.0

var _rec_start := 0.0
var _last_sample := {}
var _saved_at := 0.0
var _audio_on := false
var _audio_started := 0.0
var _toggle: Button
var _panel: PanelContainer
var _jump := false # a jump happened since the last trail point
var _scroll: ScrollContainer
var _list: VBoxContainer
var _msg: Label
var _rec_btn: Button
var _audio_btn: Button
var _time: Label
var _replay_box: HBoxContainer


func _init() -> void:
	name = "BeaconWalks"
	add_to_group("beacon_walks") # the speed button sits beside its button
	layer = 6


func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(WALK_DIR)
	for k in ["grid", "local", "globe"]: # trails used to be kept between launches
		if FileAccess.file_exists("user://trail_%s.json" % k):
			DirAccess.remove_absolute("user://trail_%s.json" % k)
	ui_scale = FieldMenu.PHONE_SCALE if BuildInfo.is_phone() else 1.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--ui-scale="):
			ui_scale = float(a.trim_prefix("--ui-scale="))
	_build()
	_load_walks()
	# Dev: --walks-open shows the panel, --walk-demo draws a sample trail.
	var args := OS.get_cmdline_user_args()
	set_open(args.has("--walks-open"), false)
	if args.has("--walk-demo"):
		var t := []
		for i in 80:
			t.append({"p": {"x": -180.0 + i * 4.5, "y": sin(i / 9.0) * 120.0}, "m": ["Glow", "Tide", "Pulse", "Rush", "Drift"][i / 16], "t": 0, "b": false})
		trails["grid"] = t


# ---------------------------------------------------------------- positions

## The listener's position as stored: {x, y} on the test grid, {lat, lon} elsewhere.
func pos_now() -> Dictionary:
	return pos_of(player.field, player.pos)


static func pos_of(field: BeaconField, p: Vector2) -> Dictionary:
	match field.kind:
		"grid":
			return {"x": snappedf(p.x, 0.01), "y": snappedf(p.y, 0.01)}
		"local":
			var ll := field.to_lat_lon(p)
			return {"lat": snappedf(ll.lat, 1e-7), "lon": snappedf(ll.lon, 1e-7)}
	return {"lat": snappedf(p.y, 1e-7), "lon": snappedf(p.x, 1e-7)}


## A stored position back in the field's own coordinates (or null off a local grid's area).
static func field_pos(field: BeaconField, p: Dictionary) -> Vector2:
	if p.has("x"):
		return Vector2(p.x, p.y)
	if field.kind == "local":
		return field.from_lat_lon(p.lat, p.lon)
	return Vector2(p.lon, p.lat)


static func moved(a: Dictionary, b: Dictionary) -> float:
	return WalkMath.moved(a, b)


# ---------------------------------------------------------------- trail

## The trail of this session (each launch starts clean; Record walk keeps a path).
func trail(kind: String) -> Array:
	if not trails.has(kind):
		trails[kind] = []
	return trails[kind]


## The next trail point follows a jump: the line breaks there and the gap is drawn dotted.
func mark_jump() -> void:
	_jump = true


func _add_trail() -> void:
	var kind := player.field.kind
	var t := trail(kind)
	var p := pos_now()
	var last: Dictionary = t[-1] if not t.is_empty() else {}
	var d := moved(last.get("p", {}), p)
	var min_m := 4.0 if kind == "grid" else (maxf(3.0, player.field.spacing / 40.0) if kind == "local" else 30.0)
	if not last.is_empty() and d < min_m:
		return
	var mood := ""
	var top := 0.0
	for a in player.active:
		if a.w > top:
			top = a.w
			mood = a.song.get("mood", "")
	# A jump (beyond a GPS fix's few meters) or a leap too long to have been walked breaks the line.
	var leap := d > (400.0 if kind == "grid" else 20000.0) or (_jump and d > 4.0 * min_m)
	_jump = false
	t.append({"p": p, "m": mood, "t": Time.get_unix_time_from_system() * 1000.0, "b": not last.is_empty() and leap})
	if t.size() > TRAIL_MAX:
		t = t.slice(t.size() - TRAIL_MAX)
		trails[kind] = t
	if Time.get_ticks_msec() - _saved_at > 10000.0:
		_save_trails()


func _save_trails() -> void:
	_saved_at = Time.get_ticks_msec() # the trail isn't kept between launches any more


## Stretches to draw for the current field: [{pts: [{p, m}], replay}], the
## trail split at jumps, plus a replaying walk's path.
## What to draw: [{pts, replay, jump}]. `jump` lines are the gaps a jump left
## (two points, drawn dotted); the others are walked (or glided) paths.
func lines() -> Array:
	var out := []
	if show_trail:
		var cur := []
		for pt in trail(player.field.kind):
			if pt.b and not cur.is_empty():
				out.append({"pts": cur, "replay": false})
				out.append({"pts": [cur[-1], pt], "replay": false, "jump": true})
				cur = []
			cur.append(pt)
		if not cur.is_empty():
			out.append({"pts": cur, "replay": false})
	if not replay.is_empty() and replay.rec.field.kind == player.field.kind:
		out.append({"pts": replay.rec.samples.map(func(s): return {"p": s.p, "m": ""}), "replay": true})
	return out


# ---------------------------------------------------------------- recording

func start_recording() -> void:
	if not replay.is_empty():
		_say("Stop the replay first.", true)
		return
	var f := player.field
	var info := {"kind": f.kind}
	if f.kind == "local":
		info.merge({"center": {"lat": f.center_lat, "lon": f.center_lon}, "sizeKm": f.size_km, "spacingKm": f.spacing / 1000.0})
	var now := Time.get_unix_time_from_system()
	recording = {"format": WALK_FORMAT, "version": WALK_VERSION, "name": "", "createdAt": floorf(now * 1000.0), "field": info,
		"wallStart": now, "settings": {"sharpness": player.sharpness}, "duration": 0.0, "samples": [], "songs": {}, "beacons": {}}
	_rec_start = Time.get_ticks_msec() / 1000.0
	_last_sample = {}
	sample(recording, 0.0, pos_now(), player.active)
	_render()
	_say("Recording your walk: the path, the blend and the songs.")


## Adds a moment to a recording (same rules as web/src/walk.js WalkRecorder.sample).
func sample(rec: Dictionary, t: float, p: Dictionary, active: Array) -> bool:
	var blend := []
	for a in active:
		if a.w > 1e-4:
			blend.append([a.id, snappedf(a.w, 1e-4)])
	if not _last_sample.is_empty():
		var dt := t - float(_last_sample.t)
		var same: bool = blend.size() == _last_sample.a.size()
		if same:
			for i in blend.size():
				if blend[i][0] != _last_sample.a[i][0] or absf(blend[i][1] - _last_sample.a[i][1]) >= 0.002:
					same = false
		if dt < SAMPLE_MIN_S or (same and dt < SAMPLE_MAX_S):
			rec.duration = maxf(rec.duration, t)
			return false
	for a in active:
		if a.w <= 1e-4:
			continue
		if not rec.songs.has(a.id):
			rec.songs[a.id] = a.song.duplicate(true)
		if not rec.beacons.has(a.id):
			rec.beacons[a.id] = {"label": a.beacon.get("label", a.id), "pos": pos_of(player.field, a.beacon.pos)}
	var s := {"t": snappedf(t, 0.001), "p": p, "a": blend}
	rec.samples.append(s)
	rec.duration = maxf(rec.duration, s.t)
	_last_sample = s
	return true


func stop_recording() -> void:
	var rec := recording
	recording = {}
	var t := Time.get_ticks_msec() / 1000.0 - _rec_start
	rec.duration = maxf(rec.duration, snappedf(t, 0.001))
	if not rec.samples.is_empty() and rec.samples[-1].t < rec.duration:
		var last: Dictionary = rec.samples[-1].duplicate()
		last.t = rec.duration
		rec.samples.append(last)
	if rec.duration < 1.0:
		_render()
		_say("That was too short to keep.")
		return
	rec.id = "walk-%d" % int(rec.createdAt)
	rec.name = "Walk " + Time.get_datetime_string_from_system(false, true).substr(5, 11)
	_write_json("%s/%s.walk.json" % [WALK_DIR, rec.id], rec)
	_load_walks()
	_say("Saved \"%s\" (%s, %d songs)." % [rec.name, clock_text(rec.duration), rec.songs.size()])


# ---------------------------------------------------------------- replay maths

## The walk at `t` seconds (WalkMath, checked against the website's).
static func frame_at(rec: Dictionary, t: float) -> Dictionary:
	return WalkMath.frame_at(rec, t)


static func clock_text(s: float) -> String:
	return WalkMath.clock_text(s)


# ---------------------------------------------------------------- replay

func start_replay(rec: Dictionary, export_wav := false) -> void:
	if not recording.is_empty():
		_say("Stop recording first.", true)
		return
	stop_replay(true)
	if rec.field.kind != player.field.kind:
		_say("This walk was recorded on the %s: open that field to replay it." % _field_name(rec.field.kind), true)
		return
	if not Transport.running:
		Transport.start()
	player.harmony = BeaconMixer.Harmony.new()
	replay = {"rec": rec, "start": Time.get_ticks_msec() / 1000.0, "export": export_wav}
	if input:
		input.enabled = false # walking pauses; looking around (drag, pinch) still works
	if export_wav:
		_record_audio(true)
	_render()
	if export_wav:
		_say("Exporting \"%s\" as WAV: it plays through once (%s)." % [rec.name, clock_text(rec.duration)])
	else:
		_say("Replaying \"%s\"." % rec.name)


func stop_replay(quiet := false) -> Dictionary:
	var r := replay
	if r.is_empty():
		return {}
	replay = {}
	player.replay = []
	if input:
		input.enabled = true
	player.set_position(player.pos)
	_render()
	if not quiet and not r.export:
		_say("Replay stopped.")
	return r


func _tick_replay() -> void:
	var r := replay
	var t: float = Time.get_ticks_msec() / 1000.0 - r.start
	if t >= r.rec.duration:
		stop_replay(true)
		if r.export:
			var path := _record_audio(false, String(r.rec.name))
			_say(("Exported \"%s\" to %s." % [r.rec.name, path]) if path != "" else "The export couldn't be saved.", path == "")
		else:
			_say("\"%s\" finished." % r.rec.name)
		return
	var f := frame_at(r.rec, t)
	var entries := []
	for a in f.active:
		var b: Dictionary = r.rec.beacons.get(a.id, {})
		var bp := field_pos(player.field, b.get("pos", f.pos))
		entries.append({"id": a.id, "w": a.w, "d": 0.0, "beacon": {"id": a.id, "label": b.get("label", a.id), "pos": bp}, "song": r.rec.songs[a.id]})
	player.replay = entries
	if not f.pos.is_empty():
		player.pos = field_pos(player.field, f.pos)
	player.set_position(player.pos)
	_time.text = "%s / %s" % [clock_text(t), clock_text(r.rec.duration)]


# ---------------------------------------------------------------- sound

## Starts or stops recording the Master bus. Stopping saves a WAV in
## Documents/MusicBeaconXR and returns its path ("" on failure).
func _record_audio(on: bool, title := "") -> String:
	var bus := AudioServer.get_bus_index("Master")
	var fx: AudioEffectRecord = null
	for i in AudioServer.get_bus_effect_count(bus):
		if AudioServer.get_bus_effect(bus, i) is AudioEffectRecord:
			fx = AudioServer.get_bus_effect(bus, i)
	if fx == null:
		fx = AudioEffectRecord.new()
		AudioServer.add_bus_effect(bus, fx)
	if on:
		fx.format = AudioStreamWAV.FORMAT_16_BITS
		fx.set_recording_active(true)
		_audio_started = Time.get_ticks_msec()
		return ""
	var wav := fx.get_recording()
	fx.set_recording_active(false)
	if wav == null:
		return ""
	var dir := MyBeacons.exchange_dir()
	DirAccess.make_dir_recursive_absolute(dir)
	var base := title.to_lower().replace(" ", "-").validate_filename() if title != "" else "music-beacon-" + Time.get_datetime_string_from_system().replace(":", "-")
	var path := dir.path_join(base + ".wav")
	return path if wav.save_to_wav(path) == OK else ""


func _toggle_audio() -> void:
	if _audio_on:
		_audio_on = false
		var secs := (Time.get_ticks_msec() - _audio_started) / 1000.0
		var path := _record_audio(false)
		_say(("Saved %s of what you heard to %s." % [clock_text(secs), path]) if path != "" else "Couldn't save the recording.", path == "")
	else:
		if not Transport.running:
			Transport.start()
		_audio_on = true
		_record_audio(true)
		_say("Recording what you hear… tap again to stop and save (WAV).")
	_render()


# ---------------------------------------------------------------- files

func _load_walks() -> void:
	walks = []
	var d := DirAccess.open(WALK_DIR)
	if d:
		for n in d.get_files():
			if n.ends_with(".walk.json"):
				var rec = _read_json("%s/%s" % [WALK_DIR, n])
				if rec is Dictionary and rec.get("format") == WALK_FORMAT:
					walks.append(rec)
	walks.sort_custom(func(a, b): return float(a.createdAt) > float(b.createdAt))
	_render()


func _act(action: String, rec: Dictionary) -> void:
	match action:
		"play":
			start_replay(rec)
		"wav":
			start_replay(rec, true)
		"save":
			var dir := MyBeacons.exchange_dir()
			DirAccess.make_dir_recursive_absolute(dir)
			var path := dir.path_join(String(rec.name).to_lower().replace(" ", "-").validate_filename() + ".walk.json")
			_write_json(path, rec)
			_say("Saved %s." % path)
		"delete":
			if not replay.is_empty() and replay.rec.id == rec.id:
				stop_replay(true)
			DirAccess.remove_absolute(ProjectSettings.globalize_path("%s/%s.walk.json" % [WALK_DIR, rec.id]))
			_load_walks()
			_say("Deleted.")


func _import() -> void:
	var dir := MyBeacons.exchange_dir()
	var d := DirAccess.open(dir)
	var newest := ""
	var t := 0
	if d:
		for n in d.get_files():
			if n.ends_with(".walk.json"):
				var mt := FileAccess.get_modified_time(dir.path_join(n))
				if mt > t:
					t = mt
					newest = n
	if newest == "":
		_say("Put a .walk.json file (downloaded from the website) in %s, then tap Import." % dir, true)
		return
	var rec = _read_json(dir.path_join(newest))
	if not (rec is Dictionary) or rec.get("format") != WALK_FORMAT or rec.get("samples", []).is_empty():
		_say("%s isn't a walk recording." % newest, true)
		return
	rec.id = "walk-%d" % int(Time.get_unix_time_from_system() * 1000.0)
	_write_json("%s/%s.walk.json" % [WALK_DIR, rec.id], rec)
	_load_walks()
	_say("Imported \"%s\"." % rec.name)


static func _read_json(path: String) -> Variant:
	return JSON.parse_string(FileAccess.get_file_as_string(path)) if FileAccess.file_exists(path) else null


static func _write_json(path: String, v: Variant) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(v))


static func _field_name(kind: String) -> String:
	return {"grid": "test grid", "local": "local grid", "globe": "globe"}.get(kind, kind)


# ---------------------------------------------------------------- per frame

func _process(_delta: float) -> void:
	_fit()
	if player == null:
		return
	if not replay.is_empty():
		_tick_replay()
		return
	_add_trail()
	if not recording.is_empty():
		sample(recording, Time.get_ticks_msec() / 1000.0 - _rec_start, pos_now(), player.active)


func _exit_tree() -> void:
	_save_trails()


# ---------------------------------------------------------------- panel

func _fit() -> void:
	var view := get_viewport().get_visible_rect().size
	var ts := minf(ui_scale, (view.x - 24.0) / maxf(1.0, _toggle.size.x))
	_toggle.scale = Vector2(ts, ts)
	_toggle.position = Vector2(view.x - 12.0 - _toggle.size.x * ts, view.y - 12.0 - _toggle.size.y * ts)
	# Full size above the toggle, below the top buttons; what doesn't fit scrolls.
	var room := _toggle.position.y - 8.0 - FieldMenu.BAR * ts
	var s := minf(ui_scale, (view.x - 24.0) / maxf(1.0, _panel.size.x))
	FieldMenu.fit_scroll(_scroll, room / s - 26.0)
	_panel.reset_size()
	# Bottom right, just above the button; it pops open from its bottom-right corner.
	PopupFx.apply(_panel, s, _panel.size, Vector2(view.x - 12.0 - _panel.size.x * s, _toggle.position.y - 8.0 - _panel.size.y * s))


func set_open(open: bool, sound := true) -> void:
	if open:
		PopupFx.claim(self)
	PopupFx.animate(_panel, open, sound)
	if _toggle:
		_toggle.set_pressed_no_signal(open)


func close_popup(except: Object) -> void:
	if except != self and PopupFx.is_open(_panel):
		set_open(false)


func _say(text: String, err := false) -> void:
	if _msg:
		_msg.text = text
		_msg.add_theme_color_override("font_color", Color("ff6b6b") if err else Color("8d9aab"))


func _build() -> void:
	var menu := FieldMenu.new("grid") # for its button and label styles
	_toggle = menu._button("● Walks", func(): set_open(not PopupFx.is_open(_panel)), true)
	add_child(_toggle)
	_panel = PanelContainer.new()
	_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	_panel.visible = false
	add_to_group(PopupFx.GROUP)
	var sb := StyleBoxFlat.new()
	sb.bg_color = FieldMenu.POP_BG
	sb.border_color = FieldMenu.POP_BORDER
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(12)
	sb.set_content_margin_all(12)
	_panel.add_theme_stylebox_override("panel", sb)
	add_child(_panel)
	PopupFx.glass(_panel)
	var v := VBoxContainer.new()
	v.custom_minimum_size = Vector2(340, 0)
	v.add_theme_constant_override("separation", 8)
	_scroll = FieldMenu.scroller(v)
	_panel.add_child(_scroll)
	v.add_child(menu._heading("WALKS · TRAIL, RECORDINGS, SOUND"))
	var r1 := HBoxContainer.new()
	_rec_btn = menu._button("● Record walk", func(): stop_recording() if not recording.is_empty() else start_recording())
	r1.add_child(_rec_btn)
	var tr := CheckBox.new()
	tr.text = "Trail"
	tr.button_pressed = true
	tr.focus_mode = Control.FOCUS_NONE
	tr.toggled.connect(func(on): show_trail = on)
	r1.add_child(tr)
	r1.add_child(menu._button("Clear trail", func(): trails[player.field.kind] = []; _save_trails(); _say("Trail cleared.")))
	v.add_child(r1)
	_audio_btn = menu._button("● Record what I hear (WAV)", _toggle_audio)
	v.add_child(_audio_btn)
	_replay_box = HBoxContainer.new()
	_time = menu._small("")
	_replay_box.add_child(_time)
	_replay_box.add_child(menu._button("■ Stop replay", func(): stop_replay()))
	_replay_box.visible = false
	v.add_child(_replay_box)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED # grows; the panel scrolls
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_list)
	v.add_child(scroll)
	v.add_child(menu._button("Import a walk", _import))
	_msg = menu._small("Recordings and sound files go to " + MyBeacons.exchange_dir())
	v.add_child(_msg)
	menu.free()


func _render() -> void:
	if _list == null:
		return
	_rec_btn.text = "■ Stop recording" if not recording.is_empty() else "● Record walk"
	_audio_btn.text = "■ Stop and save" if _audio_on else "● Record what I hear (WAV)"
	_replay_box.visible = not replay.is_empty()
	for c in _list.get_children():
		c.queue_free()
	var menu := FieldMenu.new("grid")
	if walks.is_empty():
		_list.add_child(menu._small("No walks yet. Tap Record walk and move around (or press T to auto-walk)."))
	for rec in walks:
		var box := VBoxContainer.new()
		var l := Label.new()
		l.text = String(rec.name)
		box.add_child(l)
		box.add_child(menu._small("%s · %s · %d songs" % [clock_text(rec.duration), _field_name(rec.field.kind), rec.songs.size()]))
		var bs := HFlowContainer.new()
		for b in [["▶ Replay", "play"], ["Export WAV", "wav"], ["Save file", "save"], ["Delete", "delete"]]:
			var a: String = b[1]
			var r: Dictionary = rec
			var btn := menu._button(b[0], func(): _act(a, r))
			btn.custom_minimum_size = Vector2(0, 32)
			btn.add_theme_font_size_override("font_size", 13)
			bs.add_child(btn)
		box.add_child(bs)
		_list.add_child(box)
	menu.free()
