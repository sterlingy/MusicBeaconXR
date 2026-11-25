extends SceneTree
## Measures how bright (or shrill) the beacon songs make the Prism parts.
## For a spread of songs it applies each song's keys / lead settings through
## ParamMap, plays a short passage on phone quality, and reports the share of
## energy above 3 kHz (where "shrill" lives). Optionally writes WAVs to listen to.
##   godot --headless --path . -s res://tools/tone_check.gd -- [--wav=<folder>] [--quality=0]

const SR := 48000.0
const BLOCK := 512


func _init() -> void:
	var wav_dir := ""
	var quality := 0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--wav="):
			wav_dir = a.trim_prefix("--wav=")
		elif a.begins_with("--quality="):
			quality = int(a.trim_prefix("--quality="))
	if wav_dir != "":
		DirAccess.make_dir_recursive_absolute(wav_dir)
	var songs: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://songs/grid.json")).songs
	var keys := songs.keys()
	keys.sort()
	var report := {"keys": [], "lead": [], "pad": []}
	var picks := []
	for i in range(0, keys.size(), maxi(1, keys.size() / 12)):
		picks.append(keys[i])
	for id in picks:
		var song: Dictionary = songs[id]
		for role in ["keys", "lead", "pad"]:
			var s := _synth({"keys": "Prism Keys", "lead": "Comet Tail", "pad": "Aurora Pad"}[role], quality)
			if song.tracks.has(role):
				var params: Dictionary = ParamMap.to_synth(role, song.tracks[role].get("params", {}))
				for k in params:
					s.set_param(k, params[k])
			var buf := _play(s, role)
			report[role].append(_hf_share(buf))
			if wav_dir != "" and id == picks[picks.size() / 2]:
				_save(buf, wav_dir.path_join("%s_%s.wav" % [role, id]))
	for role in report:
		var v: Array = report[role]
		v.sort()
		print("  %-5s energy above 3 kHz: median %4.1f%%  worst %4.1f%%" % [role, 100.0 * v[v.size() / 2], 100.0 * v[-1]])
	quit()


func _synth(preset_name: String, quality: int) -> JamSynth:
	var s := JamSynth.new()
	s.instrument = "Prism"
	for p in PresetLibrary.list("Prism"):
		if p.name == preset_name:
			PresetLibrary.apply(s, p)
	s.set_param("voice.quality", quality)
	s.set_param("send.space", 0) # the shared reverb is measured with the dry part
	s.set_param("send.echo", 0)
	return s


func _play(s: JamSynth, role: String) -> PackedVector2Array:
	var notes: Array = {"keys": [[60, 64, 67, 71], [62, 65, 69, 72]], "pad": [[48, 55, 60, 64], [50, 57, 62, 65]],
		"lead": [[76], [79], [81], [79], [76], [74]]}[role]
	var out := PackedVector2Array()
	var step := int(SR * 0.5) if role == "lead" else int(SR * 1.5)
	for chord in notes:
		for n in chord:
			s.note_on(n, 0.85)
		var t := 0
		while t < step:
			out.append_array(s.render_offline(BLOCK, SR))
			t += BLOCK
		for n in chord:
			s.note_off(n)
	return out


## Share of energy above ~3 kHz: four one-pole high passes (24 dB/octave), so a
## lead's fundamental barely leaks in. Energy out / energy in.
func _hf_share(buf: PackedVector2Array) -> float:
	var a := exp(-2.0 * PI * 3000.0 / SR)
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
	return e_hi / maxf(e_all, 1e-12)


func _save(buf: PackedVector2Array, path: String) -> void:
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
