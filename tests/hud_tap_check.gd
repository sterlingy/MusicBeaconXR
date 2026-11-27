extends Node
## The readout's fold button answers a real tap (a touch, as on a phone, and a
## mouse click), folding and unfolding the panel.
##   godot --headless --path . res://tests/hud_tap_check.tscn

var failures := 0


func check(ok: bool, what: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: " + what)


func tap(canvas_at: Vector2, touch: bool) -> void:
	var at := get_viewport().get_final_transform() * canvas_at # window pixels (the project stretches its canvas)
	if touch:
		for down in [true, false]:
			var e := InputEventScreenTouch.new()
			e.index = 0
			e.position = at
			e.pressed = down
			get_viewport().push_input(e)
			await get_tree().process_frame
			await get_tree().process_frame
	else:
		for down in [true, false]:
			var m := InputEventMouseButton.new()
			m.button_index = MOUSE_BUTTON_LEFT
			m.position = at
			m.global_position = at
			m.pressed = down
			get_viewport().push_input(m)
			await get_tree().process_frame
			await get_tree().process_frame


func _ready() -> void:
	var hud: BeaconHud
	if "--globe" in OS.get_cmdline_user_args():
		# The whole globe scene (run with -- --globe --phone to see the phone layout).
		var scene: Node = load("res://scenes/globe_field.tscn").instantiate()
		add_child(scene)
		hud = scene.hud
	else:
		var player := BeaconPlayer.new()
		player.field = BeaconField.make_grid()
		add_child(player)
		hud = BeaconHud.new(player)
		add_child(hud)
	for i in 4:
		await get_tree().process_frame
	hud.set_collapsed(false)
	for i in 3:
		await get_tree().process_frame
	# Control: a plain button on its own layer.
	var cl := CanvasLayer.new()
	add_child(cl)
	var plain := Button.new()
	plain.position = Vector2(900, 500)
	plain.size = Vector2(80, 40)
	var hits := [0]
	plain.pressed.connect(func(): hits[0] += 1)
	cl.add_child(plain)
	await get_tree().process_frame
	await tap(Vector2(940, 520), false)
	print("plain button presses: ", hits[0])
	var bb: Button = hud._collapse
	var pt: Vector2 = bb.get_global_transform_with_canvas() * (bb.size * 0.5)
	var mm := InputEventMouseMotion.new()
	mm.position = pt
	mm.global_position = pt
	get_viewport().push_input(mm)
	await get_tree().process_frame
	await get_tree().process_frame
	var hov := get_viewport().gui_get_hovered_control()
	print("hovered: ", hov, " ", hov.get_path() if hov else "", " button rect ", bb.get_global_rect(), " panel ", hud._panel.get_global_rect(), " scale ", hud._panel.scale)
	for touch in [false, true]:
		var b: Button = hud._collapse
		var at: Vector2 = b.get_global_transform_with_canvas() * (b.size * 0.5)
		await tap(at, touch)
		check(hud.collapsed, "%s on the fold button folds the panel (at %s)" % ["a touch" if touch else "a click", at])
		for i in 3:
			await get_tree().process_frame
		at = b.get_global_transform_with_canvas() * (b.size * 0.5)
		await tap(at, touch)
		check(not hud.collapsed, "%s again unfolds it" % ["a touch" if touch else "a click"])
	print("hud_tap_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)
