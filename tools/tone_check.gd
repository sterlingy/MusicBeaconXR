extends SceneTree
## Checks that the beacon patches never turn shrill. For every song in the
## packs it plays each melodic part the way the beacon player does (the song's
## own notes, ranges and settings through ParamMap, on phone quality) and
## measures the share of energy above 2.5 kHz, in dB. Lists the worst songs.
##   godot --headless --path . -s res://tools/tone_check.gd -- [--role=lead] [--wav=<folder>] [--all]
## --all checks the globe pack too (slower). --wav writes the worst song per part.

const SR := 48000.0
const BLOCK := 512
const SYNTH := {"bass": ["Undertow", "Deep Current"], "keys": ["Prism", "Prism Keys"], "lead": ["Prism", "Comet Tail"], "pluck": ["Driftwood", "Nylon Pluck"]}
## Above this share (dB above 2.5 kHz), a part counts as shrill.
const LIMIT := {"bass": -30.0, "keys": -22.0, "lead": -22.0, "pluck": -15.0}
const PRESET_LIMIT := {"keys": -22.0, "lead": -22.0, "pad": -25.0}


func _init() -> void:
	var roles := SYNTH.keys()
	var wav_dir := ""
	var packs := ["res://songs/grid.json"]
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--role="):
			roles = [a.trim_prefix("--role=")]
		elif a.begins_with("--wav="):
			wav_dir = a.trim_prefix("--wav=")
		elif a == "--all":
			packs.append("res://songs/globe.json")
	var songs := {}
	for p in packs:
		songs.merge(JSON.parse_string(FileAccess.get_file_as_string(p)).songs)
	var failed := 0
	if "--presets" in OS.get_cmdline_user_args():
		failed += check_presets()
	for role in roles:
		var results := []
		for id in songs:
			var buf := render(role, songs[id])
			if buf.is_empty():
				continue
			results.append([hf_db(buf), id, buf])
		results.sort_custom(func(a, b): return a[0] > b[0])
		var vals := results.map(func(r): return r[0])
		var over := results.filter(func(r): return r[0] > LIMIT[role]).size()
		failed += over
		print("  %-5s above 2.5 kHz: median %5.1f dB, worst %5.1f dB (%s %s), %d of %d over %.0f dB" % [role, vals[vals.size() / 2], vals[0],
			results[0][1], songs[results[0][1]].title, over, results.size(), LIMIT[role]])
		if wav_dir != "":
			DirAccess.make_dir_recursive_absolute(wav_dir)
			save_wav(results[0][2], wav_dir.path_join("%s_worst_%s.wav" % [role, results[0][1]]))
	print("tone_check: %s" % ("OK" if failed == 0 else "%d shrill part(s)" % failed))
	quit(0 if failed == 0 else 1)


## Every Prism preset, played hard (velocity 1) across its register: a patch
## should stay mellow even at the top of its range.
func check_presets() -> int:
	var register := {"keys": [[48, 55, 60, 64], [60, 64, 67, 72], [67, 72, 76, 79]], "pad": [[48, 55, 60, 64], [60, 64, 67, 72], [67, 72, 76, 79]],
		"lead": [[60], [67], [72], [79], [84], [88], [91]]}
	var role_of := {"Prism Keys": "keys", "Glass EP": "keys", "Drawbar Drift": "keys", "Comet Tail": "lead", "Talking Lead": "lead",
		"Aurora Pad": "pad", "Glass Choir": "pad", "Dust Halo": "pad"}
	var bad := 0
	for p in PresetLibrary.list("Prism"):
		var role: String = role_of.get(p.name, "keys")
		var worst := -99.0
		var worst_at := 0
		for chord in register[role]:
			var s := JamSynth.new()
			s.instrument = "Prism"
			PresetLibrary.apply(s, p)
			s.set_param("voice.quality", 0)
			s.set_param("send.space", 0)
			s.set_param("send.echo", 0)
			for n in chord:
				s.note_on(n, 1.0)
			var buf := s.render_offline(int(SR * 0.6), SR)
			var db := hf_db(buf)
			if db > worst:
				worst = db
				worst_at = chord[-1]
		var limit: float = PRESET_LIMIT[role]
		if worst > limit:
			bad += 1
		print("  preset %-14s worst %5.1f dB above 2.5 kHz (top note %d)%s" % [p.name, worst, worst_at, "  SHRILL" if worst > limit else ""])
	return bad


## Plays two bars of a song's part like BeaconPlayer: same notes, same settings.
func render(role: String, song: Dictionary) -> PackedVector2Array:
	var t: Dictionary = song.tracks.get(role, {})
	if t.is_empty():
		return PackedVector2Array()
	var s := JamSynth.new()
	s.instrument = SYNTH[role][0]
	for p in PresetLibrary.list(SYNTH[role][0]):
		if p.name == SYNTH[role][1]:
			PresetLibrary.apply(s, p)
	if s.instrument == "Prism":
		s.set_param("voice.quality", 0)
	var params: Dictionary = ParamMap.to_synth(role, t.get("params", {}))
	for k in params:
		s.set_param(k, params[k])
	var ids := {}
	for d in s.get_param_list():
		ids[d.id] = true
	for k in ["send.space", "send.echo", "reverb.mix"]:
		if ids.has(k):
			s.set_param(k, 0) # measure the dry part
	var step_frames := int(SR * 60.0 / float(song.bpm) / 4.0)
	var out := PackedVector2Array()
	var pending := {} # frame -> notes to release
	var frame := 0
	for bar in 2:
		var pat: Array = t.pattern
		var bar_pat = pat[bar % pat.size()]
		var chord := int(song.progression[bar % song.progression.size()])
		for step in 16:
			var ev = bar_pat[step] if bar_pat else null
			if ev != null:
				var notes := []
				if role == "keys":
					notes = BeaconMixer.chord_notes(song.key, chord, int(round(t.params.get("octave", 4))), int(round(t.params.get("voicing", 3))))
				else:
					notes = [BeaconMixer.fold_into_range(role, BeaconMixer.degree_to_midi(song.key, chord + int(ev.d), BeaconMixer.ROLE_OCTAVE[role] + int(ev.get("o", 0))))]
				for n in notes:
					s.note_on(n, float(ev.v))
				var off := frame + int(step_frames * float(ev.g) * 0.95)
				pending[off] = pending.get(off, []) + notes
			var end := frame + step_frames
			while frame < end:
				var n := mini(BLOCK, end - frame)
				for f in pending.keys():
					if f <= frame:
						for x in pending[f]:
							s.note_off(x)
						pending.erase(f)
				out.append_array(s.render_offline(n, SR))
				frame += n
	return out


## Energy above 2.5 kHz relative to all energy, in dB (four one-pole high
## passes, 24 dB/octave, so the fundamentals barely leak in).
static func hf_db(buf: PackedVector2Array) -> float:
	var a := exp(-2.0 * PI * 2500.0 / SR)
	var lp := [0.0, 0.0, 0.0, 0.0]
	var e_all := 0.0
	var e_hi := 0.0
	for f in buf:
		var x := (f.x + f.y) * 0.5
		e_all += x * x
		for i in 4:
			lp[i] = x + a * (lp[i] - x)
			x -= lp[i]
		e_hi += x * x
	return 10.0 * log(maxf(e_hi, 1e-15) / maxf(e_all, 1e-12)) / log(10.0)


static func save_wav(buf: PackedVector2Array, path: String) -> void:
	var data := PackedByteArray()
	data.resize(buf.size() * 4)
	for i in buf.size():
		data.encode_s16(i * 4, int(clampf(buf[i].x, -1.0, 1.0) * 32767.0))
		data.encode_s16(i * 4 + 2, int(clampf(buf[i].y, -1.0, 1.0) * 32767.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.stereo = true
	w.mix_rate = int(SR)
	w.data = data
	w.save_to_wav(path)
