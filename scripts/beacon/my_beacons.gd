class_name MyBeacons
extends CanvasLayer
## "My beacons" on the app's globe: the user's own grids, planted songs and
## custom maps (BeaconDrafts), kept in user://beacon_drafts.json. The app twin
## of the website's My beacons panel (web/src/draftsui.js). Step 1 of
## docs/beacon-database-plan.md: no server yet.
##
## The app has no song editor yet, so "Plant" plants the song you're hearing
## most (the loudest beacon), as the plan says.

## The scene moves the listener and the camera there.
signal go_to(lat: float, lon: float, span_km: float)

const ACCENT := Color("ffb547")
const RANGES_M := [100, 250, 500, 1000, 2000, 5000, 10000]
const UID := "u:"

var drafts: BeaconDrafts
var player: BeaconPlayer
## Other people's beacons, by 1 degree tile (step 2).
var shared_map: SharedMap
var _shared_at := -1e9
var _shared_pos := Vector2(INF, INF)
var _shared_label: Label
var _shared_on: CheckBox
## Signing in and sharing (step 3).
var account: BeaconAccount
var _email: LineEdit
var _code: LineEdit
var _signed_out: VBoxContainer
var _signed_in: HBoxContainer
var _who: Label
var _reason: OptionButton
var _terms: ConfirmationDialog
## Following a flight (FlightFollow): the globe scene moves the listener with it.
var flight: FlightFollow
var _flight_q: LineEdit
var _flight_btn: Button
var geo: GeoLocation
## The latest location fix {lat, lon, accuracy, at}; dev: --fakegps=lat,lon[,accuracy].
var fix := {}
var placing := "" # map id while taps put beacons on it
var shares := {}
var ui_scale := 1.0

var _toggle: Button
var _panel: PanelContainer
var _list: VBoxContainer
var _msg: Label
var _status: Label
var _spacing: OptionButton
var _range: OptionButton
var _mode: OptionButton
var _offer_box: VBoxContainer
var _offer_text: Label
var _offer := {}
var _offer_key := ""
var _offer_dismissed := ""
var _wanted := "" # an action waiting for a location fix
var _wanted_arg: Variant = null


func _init() -> void:
	name = "MyBeacons"
	layer = 6


func _ready() -> void:
	drafts = BeaconDrafts.load_file()
	ui_scale = FieldMenu.PHONE_SCALE if BuildInfo.is_phone() else 1.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--ui-scale="):
			ui_scale = float(a.trim_prefix("--ui-scale="))
		elif a.begins_with("--fakegps="):
			var p := a.trim_prefix("--fakegps=").split(",")
			fix = {"lat": float(p[0]), "lon": float(p[1]), "accuracy": float(p[2]) if p.size() > 2 else 10.0, "at": INF, "fake": true}
	geo = GeoLocation.new()
	add_child(geo)
	geo.located.connect(_on_located)
	geo.unavailable.connect(func(reason: String):
		if _wanted != "":
			_say("Couldn't get your location: %s. Beacons can only be made where you are." % reason, true)
			_wanted = "")
	shared_map = SharedMap.new()
	add_child(shared_map)
	account = BeaconAccount.new()
	add_child(account)
	flight = FlightFollow.new()
	add_child(flight)
	shared_map.changed.connect(func(): _rebuild(false))
	player.layer = _layer
	_build()
	_render_list()
	player.set_position(player.pos)


# ---------------------------------------------------------------- the layer

func _layer(pos: Vector2) -> Dictionary:
	var L := drafts.user_layer(pos.y, pos.x)
	shares = BeaconDrafts.layer_shares(L, drafts.pool.exclusive)
	var entries := []
	for a in L.active:
		var e: Dictionary = a.entry
		entries.append({"id": UID + e.key, "w": a.w * L.u, "d": a.d / 1000.0, "song": drafts.song_of(e),
			"beacon": {"id": UID + e.key, "label": label_of(e), "pos": Vector2(e.lon, e.lat), "entry": e}})
	return {"globe_share": shares.globeShare, "entries": entries}


func label_of(e: Dictionary) -> String:
	if e.get("shared", false):
		return "Shared song" if e.kind == "plant" else "Shared grid"
	match e.kind:
		"plant":
			return "Planted"
		"map":
			var m := _find(e.source.id)
			return "%s #%d" % [e.source.name, (m.beacons.find(e.map_beacon) + 1) if not m.is_empty() else 0]
	var km := func(n: int) -> String: return FieldMenu._num(absf(n) * e.spacingM / 1000.0)
	var parts := PackedStringArray()
	if e.north != 0:
		parts.append("%s%s" % [km.call(e.north), "N" if e.north > 0 else "S"])
	if e.east != 0:
		parts.append("%s%s" % [km.call(e.east), "E" if e.east > 0 else "W"])
	return "%s · %s" % [e.source.name, " ".join(parts) if not parts.is_empty() else "center"]


func _changed() -> void:
	_rebuild(true)


## Rebuilds the pool from your drafts and the shared map, and the music with it.
func _rebuild(save: bool) -> void:
	var mine := {}
	for x in drafts.doc.grids + drafts.doc.plants + drafts.doc.maps:
		if x.has("sharedId"):
			mine[x.sharedId] = true
	drafts.shared = {"doc": shared_map.doc(), "song": shared_map.song, "mine": mine}
	drafts.changed(save)
	_offer_key = "x"
	player.set_position(player.pos)
	_render_list()


## The loudest user beacon playing now, or {}.
func loudest_user() -> Dictionary:
	var best := {}
	for a in player.active:
		if String(a.id).begins_with(UID) and (best.is_empty() or a.w > best.w):
			best = a
	return best


# ---------------------------------------------------------------- location

func _on_located(lat: float, lon: float, accuracy_m: float) -> void:
	fix = {"lat": lat, "lon": lon, "accuracy": accuracy_m, "at": Time.get_ticks_msec()}
	if _wanted != "":
		var w := _wanted
		_wanted = ""
		_with_fix(w, _wanted_arg)


## Runs `action` once there's a fresh location fix (asks for one if needed).
func _need_fix(action: String, arg: Variant = null) -> void:
	if not fix.is_empty() and (fix.get("fake", false) or Time.get_ticks_msec() - float(fix.at) < 30000.0):
		_with_fix(action, arg)
		return
	_wanted = action
	_wanted_arg = arg
	_say("Finding you… (allow location if asked)")
	geo.start()


func _with_fix(action: String, arg: Variant) -> void:
	var why := BeaconDrafts.fix_problem(fix)
	if why != "":
		_say(why, true)
		return
	match action:
		"generate":
			_generate(int(arg), "")
		"more":
			_generate(int(_offer.spacingM), String(_offer.center))
		"plant":
			_plant()


func _generate(spacing_m: int, center: String) -> void:
	var g := drafts.make_grid(fix.lat, fix.lon, spacing_m, center)
	if center != "" and not BeaconDrafts.in_grid(g, fix.lat, fix.lon):
		drafts.doc.nextNumber -= 1
		_say("You need to be inside the next grid to make it. Walk on a little and try again.", true)
		return
	for x in drafts.doc.grids:
		if x.center == g.center and int(x.spacingM) == spacing_m:
			drafts.doc.nextNumber -= 1
			_say("%s is already here, with the same spacing." % x.name, true)
			return
	drafts.doc.grids.append(g)
	_changed()
	var c := BeaconDrafts.parse_point(g.center)
	go_to.emit(c.lat, c.lon, (BeaconDrafts.GRID_POINTS + 3) * spacing_m / 1000.0)
	_say("%s: 441 beacons, one every %s, %s km a side, centered where you are.%s" % [g.name, _dist(spacing_m), FieldMenu._num(20.0 * spacing_m / 1000.0), " (test location)" if fix.get("fake", false) else ""])


func _plant() -> void:
	if player.active.is_empty():
		_say("No song is playing here to plant.", true)
		return
	var top: Dictionary = player.active[0]
	for a in player.active:
		if a.w > top.w:
			top = a
	var p := drafts.plant_song(fix.lat, fix.lon, top.song, RANGES_M[_range.selected])
	if p.has("error"):
		_say("Couldn't plant it: " + p.error, true)
		return
	drafts.doc.prefs.plantsOn = true
	_changed()
	_say("Planted \"%s\" where you are, heard within %s." % [p.song.title, _dist(p.rangeM)])


## While placing: a tap on the globe at lon/lat puts a beacon on the map. Returns true when it did.
func place_at(lon: float, lat: float) -> bool:
	if placing == "":
		return false
	var m := _find(placing)
	if m.is_empty():
		placing = ""
		return false
	var why := BeaconDrafts.place_problem(lat, lon)
	if why != "":
		_say(why, true)
		return true
	drafts.add_map_beacon(m, lat, lon, RANGES_M[_range.selected])
	_changed()
	_say("Beacon %d on %s. Tap again for another." % [m.beacons.size(), m.name])
	return true


func _find(id: String) -> Dictionary:
	for g in drafts.doc.grids:
		if g.id == id:
			return g
	for m in drafts.doc.maps:
		if m.id == id:
			return m
	return {}


func _act(action: String, id: String) -> void:
	var item := _find(id)
	if action == "share":
		_share(id)
		return
	match action:
		"toggle":
			if id == "plants":
				drafts.doc.prefs.plantsOn = not drafts.doc.prefs.get("plantsOn", true)
			else:
				item.on = not item.on
		"exclusive":
			item.exclusive = not item.exclusive
		"regen":
			BeaconDrafts.regenerate_all(item)
			_say("New songs on all of %s's generated beacons." % item.name)
		"go":
			if id == "plants":
				if drafts.doc.plants.is_empty():
					return
				var pt := BeaconDrafts.parse_point(drafts.doc.plants[-1].point)
				go_to.emit(pt.lat, pt.lon, 3.0)
			elif item.has("center"):
				var c := BeaconDrafts.parse_point(item.center)
				go_to.emit(c.lat, c.lon, (BeaconDrafts.GRID_POINTS + 3) * int(item.spacingM) / 1000.0)
			elif not item.beacons.is_empty():
				go_to.emit(float(item.beacons[0].lat), float(item.beacons[0].lon), 3.0)
			else:
				_say("%s has no beacons yet: tap Place, then tap the globe." % item.name)
			return
		"place":
			placing = "" if placing == id else id
			if placing != "":
				item.on = true
				_say("Tap the globe to put beacons on %s." % item.name)
		"dup":
			var c := drafts.duplicate_item(item)
			(drafts.doc.maps if item.has("beacons") else drafts.doc.grids).append(c)
		"delete":
			if id == "plants":
				drafts.doc.plants = []
			elif item.has("beacons"):
				drafts.doc.maps.erase(item)
			else:
				drafts.doc.grids.erase(item)
			if placing == id:
				placing = ""
			_say("Deleted.")
	_changed()


# ---------------------------------------------------------------- per frame

func _process(_delta: float) -> void:
	_fit()
	# The shared map: the tiles around you, every minute and soon after you move.
	var p := player.pos
	var now := Time.get_ticks_msec()
	if drafts.doc.prefs.get("sharedOn", true) and (now - _shared_at > 60000.0 or absf(p.x - _shared_pos.x) > 0.05 or absf(p.y - _shared_pos.y) > 0.05):
		_shared_at = now
		_shared_pos = p
		shared_map.update(p.y, p.x)
	var ss := shared_map.stats()
	_shared_label.text = "Shared map: off" if not drafts.doc.prefs.get("sharedOn", true) else \
		("Shared map: can't reach it; your beacons and the globe still play" if ss.offline and ss.tiles == 0 else \
		"Shared map: %d grids, %d songs nearby%s" % [ss.grids, ss.plants, " · offline, playing what's saved" if ss.offline else ""])
	var names: Array = drafts.pool.exclusive.map(func(x): return x.name)
	var line := BeaconDrafts.status_line(shares, names) if not shares.is_empty() else "Global 100%"
	_status.text = line
	_toggle.text = ("★ My beacons  ·  " + line) if not _panel.visible else "★ My beacons"
	var offer := drafts.more_grid_offer(player.pos.y, player.pos.x)
	var key: String = "%s:%s" % [offer.from.id, offer.dir] if not offer.is_empty() else ""
	if key != _offer_key:
		_offer_key = key
		_offer = offer
		_offer_box.visible = key != "" and key != _offer_dismissed
		if _offer_box.visible:
			_offer_text.text = "You've walked out of %s (%s). Generate the next grid along, every %s?" % [offer.from.name, offer.dir, _dist(offer.spacingM)]


## Bottom left: the toggle in the corner, the panel above it (the HUD is top left,
## the field menu top right). The panel shrinks to fit the screen.
func _fit() -> void:
	var view := get_viewport().get_visible_rect().size
	var ts := minf(ui_scale, (view.x - 24.0) / maxf(1.0, _toggle.size.x))
	_toggle.scale = Vector2(ts, ts)
	_toggle.position = Vector2(12, view.y - 12.0 - _toggle.size.y * ts)
	var room := _toggle.position.y - 8.0 - 12.0
	var s := minf(ui_scale, minf(room / maxf(1.0, _panel.size.y), (view.x - 24.0) / maxf(1.0, _panel.size.x)))
	s = maxf(0.4, s)
	_panel.scale = Vector2(s, s)
	_panel.position = Vector2(12, _toggle.position.y - 8.0 - _panel.size.y * s)


static func _dist(m: float) -> String:
	return "%d m" % roundi(m) if m < 1000.0 else "%s km" % FieldMenu._num(m / 1000.0)


func _say(text: String, err := false) -> void:
	_msg.text = text
	_msg.add_theme_color_override("font_color", Color("ff6b6b") if err else Color("8d9aab"))


# ---------------------------------------------------------------- building the panel

func _build() -> void:
	var menu := FieldMenu.new("globe") # only for its button and label styles
	_toggle = menu._button("★ My beacons", func(): _panel.visible = not _panel.visible, true)

	add_child(_toggle)
	_panel = PanelContainer.new()
	_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	_panel.visible = false
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.06, 0.08, 0.11, 0.94)
	sb.border_color = Color("2a3644")
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(12)
	sb.set_content_margin_all(12)
	_panel.add_theme_stylebox_override("panel", sb)
	add_child(_panel)
	var v := VBoxContainer.new()
	v.custom_minimum_size = Vector2(360, 0)
	v.add_theme_constant_override("separation", 8)
	_panel.add_child(v)
	v.add_child(menu._heading("MY BEACONS · ON THIS DEVICE"))
	_status = menu._small("Global 100%")
	_status.add_theme_color_override("font_color", Color.WHITE)
	v.add_child(_status)

	var gen := HBoxContainer.new()
	_spacing = OptionButton.new()
	_spacing.focus_mode = Control.FOCUS_NONE
	for sp in BeaconDrafts.SPACINGS_M:
		_spacing.add_item("every " + _dist(sp))
	_spacing.select(3)
	gen.add_child(_spacing)
	gen.add_child(menu._button("Generate grid here", func(): _need_fix("generate", BeaconDrafts.SPACINGS_M[_spacing.selected])))
	v.add_child(gen)

	_offer_box = VBoxContainer.new()
	_offer_box.visible = false
	_offer_text = menu._small("")
	_offer_text.add_theme_color_override("font_color", ACCENT)
	_offer_box.add_child(_offer_text)
	var ob := HBoxContainer.new()
	ob.add_child(menu._button("Generate the next grid", func(): _need_fix("more")))
	ob.add_child(menu._button("Not now", func(): _offer_dismissed = _offer_key; _offer_box.visible = false))
	_offer_box.add_child(ob)
	v.add_child(_offer_box)

	var pl := HBoxContainer.new()
	pl.add_child(menu._button("Plant this song here", func(): _need_fix("plant")))
	_range = OptionButton.new()
	_range.focus_mode = Control.FOCUS_NONE
	for r in RANGES_M:
		_range.add_item("within " + _dist(r))
	_range.select(2)
	pl.add_child(_range)
	v.add_child(pl)
	v.add_child(menu._small("Plant uses the song you hear most. Making beacons needs your location (lower 48 US for now)."))

	var fl := HBoxContainer.new()
	_flight_q = LineEdit.new()
	_flight_q.placeholder_text = "DL934 or N733YX"
	_flight_q.custom_minimum_size = Vector2(150, 0)
	fl.add_child(_flight_q)
	_flight_btn = menu._button("✈ Follow flight", _toggle_flight)
	fl.add_child(_flight_btn)
	v.add_child(fl)

	var tools := HBoxContainer.new()
	tools.add_child(menu._button("New map", _new_map))
	tools.add_child(menu._button("New song here", _regen_here))
	tools.add_child(menu._button("☆ Favorite", _favorite_here))
	v.add_child(tools)
	var ie := HBoxContainer.new()
	ie.add_child(menu._button("Export all", _export))
	ie.add_child(menu._button("Import", _import))
	v.add_child(ie)

	var mode_row := HBoxContainer.new()
	var ml := menu._small("Shared spots play")
	ml.autowrap_mode = TextServer.AUTOWRAP_OFF
	mode_row.add_child(ml)
	_mode = OptionButton.new()
	_mode.focus_mode = Control.FOCUS_NONE
	for m in BeaconDrafts.PLAY_MODES:
		_mode.add_item(BeaconDrafts.PLAY_MODE_LABEL[m])
	_mode.select(BeaconDrafts.PLAY_MODES.find(drafts.doc.prefs.playMode))
	_mode.item_selected.connect(func(i): drafts.doc.prefs.playMode = BeaconDrafts.PLAY_MODES[i]; _changed())
	mode_row.add_child(_mode)
	v.add_child(mode_row)

	_shared_on = CheckBox.new()
	_shared_on.text = "Play the shared map (other people's beacons)"
	_shared_on.focus_mode = Control.FOCUS_NONE
	_shared_on.button_pressed = drafts.doc.prefs.get("sharedOn", true)
	_shared_on.toggled.connect(func(t): drafts.doc.prefs.sharedOn = t; _changed())
	v.add_child(_shared_on)
	_shared_label = menu._small("Shared map: …")
	v.add_child(_shared_label)

	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(0, 220)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_list)
	v.add_child(scroll)
	_msg = menu._small("")
	v.add_child(_msg)

	# Reporting a shared beacon you hear.
	var rep_row := HBoxContainer.new()
	rep_row.add_child(menu._button("Report what's playing", _report_here))
	_reason = OptionButton.new()
	_reason.focus_mode = Control.FOCUS_NONE
	for r in BeaconAccount.REPORT_REASONS:
		_reason.add_item(r)
	rep_row.add_child(_reason)
	v.add_child(rep_row)

	# Account: email sign-in with the code from the email.
	v.add_child(menu._heading("ACCOUNT (FOR SHARING)"))
	_signed_out = VBoxContainer.new()
	_signed_out.add_child(menu._small("Listening never needs an account. To share, sign in with the 6-digit code we email you."))
	var er := HBoxContainer.new()
	_email = LineEdit.new()
	_email.placeholder_text = "you@example.com"
	_email.custom_minimum_size = Vector2(200, 0)
	_email.virtual_keyboard_type = LineEdit.KEYBOARD_TYPE_EMAIL_ADDRESS
	er.add_child(_email)
	er.add_child(menu._button("Email me a code", _send_code))
	_signed_out.add_child(er)
	var cr := HBoxContainer.new()
	_code = LineEdit.new()
	_code.placeholder_text = "6-digit code"
	_code.custom_minimum_size = Vector2(130, 0)
	_code.virtual_keyboard_type = LineEdit.KEYBOARD_TYPE_NUMBER
	cr.add_child(_code)
	cr.add_child(menu._button("Sign in", _verify_code))
	_signed_out.add_child(cr)
	v.add_child(_signed_out)
	_signed_in = HBoxContainer.new()
	_who = menu._small("")
	_signed_in.add_child(_who)
	_signed_in.add_child(menu._button("Sign out", func(): await account.sign_out(); _say("Signed out. Your beacons stay on this device.")))
	_signed_in.add_child(menu._button("Delete account", _delete_account))
	v.add_child(_signed_in)
	account.signed_in_changed.connect(func(_e): _render_account())
	_render_account()

	_terms = ConfirmationDialog.new()
	_terms.title = "Before you share"
	_terms.dialog_text = BeaconAccount.TERMS_TEXT
	_terms.dialog_autowrap = true
	_terms.size = Vector2i(520, 360)
	_terms.ok_button_text = "I agree, share it"
	_terms.cancel_button_text = "Not now"
	add_child(_terms)
	menu.free()


# ---------------------------------------------------------------- following a flight

func _toggle_flight() -> void:
	if flight.active():
		var f := flight.fix
		flight.stop()
		_flight_btn.text = "✈ Follow flight"
		_say("Stopped following %s." % f.get("reg", "the flight"))
		return
	_say("Looking for %s…" % _flight_q.text)
	var why := await flight.start(_flight_q.text)
	if why != "":
		_say(why, true)
		return
	_flight_btn.text = "■ Stop flight"
	go_to.emit(flight.fix.lat, flight.fix.lon, 1500.0)
	_say("✈ Following %s. Data: adsb.lol (ODbL)." % FlightFollow.describe(flight.fix))


# ---------------------------------------------------------------- sharing (step 3)

func _render_account() -> void:
	_signed_out.visible = not account.signed_in()
	_signed_in.visible = account.signed_in()
	_who.text = "Signed in as %s" % account.email()


func _send_code() -> void:
	if not _email.text.contains("@"):
		_say("Type your email address first.", true)
		return
	var r := await account.send_email(_email.text)
	_say("Sent: type the 6-digit code from the email." if r.ok else "Couldn't send the email: " + r.error, not r.ok)


func _verify_code() -> void:
	var r := await account.verify_code(_email.text, _code.text)
	_say("Signed in. You can share your beacons now." if r.ok else "Couldn't sign in: " + r.error, not r.ok)
	_render_list()


## Signed in and terms accepted (asks once). Returns false after saying why not.
func _ready_to_share(what: String) -> bool:
	if not account.signed_in():
		_say("Sign in (under Account) to %s." % what, true)
		return false
	if not await account.has_consent():
		_terms.popup_centered()
		var accepted := [false]
		var on_ok := func(): accepted[0] = true
		_terms.confirmed.connect(on_ok, CONNECT_ONE_SHOT)
		await _terms.visibility_changed
		if _terms.confirmed.is_connected(on_ok):
			_terms.confirmed.disconnect(on_ok)
		if not accepted[0]:
			_say("Not shared: the terms weren't accepted.")
			return false
		var a := await account.accept_terms()
		if not a.ok:
			_say("Couldn't save that: " + a.error, true)
			return false
	return true


func _share(id: String) -> void:
	if id == "plants":
		var todo: Array = drafts.doc.plants.filter(func(p): return not p.has("sharedId"))
		if todo.is_empty():
			_say("All your planted songs are shared already.")
			return
		if not await _ready_to_share("share your planted songs"):
			return
		for p in todo:
			var r := await account.share_plant(p)
			if not r.ok:
				_say("Couldn't share: " + r.error, true)
				_changed()
				return
		_changed()
		_say("Shared %d planted songs." % todo.size())
		return
	var item := _find(id)
	var table := "maps" if item.has("beacons") else "grids"
	if not await _ready_to_share("share " + item.name):
		return
	var r: Dictionary
	if item.has("sharedId"):
		r = await account.unshare(table, item)
	elif table == "maps":
		r = await account.share_map(item)
	else:
		r = await account.share_grid(item)
	_changed()
	if not r.ok:
		_say("Couldn't do that: " + r.error, true)
	else:
		_say("%s is %s." % [item.name, "shared" if item.has("sharedId") else "no longer shared"])


func _report_here() -> void:
	var best := {}
	for a in player.active:
		var e: Dictionary = a.get("beacon", {}).get("entry", {})
		if e.get("shared", false) and (best.is_empty() or a.w > best.w):
			best = a
	if best.is_empty():
		_say("No shared beacon is playing here.", true)
		return
	if not await _ready_to_share("report it"):
		return
	var r := await account.report(best.beacon.entry, BeaconAccount.REPORT_REASONS[_reason.selected])
	_say("Thanks: reported. After reports from 3 people it's hidden until it's reviewed." if r.ok else "Couldn't report it: " + r.error, not r.ok)


func _delete_account() -> void:
	var r := await account.delete_account()
	if r.ok:
		for x in drafts.doc.grids + drafts.doc.plants + drafts.doc.maps:
			x.erase("sharedId")
		_changed()
	_say("Your account and everything you shared are deleted." if r.ok else "Couldn't delete it: " + r.error, not r.ok)


func _render_list() -> void:
	if _list == null:
		return
	for c in _list.get_children():
		c.queue_free()
	var menu := FieldMenu.new("globe")
	var rows := 0
	for g in drafts.doc.grids:
		_row(menu, g.id, g.on, g.tint, g.name, "441 beacons · every %s · %s km a side%s" % [_dist(g.spacingM), FieldMenu._num(20.0 * g.spacingM / 1000.0), " · shared" if g.has("sharedId") else ""],
			[["Go", "go"], ["Unshare" if g.has("sharedId") else "Share", "share"], ["New songs", "regen"], ["Copy", "dup"], ["Delete", "delete"]])
		rows += 1
	for m in drafts.doc.maps:
		_row(menu, m.id, m.on, m.tint, m.name, "custom map · %d beacons%s%s" % [m.beacons.size(), " · exclusive" if m.exclusive else "", " · shared" if m.has("sharedId") else ""],
			[["Go", "go"], ["Unshare" if m.has("sharedId") else "Share", "share"], ["Done" if placing == m.id else "Place", "place"], ["Exclusive", "exclusive"], ["Copy", "dup"], ["Delete", "delete"]])
		rows += 1
	if not drafts.doc.plants.is_empty():
		_row(menu, "plants", drafts.doc.prefs.get("plantsOn", true), BeaconDrafts.PLANT_TINT, "Planted songs", "%d planted where you were" % drafts.doc.plants.size(),
			[["Go", "go"], ["Share all", "share"], ["Delete all", "delete"]])
		rows += 1
	if rows == 0:
		_list.add_child(menu._small("Nothing yet. Generate a grid or plant a song where you are, or start a custom map."))
	menu.free()


func _row(menu: FieldMenu, id: String, on: bool, tint: String, title: String, sub: String, buttons: Array) -> void:
	var box := VBoxContainer.new()
	var top := HBoxContainer.new()
	var cb := CheckBox.new()
	cb.button_pressed = on
	cb.focus_mode = Control.FOCUS_NONE
	cb.toggled.connect(func(_t): _act("toggle", id))
	top.add_child(cb)
	var sw := ColorRect.new()
	sw.color = Color(tint)
	sw.custom_minimum_size = Vector2(12, 12)
	sw.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	top.add_child(sw)
	var l := Label.new()
	l.text = title
	top.add_child(l)
	box.add_child(top)
	box.add_child(menu._small(sub))
	var bs := HFlowContainer.new()
	for b in buttons:
		var a: String = b[1]
		var btn := menu._button(b[0], func(): _act(a, id))
		btn.custom_minimum_size = Vector2(0, 32)
		btn.add_theme_font_size_override("font_size", 13)
		bs.add_child(btn)
	box.add_child(bs)
	_list.add_child(box)


func _new_map() -> void:
	var m := drafts.make_map("")
	drafts.doc.maps.append(m)
	placing = m.id
	_changed()
	_say("%s: tap the globe to put beacons on it, from anywhere. Only you edit it." % m.name)


func _regen_here() -> void:
	var a := loudest_user()
	if a.is_empty():
		_say("None of your beacons is playing here.", true)
		return
	var e: Dictionary = a.beacon.entry
	if e.get("shared", false):
		_say("That's a shared beacon: it belongs to whoever made it. Plant your own song instead.", true)
		return
	match e.kind:
		"plant":
			_say("A planted song is hand-made: it has no generated song.", true)
			return
		"map":
			e.map_beacon.erase("song")
			e.map_beacon.variant = int(e.map_beacon.get("variant", 0)) + 1
		_:
			BeaconDrafts.regenerate_one(e.grid, e.point)
	_changed()
	_say("New song on %s." % label_of(e))


func _favorite_here() -> void:
	var a := loudest_user()
	if a.is_empty():
		_say("None of your beacons is playing here.", true)
		return
	var e: Dictionary = a.beacon.entry
	var fav: Dictionary = drafts.doc.prefs.favorites
	if fav.get(e.point, "") == e.key:
		fav.erase(e.point)
		_say("Took the favorite off \"%s\"." % a.song.title)
	else:
		fav[e.point] = e.key
		_say("\"%s\" is your favorite at this spot (favorited 1×)." % a.song.title)
	_changed()


## Export and import go through the Documents folder (MusicBeaconXR/*.beacons.json),
## so the files can be moved to and from the website.
static func exchange_dir() -> String:
	return OS.get_system_dir(OS.SYSTEM_DIR_DOCUMENTS).path_join("MusicBeaconXR")


func _export() -> void:
	DirAccess.make_dir_recursive_absolute(exchange_dir())
	var p := exchange_dir().path_join("my-beacons.beacons.json")
	var f := FileAccess.open(p, FileAccess.WRITE)
	if f == null:
		_say("Couldn't write %s." % p, true)
		return
	f.store_string(JSON.stringify(drafts.doc))
	_say("Saved %s." % p)


func _import() -> void:
	var dir := DirAccess.open(exchange_dir())
	if dir == null:
		_say("Put a .beacons.json file (exported from the website) in %s, then tap Import." % exchange_dir(), true)
		return
	var newest := ""
	var t := 0
	for n in dir.get_files():
		if n.ends_with(".beacons.json") and n != "my-beacons.beacons.json":
			var mt := FileAccess.get_modified_time(exchange_dir().path_join(n))
			if mt > t:
				t = mt
				newest = n
	if newest == "":
		_say("No .beacons.json file to import in %s (other than this device's own export)." % exchange_dir(), true)
		return
	var data = JSON.parse_string(FileAccess.get_file_as_string(exchange_dir().path_join(newest)))
	var errs := BeaconDrafts.validate_doc(data)
	if not errs.is_empty():
		_say("Not imported: %s" % "; ".join(errs.slice(0, 3)), true)
		return
	var n := drafts.merge_doc(data)
	_changed()
	_say("Imported %s: %d grids, %d maps, %d planted songs, as copies." % [newest, n.grids, n.maps, n.plants])
