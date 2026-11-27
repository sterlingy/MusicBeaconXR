extends Node
## The song panel's "Orchestral samples" switch: off, every part plays its own
## synth; on again, the songs' samples come back.
##   godot --audio-driver Dummy --path . res://tests/samples_toggle_check.tscn

var failures := 0


func check(ok: bool, msg: String) -> void:
	print(("ok   " if ok else "FAIL ") + msg)
	if not ok:
		failures += 1


func _ready() -> void:
	_run.call_deferred()


func _playing(p: BeaconPlayer) -> Array:
	var out := []
	for role in p.rigs:
		if p.sample_playing(role) != "":
			out.append("%s:%s" % [role, p.sample_playing(role)])
	return out


func _wait(ms: int) -> void:
	var t0 := Time.get_ticks_msec()
	while Time.get_ticks_msec() - t0 < ms:
		await get_tree().process_frame


func _run() -> void:
	var was := bool(FieldPrefs.get_value("samples", true))
	FieldPrefs.set_value("samples", true)
	var node: Node = load("res://scenes/globe_field.tscn").instantiate()
	get_tree().root.add_child(node)
	var p := get_tree().get_first_node_in_group("beacon_player") as BeaconPlayer
	check(p != null and p.samples_on, "the player starts with samples on")
	await _wait(4000)
	var on := _playing(p)
	print("  on: ", on)
	check(not on.is_empty(), "some parts play samples")
	p.set_samples_on(false)
	await _wait(300)
	check(_playing(p).is_empty(), "off: every part plays its synth")
	check(FieldPrefs.get_value("samples", true) == false, "off is remembered")
	p.set_samples_on(true)
	await _wait(3000)
	check(_playing(p).size() == on.size(), "on again: the samples come back")
	FieldPrefs.set_value("samples", was)
	print("samples_toggle_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)
