extends Node
## SynthKit song sounds in the app: every part loads the SynthKit preset the
## song it hears most chose (KitSounds), with the song's tune on top; a song
## without a kit plays the part's base preset as before; Remix's kit swap is
## heard.
##   godot --audio-driver Dummy --path . res://tests/kit_player_check.tscn

var failures := 0


func check(ok: bool, what: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: " + what)
	else:
		print("ok   " + what)


func _ready() -> void:
	var was_remix = FieldPrefs.get_value("remix", {})
	var scene: Node = load("res://scenes/globe_field.tscn").instantiate()
	add_child(scene)
	for i in 4:
		await get_tree().process_frame
	var p: BeaconPlayer = scene.player
	p.set_remix(Remix.defaults())
	scene.input.jump_to(Vector2(2.35, 48.86))
	Transport.start()
	await _settle()
	var top: Dictionary = p.active[0]
	for a in p.active:
		if a.w > top.w:
			top = a
	var role := "bass"
	var want: String = top.song.tracks[role].kit.preset
	var lead = BeaconMixer.choose_kit(p.mix[role].kits, "")
	check(want != "", "the song chose a SynthKit bass")
	check(String(p.kit_loaded[role]) == String(lead.preset), "the bass loaded the loudest song's preset (%s)" % p.kit_loaded[role])
	var synth: JamSynth = p.rigs[role].synth
	var expect := KitSounds.kit_params("Undertow", p._kit_base[role], lead.tune)
	check(absf(synth.get_param("filter.cutoff") - float(expect["filter.cutoff"])) < 0.5, "the tune is on the preset's cutoff")
	var pad_kit = p.harmony.song.get("pad", {}).get("kit", {})
	check(String(p.kit_loaded.pad) == String(pad_kit.get("preset", "")), "the pad plays the harmony song's pad (%s)" % p.kit_loaded.pad)
	check(p.rigs.keys.synth.get_param("voice.budget") == float(p.quality.settings().prism_budget), "a preset load keeps the device's Prism voices")

	# A song without kits (planted before them) plays the base presets.
	for a in p.active:
		var s: Dictionary = a.song.duplicate(true)
		for r in s.tracks:
			s.tracks[r].erase("kit")
		p.set_song(String(a.id), s)
	await _settle()
	check(String(p.kit_loaded[role]) == "", "no kit: the bass is back on its base preset")

	# Remix: swapping the lead to a SynthKit preset is heard.
	var rx := Remix.defaults()
	rx.on = true
	rx.parts.lead.swap = Remix.SWAPS.lead.find("kit:Talking Lead")
	p.set_remix(rx)
	await _settle()
	check(p.active[0].song.tracks.lead.kit.preset == "Talking Lead", "Remix swaps the lead's SynthKit sound")
	check(p.mix.lead.gain <= 0.001 or String(p.kit_loaded.lead) == "Talking Lead", "the lead plays it")

	Transport.stop()
	FieldPrefs.set_value("remix", was_remix)
	print("kit_player_check: ", "OK" if failures == 0 else "FAILED", " (%d failure(s))" % failures)
	get_tree().quit(1 if failures else 0)


func _settle() -> void:
	for i in 20:
		await get_tree().process_frame
	await get_tree().create_timer(0.35).timeout
