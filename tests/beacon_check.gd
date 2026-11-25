extends Node
## Headless check of the Godot beacon player against the browser version.
## godot --headless --path . res://tests/beacon_check.tscn

var failures := 0


func check(ok: bool, msg: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: ", msg)


func _ready() -> void:
	_check_weights()
	_check_fields()
	await _check_player()
	print("beacon_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)


func _check_weights() -> void:
	var fx = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/weights.json"))
	var grid := BeaconField.make_grid()
	var globe := BeaconField.make_globe()
	var worst := 0.0
	for pt in fx:
		var f := grid if pt.field == "grid" else globe
		var p := Vector2(pt.pos.x, pt.pos.y) if pt.field == "grid" else Vector2(pt.pos.lon, pt.pos.lat)
		var got := f.weigh(p)
		for i in pt.w.size():
			check(got[i].id == pt.w[i][0], "%s at %s: beacon %d is %s, browser says %s" % [pt.field, p, i, got[i].id, pt.w[i][0]])
			worst = maxf(worst, absf(got[i].w - float(pt.w[i][1])))
	# Vector2 holds 32-bit floats, so positions round slightly differently than in JavaScript.
	check(worst < 1e-5, "weights match the browser (worst difference %s)" % str(worst))
	print("  weights: %d points match the browser, worst difference %s" % [fx.size(), str(worst)])


func _check_fields() -> void:
	check(BeaconField.make_grid().beacons.size() == 25, "grid has 25 beacons")
	check(BeaconField.make_globe().beacons.size() == 614, "globe has 614 beacons")
	var c := BeaconMixer.chord_name({"root": 0, "mode": "major"}, 1)
	check(c == "Dm", "ii in C major is Dm (got %s)" % c)


func _check_player() -> void:
	var player := BeaconPlayer.new()
	add_child(player)
	check(player.load_songs("res://songs/grid.json") == 25, "grid song pack loads 25 songs")
	var globe := BeaconField.make_globe()
	var globe_songs = JSON.parse_string(FileAccess.get_file_as_string("res://songs/globe.json"))
	check(globe_songs.songs.size() == 614, "globe song pack has 614 songs")
	# Prism parts follow the song's own sound and stay tame.
	var soft := ParamMap.to_synth("lead", {"osc.wave": "sine", "osc2.wave": "triangle", "filter.cutoff": 12000, "filter.resonance": 9.9})
	check(soft["a.type"] == ParamMap.PRISM_ANALOG and soft["a.wave"] == 4 and soft["b.wave"] == 3, "a sine lead plays sines on Prism")
	check(soft["f1.cutoff"] <= 1800.0 * pow(2.0, 0.6) + 1.0 and soft["f1.resonance"] <= 3.0, "a bright song opens the lead's filter only a little")
	player.set_position(Vector2(-38, 27))
	check(player.active.size() == 3, "three active beacons")
	var harmony_changes := []
	player.harmony_changed.connect(func(info): harmony_changes.append(info))
	# Mute and solo, like a mixing desk.
	player.set_muted("drums", true)
	check(not player.audible("drums") and player.audible("bass"), "mute silences one part")
	player.set_soloed("lead", true)
	check(player.audible("lead") and not player.audible("bass") and not player.audible("drums"), "solo plays only the soloed part")
	player.set_soloed("lead", false)
	player.set_muted("drums", false)
	check(player.audible("drums") and player.audible("bass"), "clearing them brings every part back")
	check(not Transport.metronome_on and Transport.count_in_bars == 0, "beacon music starts with no metronome or count-in")
	Transport.start()
	var peaks := {}
	for i in 150:
		await get_tree().process_frame
		for role in player.rigs:
			var pk: Vector2 = player.rigs[role].synth.take_peak()
			peaks[role] = maxf(peaks.get(role, 0.0), maxf(pk.x, pk.y))
	# Walk onto another beacon (E5): after a bar line the harmony must follow it.
	player.set_position(Vector2(200, 200))
	for i in 240:
		await get_tree().process_frame
	Transport.stop()
	var total := 0
	for role in player.played:
		total += player.played[role]
	check(total > 20, "notes were scheduled (%d)" % total)
	check(player.harmony.id == "g44", "harmony followed the listener to E5 (now %s)" % player.harmony.id)
	var line := []
	for role in BeaconPlayer.PARTS:
		line.append("%s %d notes, peak %.2f" % [role, player.played[role], peaks.get(role, 0.0)])
	check(player.played["pad"] >= 1, "the pad held the harmony's chords (%d chord changes)" % player.played["pad"])
	print("  player: ", "; ".join(line))
	print("  harmony changes: ", harmony_changes.map(func(h): return "%s (%s)" % [h.title, h.chord]))
	var sounding := 0
	for role in peaks:
		if peaks[role] > 0.01:
			sounding += 1
	check(sounding >= 3, "at least 3 parts made sound (%d)" % sounding)
	player.queue_free()
	await get_tree().process_frame
