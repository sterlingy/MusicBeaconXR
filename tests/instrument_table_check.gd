extends Node
## Headless check of the Instrument Table (scenes/instrument_table.tscn): the
## objects reach SynthKit through SynthBridge, with knob values in real units.
## godot --headless --path . res://tests/instrument_table_check.tscn -- --shot=none

var failures := 0


func check(ok: bool, msg: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: ", msg)


## The table saves patch changes to user:// as they happen (PATCH_FILE),
## and this check re-patches the dial: set any saved patches aside so it starts
## from the defaults, and put them back afterwards, so runs never affect each
## other or your own patches.
const PATCH_FILE := "user://music_input_patches.json" # scripts/play/playground.gd's
var _saved_patches: Variant = null


func _set_patches_aside() -> void:
	var path := ProjectSettings.globalize_path(PATCH_FILE)
	if FileAccess.file_exists(PATCH_FILE):
		_saved_patches = FileAccess.get_file_as_string(PATCH_FILE)
		DirAccess.remove_absolute(path)


func _put_patches_back() -> void:
	var path := ProjectSettings.globalize_path(PATCH_FILE)
	if _saved_patches is String:
		var f := FileAccess.open(PATCH_FILE, FileAccess.WRITE)
		f.store_string(_saved_patches)
		f.close()
	elif FileAccess.file_exists(PATCH_FILE):
		DirAccess.remove_absolute(path)


func _ready() -> void:
	_set_patches_aside()
	var table: Node3D = load("res://scenes/instrument_table.tscn").instantiate()
	add_child(table)
	await get_tree().process_frame
	var kit: MusicInput = table.kit
	var bridge: SynthBridge = table.bridge
	check(table.objects.size() == 14, "14 objects on the table (got %d)" % table.objects.size())
	for part in SynthBridge.PARTS:
		check(bridge.rigs.has(part), "a rig for %s" % part)
	var keys: InstrumentRig = bridge.rigs["keys"]
	check(keys.instrument == "Prism" and keys.synth.get_param("voice.bend_range") == 12.0, "keys is Prism and bends an octave")
	check(bridge.rigs.has("pad") and bridge.rigs["pad"].instrument == "Prism", "there's a pad part, on Prism")

	# The dial is patched to the keys' filter ("filter.cutoff", Prism's f1.cutoff): all the way up is 18 kHz.
	var dial: TwistDial = table.objects["Dial"]
	dial.set_value(1.0)
	check(absf(keys.synth.get_param("f1.cutoff") - 18000.0) < 1.0, "dial up = cutoff 18 kHz (got %s)" % keys.synth.get_param("f1.cutoff"))
	dial.set_value(0.5)
	var mid := sqrt(30.0 * 18000.0)
	check(absf(keys.synth.get_param("f1.cutoff") - mid) / mid < 0.01, "dial half way = the log middle (got %s)" % keys.synth.get_param("f1.cutoff"))

	# Repatch the dial to the lead's resonance: the dial now moves that instead.
	kit.patches.set_patch("Dial.turn", "lead", "filter.resonance")
	dial.set_value(0.3)
	check(absf(bridge.rigs["lead"].synth.get_param("f1.resonance") - 3.0) < 0.01, "repatched: the dial sets the lead's resonance to 3")
	# Chord blocks layer the pad an octave under the keys.
	var pad_events := []
	bridge.rigs["pad"].played.connect(func(e): pad_events.append(e))
	var blocks: ChordBlocks = table.objects["Blocks"]
	var bh := PlayHand.new("mouse", 7)
	bh.position = blocks.global_transform * Vector3(blocks.box.position.x + 0.02, blocks.block * 0.5, 0)
	blocks.hand_down(bh)
	var pad_on := pad_events.filter(func(e): return e.type == "on").map(func(e): return e.note)
	check(pad_on == [36, 40, 43], "the C block also holds C major on the pad, an octave down (got %s)" % [pad_on])
	blocks.hand_up(bh)

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
	_put_patches_back()
	get_tree().quit(0 if failures == 0 else 1)
