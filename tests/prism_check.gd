extends Node
## Headless check of Prism (SynthKit's keys / lead / pad engine): presets, every
## engine, filter and effect, voice modes, the shared voice budget, sleeping,
## and a performance benchmark of the whole beacon mix with three Prisms.
## godot --headless --path . res://tests/prism_check.tscn

const SR := 48000.0
var failures := 0


func check(ok: bool, msg: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: ", msg)


func _ready() -> void:
	check("Prism" in JamSynth.get_instrument_types(), "Prism is a SynthKit instrument")
	_check_presets()
	_check_engines_filters_fx()
	_check_modes()
	_check_budget_and_sleep()
	_benchmark()
	print("prism_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)


func make(preset_name := "") -> JamSynth:
	var s := JamSynth.new()
	s.instrument = "Prism"
	if preset_name != "":
		for p in PresetLibrary.list("Prism"):
			if p.name == preset_name:
				PresetLibrary.apply(s, p)
	return s


func level(s: JamSynth, frames: int) -> Dictionary:
	return AudioUtil.stats(s.render_offline(frames, SR))


func _check_presets() -> void:
	var presets := PresetLibrary.list("Prism")
	check(presets.size() == 8, "8 Prism presets (got %d)" % presets.size())
	var ids := {}
	for d in make().get_param_list():
		ids[d.id] = true
	for p in presets:
		var s := make()
		check(PresetLibrary.apply(s, p), "%s applies" % p.name)
		for k in p.params:
			check(ids.has(k), "%s uses real param %s" % [p.name, k])
		for n in [48, 55, 60, 64]:
			s.note_on(n, 0.9)
		var buf := s.render_offline(int(SR), SR)
		for n in [48, 55, 60, 64]:
			s.note_off(n)
		buf.append_array(s.render_offline(int(SR), SR))
		var st := AudioUtil.stats(buf)
		check(st.bad == 0, "%s: no NaN/inf" % p.name)
		check(st.peak > 0.02 and st.peak < 3.0, "%s: level sane (peak %.3f)" % [p.name, st.peak])
		print("  %-14s peak %.2f  rms %.3f" % [p.name, st.peak, st.rms])


func _check_engines_filters_fx() -> void:
	var names := ["Off", "Analog", "Wavetable", "FM", "Harmonic"]
	for t in range(1, 5):
		for u in [1, 4]:
			var s := make()
			s.set_param("a.type", t)
			s.set_param("a.unison", u)
			s.set_param("a.timbre", 0.7)
			s.set_param("a.morph", 0.5)
			s.note_on(96, 0.9) # high note: band-limiting matters
			s.note_on(36, 0.9)
			var st := level(s, 24000)
			check(st.bad == 0 and st.peak > 0.02 and st.peak < 3.0, "%s engine, unison %d renders (peak %.3f)" % [names[t], u, st.peak])
	for table in 8:
		var s := make()
		s.set_param("a.type", 2)
		s.set_param("a.table", table)
		for pos in [0.0, 0.5, 1.0]:
			s.set_param("a.timbre", pos)
			s.note_on(60, 0.9)
			var st := level(s, 4800)
			check(st.bad == 0 and st.peak > 0.01, "wavetable %d at %.1f sounds" % [table, pos])
			s.note_off(60)
	var fnames := ["LP 24", "LP 12", "Band Pass", "High Pass", "Notch", "Ladder", "Comb", "Formant"]
	for ft in 8:
		for routing in 3:
			var s := make()
			s.set_param("b.type", 2)
			s.set_param("f1.type", ft)
			s.set_param("f2.type", (ft + 3) % 8)
			s.set_param("f1.resonance", 9)
			s.set_param("filter.routing", routing)
			s.set_param("mix.fm", 5)
			s.set_param("mix.ring", 3)
			s.set_param("mix.fold", 6)
			s.note_on(48, 1.0)
			var st := level(s, 24000)
			check(st.bad == 0 and st.peak > 0.005 and st.peak < 4.0, "filter %s, routing %d (peak %.3f)" % [fnames[ft], routing, st.peak])
	for fx in range(1, 5):
		var s := make()
		s.set_param("fx1.type", fx)
		s.set_param("fx1.amount", 8)
		s.note_on(60, 0.9)
		var st := level(s, 24000)
		check(st.bad == 0 and st.peak > 0.02, "effect %d renders" % fx)
	# Every mod target, driven hard by an LFO, stays finite.
	for d in range(1, 23):
		var s := make()
		s.set_param("b.type", 3)
		s.set_param("mod1.src", 4)
		s.set_param("mod1.dst", d)
		s.set_param("mod1.amount", 1.0)
		s.set_param("lfo1.rate", 12)
		s.note_on(60, 0.9)
		var st := level(s, 12000)
		check(st.bad == 0 and st.peak < 4.0, "mod target %d stays finite (peak %.3f)" % [d, st.peak])


func _check_modes() -> void:
	# Legato: a second key while the first is held glides without retriggering.
	var s := make("Comet Tail")
	s.note_on(60, 0.9)
	s.render_offline(9600, SR)
	s.note_on(67, 0.9)
	var st := level(s, 9600)
	check(st.peak > 0.05, "legato second note sounds")
	s.note_off(67)
	var back := level(s, 9600)
	check(back.peak > 0.05, "releasing the top key falls back to the held one")
	s.note_off(60)
	s.render_offline(int(SR), SR)
	check(level(s, 4800).peak < 0.01, "both released: silence")
	# Pitch bend and the mod wheel respond.
	var w := make("Prism Keys")
	w.note_on(60, 0.9)
	w.pitch_bend(1.0)
	w.control_change(1, 1.0)
	check(level(w, 9600).bad == 0, "bend and wheel are safe")


func _check_budget_and_sleep() -> void:
	# Two pads sharing a small budget: neither can push the total past it.
	var a := make("Aurora Pad")
	var b := make("Aurora Pad")
	a.set_param("voice.budget", 8)
	b.set_param("voice.budget", 8)
	a.set_param("a.unison", 1)
	b.set_param("a.unison", 1)
	for n in [48, 52, 55, 59, 62, 65, 69, 72]:
		a.note_on(n, 0.8)
		a.render_offline(256, SR)
	for n in [50, 53, 57, 60, 64, 67]:
		b.note_on(n, 0.8)
		b.render_offline(256, SR)
	var st := AudioUtil.stats(a.render_offline(4800, SR))
	check(st.bad == 0 and st.peak > 0.01, "a budget-limited pad still plays")
	# Sleeping: part gain at zero takes no notes and makes no sound.
	var s := make("Prism Keys")
	s.set_param("out.gain", 0.0)
	s.note_on(60, 0.9)
	check(level(s, 9600).peak < 1e-6, "out.gain 0: asleep and silent")
	s.set_param("out.gain", 1.0)
	s.note_on(60, 0.9)
	check(level(s, 9600).peak > 0.02, "waking up plays again")


## The full beacon mix at its busiest: keys and pad holding four-note chords, a
## lead line, plus drums, bass, pluck and texture. Rendered in 512-frame chunks,
## round robin, like the audio thread does. Reports the share of one CPU core.
func _benchmark() -> void:
	for q in [2, 0]:
		var parts := {
			"keys": make("Prism Keys"), "pad": make("Aurora Pad"), "lead": make("Comet Tail"),
		}
		for k in parts:
			parts[k].set_param("voice.quality", q)
			parts[k].set_param("voice.budget", 24 if q == 2 else 12)
		var others := {}
		for t in ["Pulsar", "Undertow", "Driftwood", "Tangle"]:
			var o := JamSynth.new()
			o.instrument = t
			var pr := PresetLibrary.list(t)
			if not pr.is_empty():
				PresetLibrary.apply(o, pr[0])
			others[t] = o
		var seconds := 6.0
		var chunks := int(seconds * SR / 512)
		var prism_us := 0
		var other_us := 0
		var chords := [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]]
		var lead := [72, 74, 76, 79, 76, 74]
		for c in chunks:
			if c % 47 == 0:
				var ch: Array = chords[(c / 47) % 4]
				var prev: Array = chords[((c / 47) + 3) % 4]
				for n in prev:
					parts.keys.note_off(n)
					parts.pad.note_off(n)
				for n in ch:
					parts.keys.note_on(n, 0.8)
					parts.pad.note_on(n - 12, 0.6)
				others.Undertow.note_on(ch[0] - 24, 0.9)
			if c % 12 == 0:
				parts.lead.note_on(lead[(c / 12) % lead.size()], 0.9)
				others.Pulsar.note_on([36, 42, 38, 42][(c / 12) % 4], 0.9)
				others.Driftwood.note_on(lead[(c / 12) % lead.size()] - 12, 0.7)
			if c % 12 == 6:
				others.Tangle.note_on(60, 0.5)
				others.Tangle.note_off(60)
			var t0 := Time.get_ticks_usec()
			for k in parts:
				parts[k].render_offline(512, SR)
			var t1 := Time.get_ticks_usec()
			for k in others:
				others[k].render_offline(512, SR)
			other_us += Time.get_ticks_usec() - t1
			prism_us += t1 - t0
		var real_us := seconds * 1e6
		var prism_pct := 100.0 * prism_us / real_us
		var total_pct := 100.0 * (prism_us + other_us) / real_us
		print("  benchmark, quality %s: three Prisms %.1f%% of one core, whole mix %.1f%%" % [["Low", "Medium", "High"][q], prism_pct, total_pct])
		check(total_pct < 30.0, "the whole mix stays under 30%% of a core at quality %d (got %.1f%%)" % [q, total_pct])
