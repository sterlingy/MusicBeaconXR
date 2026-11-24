extends Node
## Headless check of the Instrument Table (scenes/instrument_table.tscn): the
## objects reach SynthKit through SynthBridge, with knob values in real units.
## godot --headless --path . res://tests/instrument_table_check.tscn -- --shot=none

var failures := 0


func check(ok: bool, msg: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: ", msg)


func _ready() -> void:
	var table: Node3D = load("res://scenes/instrument_table.tscn").instantiate()
	add_child(table)
	await get_tree().process_frame
	var kit: MusicInput = table.kit
	var bridge: SynthBridge = table.bridge
	check(table.objects.size() == 14, "14 objects on the table (got %d)" % table.objects.size())
	for part in SynthBridge.PARTS:
		check(bridge.rigs.has(part), "a rig for %s" % part)
	var keys: InstrumentRig = bridge.rigs["keys"]
	check(keys.instrument == "Lumen" and keys.synth.get_param("voice.bend_range") == 12.0, "keys is Lumen and bends an octave")

	# The dial is patched to the Lumen filter: all the way up is 18 kHz, half way is the log middle.
	var dial: TwistDial = table.objects["Dial"]
	dial.set_value(1.0)
	check(absf(keys.synth.get_param("filter.cutoff") - 18000.0) < 1.0, "dial up = cutoff 18 kHz (got %s)" % keys.synth.get_param("filter.cutoff"))
	dial.set_value(0.5)
	var mid := sqrt(30.0 * 18000.0)
	check(absf(keys.synth.get_param("filter.cutoff") - mid) / mid < 0.01, "dial half way = the log middle (got %s)" % keys.synth.get_param("filter.cutoff"))

	# Repatch the dial to Comet's resonance: the dial now moves that instead.
	kit.patches.set_patch("Dial.turn", "lead", "filter.resonance")
	dial.set_value(0.3)
	check(absf(bridge.rigs["lead"].synth.get_param("filter.resonance") - 3.0) < 0.01, "repatched: the dial sets Comet resonance to 3")

	# A note from the bars reaches the Driftwood rig.
	var played := []
	bridge.rigs["mallet"].played.connect(func(e): played.append(e))
	var bars: ChimeBars = table.objects["Bars"]
	var h := PlayHand.new("mouse", 1)
	h.position = bars.global_transform * Vector3(bars.box.position.x + 0.01, 0.05, 0)
	bars.hand_down(h)
	var on := played.filter(func(e): return e.type == "on")
	check(on.size() == 1 and on[0].note == 60, "the first bar plays C on the mallet rig (got %s)" % [played])

	# The whammy lever bends the lead.
	var lead_events := []
	bridge.rigs["lead"].played.connect(func(e): lead_events.append(e))
	var whammy: SlideFader = table.objects["Whammy"]
	whammy.set_value(1.0)
	check(lead_events.any(func(e): return e.type == "bend" and e.value > 0.99), "the whammy at the top bends the lead fully up")

	# The lock toggle reaches the objects' labels.
	kit.send_action("lock", false)
	check(bars.labels[1].text == "C#", "lock off: the second bar is C#")
	kit.send_action("lock", true)

	print("instrument_table_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)
