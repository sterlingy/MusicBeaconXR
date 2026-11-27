extends SceneTree
## AudioQuality: the tier and level each kind of device starts at, the user's
## Auto / High / Light setting, and the adaptive steps (down under sustained
## load, back up after a calm spell, never above where it started).
##   godot --headless --path . -s res://tests/quality_check.gd

var failures := 0


func check(ok: bool, what: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: " + what)


func _init() -> void:
	var desktop := {"mobile": false, "ram_gb": 32.0, "cores": 16}
	var flagship := {"mobile": true, "ram_gb": 11.2, "cores": 8}
	var midrange := {"mobile": true, "ram_gb": 5.6, "cores": 8}
	var small := {"mobile": true, "ram_gb": 3.6, "cores": 8}
	var cases := [
		[desktop, "auto", "full", AudioQuality.HIGH],
		[flagship, "auto", "full", AudioQuality.HIGH],
		[midrange, "auto", "phone", AudioQuality.MEDIUM],
		[small, "auto", "phone", AudioQuality.LIGHT],
		[small, "high", "full", AudioQuality.HIGH],
		[desktop, "light", "phone", AudioQuality.LIGHT],
	]
	for c in cases:
		var q := AudioQuality.new(c[1], c[0])
		check(q.tier == c[2] and q.level == c[3], "%s %s: %s %s (want %s %s)" % [c[0], c[1], q.tier, q.level_name(), c[2], AudioQuality.LEVELS[c[3]].name])

	# Sustained load steps down one level at a time, with a cooldown between steps.
	var q := AudioQuality.new("auto", flagship)
	var steps := 0
	for i in 60: # 6 s at 0.95 load
		if q.update(0.95, 0.1):
			steps += 1
	check(q.level == AudioQuality.MEDIUM and steps == 1, "5 s of overload: one step down (at %s after %d)" % [q.level_name(), steps])
	for i in 200:
		q.update(0.95, 0.1)
	check(q.level == AudioQuality.MINIMUM, "keeps stepping down under load, to Minimum (at %s)" % q.level_name())
	# A short spike doesn't count.
	var calm := AudioQuality.new("auto", flagship)
	for i in 10:
		calm.update(0.95, 0.1)
	for i in 100:
		calm.update(0.1, 0.1)
	check(calm.level == AudioQuality.HIGH, "a 1 s spike changes nothing")
	# Back up after a calm spell, but never above the starting level.
	for i in 3000:
		q.update(0.1, 0.1)
	check(q.level == AudioQuality.HIGH, "climbs back to High when calm (at %s)" % q.level_name())
	var mid := AudioQuality.new("auto", midrange)
	for i in 3000:
		mid.update(0.05, 0.1)
	check(mid.level == AudioQuality.MEDIUM, "never above where it started (at %s)" % mid.level_name())
	check(q.describe().begins_with("Auto · High · audio"), "readout: " + q.describe())

	# Every level has settings both instruments accept.
	var prism := JamSynth.new()
	prism.set_instrument("Prism")
	var sampler := JamSynth.new()
	sampler.set_instrument("Sampler")
	for lv in AudioQuality.LEVELS:
		prism.set_param("voice.quality", lv.prism_quality)
		prism.set_param("voice.budget", lv.prism_budget)
		sampler.set_param("voice.quality", lv.sampler_quality)
		sampler.set_param("voice.count", lv.sampler_voices)
		check(int(prism.get_param("voice.quality")) == lv.prism_quality and int(prism.get_param("voice.budget")) == lv.prism_budget, "Prism takes " + lv.name)
		check(int(sampler.get_param("voice.quality")) == lv.sampler_quality and int(sampler.get_param("voice.count")) == lv.sampler_voices, "Sampler takes " + lv.name)

	var here := AudioQuality.this_device()
	print("  this device: %.1f GB, %d cores -> %s" % [here.ram_gb, here.cores, AudioQuality.new("auto").describe()])
	print("quality_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	quit(0 if failures == 0 else 1)
