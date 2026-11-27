extends SceneTree
## Auto-walk (wander) must move the listener on the globe and the grid fields,
## at the travel speed. Run: godot --audio-driver Dummy -s res://tests/wander_check.gd

var failures := 0


func check(ok: bool, msg: String) -> void:
	print(("ok   " if ok else "FAIL ") + msg)
	if not ok:
		failures += 1


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	for scene in ["res://scenes/globe_field.tscn", "res://scenes/beacon_field.tscn"]:
		var node: Node = load(scene).instantiate()
		root.add_child(node)
		for i in 20:
			await process_frame
		var li := get_first_node_in_group("listener_input") as ListenerInput
		var sp := get_first_node_in_group(PopupFx.GROUP) # any; the speed below is set on the space directly
		check(li != null, "%s has a listener" % scene)
		if li == null:
			continue
		li.wander = true
		var start := li.position
		var t0 := Time.get_ticks_msec()
		while Time.get_ticks_msec() - t0 < 3000:
			await process_frame
		var moved := li.position.distance_to(start)
		print("  %s: wander %s, walk_speed %s, moved %s in 3 s" % [scene.get_file(), li.wander, li.space.walk_speed, moved])
		check(moved > li.space.walk_speed * 1.0, "%s: wander moves the listener" % scene.get_file())
		node.queue_free()
		await process_frame
	print("wander_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	quit(0 if failures == 0 else 1)
