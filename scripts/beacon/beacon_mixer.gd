class_name BeaconMixer
extends RefCounted
## Song theory and blending (GDScript port of web/src/song.js and mixer.js).
## Songs are the "beacon-song" v1 dictionaries described in web/README.md.

const ROLES := ["drums", "bass", "keys", "lead", "pluck", "texture"]
const DRUM_VOICES := ["kick", "snare", "hat", "open", "clap"]
## The songs' lead and pluck notes carry +1 octave (or more), so they start at octave 3.
const ROLE_OCTAVE := {"bass": 2, "lead": 3, "pluck": 3, "texture": 3}
## Lowest and highest MIDI note a part may play; notes outside fold in by
## octaves. A bass above G3 stops sounding like a bass, and a lead above D6
## turns piercing.
const ROLE_RANGE := {"bass": [28, 55], "lead": [52, 86], "pluck": [48, 91]}
const MODES := {
	"major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10], "dorian": [0, 2, 3, 5, 7, 9, 10],
	"mixolydian": [0, 2, 4, 5, 7, 9, 10], "lydian": [0, 2, 4, 6, 7, 9, 11], "phrygian": [0, 1, 3, 5, 7, 8, 10],
	"harmonicMinor": [0, 2, 3, 5, 7, 8, 11],
}
const NOTE_NAMES := ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
const LOG_PARAMS := ["cutoff", "tone", "tune", "rate", "amount"]


static func degree_to_midi(key: Dictionary, degree: int, octave := 4) -> int:
	var scale: Array = MODES.get(key.mode, MODES.major)
	var n := scale.size()
	var oct := floori(float(degree) / n)
	var idx := posmod(degree, n)
	return 12 * (octave + 1 + oct) + int(key.root) + int(scale[idx])


## Moves a note by octaves into the role's range (if it has one).
static func fold_into_range(role: String, midi: int) -> int:
	var r: Array = ROLE_RANGE.get(role, [])
	if r.is_empty():
		return midi
	while midi > r[1]:
		midi -= 12
	while midi < r[0]:
		midi += 12
	return midi


## A progression chord as [key, degree]: a plain degree is in the song's key; a
## borrowed chord {d, m} is degree d of mode m on the same root (as
## web/src/song.js chordRef), and melodies over it use that mode's scale.
static func chord_ref(key: Dictionary, c: Variant) -> Array:
	if typeof(c) == TYPE_DICTIONARY:
		var m: String = c.get("m", key.mode)
		return [{"root": key.root, "mode": m if MODES.has(m) else key.mode}, int(c.get("d", 0))]
	return [key, int(c)]


## MIDI note `deg` scale steps above a chord's root, in the chord's own scale.
static func chord_tone(key: Dictionary, c: Variant, deg: int, octave := 4) -> int:
	var ref := chord_ref(key, c)
	return degree_to_midi(ref[0], ref[1] + deg, octave)


static func chord_notes(key: Dictionary, chord: Variant, octave := 4, size := 3) -> Array:
	var ref := chord_ref(key, chord)
	var out := []
	for i in size:
		out.append(degree_to_midi(ref[0], ref[1] + 2 * i, octave))
	return out


static func chord_name(key: Dictionary, degree: Variant) -> String:
	var c := chord_notes(key, degree)
	var third: int = c[1] - c[0]
	var fifth: int = c[2] - c[0]
	var root: String = NOTE_NAMES[c[0] % 12]
	if third == 3 and fifth == 6:
		return root + "dim"
	if third == 3:
		return root + "m"
	return root


static func validate(s) -> PackedStringArray:
	var errs := PackedStringArray()
	if typeof(s) != TYPE_DICTIONARY:
		return PackedStringArray(["not an object"])
	if s.get("format") != "beacon-song":
		errs.append("format must be beacon-song")
	# Version 2 adds a song form (sections); this player plays its verse material as a loop.
	if not int(s.get("version", 0)) in [1, 2]:
		errs.append("version must be 1 or 2")
	var key = s.get("key")
	if typeof(key) != TYPE_DICTIONARY or not MODES.has(key.get("mode", "")) or int(key.get("root", -1)) < 0 or int(key.get("root", -1)) > 11:
		errs.append("bad key")
	if float(s.get("bpm", 0)) < 40 or float(s.get("bpm", 0)) > 220:
		errs.append("bpm must be 40-220")
	if typeof(s.get("progression")) != TYPE_ARRAY or s.progression.is_empty():
		errs.append("progression missing")
	else:
		for c in s.progression:
			if typeof(c) == TYPE_DICTIONARY:
				if not MODES.has(c.get("m", "")):
					errs.append("a borrowed chord needs a known mode")
					break
			elif typeof(c) != TYPE_INT and typeof(c) != TYPE_FLOAT:
				errs.append("progression entries must be degrees or {d, m} chords")
				break
	if typeof(s.get("tracks")) != TYPE_DICTIONARY:
		errs.append("tracks missing")
	return errs


## Blends the active songs ([{id, w, song}]) into per-role {gain, params, sample, sources}.
static func blend(active: Array) -> Dictionary:
	var roles := {}
	for role in ROLES:
		var gain := 0.0
		var sources := []
		for a in active:
			var t = a.song.tracks.get(role)
			var lvl: float = t.level if t else 0.0
			gain += a.w * lvl
			sources.append({"id": a.id, "share": a.w * lvl})
		var total := 0.0
		for s in sources:
			total += s.share
		for s in sources:
			s.share = s.share / total if total > 0.0 else 0.0
		roles[role] = {"gain": gain, "params": _blend_params(active, role, sources), "sample": _lead_sample(active, role, sources), "kits": kit_shares(active, role, sources), "sources": sources}
	return roles


## The SynthKit sounds a part's songs ask for, loudest first: [{preset, tune,
## share}], one per preset (its tune from the loudest song using it); preset
## "" = songs without a kit. As web/src/mixer.js kitShares.
static func kit_shares(active: Array, role: String, sources: Array) -> Array:
	var by := {}
	var order := []
	for i in sources.size():
		var t = active[i].song.tracks.get(role)
		var kit = t.get("kit") if t is Dictionary else null
		var name: String = str(kit.get("preset", "")) if kit is Dictionary else ""
		if not by.has(name):
			by[name] = {"preset": name, "tune": null, "share": 0.0, "best": -1.0}
			order.append(name)
		var e: Dictionary = by[name]
		e.share += float(sources[i].share)
		if float(sources[i].share) > e.best:
			e.best = float(sources[i].share)
			e.tune = kit.get("tune") if kit is Dictionary else null
	var out := []
	for name in order:
		out.append({"preset": name, "tune": by[name].tune, "share": by[name].share})
	out.sort_custom(func(a, b): return a.share > b.share or (a.share == b.share and String(a.preset) < String(b.preset)))
	return out


## The sound a part keeps: switches only when another is louder by `margin` (null when there's none).
static func choose_kit(kits: Array, current: String, margin := 0.15):
	if kits.is_empty():
		return null
	for k in kits:
		if k.preset == current and k.share >= kits[0].share - margin:
			return k
	return kits[0]


## The sampled instrument a part plays: the loudest song's choice in that role ("" = its synth).
static func _lead_sample(active: Array, role: String, sources: Array) -> String:
	var best := -1.0
	var out := ""
	for i in sources.size():
		if sources[i].share > best:
			best = sources[i].share
			var t = active[i].song.tracks.get(role)
			out = str(t.get("sample", "")) if t else ""
	return out


static func _blend_params(active: Array, role: String, sources: Array) -> Dictionary:
	var out := {}
	var lead = null
	var best := -1.0
	for i in sources.size():
		if sources[i].share > best:
			best = sources[i].share
			lead = active[i]
	if lead and lead.song.tracks.has(role):
		out.merge(lead.song.tracks[role].params, true)
	var use_share := false
	for s in sources:
		if s.share > 0.0:
			use_share = true
	var keys := {}
	for a in active:
		var t = a.song.tracks.get(role)
		if t:
			for k in t.params:
				if typeof(t.params[k]) in [TYPE_FLOAT, TYPE_INT]:
					keys[k] = true
	for k in keys:
		var is_log := false
		for frag in LOG_PARAMS:
			if k.contains(frag):
				is_log = true
		var vals := []
		for a in active:
			var t = a.song.tracks.get(role)
			vals.append(t.params.get(k) if t else null)
		for v in vals:
			if v != null and float(v) <= 0.0:
				is_log = false
		var acc := 0.0
		var wsum := 0.0
		for i in vals.size():
			if vals[i] == null:
				continue
			var w: float = sources[i].share if use_share else active[i].w
			if w <= 0.0:
				continue
			acc += w * (log(float(vals[i])) if is_log else float(vals[i]))
			wsum += w
		if wsum <= 0.0:
			continue
		var v := acc / wsum
		if is_log:
			v = exp(v)
		if lead and lead.song.has("morph") and lead.song.morph.has(role) and lead.song.morph[role].has(k):
			var r: Array = lead.song.morph[role][k]
			v = clampf(v, r[0], r[1])
		out[k] = v
	return out


static func target_tempo(active: Array) -> float:
	var s := 0.0
	var w := 0.0
	for a in active:
		s += a.w * float(a.song.bpm)
		w += a.w
	return s / w if w > 0.0 else 110.0


## Deterministic number in [0, 1) for a tuple of ints.
static func hash01(a: int, b: int, c: int) -> float:
	var h := 0x9e3779b9
	for p in [a, b, c]:
		h = (h ^ (p + 0x7f4a7c15 + (h << 6) + (h >> 2))) & 0xffffffff
		h = ((h ^ (h >> 16)) * 0x85ebca6b) & 0xffffffff
	h = ((h ^ (h >> 13)) * 0xc2b2ae35) & 0xffffffff
	return float((h ^ (h >> 16)) & 0xffffffff) / 4294967296.0


static func pick_source(sources: Array, bar: int, step: int, salt: int):
	var r := hash01(bar % 4, step, salt)
	var acc := 0.0
	for s in sources:
		acc += s.share
		if r < acc:
			return s.id
	return null


## Notes for one 16th step: [{role, id, voice?, notes, vel, gate}] (gate in steps).
static func step_events(active: Array, mix: Dictionary, harmony: Harmony, bar: int, step: int) -> Array:
	var by_id := {}
	for a in active:
		by_id[a.id] = a.song
	var key: Dictionary = harmony.song.key
	var chord_deg: Variant = harmony.chord_degree(bar)
	var events := []
	for ri in ROLES.size():
		var role: String = ROLES[ri]
		var m: Dictionary = mix[role]
		if m.gain <= 0.001:
			continue
		if role == "drums":
			for vi in DRUM_VOICES.size():
				var voice: String = DRUM_VOICES[vi]
				var id = pick_source(m.sources, bar, step, 100 + vi)
				if id == null:
					continue
				var pat = by_id[id].tracks.get("drums", {}).get("pattern", {}).get(voice)
				if pat and float(pat[step]) > 0.0:
					events.append({"role": role, "id": id, "voice": voice, "notes": [], "vel": float(pat[step]), "gate": 1})
			continue
		var sid = pick_source(m.sources, bar, step, ri)
		if sid == null:
			continue
		var t: Dictionary = by_id[sid].tracks[role]
		var bar_pat = t.pattern[bar % t.pattern.size()]
		var ev = bar_pat[step] if bar_pat else null
		if ev == null:
			continue
		if role == "keys":
			events.append({"role": role, "id": sid, "notes": chord_notes(key, chord_deg, int(round(m.params.get("octave", 4))), int(round(m.params.get("voicing", 3)))), "vel": float(ev.v), "gate": float(ev.g)})
		else:
			var midi := fold_into_range(role, chord_tone(key, chord_deg, int(ev.d), ROLE_OCTAVE[role] + int(ev.get("o", 0))))
			events.append({"role": role, "id": sid, "notes": [midi], "vel": float(ev.v), "gate": float(ev.g)})
	return events


## Which song sets key, chords and phrase position. Switches only on bar lines,
## and only when another song leads by `hysteresis`.
class Harmony:
	var hysteresis := 0.08
	var phrase_bars := 1
	var id = null
	var song: Dictionary = {}

	func update(active: Array, bar: int) -> bool:
		if active.is_empty():
			return false
		var top = active[0]
		for a in active:
			if a.w > top.w:
				top = a
		var cur = null
		for a in active:
			if a.id == id:
				cur = a
		if id == null:
			_choose(top)
			return true
		if bar % phrase_bars != 0:
			return false
		if cur == null or (top.id != id and top.w > cur.w + hysteresis):
			_choose(top)
			return true
		song = cur.song
		return false

	func _choose(a) -> void:
		id = a.id
		song = a.song

	## This bar's chord: a degree (int) or a borrowed chord ({d, m}).
	func chord_degree(bar: int) -> Variant:
		var p: Array = song.progression
		var c = p[bar % p.size()]
		return c if typeof(c) == TYPE_DICTIONARY else int(c)
