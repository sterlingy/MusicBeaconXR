extends Node
## The readout's part bars are live meters: while the music plays they move
## with it (not only when the listener moves). Needs an audio driver that
## mixes, e.g. --audio-driver Dummy.
##   godot --headless --audio-driver Dummy --path . res://tests/meter_check.tscn

func _ready() -> void:
	var g: Node = load("res://scenes/beacon_field.tscn").instantiate()
	add_child(g)
	await get_tree().create_timer(0.5).timeout
	Transport.start()
	var seen := {}
	for i in 40:
		await get_tree().create_timer(0.05).timeout
		for role in g.player.meters:
			if not seen.has(role):
				seen[role] = []
			seen[role].append(snappedf(g.player.meters[role], 0.01))
	var moving := 0
	for role in seen:
		var vals: Array = seen[role]
		var lo: float = vals.min()
		var hi: float = vals.max()
		print("  %-8s %.2f..%.2f" % [role, lo, hi])
		if hi - lo > 0.05:
			moving += 1
	var ok := moving >= 2
	print("meter_check: %s (%d parts moving while standing still)" % ["OK" if ok else "FAILED", moving])
	get_tree().quit(0 if ok else 1)
