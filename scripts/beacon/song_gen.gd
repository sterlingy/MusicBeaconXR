class_name SongGen
extends RefCounted
## The browser's song generator (web/src/song.js generateSong), line for line,
## so the app makes exactly the same song for a beacon as the website does.
## The app needs it for the local grid, whose beacons are anywhere on Earth
## and too many to ship as a song pack. The preset and control tables come
## from songs/gen_tables.json (written by web/tools/export_songs.mjs), and
## tests/fixtures/song_gen.json holds songs it must reproduce exactly.
##
## Matching JavaScript means: 32-bit integer math for the hashes and the
## random generator, Math.round (halves round up), and V8's sort (fitForm
## sorts with a comparator that draws random numbers, so the order of
## comparisons matters).

const ROLES := ["drums", "bass", "keys", "lead", "pluck", "texture"]
const ROLE_INSTRUMENT := {"drums": "Pulsar", "bass": "Undertow", "keys": "Lumen", "lead": "Comet", "pluck": "Driftwood", "texture": "Tangle"}
const MIX := {"drums": 0.214, "bass": 0.602, "keys": 0.441, "lead": 0.716, "pluck": 1.0, "texture": 0.216}
const SHAPES := ["sine", "triangle", "saw", "ramp", "square", "random", "drift"]
const PROGRESSIONS := {
	"major": [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 3], [0, 3, 0, 4], [5, 3, 0, 4], [0, 1, 3, 4]],
	"minor": [[0, 5, 2, 6], [0, 3, 4, 0], [0, 6, 5, 6], [0, 3, 6, 2], [0, 5, 3, 4]],
	"dorian": [[0, 3, 0, 3], [0, 6, 3, 0], [0, 1, 3, 0]],
	"mixolydian": [[0, 6, 3, 0], [0, 3, 6, 3], [0, 4, 6, 3]],
	"lydian": [[0, 1, 0, 1], [0, 1, 4, 0], [0, 6, 1, 0]],
	"phrygian": [[0, 1, 0, 6], [0, 1, 2, 1]],
	"harmonicMinor": [[0, 3, 4, 0], [0, 5, 4, 4], [0, 3, 5, 4]],
}
const PRE_PROGRESSIONS := [[3, 4, 3, 4], [1, 3, 4, 4], [5, 3, 4, 4], [3, 3, 4, 4]]
const BRIDGE_PROGRESSIONS := [[3, 4, 5, 4], [5, 3, 1, 4], [3, 0, 4, 4], [5, 4, 3, 4], [1, 5, 3, 4]]
# Generator v2 (as web/src/song.js): borrowed chords {d, m}, drone sways, families.
const BORROWED := {
	"major": [[0, {"d": 6, "m": "mixolydian"}, 3, 0], [0, {"d": 4, "m": "mixolydian"}, 3, {"d": 2, "m": "minor"}], [0, {"d": 2, "m": "minor"}, 3, 4],
		[0, 3, {"d": 3, "m": "minor"}, 0], [0, {"d": 5, "m": "minor"}, {"d": 6, "m": "minor"}, 0], [0, {"d": 1, "m": "lydian"}, 3, 0], [3, {"d": 6, "m": "mixolydian"}, 0, 0]],
	"minor": [[0, 6, 3, 0], [0, {"d": 3, "m": "dorian"}, 0, 6], [0, 5, 6, {"d": 4, "m": "harmonicMinor"}], [0, 6, 2, {"d": 4, "m": "harmonicMinor"}], [0, {"d": 3, "m": "dorian"}, 6, 0]],
	"dorian": [[0, {"d": 4, "m": "harmonicMinor"}, 3, 0]],
	"mixolydian": [[0, {"d": 2, "m": "minor"}, 6, 0]],
}
const SWAYS := [[0, 0, 0, 0], [0, 0, 6, 6], [0, 0, 5, 5], [0, 0, 3, 3], [0, 6, 0, 6], [0, 0, 1, 1]]
const FAMILY_BPM := {"journey": [120, 132], "ambient": [64, 92], "groove": [104, 122]}
const BORROW_ODDS := {"song": 0.5, "journey": 0.0, "ambient": 0.35, "groove": 0.6}
const FAMILY_FORMS := {
	"journey": [["intro", "verse", "pre", "chorus", "break", "pre", "chorus", "outro"], ["intro", "verse", "verse", "pre", "chorus", "break", "chorus", "outro"]],
	"ambient": [["intro", "verse", "break", "verse", "outro"], ["intro", "verse", "bridge", "verse", "outro"]],
	"groove": [["intro", "verse", "chorus", "verse", "chorus", "break", "chorus", "outro"], ["intro", "verse", "verse", "chorus", "verse", "chorus", "chorus", "outro"]],
}
const JOURNEY_ENERGY := {"intro": 0.3, "verse": 0.6, "pre": 0.8, "chorus": 1.25, "break": 0.3, "outro": 0.4}
const AMBIENT_ENERGY := {"intro": 0.35, "verse": 0.55, "break": 0.3, "bridge": 0.5, "outro": 0.3}
const FORMS := [
	["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus", "outro"],
	["intro", "verse", "pre", "chorus", "verse", "pre", "chorus", "bridge", "chorus", "chorus", "outro"],
	["intro", "verse", "verse", "chorus", "verse", "chorus", "break", "chorus", "outro"],
	["intro", "verse", "chorus", "verse", "chorus", "break", "bridge", "chorus", "chorus", "outro"],
]
const SECTION_SIZES := {"intro": [4, 8], "verse": [8, 16], "pre": [4, 8], "chorus": [8, 16], "bridge": [8, 16], "break": [4, 8], "outro": [4, 8, 16]}
const MIN_SONG_SECONDS := 120.0
const MAX_SONG_SECONDS := 300.0
const MOODS := [
	{"name": "Drift", "energy": 0.25, "bpm": [72, 90], "modes": ["lydian", "major", "dorian"], "families": ["ambient", "ambient", "song"]},
	{"name": "Glow", "energy": 0.4, "bpm": [80, 100], "modes": ["major", "mixolydian", "lydian"], "families": ["song", "song", "ambient"]},
	{"name": "Tide", "energy": 0.55, "bpm": [96, 112], "modes": ["minor", "dorian"], "families": ["song", "groove", "groove"]},
	{"name": "Pulse", "energy": 0.75, "bpm": [110, 124], "modes": ["minor", "phrygian", "harmonicMinor"], "families": ["groove", "journey", "song"]},
	{"name": "Rush", "energy": 0.9, "bpm": [120, 132], "modes": ["mixolydian", "minor", "dorian"], "families": ["journey", "journey", "groove"]},
]
const NAME_A := ["Amber", "Cobalt", "Salt", "Cedar", "Neon", "Paper", "Velvet", "Iron", "Moss", "Silver", "Ember", "Glass", "Coral", "Dusk", "Lunar", "Copper"]
const NAME_B := ["Harbor", "Orchard", "Signal", "Lantern", "Canyon", "Garden", "Circuit", "Meadow", "Station", "Shore", "Ridge", "Hollow", "Bloom", "Current", "Atlas", "Field"]
const PLAY_ODDS := {"verse": 0.7, "pre": 0.8, "chorus": 0.9, "bridge": 0.55, "break": 0.4}
const TABLES := "res://songs/gen_tables.json"
const M32 := 0xFFFFFFFF

static var _tables: Dictionary = {}

var _a := 0 # mulberry32 state (unsigned 32-bit)


# ---------------------------------------------------------------- JS math

## Math.imul's low 32 bits, unsigned; split so nothing overflows 64 bits.
static func imul(a: int, b: int) -> int:
	a &= M32
	b &= M32
	return (a * (b & 0xFFFF) + (((a * (b >> 16)) & 0xFFFF) << 16)) & M32


## FNV-1a over the string's UTF-16 code units (song seeds are ASCII).
static func hash_string(s: String) -> int:
	var h := 0x811c9dc5
	for i in s.length():
		h ^= s.unicode_at(i)
		h = imul(h, 0x01000193)
	return h


## Math.round: halves round toward +infinity.
static func js_round(v: float) -> float:
	return floorf(v + 0.5)


static func rnd(v: float, d := 2) -> float:
	var k := pow(10.0, d)
	return js_round(v * k) / k


## +x.toFixed(4) for the values the generator makes (multiples of a step).
static func fixed4(x: float) -> float:
	return js_round(x * 10000.0) / 10000.0


## mulberry32, as song.js rng(): floats in [0, 1).
func r() -> float:
	_a = (_a + 0x6d2b79f5) & M32
	var t := _a
	t = imul(t ^ (t >> 15), t | 1)
	t ^= (t + imul(t ^ (t >> 7), t | 61)) & M32
	return float((t ^ (t >> 14)) & M32) / 4294967296.0


func pick(arr: Array) -> Variant:
	return arr[int(floorf(r() * arr.size()))]


func rng_range(lo: float, hi: float) -> float:
	return lo + (hi - lo) * r()


func shuffle(a: Array) -> Array:
	for i in range(a.size() - 1, 0, -1):
		var j := int(floorf(r() * (i + 1)))
		var tmp = a[i]
		a[i] = a[j]
		a[j] = tmp
	return a


## Array.prototype.sort as V8 runs it on short arrays (TimSort: one run, made
## by CountAndMakeRun, then extended by binary insertion), calling `cmp`
## exactly as often and in the same order, so random comparators match.
static func v8_sort(a: Array, cmp: Callable) -> Array:
	var n := a.size()
	if n < 2:
		return a
	assert(n < 64, "v8_sort: only short arrays (one run) are supported")
	# CountAndMakeRun(0, n)
	var run := 2
	var desc: bool = float(cmp.call(a[1], a[0])) < 0.0
	var prev = a[1]
	for idx in range(2, n):
		var order := float(cmp.call(a[idx], prev))
		if desc:
			if order >= 0.0:
				break
		elif order < 0.0:
			break
		prev = a[idx]
		run += 1
	if desc:
		var lo := 0
		var hi := run - 1
		while lo < hi:
			var tmp = a[lo]
			a[lo] = a[hi]
			a[hi] = tmp
			lo += 1
			hi -= 1
	if n == 1:
		return a
	# BinaryInsertionSort(0, run, n)
	var start := run
	while start < n:
		var pivot = a[start]
		var left := 0
		var right := start
		while left < right:
			var mid := left + ((right - left) >> 1)
			if float(cmp.call(pivot, a[mid])) < 0.0:
				right = mid
			else:
				left = mid + 1
		var p := start
		while p > left:
			a[p] = a[p - 1]
			p -= 1
		a[left] = pivot
		start += 1
	return a


# ---------------------------------------------------------------- tables

static func tables() -> Dictionary:
	if _tables.is_empty():
		_tables = JSON.parse_string(FileAccess.get_file_as_string(TABLES))
	return _tables


static func controls(n: String) -> Array:
	return tables().controls[n]


static func is_choice(c: Array) -> bool:
	return c[2] is Array


static func c_opts(c: Array) -> Dictionary:
	return c[6] if c.size() > 6 and c[6] is Dictionary else {}


static func defaults(n: String) -> Dictionary:
	var p := {}
	for c in controls(n):
		p[c[0]] = c[3] if is_choice(c) else c[5]
	return p


static func automatable(n: String) -> Array:
	var out := []
	for c in controls(n):
		if not is_choice(c) and c_opts(c).get("auto", true) != false:
			out.append(c[0])
	return out


# ---------------------------------------------------------------- generator

## A complete song for a beacon, the same as song.js generateSong(seed).
static func generate(seed: String, hint := {}) -> Dictionary:
	var g := SongGen.new()
	g._a = hash_string(seed)
	var song := g._song(hint)
	assign_samples(song, seed)
	return song


## Sampled instruments (SynthKit's Sampler; packs built by tools/build_samples.py):
## which recorded instrument a part may play instead of its synth, in the order
## the parts are rolled. Same as web/src/song.js SAMPLE_CHOICES and SAMPLE_ODDS.
const SAMPLE_CHOICES := {
	"drums": ["orch_kit"],
	"bass": ["contrabass_pizz", "contrabass", "tuba", "bassoon"],
	"keys": ["piano"],
	"lead": ["horn", "flute", "clarinet", "oboe", "trumpet"],
	"pluck": ["harp", "strings_pizz", "marimba", "glock", "xylo"],
	"pad": ["strings", "strings", "trombone", "horn"],
}
const SAMPLE_ODDS := {
	"ambient": {"drums": 0.1, "bass": 0.3, "keys": 0.5, "lead": 0.45, "pluck": 0.5, "pad": 0.6},
	"journey": {"drums": 0.25, "bass": 0.35, "keys": 0.45, "lead": 0.55, "pluck": 0.45, "pad": 0.6},
	"song": {"drums": 0.15, "bass": 0.3, "keys": 0.45, "lead": 0.35, "pluck": 0.35, "pad": 0.4},
	"groove": {"drums": 0.08, "bass": 0.2, "keys": 0.3, "lead": 0.2, "pluck": 0.3, "pad": 0.25},
}


## Picks the song's sampled parts from its own seed (seed + "|samples"), so the
## notes and synth sounds stay the same. A player without the sample plays the synth.
static func assign_samples(song: Dictionary, seed: String) -> void:
	var g := SongGen.new()
	g._a = hash_string(seed + "|samples")
	var odds: Dictionary = SAMPLE_ODDS.get(song.get("family", "song"), SAMPLE_ODDS.song)
	for role in SAMPLE_CHOICES:
		var roll := g.r()
		var id: String = g.pick(SAMPLE_CHOICES[role])
		if roll >= float(odds[role]):
			continue
		if role == "pad":
			song["pad"] = {"sample": id}
		elif song.tracks.has(role):
			song.tracks[role]["sample"] = id


func _song(hint := {}) -> Dictionary:
	var mood: Dictionary = MOODS[int(floorf(r() * MOODS.size()))]
	var family: String = hint.family if hint.has("family") else pick(mood.families)
	var mode: String = pick(mood.modes)
	var key := {"root": int(floorf(r() * 12)), "mode": mode}
	var e := clampf(mood.energy + rng_range(-0.1, 0.1), 0.0, 1.0)
	var bpm: Array = FAMILY_BPM.get(family, mood.bpm)
	var title := "%s %s" % [pick(NAME_A), pick(NAME_B)]
	var song := {"format": "beacon-song", "version": 2, "title": title, "author": "generator", "mood": mood.name,
		"family": family, "energy": rnd(e), "key": key}
	song.bpm = int(js_round(rng_range(bpm[0], bpm[1])))
	song.bars = 4
	song.steps = 16
	song.progression = _pick_progression(family, mode).duplicate()
	song.tracks = {}
	song.morph = {}
	song.tracks.drums = _drums(e, family)
	song.tracks.bass = _bass(e, family)
	song.tracks.keys = _keys(e, family)
	song.tracks.lead = _lead(e, family)
	song.tracks.pluck = _pluck(e, family)
	song.tracks.texture = _texture(e, family)
	for role in ROLES:
		_dress(song.tracks[role], role, e)
	if family == "ambient":
		var dp: Dictionary = song.tracks.drums.params
		dp["hat.tone"] = minf(float(dp["hat.tone"]), 4500.0)
	for role in ROLES:
		song.morph[role] = _morph(role)
	_structure(song, e)
	for role in ROLES:
		song.tracks[role].level = rnd(float(song.tracks[role].level) * MIX[role], 3)
	return song


func _pick_progression(family: String, mode: String) -> Array:
	if family == "journey":
		return pick(SWAYS)
	if BORROWED.has(mode) and r() < BORROW_ODDS[family]:
		return pick(BORROWED[mode])
	return pick(PROGRESSIONS.get(mode, PROGRESSIONS.major))


func _dress(t: Dictionary, role: String, e: float) -> void:
	var n: String = ROLE_INSTRUMENT[role]
	var all: Array = tables().presets[n]
	var fits := all.filter(func(p): return absf(float(p.energy) - e) <= 0.3)
	var preset: Dictionary = pick(fits if not fits.is_empty() else all)
	var base := defaults(n)
	base.merge(preset.params, true)
	var auto: Dictionary = preset.get("automation", {}).duplicate(true)
	var params := {}
	for c in controls(n):
		var v = base[c[0]]
		if is_choice(c):
			params[c[0]] = pick(c[2]) if r() < 0.12 else v
		elif c_opts(c).get("auto", true) == false:
			params[c[0]] = v
		else:
			var lo: float = c[2]
			var hi: float = c[3]
			var stepv: float = c[4]
			var x: float
			if c_opts(c).get("log", false):
				x = float(v) * pow(2.0, rng_range(-0.12, 0.12) * (log(hi / lo) / log(2.0)))
			else:
				x = float(v) + rng_range(-0.12, 0.12) * (hi - lo)
			x = js_round(clampf(x, lo, hi) / stepv) * stepv
			params[c[0]] = fixed4(x)
	if role == "keys":
		params.voicing = t.params.voicing
		params.octave = t.params.octave
	t.params = params
	t.preset = preset.name
	var free := automatable(n).filter(func(id): return not auto.has(id) and not id.contains("send") and not id.ends_with("mix"))
	var extra := 0
	if r() < 0.3 + e * 0.4:
		extra = 2 if r() < 0.35 else 1
	while extra > 0 and not free.is_empty():
		extra -= 1
		var id: String = free.pop_at(int(floorf(r() * free.size())))
		var shape = pick(SHAPES)
		var bars = pick([1, 2, 4, 8, 16])
		var depth := rnd(rng_range(0.1, 0.4))
		var phase := rnd(r())
		auto[id] = {"shape": shape, "bars": bars, "depth": depth, "phase": phase}
	if not auto.is_empty():
		t.automation = auto


func _morph(role: String) -> Dictionary:
	var out := {}
	for c in controls(ROLE_INSTRUMENT[role]):
		if not is_choice(c):
			out[c[0]] = [c[2], c[3]]
	return out


func _fit_form(sections: Array, bpm: float, target_sec: float) -> Array:
	var spb := 240.0 / bpm
	var want := target_sec / spb
	var form := []
	for s in sections:
		form.append({"section": s, "bars": 16 if s == "verse" else SECTION_SIZES[s][0]})
	var total := func() -> int:
		var t := 0
		for f in form:
			t += int(f.bars)
		return t
	var vc := func(i: int) -> int:
		return 1 if form[i].section in ["verse", "chorus"] else 0
	var step := func(dir: int) -> bool:
		var order := []
		for i in form.size():
			order.append(i)
		v8_sort(order, func(a, b):
			var d: int = vc.call(b) - vc.call(a)
			return float(d) if d != 0 else r() - 0.5)
		for i in order:
			var sizes: Array = SECTION_SIZES[form[i].section]
			var k := sizes.find(form[i].bars)
			if dir > 0 and k < sizes.size() - 1:
				form[i].bars = sizes[k + 1]
				return true
			if dir < 0 and k > 0:
				form[i].bars = sizes[k - 1]
				return true
		return false
	var n := 0
	while n < 40 and total.call() < want - 4:
		if not step.call(1):
			break
		n += 1
	n = 0
	while n < 40 and total.call() > want + 4:
		if not step.call(-1):
			break
		n += 1
	while total.call() * spb < MIN_SONG_SECONDS:
		var at := form.size() - (1 if form[-1].section == "outro" else 0)
		form.insert(at, {"section": "chorus", "bars": 8})
	while total.call() * spb > MAX_SONG_SECONDS:
		var drop := -1
		for k in form.size():
			if k > 1 and k < form.size() - 2 and form[k].section != "chorus":
				drop = k
				break
		if drop < 0:
			break
		form.remove_at(drop)
	while total.call() * spb > MAX_SONG_SECONDS and step.call(-1):
		pass
	return form


func _lineup(on: Array) -> Dictionary:
	var out := {}
	for x in ROLES:
		out[x] = rnd(rng_range(0.75, 1.0)) if x in on else 0
	return out


func _use_palette(song: Dictionary, palette: Array) -> void:
	for role in ROLES:
		if not role in palette:
			song.tracks[role].level = 0
		elif float(song.tracks[role].level) < 0.3:
			song.tracks[role].level = rnd(rng_range(0.35, 0.7))


static func _uniq(a: Array) -> Array:
	var out := []
	for x in a:
		if not x in out:
			out.append(x)
	return out


func _arrange_journey(song: Dictionary) -> void:
	var palette := ["drums", "bass", "texture", pick(["keys", "pluck"])]
	if r() < 0.6:
		palette.append("lead")
	if r() < 0.4:
		palette.append("keys")
	var uniq := _uniq(palette)
	_use_palette(song, uniq)
	var melodic := uniq.filter(func(x): return x in ["keys", "pluck", "texture"])
	for f in song.form:
		var on: Array
		match f.section:
			"intro":
				on = melodic.slice(0, 1 + int(floorf(r() * melodic.size())))
			"verse":
				on = melodic + ["bass"]
			"pre":
				on = melodic + ["bass", "drums"]
				f.enter = {"drums": pick([0.25, 0.5])}
			"chorus":
				on = uniq.duplicate()
			"break":
				on = melodic.filter(func(x): return x != "pluck" or r() < 0.5)
				if r() < 0.3:
					on.append("bass")
			_:
				on = [pick(melodic), "drums"]
				if r() < 0.5:
					on.append("bass")
		if on.is_empty():
			on = [pick(melodic)]
		f.layers = _lineup(_uniq(on))
	for k in JOURNEY_ENERGY:
		var spec: Dictionary = song.sections.get(k, {}).duplicate()
		spec.energy = JOURNEY_ENERGY[k]
		song.sections[k] = spec


func _arrange_ambient(song: Dictionary) -> void:
	var palette := ["texture", "keys"]
	if r() < 0.6:
		palette.append("pluck")
	if r() < 0.45:
		palette.append("lead")
	if r() < 0.3:
		palette.append("bass")
	if float(song.tracks.drums.level) > 0 and r() < 0.7:
		palette.append("drums")
	_use_palette(song, palette)
	for f in song.form:
		var brk: bool = f.section == "break"
		var on := palette.filter(func(x): return r() < 0.9 if (x == "texture" or x == "keys") else r() < (0.25 if brk else 0.55))
		f.layers = _lineup(on if not on.is_empty() else ["texture"])
	for k in AMBIENT_ENERGY:
		var spec: Dictionary = song.sections.get(k, {}).duplicate()
		spec.energy = AMBIENT_ENERGY[k]
		song.sections[k] = spec


func _arrange_groove(song: Dictionary) -> void:
	var core := ["drums", "bass", pick(["keys", "texture"])]
	var shuffled := shuffle(["keys", "lead", "pluck", "texture"].filter(func(x): return not x in core))
	var tops := shuffled.slice(0, 1 + int(floorf(r() * 2)))
	_use_palette(song, core + tops)
	for f in song.form:
		var on: Array
		match f.section:
			"intro":
				on = core.filter(func(x): return x != "bass" or r() < 0.5)
			"break":
				on = [core[2]] + tops.filter(func(_x): return r() < 0.5)
			"outro":
				on = core.filter(func(_x): return r() < 0.8)
			_:
				var odds := 0.9 if f.section == "chorus" else 0.45
				on = core + tops.filter(func(_x): return r() < odds)
		f.layers = _lineup(on if not on.is_empty() else core)


func _arrange(song: Dictionary) -> void:
	match song.family:
		"journey":
			_arrange_journey(song)
			return
		"ambient":
			_arrange_ambient(song)
			return
		"groove":
			_arrange_groove(song)
			return
	var count: int = pick([2, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6])
	var palette := [pick(["keys", "lead", "pluck", "texture"])]
	for role in shuffle(ROLES.filter(func(x): return x != palette[0])):
		if palette.size() < count:
			palette.append(role)
	for role in ROLES:
		if not role in palette:
			song.tracks[role].level = 0
		elif float(song.tracks[role].level) < 0.3:
			song.tracks[role].level = rnd(rng_range(0.35, 0.7))
	var some := func(k: int) -> Array:
		return shuffle(palette.duplicate()).slice(0, k)
	var lineup := func(on: Array) -> Dictionary:
		var out := {}
		for x in ROLES:
			out[x] = rnd(rng_range(0.7, 1.0)) if x in on else 0
		return out
	var seen := {}
	var last := -1
	for k in song.form.size():
		if song.form[k].section == "chorus":
			last = k
	for i in song.form.size():
		var f: Dictionary = song.form[i]
		var on: Array
		var before = seen.get(f.section)
		if f.section == "intro" or f.section == "outro":
			var k := 1 + int(floorf(r() * palette.size()))
			on = some.call(k)
		elif before != null and r() < 0.6:
			on = (before as Array).duplicate()
			var off := palette.filter(func(x): return not x in on)
			if not off.is_empty() and (r() < 0.6 or on.size() < 2):
				on.append(pick(off))
			elif on.size() > 1:
				on.remove_at(int(floorf(r() * on.size())))
		else:
			var odds: float = PLAY_ODDS[f.section]
			on = palette.filter(func(_x): return r() < odds)
			if on.is_empty():
				on = some.call(1)
		if i == last and r() < 0.7:
			on = palette.duplicate()
		seen[f.section] = on
		f.layers = lineup.call(on)
		if on.size() > 1 and int(f.bars) >= 8 and r() < 0.35:
			var who: String = pick(on)
			f.enter = {who: pick([0.25, 0.5, 0.75])}


func _structure(song: Dictionary, e: float) -> void:
	var mode: String = song.key.mode
	var fam: String = song.family
	var progs: Array
	if fam == "journey":
		progs = SWAYS
	else:
		progs = (PROGRESSIONS.get(mode, PROGRESSIONS.major) as Array).duplicate()
		if fam != "song" or r() < 0.5:
			progs += BORROWED.get(mode, [])
	var options := progs.filter(func(p): return p != song.progression)
	var chorus: Array
	if not options.is_empty():
		chorus = (pick(options) as Array).duplicate()
	else:
		chorus = song.progression.slice(2) + song.progression.slice(0, 2)
	var sections: Array = pick(FAMILY_FORMS.get(fam, FORMS))
	var target := rng_range(200, 290) if fam == "journey" or fam == "ambient" else rng_range(150, 270)
	song.form = _fit_form(sections, song.bpm, target)
	song.sections = {"chorus": {"progression": chorus}}
	song.sections.pre = {"progression": (pick(PRE_PROGRESSIONS) as Array).duplicate()}
	song.sections.bridge = {"progression": (pick(BRIDGE_PROGRESSIONS) as Array).duplicate()}
	_arrange(song)
	if r() < 0.3:
		song.sections.outro = {"fade": false}
	var up := func(x: float) -> float: return minf(1.0, e + x)
	song.tracks.drums.patternB = _drums(up.call(0.2), fam).pattern
	song.tracks.bass.patternB = _bass(up.call(0.15), fam).pattern
	song.tracks.keys.patternB = _keys(up.call(0.3), fam).pattern
	var hook: Array = _lead(up.call(0.2), fam).pattern
	var notes := hook.filter(func(b): return b.any(func(s): return s != null))
	var pb := []
	for i in hook.size():
		var b: Array = hook[i]
		pb.append(b if b.any(func(s): return s != null) else (notes[i % notes.size()] if not notes.is_empty() else b))
	song.tracks.lead.patternB = pb
	song.tracks.pluck.patternB = _pluck(up.call(0.2), fam).pattern
	var pad := []
	pad.resize(16)
	pad[0] = {"d": 0, "o": 0, "v": 0.6, "g": 8}
	pad[8] = {"d": pick([2, 4]), "o": 0, "v": 0.55, "g": 8}
	song.tracks.texture.patternB = [pad, pad, pad, pad]
	song.bars = 4


static func _zeros() -> Array:
	var a := []
	a.resize(16)
	a.fill(0)
	return a


static func _rests() -> Array:
	var a := []
	a.resize(16)
	return a


func _family_drums(e: float, fam: String) -> Dictionary:
	var kick := _zeros()
	var snare := _zeros()
	var hat := _zeros()
	var open := _zeros()
	var clap := _zeros()
	var level := rnd(rng_range(0.6, 0.9))
	if fam == "journey":
		for i in 16:
			if i % 4 == 0:
				kick[i] = 0.95
			if i % 4 == 2:
				open[i] = rnd(0.45 + 0.2 * r())
			else:
				hat[i] = rnd(0.22 + 0.2 * r())
			if (i == 4 or i == 12) and r() < 0.6:
				clap[i] = 0.65
	elif fam == "groove":
		for i in 16:
			if i == 0 or (i in [3, 6, 8, 10, 11, 14] and r() < 0.6):
				kick[i] = rnd(0.8 + 0.15 * r())
			if i == 4 or i == 12:
				snare[i] = 0.85
			elif r() < 0.12:
				snare[i] = 0.3
			if i % 2 == 0:
				hat[i] = rnd(0.45 + 0.25 * r())
	else:
		if r() < 0.6:
			level = 0.0
		else:
			level = rnd(rng_range(0.25, 0.45))
			kick[0] = 0.6
			if r() < 0.5:
				kick[8] = 0.45
			hat[4] = rnd(0.12 + 0.08 * r())
			if r() < 0.5:
				hat[12] = rnd(0.1 + 0.08 * r())
	var params := {}
	params["kick.tune"] = rnd(rng_range(42, 60))
	params["kick.decay"] = rnd(rng_range(0.25, 0.7))
	params["snare.tone"] = rnd(rng_range(160, 260))
	params["snare.decay"] = rnd(rng_range(0.1, 0.3))
	params["hat.decay"] = rnd(rng_range(0.15, 0.4) if fam == "ambient" else rng_range(0.03, 0.12), 3)
	params["hat.tone"] = rnd(rng_range(6000, 11000), 0)
	params["master.drive"] = rnd(rng_range(0, 0.1 if fam == "ambient" else 0.6))
	return {"instrument": "Pulsar", "level": level, "params": params, "pattern": {"kick": kick, "snare": snare, "hat": hat, "open": open, "clap": clap}}


func _drums(e: float, fam := "song") -> Dictionary:
	if fam in ["journey", "groove", "ambient"]:
		return _family_drums(e, fam)
	var kick := _zeros()
	var snare := _zeros()
	var hat := _zeros()
	var open := _zeros()
	var clap := _zeros()
	var style: String
	if e < 0.35:
		style = "sparse"
	elif e < 0.6:
		style = "halftime" if r() < 0.5 else "backbeat"
	else:
		style = "four" if r() < 0.5 else "broken"
	for i in 16:
		if style == "four" and i % 4 == 0:
			kick[i] = 0.95
		if style == "backbeat" and (i == 0 or i == 8 or (i == 10 and r() < 0.6)):
			kick[i] = 0.9
		if style == "broken" and i in [0, 3, 6, 10, 11] and r() < 0.85:
			kick[i] = 0.85 + 0.1 * r()
		if style == "halftime" and (i == 0 or (i == 11 and r() < 0.5)):
			kick[i] = 0.9
		if style == "sparse" and i == 0:
			kick[i] = 0.7
		if style in ["four", "backbeat", "broken"] and (i == 4 or i == 12):
			snare[i] = 0.85
		if style == "halftime" and i == 8:
			snare[i] = 0.9
		if e > 0.5 and r() < 0.08 and not snare[i]:
			snare[i] = 0.35
		var hat_every := 1 if e > 0.7 else (2 if e > 0.4 else 4)
		if i % hat_every == 0:
			var x: float = 1.0 if i % 4 == 0 else r()
			hat[i] = rnd(0.45 + 0.35 * x * (0.6 if style == "sparse" else 1.0))
		if e > 0.6 and i % 4 == 2 and r() < 0.5:
			open[i] = 0.6
			hat[i] = 0
		if style == "four" and (i == 4 or i == 12) and r() < 0.5:
			clap[i] = 0.7
	var level := rnd(rng_range(0, 0.4) if e < 0.3 else rng_range(0.6, 0.9))
	var params := {}
	params["kick.tune"] = rnd(rng_range(42, 60))
	params["kick.decay"] = rnd(rng_range(0.25, 0.7))
	params["snare.tone"] = rnd(rng_range(160, 260))
	params["snare.decay"] = rnd(rng_range(0.1, 0.3))
	params["hat.decay"] = rnd(rng_range(0.03, 0.12), 3)
	params["hat.tone"] = rnd(rng_range(6000, 11000), 0)
	params["master.drive"] = rnd(rng_range(0, 0.6))
	return {"instrument": "Pulsar", "level": level, "params": params, "pattern": {"kick": kick, "snare": snare, "hat": hat, "open": open, "clap": clap}}


func _family_bass(e: float, fam: String) -> Dictionary:
	var bar := _rests()
	if fam == "journey":
		for i in 16:
			if i % 4 != 0:
				bar[i] = {"d": 0, "o": 0, "v": rnd(0.85 if i % 4 == 1 else 0.7), "g": 1}
		if r() < 0.4:
			bar[15] = {"d": pick([4, 6]), "o": 0, "v": 0.75, "g": 1}
	elif fam == "groove":
		bar[0] = {"d": 0, "o": 0, "v": 0.9, "g": pick([6, 8])}
		var d8 = pick([0, 0, 4])
		bar[8] = {"d": d8, "o": 0, "v": 0.8, "g": pick([4, 6])}
		if r() < 0.4:
			bar[14] = {"d": pick([0, 6]), "o": 0, "v": 0.7, "g": 2}
	else:
		bar[0] = {"d": 0, "o": 0, "v": 0.7, "g": 16}
	var level := rnd(rng_range(0.3, 0.5) if fam == "ambient" else rng_range(0.6, 0.9))
	var j := fam == "journey"
	var params := {}
	params["osc.wave"] = pick(["sawtooth", "square"]) if j else "square"
	params["osc.detune"] = rnd(rng_range(1, 6))
	params["sub.level"] = rnd(rng_range(0.5, 0.9))
	params["filter.cutoff"] = rnd(rng_range(300, 800) if j else rng_range(140, 380), 0)
	params["filter.emphasis"] = rnd(rng_range(0.5, 6.0 if j else 2.0))
	params["fenv.amount"] = rnd(rng_range(300, 1600) if j else rng_range(0, 300), 0)
	params["fenv.decay"] = rnd(rng_range(0.08, 0.3))
	params["aenv.release"] = rnd(rng_range(0.04, 0.12) if j else rng_range(0.2, 0.6))
	params["glide"] = 0
	return {"instrument": "Undertow", "level": level, "params": params, "pattern": [bar, bar, bar, bar]}


func _bass(e: float, fam := "song") -> Dictionary:
	if fam in ["journey", "groove", "ambient"]:
		return _family_bass(e, fam)
	var bar := _rests()
	var density := 0.15 + e * 0.5
	for i in 16:
		var strong := i % 4 == 0
		if i == 0 or (strong and r() < 0.7) or r() < density * 0.5:
			var d: int = 0 if i == 0 else pick([0, 0, 0, 4, 2, 7, 6, 3])
			var o: int = 0 if d == 7 else (1 if r() < 0.15 else 0)
			var v := rnd(0.9 if strong else 0.65 + 0.2 * r())
			var g = pick([3, 4, 6]) if e < 0.4 else pick([1, 1, 2])
			bar[i] = {"d": d, "o": o, "v": v, "g": g}
	var level := rnd(rng_range(0.6, 0.9))
	var params := {}
	params["osc.wave"] = pick(["sawtooth", "square", "sawtooth"])
	params["osc.detune"] = rnd(rng_range(2, 12))
	params["sub.level"] = rnd(rng_range(0.2, 0.7))
	params["filter.cutoff"] = rnd(rng_range(200, 900 + e * 1200), 0)
	params["filter.emphasis"] = rnd(rng_range(1, 9))
	params["fenv.amount"] = rnd(rng_range(200, 2400), 0)
	params["fenv.decay"] = rnd(rng_range(0.08, 0.5))
	params["aenv.release"] = rnd(rng_range(0.05, 0.3))
	params["glide"] = rnd(rng_range(0.02, 0.1) if r() < 0.4 else 0.0, 3)
	return {"instrument": "Undertow", "level": level, "params": params, "pattern": [bar, bar, bar, bar]}


func _keys(e: float, fam := "song") -> Dictionary:
	var calm := e < 0.45 or fam == "ambient"
	var choices: Array
	if calm:
		choices = [[0], [0, 8]]
	elif fam == "groove":
		choices = [[2, 6, 10, 14], [0, 3, 8, 11], [3, 6, 11, 14]]
	else:
		choices = [[0, 6, 12], [2, 6, 10, 14], [0, 3, 8, 11], [4, 12]]
	var rhythm: Array = pick(choices)
	var gate = 16.0 / rhythm.size() if calm else pick([1, 2, 3])
	var bar := _rests()
	for s in rhythm:
		bar[s] = {"v": rnd(0.55 + 0.25 * r()), "g": gate}
	var level := rnd(rng_range(0.4, 0.8))
	var params := {}
	params["osc.wave"] = pick(["sawtooth", "triangle", "square"])
	params["osc.detune"] = rnd(rng_range(4, 18))
	params["filter.cutoff"] = rnd(rng_range(700, 4000), 0)
	params["filter.resonance"] = rnd(rng_range(0.5, 4))
	if fam == "ambient":
		params["aenv.attack"] = rnd(rng_range(0.8, 2), 3)
	else:
		params["aenv.attack"] = rnd(rng_range(0.3, 1.2) if calm else rng_range(0.005, 0.05), 3)
	params["aenv.release"] = rnd(rng_range(2, 4) if fam == "ambient" else rng_range(0.3, 2.5))
	params["chorus.mix"] = rnd(rng_range(0.1, 0.6))
	params["reverb.send"] = rnd(rng_range(0.2, 0.7))
	params["voicing"] = pick([3, 4])
	params["octave"] = pick([3, 4])
	return {"instrument": "Lumen", "level": level, "params": params, "pattern": [bar, bar, bar, bar]}


func _lead(e: float, fam := "song") -> Dictionary:
	var motif := _rests()
	var d: int = pick([0, 2, 4, 7])
	var notes := 2 + int(floorf(2 * r())) if fam == "ambient" else 3 + int(floorf(e * 6 * r()))
	var slots := shuffle([0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14]).slice(0, notes)
	slots.sort()
	for s in slots:
		d += int(pick([-2, -1, -1, 1, 1, 2, 3, -3, 0]))
		d = clampi(d, -2, 9)
		var v := rnd(0.6 + 0.3 * r())
		motif[s] = {"d": d, "o": 1, "v": v, "g": pick([4, 6, 8]) if fam == "ambient" else pick([1, 2, 2, 3])}
	var answer := []
	for i in 16:
		var st = motif[i]
		if st != null and i < 12:
			var a: Dictionary = st.duplicate()
			a.d = int(st.d) + int(pick([0, 0, 1, -1, 2]))
			answer.append(a)
		else:
			answer.append(null)
	var rest := _rests()
	var level := rnd(rng_range(0.35, 0.7))
	var params := {}
	params["osc.wave"] = pick(["sawtooth", "square", "triangle"])
	params["osc2.semis"] = pick([0, 7, 12, -12])
	params["filter.cutoff"] = rnd(rng_range(1200, 6000), 0)
	params["filter.resonance"] = rnd(rng_range(0.5, 6))
	params["vibrato.depth"] = rnd(rng_range(0, 25))
	params["vibrato.rate"] = rnd(rng_range(4, 7))
	params["portamento"] = rnd(rng_range(0, 0.08), 3)
	params["delay.send"] = rnd(rng_range(0.1, 0.5))
	params["aenv.release"] = rnd(rng_range(0.08, 0.5))
	var pattern := [motif, rest, answer, rest] if r() < 0.5 else [rest, motif, rest, answer]
	return {"instrument": "Comet", "level": level, "params": params, "pattern": pattern}


func _pluck(e: float, fam := "song") -> Dictionary:
	var shape: String = pick(["up", "updown"]) if fam == "journey" else pick(["up", "down", "updown", "random"])
	var every := 1 if fam == "journey" else (4 if fam == "ambient" else (1 if e > 0.6 else 2))
	var skip := 0.05 if fam == "journey" else 0.2
	var bar := _rests()
	var tones := [0, 2, 4, 7]
	var k := 0
	var i := 0
	while i < 16:
		if r() < skip:
			i += every
			continue
		var d: int
		if shape == "up":
			d = tones[k % 4]
		elif shape == "down":
			d = tones[3 - (k % 4)]
		elif shape == "updown":
			d = tones[[0, 1, 2, 3, 2, 1][k % 6]]
		else:
			d = pick(tones)
		var o := 1 + (1 if r() < 0.15 else 0)
		bar[i] = {"d": d, "o": o, "v": rnd(0.5 + 0.35 * r()), "g": 1}
		k += 1
		i += every
	var level := rnd(0.0 if r() < 0.3 else rng_range(0.35, 0.7))
	var params := {}
	params["model"] = pick(["string", "string", "marimba", "kalimba"])
	params["brightness"] = rnd(rng_range(0.3, 0.95))
	params["decay"] = rnd(rng_range(0.3, 2.5))
	params["reverb.send"] = rnd(rng_range(0.1, 0.5))
	return {"instrument": "Driftwood", "level": level, "params": params, "pattern": [bar, bar, bar, bar]}


func _texture(e: float, fam := "song") -> Dictionary:
	var bar := _rests()
	bar[0] = {"d": pick([0, 4, 7]), "o": 0, "v": 0.6, "g": 16}
	var level := rnd(rng_range(0.15, 0.5) * (1.6 if fam == "ambient" else 1.1 - e * 0.6))
	var params := {}
	params["ratio"] = pick([0.5, 1, 1.5, 2, 3, 3.5])
	params["fm.index"] = rnd(rng_range(0.5, 6))
	params["lfo.rate"] = rnd(rng_range(0.05, 0.6))
	params["lfo.depth"] = rnd(rng_range(0.2, 0.9))
	params["filter.cutoff"] = rnd(rng_range(500, 3000), 0)
	params["reverb.send"] = rnd(rng_range(0.4, 0.9))
	return {"instrument": "Tangle", "level": level, "params": params, "pattern": [bar, bar, bar, bar]}
