extends Node
## Headless check of the SynthKit addon: every instrument and every factory
## preset loads, uses real parameters and makes sound; the sequencer plays
## from the shared clock; the studio page and panels build for each instrument.
## godot --headless --path . res://tests/synthkit_check.tscn

const SR := 48000
const ALL := ["Pulsar", "Undertow", "Comet", "Lumen", "Driftwood", "Tangle"]

var failures := 0


func check(ok: bool, msg: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: ", msg)


func _ready() -> void:
	var types := JamSynth.get_instrument_types()
	for t in ALL:
		check(types.has(t), "%s registered" % t)
	_check_presets()
	await get_tree().process_frame
	await _check_sequencer()
	await _check_studio()
	print("synthkit_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)


func _check_presets() -> void:
	for t in ALL:
		var presets := PresetLibrary.list(t)
		check(presets.size() == 8, "%s has 8 factory presets (got %d)" % [t, presets.size()])
		var ids := {}
		for p in presets:
			var s := JamSynth.new()
			s.instrument = t
			for d in s.get_param_list():
				ids[d.id] = true
			check(PresetLibrary.apply(s, p), "%s/%s applies" % [t, p.name])
			for k in p.params:
				if k != "patch":
					check(ids.has(k), "%s/%s uses real param %s" % [t, p.name, k])
			var note := 36 if t == "Pulsar" else 60
			s.note_on(note, 0.9)
			if t == "Lumen":
				s.note_on(64, 0.9)
			var buf := s.render_offline(SR / 2, SR)
			s.note_off(note)
			buf.append_array(s.render_offline(SR / 2, SR))
			var st := AudioUtil.stats(buf)
			check(st.bad == 0, "%s/%s has no NaN/inf" % [t, p.name])
			check(st.peak > 0.01 and st.peak < 4.0, "%s/%s level sane (peak %.3f)" % [t, p.name, st.peak])
		print("  %-9s %d presets OK" % [t, presets.size()])


func _check_sequencer() -> void:
	var rig := InstrumentRig.new()
	rig.instrument = "Pulsar"
	rig.local_input = false
	add_child(rig)
	check(rig.sequencer.to_dict().pattern.size() == 16, "default Pulsar pattern")
	var s := 0.0
	Transport.metronome_on = false
	Transport.count_in_bars = 0
	Transport.start()
	for i in 60:
		await get_tree().process_frame
		var pk := rig.synth.take_peak()
		s = maxf(s, maxf(pk.x, pk.y))
	Transport.stop()
	# Headless audio may not run in real time; only require the clock moved.
	check(Transport.anchor_time > 0.0, "transport started")
	print("  sequencer: transport ran, peak heard %.3f (0 is OK with the dummy audio driver)" % s)
	rig.queue_free()
	await get_tree().process_frame


func _check_studio() -> void:
	var studio := SynthStudio.new()
	studio.size = Vector2(1600, 900)
	add_child(studio)
	await get_tree().process_frame
	for t in ALL:
		studio.rig.set_instrument(t)
		await get_tree().process_frame
		var built := studio.tangle.get_child_count() > 0 if t == "Tangle" else studio.panel._controls.size() > 0
		check(built, "%s panel builds controls" % t)
		check(studio._presets.size() >= 8, "%s preset list in studio" % t)
	studio.queue_free()
	await get_tree().process_frame
	print("  studio page builds for all instruments")
