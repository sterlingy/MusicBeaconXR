extends Node
## Pop-out windows: one open at a time (opening one closes the others), each
## animates open and closed (hidden once its close finishes), with a swoosh.
##   godot --headless --path . res://tests/popup_check.tscn

var failures := 0


func check(ok: bool, what: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: " + what)


func wait(s: float) -> void:
	await get_tree().create_timer(s).timeout


func _ready() -> void:
	var g: Node = load("res://scenes/globe_field.tscn").instantiate()
	add_child(g)
	await wait(0.3)
	var fields: Control = g.menu.panel
	var walks: Control = g.walks._panel
	var mine: Control = g.mine._panel
	check(not fields.visible and not walks.visible and not mine.visible, "all closed at the start")
	g.menu.set_open(true)
	await wait(0.05)
	check(PopupFx.is_open(fields) and fields.visible and fields.modulate.a < 1.0, "Fields opens, fading in (alpha %.2f)" % fields.modulate.a)
	await wait(0.4)
	check(fields.modulate.a > 0.99 and absf(fields.scale.x / g.menu.ui_scale - 1.0) < 0.05 or fields.modulate.a > 0.99, "and settles fully open")
	g.walks.set_open(true)
	await wait(0.05)
	check(PopupFx.is_open(walks) and not PopupFx.is_open(fields), "opening Walks closes Fields")
	check(fields.visible, "Fields is still on screen while it animates out")
	await wait(0.3)
	check(not fields.visible, "and hides when its close finishes")
	g.mine.set_open(true)
	await wait(0.35)
	check(PopupFx.is_open(mine) and not PopupFx.is_open(walks) and not walks.visible, "opening My beacons closes Walks")
	g.travel.open(Vector2(400, 300), Vector2(10, 50), "Somewhere", "1 km away")
	await wait(0.35)
	check(g.travel.is_open() and not PopupFx.is_open(mine), "the Jump / Move card closes My beacons")
	g.menu.set_open(true)
	await wait(0.35)
	check(not g.travel.is_open() and PopupFx.is_open(fields), "Fields closes the card")
	check(PopupFx._player != null and is_instance_valid(PopupFx._player) and PopupFx._streams.get(PopupFx.CLOSE_SFX) != null and PopupFx._streams.get(PopupFx.OPEN_SFX) != null, "the swooshes are loaded")
	check(fields.material is ShaderMaterial, "panels are frosted glass")
	# The readout folds when another window opens, and unfolding it closes the others.
	g.hud.set_collapsed(false)
	await wait(0.1)
	check(not PopupFx.is_open(fields), "unfolding the readout closes Fields")
	g.walks.set_open(true)
	await wait(0.1)
	check(g.hud.collapsed, "opening Walks folds the readout")
	g.walks.set_open(false)
	# Placement once open: each window entirely on screen, in its own corner.
	var view := get_viewport().get_visible_rect().size
	for w in [["Walks", g.walks, walks, "br"], ["My beacons", g.mine, mine, "bl"]]:
		w[1].set_open(true)
		await wait(0.45)
		var r: Rect2 = w[2].get_global_rect()
		var vis := Rect2(w[2].get_global_transform_with_canvas().origin, w[2].size * w[2].scale)
		check(vis.position.x >= 0.0 and vis.position.y >= 0.0 and vis.end.x <= view.x + 1.0 and vis.end.y <= view.y + 1.0, "%s is fully on screen (%s in %s)" % [w[0], vis, view])
		if w[3] == "br":
			check(vis.end.x > view.x * 0.8 and vis.end.y > view.y * 0.6, "%s sits bottom right (%s)" % [w[0], vis])
		else:
			check(vis.position.x < view.x * 0.2 and vis.end.y > view.y * 0.6, "%s sits bottom left (%s)" % [w[0], vis])
	print("popup_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)
