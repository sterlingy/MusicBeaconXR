extends Node
## Remix in the app: off plays as written; on, every song you hear goes through
## your settings; Hold freezes the blend; Place my version plants what you hear;
## flavours save and load; the song panel's switch follows.
##   godot --audio-driver Dummy --path . res://tests/remix_app_check.tscn

var failures := 0


func check(ok: bool, what: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: " + what)


func _ready() -> void:
	var was_remix = FieldPrefs.get_value("remix", {})
	var was_flavours = FieldPrefs.get_value("remix_flavours", {})
	var scene: Node = load("res://scenes/globe_field.tscn").instantiate()
	add_child(scene)
	for i in 4:
		await get_tree().process_frame
	var p: BeaconPlayer = scene.player
	p.set_remix(Remix.defaults())
	scene.input.jump_to(Vector2(2.35, 48.86))
	await get_tree().process_frame
	var plain: Array = p.active.map(func(a): return a.song)
	check(not plain.is_empty(), "something plays")

	# On, with a key, a brighter sound and a swapped lead.
	var s := Remix.defaults()
	s.on = true
	s.key = 3
	s.brightness = 0.5
	s.parts.lead.swap = Remix.SWAPS.lead.find("sample:flute")
	p.set_remix(s)
	var a0: Dictionary = p.active[0]
	check(int(a0.song.key.root) == posmod(int(a0.original.key.root) + 3, 12), "on: the key moves")
	check(a0.song.tracks.lead.get("sample", "") == "flute", "on: the lead plays the flute")
	check(String(p.mix.lead.sample) == "flute" or p.mix.lead.gain <= 0.001, "the blend plays your sound")
	check(FieldPrefs.get_value("remix", {}).get("on", false), "remembered")

	# The song panel's switch shows it, and turning it off plays as written.
	await get_tree().process_frame
	check(scene.hud._remix.button_pressed, "the song panel's Remix switch is on")
	scene.hud._remix.button_pressed = false
	await get_tree().process_frame
	check(not p.remix.on and is_same(p.active[0].song, plain[0]), "off: everything plays as written")
	scene.hud._remix.button_pressed = true
	await get_tree().process_frame

	# Hold: walking on doesn't change the blend.
	var held_ids: Array = p.active.map(func(a): return a.id)
	var h := p.remix.duplicate(true)
	h.hold = true
	p.set_remix(h)
	scene.input.jump_to(Vector2(140.0, -30.0))
	await get_tree().process_frame
	check(p.active.map(func(a): return a.id) == held_ids, "Hold keeps the blend where you were")
	h.hold = false
	p.set_remix(h)
	check(p.active.map(func(a): return a.id) != held_ids, "and letting go hears where you are")

	# Place my version: a planted song, baked, named as a remix.
	var mine: MyBeacons = scene.mine
	mine.fix = {"lat": 30.2672, "lon": -97.7431, "accuracy": 8.0, "at": INF, "fake": true}
	scene.input.jump_to(Vector2(-97.7431, 30.2672))
	await get_tree().process_frame
	var before := int(mine.drafts.doc.plants.size())
	mine.place_my_version()
	await get_tree().process_frame
	check(mine.drafts.doc.plants.size() == before + 1, "Place my version plants a beacon")
	if mine.drafts.doc.plants.size() > before:
		var planted: Dictionary = mine.drafts.doc.plants[-1].song
		check(String(planted.title).ends_with("(remix)") and planted.has("remixOf"), "named as a remix (%s)" % planted.title)
		check(planted.tracks.lead.get("sample", "") == "flute", "with your sound baked in")
		mine.drafts.doc.plants.pop_back()
		mine.drafts.changed(true)

	# Flavours: save, change, load.
	var ui: RemixUi = scene.hud.remix_ui
	ui._pull()
	ui._name.text = "Test flavour"
	ui._save_flavour()
	p.set_remix(Remix.defaults())
	ui._pull()
	for i in ui._flavours.item_count:
		if ui._flavours.get_item_text(i) == "Test flavour":
			ui._flavours.select(i)
	ui._load_flavour()
	check(p.remix.on and int(p.remix.key) == 3 and p.remix.parts.lead.swap == Remix.SWAPS.lead.find("sample:flute"), "a saved flavour loads")

	FieldPrefs.set_value("remix", was_remix)
	FieldPrefs.set_value("remix_flavours", was_flavours)
	print("remix_app_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)
