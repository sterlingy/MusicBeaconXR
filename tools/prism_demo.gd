extends SceneTree
## Renders listening demos of Prism's presets to WAV files (offline, no sound card).
##   godot --headless --path . -s res://tools/prism_demo.gd -- --out=<folder>
## Keys presets play chords, leads a phrase, pads slow chord changes, and one
## file plays keys + lead + pad together through the shared space.

const SR := 48000
const BLOCK := 512

var out_dir := "user://prism_demos"


func _init() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--out="):
			out_dir = a.trim_prefix("--out=")
	DirAccess.make_dir_recursive_absolute(out_dir)
	var roles := {"Prism Keys": "keys", "Glass EP": "keys", "Drawbar Drift": "keys", "Comet Tail": "lead", "Talking Lead": "lead",
		"Aurora Pad": "pad", "Glass Choir": "pad", "Dust Halo": "pad"}
	var i := 1
	for p in PresetLibrary.list("Prism"):
		var s := _synth(p.name)
		var buf := _perform({roles[p.name]: s}, 10.0)
		_save(buf, "%02d_%s.wav" % [i, p.name.to_lower().replace(" ", "_")])
		i += 1
	var trio := {"keys": _synth("Glass EP"), "lead": _synth("Comet Tail"), "pad": _synth("Aurora Pad")}
	trio.keys.set_param("out.volume", 5)
	trio.pad.set_param("out.volume", 5)
	_save(_perform(trio, 16.0), "09_keys_lead_pad_together.wav")
	print("prism_demo: wrote demos to ", ProjectSettings.globalize_path(out_dir))
	quit()


func _synth(preset_name: String) -> JamSynth:
	var s := JamSynth.new()
	s.instrument = "Prism"
	for p in PresetLibrary.list("Prism"):
		if p.name == preset_name:
			PresetLibrary.apply(s, p)
	s.set_tempo(96.0)
	return s


## A small arrangement at 96 bpm: chords per bar, a lead phrase in eighths.
func _perform(parts: Dictionary, seconds: float) -> PackedVector2Array:
	var chords := [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 62]]
	var phrase := [72, 74, 76, 79, 76, 74, 72, 67, 69, 72, 74, 72, 69, 67, 69, 72]
	var beat_frames := int(SR * 60.0 / 96.0)
	var total := int(seconds * SR)
	var out := PackedVector2Array()
	out.resize(total)
	var t := 0
	var held := {"keys": [], "pad": []}
	var lead_note := -1
	while t < total:
		var beat := t / beat_frames
		var at_beat := t % beat_frames < BLOCK
		if at_beat:
			var bar := beat / 4
			var bar_start := beat % 4 == 0
			for role in ["keys", "pad"]:
				if parts.has(role) and bar_start:
					for n in held[role]:
						parts[role].note_off(n)
					var ch: Array = chords[bar % 4]
					held[role] = ch.map(func(n): return n - 12) if role == "pad" else ch
					for n in held[role]:
						parts[role].note_on(n, 0.8 if role == "keys" else 0.6)
			if parts.has("lead") and t < total - beat_frames * 2:
				if lead_note >= 0:
					parts.lead.note_off(lead_note)
				lead_note = phrase[beat % phrase.size()]
				parts.lead.note_on(lead_note, 0.85)
				parts.lead.control_change(1, clampf(float(beat % 16) / 16.0, 0.0, 1.0))
		if t > total - beat_frames * 2:
			for role in held:
				if parts.has(role):
					for n in held[role]:
						parts[role].note_off(n)
				held[role] = []
			if lead_note >= 0 and parts.has("lead"):
				parts.lead.note_off(lead_note)
				lead_note = -1
		var n := mini(BLOCK, total - t)
		for role in parts:
			var b: PackedVector2Array = parts[role].render_offline(n, SR)
			for k in n:
				out[t + k] += b[k]
		t += n
	return out


func _save(buf: PackedVector2Array, file: String) -> void:
	var peak := 0.0
	for f in buf:
		peak = maxf(peak, maxf(absf(f.x), absf(f.y)))
	var g := 0.89 / peak if peak > 0.89 else 1.0 # never clip the file
	var data := PackedByteArray()
	data.resize(buf.size() * 4)
	for i in buf.size():
		data.encode_s16(i * 4, int(clampf(buf[i].x * g, -1.0, 1.0) * 32767.0))
		data.encode_s16(i * 4 + 2, int(clampf(buf[i].y * g, -1.0, 1.0) * 32767.0))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.stereo = true
	wav.mix_rate = SR
	wav.data = data
	wav.save_to_wav(out_dir.path_join(file))
	print("  %-34s peak %.2f" % [file, peak])
