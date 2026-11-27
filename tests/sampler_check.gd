extends SceneTree
## SynthKit's Sampler in the app: the engine has it, the sample pack loads
## (SampleBank, background decode included), notes sound at the right pitch
## and level, held notes sustain through their loops, and the generator's
## sample choices reach the blend.
##   godot --headless --path . -s res://tests/sampler_check.gd

var failures := 0


func check(ok: bool, what: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: " + what)


func _init() -> void:
	check(JamSynth.get_capabilities().get("sampler", false), "capabilities report the sampler")
	check("Sampler" in JamSynth.get_instrument_types(), "Sampler is an instrument type")
	var bank := SampleBank.new()
	if bank.index.is_empty():
		print("sampler_check: no sample pack in res://samples (run tools/build_samples.py); engine checks only")
	print("  pack: %s, %d programs" % [bank.tier, bank.index.size()])
	for id in SongGen.SAMPLE_CHOICES.values().reduce(func(a, b): return a + b, []):
		check(bank.index.is_empty() or bank.has(id), "pack has " + id)

	# Decoding an Ogg file gives 16-bit PCM.
	if bank.has("piano"):
		var prog := bank.program("piano")
		var bytes := FileAccess.get_file_as_bytes("res://samples/%s/piano/%s" % [bank.tier, prog.zones[0].file])
		var d := JamSynth.decode_ogg(bytes)
		check(d.get("frames", 0) > 1000 and d.pcm.size() == d.frames * d.channels * 2, "decode_ogg returns PCM")
		check(JamSynth.decode_ogg(PackedByteArray([1, 2, 3])).is_empty(), "decode_ogg rejects junk")

		var synth := JamSynth.new()
		synth.set_instrument("Sampler")
		var t0 := Time.get_ticks_msec()
		check(bank.load_now(synth, "piano"), "piano loads")
		print("  piano: %d zones, %.1f MB in %d ms" % [prog.zones.size(), synth.sampler_get_bytes() / 1e6, Time.get_ticks_msec() - t0])
		synth.note_on(69, 0.8)
		var a := synth.render_offline(48000, 48000.0)
		check(_peak(a) > 0.05 and _peak(a) < 1.0, "piano A4 sounds (peak %.3f)" % _peak(a))
		var hz := _pitch(a, 48000.0)
		check(absf(hz - 440.0) < 6.0, "piano A4 is 440 Hz (got %.1f)" % hz)

	# A held string note keeps sounding past the end of its recording (loops).
	if bank.has("strings"):
		var synth := JamSynth.new()
		synth.set_instrument("Sampler")
		check(bank.load_now(synth, "strings"), "strings load")
		synth.note_on(57, 0.8)
		synth.render_offline(48000 * 6, 48000.0)
		var late := synth.render_offline(48000, 48000.0)
		check(_peak(late) > 0.03, "strings sustain after 6 s (peak %.3f)" % _peak(late))
		synth.note_off(57)
		synth.render_offline(48000 * 3, 48000.0)
		check(_peak(synth.render_offline(4800, 48000.0)) < 0.001, "strings release to silence")

	# Background loading.
	if bank.has("harp"):
		var synth := JamSynth.new()
		synth.set_instrument("Sampler")
		var result := [null]
		bank.load_async(synth, "harp", func(ok): result[0] = ok)
		var t := Time.get_ticks_msec()
		while result[0] == null and Time.get_ticks_msec() - t < 20000:
			OS.delay_msec(5)
			bank.poll()
		check(result[0] == true, "harp loads in the background")

	# The generator's choices reach the blend: the loudest song picks.
	var a1 := SongGen.generate("x:1")
	var b1 := SongGen.generate("x:2")
	a1.tracks.keys["sample"] = "piano"
	b1.tracks.keys.erase("sample")
	check(BeaconMixer.blend([{"id": "a", "w": 0.7, "song": a1}, {"id": "b", "w": 0.3, "song": b1}]).keys.sample == "piano", "loudest song's sample wins")
	check(BeaconMixer.blend([{"id": "a", "w": 0.2, "song": a1}, {"id": "b", "w": 0.8, "song": b1}]).keys.sample == "", "else the synth")

	print("sampler_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	quit(0 if failures == 0 else 1)


func _peak(a: PackedVector2Array) -> float:
	var p := 0.0
	for v in a:
		p = maxf(p, maxf(absf(v.x), absf(v.y)))
	return p


## Pitch by autocorrelation over 0.2-0.3 s (the strongest period between 60 and 1000 Hz).
func _pitch(a: PackedVector2Array, sr: float) -> float:
	var x := PackedFloat32Array()
	for i in range(int(sr * 0.2), int(sr * 0.3)):
		x.append(a[i].x + a[i].y)
	var lo := int(sr / 1000.0)
	var ac := PackedFloat32Array()
	var top := 0.0
	for lag in range(lo, int(sr / 60.0)):
		var acc := 0.0
		for i in range(0, x.size() - lag):
			acc += x[i] * x[i + lag]
		acc /= float(x.size() - lag)
		ac.append(acc)
		top = maxf(top, acc)
	# The first local peak near the strongest one is the period (later peaks are its multiples).
	for k in range(1, ac.size() - 1):
		if ac[k] >= 0.85 * top and ac[k] >= ac[k - 1] and ac[k] >= ac[k + 1]:
			var d := 0.5 * (ac[k - 1] - ac[k + 1]) / (ac[k - 1] - 2.0 * ac[k] + ac[k + 1])
			return sr / (lo + k + d)
	return 0.0
