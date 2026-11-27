extends Node
## The walking trail: each launch starts clean, a jump breaks the line and
## leaves a dotted gap (GPS-sized hops don't), and the readout folds away.
##   godot --headless --path . res://tests/trail_check.tscn

var failures := 0


func check(ok: bool, what: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: " + what)


func _ready() -> void:
	# An old saved trail is gone on the next start.
	var f := FileAccess.open("user://trail_grid.json", FileAccess.WRITE)
	f.store_string("[{\"p\": {\"x\": 1, \"y\": 1}, \"m\": \"\", \"t\": 0, \"b\": false}]")
	f.close()
	var player := BeaconPlayer.new()
	player.field = BeaconField.make_grid()
	add_child(player)
	var walks := BeaconWalks.new()
	walks.player = player
	add_child(walks)
	await get_tree().process_frame
	check(walks.trail("grid").is_empty() and not FileAccess.file_exists("user://trail_grid.json"), "a clean start: no old trail")
	for p in [Vector2(0, 0), Vector2(10, 0), Vector2(15, 0)]:
		player.pos = p
		walks._add_trail()
	walks.mark_jump()
	player.pos = Vector2(22, 0) # a GPS-sized hop after a "jump": still walking
	walks._add_trail()
	walks.mark_jump()
	player.pos = Vector2(200, 0)
	walks._add_trail()
	player.pos = Vector2(210, 0)
	walks._add_trail()
	var kinds := walks.lines().map(func(l): return [l.get("jump", false), l.pts.size()])
	check(kinds == [[false, 4], [true, 2], [false, 2]], "a jump leaves a dotted gap between walked stretches (%s)" % [kinds])

	var hud := BeaconHud.new(player)
	add_child(hud)
	await get_tree().process_frame
	check(not hud.collapsed, "desktop starts with the parts showing")
	hud.set_collapsed(true)
	check(hud._body.size() >= 1 and hud._body.all(func(c): return not c.visible), "folded: only the key line shows")
	hud.set_collapsed(false)
	check(hud._body.all(func(c): return c.visible or c == hud._help), "unfolded again")
	print("trail_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)
