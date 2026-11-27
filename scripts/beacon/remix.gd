class_name Remix
extends RefCounted
## Remix: a layer over whatever is playing, so a listener can make it their own
## (port of web/src/remix.js; tests/remix_check.gd checks the two agree).
## Off, nothing changes. On, every song you hear goes through your settings
## before the blend: key, tempo, mode, how busy the parts are, their sound
## (brightness, space, grit, width), each part's level and instrument. The
## result is still an ordinary song, so "Place my version" plants exactly what
## you hear as a normal beacon.
##
##   var s := Remix.defaults()
##   s.on = true; s.brightness = 0.5
##   var mine := Remix.remix_song(song, s)

const PARTS := ["drums", "bass", "keys", "lead", "pluck", "texture", "pad"]
## The dials: [id, label, min, max, step]. All rest at 0 ("as written").
const DIALS := [
	["energy", "Energy", -1.0, 1.0, 0.05],
	["brightness", "Brightness", -1.0, 1.0, 0.05],
	["space", "Space", -1.0, 1.0, 0.05],
	["mood", "Mood", -1.0, 1.0, 0.5],
	["tempo", "Tempo", -1.0, 1.0, 0.05],
	["key", "Key", -6.0, 6.0, 1.0],
	["character", "Character", -1.0, 1.0, 0.05],
	["width", "Width", -1.0, 1.0, 0.05],
]
## Mood steps through modes from bright to dark, keeping the key's root.
const MOOD_LADDER := ["lydian", "major", "mixolydian", "dorian", "minor", "phrygian"]
## Swap sound: each part's other instruments after its own (index 0).
const SWAPS := {
	"drums": ["own", "synth", "sample:orch_kit"],
	"bass": ["own", "wave:sawtooth", "wave:square", "wave:triangle", "sample:contrabass_pizz", "sample:tuba", "sample:bassoon"],
	"keys": ["own", "wave:sine", "wave:triangle", "wave:sawtooth", "sample:piano"],
	"lead": ["own", "wave:sine", "wave:triangle", "wave:sawtooth", "wave:square", "sample:flute", "sample:horn", "sample:clarinet", "sample:trumpet", "sample:oboe"],
	"pluck": ["own", "model:nylon", "model:marimba", "model:vibes", "model:kalimba", "model:bell", "model:glass", "sample:harp", "sample:strings_pizz", "sample:glock"],
	"texture": ["own"],
	"pad": ["own", "synth", "sample:strings", "sample:horn", "sample:trombone"],
}
const LEVEL_MAX := 1.5
## Safe ranges for the sound settings the dials move (as web/src/params.js allows).
const RANGES := {
	"drums": {"hat.tone": [3000.0, 14000.0], "master.drive": [0.0, 1.0], "reverb.send": [0.0, 0.3], "delay.send": [0.0, 0.3]},
	"bass": {"filter.cutoff": [40.0, 8000.0], "filter.emphasis": [0.0, 12.0], "drive": [0.0, 1.0], "osc.detune": [0.0, 30.0], "reverb.send": [0.0, 0.35], "delay.send": [0.0, 0.3]},
	"keys": {"filter.cutoff": [80.0, 12000.0], "filter.resonance": [0.0, 10.0], "chorus.mix": [0.0, 1.0], "osc.detune": [0.0, 30.0], "reverb.send": [0.0, 0.7], "delay.send": [0.0, 0.5]},
	"lead": {"filter.cutoff": [200.0, 12000.0], "filter.resonance": [0.0, 10.0], "drive": [0.0, 1.0], "reverb.send": [0.0, 0.7], "delay.send": [0.0, 0.5]},
	"pluck": {"brightness": [0.0, 1.0], "reverb.send": [0.0, 0.7], "delay.send": [0.0, 0.5]},
	"texture": {"filter.cutoff": [80.0, 12000.0], "filter.resonance": [0.0, 10.0], "reverb.send": [0.0, 0.8], "delay.send": [0.0, 0.5]},
}
const ROLE_SALT := {"drums": 20, "bass": 21, "keys": 22, "lead": 23, "pluck": 24, "texture": 25}


static func _r3(v: float) -> float:
	return floorf(v * 1000.0 + 0.5) / 1000.0 # as JavaScript's Math.round (halves up)


## Fresh settings: off, every dial at rest, every part as written.
static func defaults() -> Dictionary:
	var parts := {}
	for p in PARTS:
		parts[p] = {"level": 1.0, "swap": 0}
	return {"on": false, "energy": 0.0, "brightness": 0.0, "space": 0.0, "mood": 0.0, "tempo": 0.0, "key": 0.0,
		"character": 0.0, "width": 0.0, "hold": false, "parts": parts}


static func _num(v: Variant, fallback: float) -> float:
	if typeof(v) in [TYPE_FLOAT, TYPE_INT]:
		return float(v)
	if typeof(v) == TYPE_STRING and String(v).is_valid_float():
		return float(v)
	return fallback


## Settings read back from storage or a file, made safe.
static func normalize(s: Variant) -> Dictionary:
	var d := defaults()
	if typeof(s) != TYPE_DICTIONARY:
		return d
	d.on = bool(s.get("on", false))
	d.hold = bool(s.get("hold", false))
	for dial in DIALS:
		d[dial[0]] = clampf(_num(s.get(dial[0]), 0.0), dial[2], dial[3])
	d.key = float(roundi(d.key))
	var sp: Dictionary = s.get("parts", {}) if typeof(s.get("parts")) == TYPE_DICTIONARY else {}
	for p in PARTS:
		var q: Dictionary = sp.get(p, {}) if typeof(sp.get(p)) == TYPE_DICTIONARY else {}
		d.parts[p].level = clampf(_num(q.get("level"), 1.0), 0.0, LEVEL_MAX)
		d.parts[p].swap = clampi(roundi(_num(q.get("swap"), 0.0)), 0, SWAPS[p].size() - 1)
	return d


## True when the settings would change nothing.
static func is_neutral(s: Dictionary) -> bool:
	for dial in DIALS:
		if absf(float(s.get(dial[0], 0.0))) > 1e-9:
			return false
	for p in PARTS:
		var q: Dictionary = s.parts.get(p, {})
		if absf(float(q.get("level", 1.0)) - 1.0) > 1e-9 or int(q.get("swap", 0)) != 0:
			return false
	return true


## A short key for caching transformed songs.
static func signature(s: Dictionary) -> String:
	var a := []
	for dial in DIALS:
		a.append(float(s.get(dial[0], 0.0)))
	for p in PARTS:
		a.append(float(s.parts[p].level))
		a.append(int(s.parts[p].swap))
	return JSON.stringify(a)


## The mode `mood` steps from `mode`: brighter for mood > 0, darker for mood < 0.
static func mood_mode(mode: String, mood: float) -> String:
	var steps := roundi(mood * 2.0)
	if steps == 0:
		return mode
	var i := MOOD_LADDER.find("minor" if mode == "harmonicMinor" else mode)
	if i < 0:
		return mode
	return MOOD_LADDER[clampi(i - steps, 0, MOOD_LADDER.size() - 1)]


## One song with the settings applied (a new dictionary; the original is untouched).
static func remix_song(song: Dictionary, s: Dictionary) -> Dictionary:
	var out: Dictionary = song.duplicate(true)
	if not out.has("tracks") or typeof(out.tracks) != TYPE_DICTIONARY:
		return out
	var e := float(s.get("energy", 0.0))
	var b := float(s.get("brightness", 0.0))
	var sp := float(s.get("space", 0.0))
	var c := float(s.get("character", 0.0))
	var wd := float(s.get("width", 0.0))
	var parts: Dictionary = s.get("parts", {})
	if float(s.get("tempo", 0.0)) != 0.0:
		out.bpm = clampf(floorf(float(out.bpm) * (1.0 + 0.15 * float(s.tempo)) * 10.0 + 0.5) / 10.0, 40.0, 220.0)
	if out.has("key") and typeof(out.key) == TYPE_DICTIONARY:
		if float(s.get("key", 0.0)) != 0.0:
			out.key.root = posmod(int(out.key.root) + roundi(float(s.key)), 12)
		if float(s.get("mood", 0.0)) != 0.0:
			out.key.mode = mood_mode(String(out.key.mode), float(s.mood))
	for role in out.tracks:
		var t = out.tracks[role]
		if typeof(t) != TYPE_DICTIONARY:
			continue
		if typeof(t.get("params")) != TYPE_DICTIONARY:
			t["params"] = {}
		var p: Dictionary = t.params
		var r: Dictionary = RANGES.get(role, {})
		var pr: Dictionary = parts.get(role, {})
		var lvl := float(t.get("level", 0.0)) * float(pr.get("level", 1.0))
		if role == "drums" or role == "pluck":
			lvl *= 1.0 + 0.25 * e
		t.level = _r3(clampf(lvl, 0.0, 1.0))
		if e != 0.0:
			if role == "drums":
				if t.has("pattern"):
					t.pattern = _drum_energy(t.pattern, e)
			else:
				if t.has("pattern"):
					t.pattern = _note_energy(t.pattern, e, role)
				if t.has("patternB"):
					t.patternB = _note_energy(t.patternB, e, role)
		if b != 0.0:
			if p.get("filter.cutoff") != null:
				_put(p, r, "filter.cutoff", float(p["filter.cutoff"]) * pow(2.0, 1.2 * b))
			if role == "pluck" and p.get("brightness") != null:
				_put(p, r, "brightness", float(p.brightness) + 0.3 * b)
			if role == "drums" and p.get("hat.tone") != null:
				_put(p, r, "hat.tone", float(p["hat.tone"]) * pow(2.0, 0.5 * b))
		if sp != 0.0:
			for k in ["reverb.send", "delay.send"]:
				if not r.has(k):
					continue
				var v := float(p.get(k, 0.0)) if p.get(k) != null else 0.0
				var cap: float = r[k][1]
				_put(p, r, k, v + (cap - v) * sp * 0.8 if sp >= 0.0 else v * (1.0 + sp))
		if c != 0.0:
			if role == "drums":
				_put(p, r, "master.drive", _or0(p, "master.drive") + 0.35 * c)
			if role == "bass":
				_put(p, r, "drive", _or0(p, "drive") + 0.3 * c)
				if p.get("filter.emphasis") != null:
					_put(p, r, "filter.emphasis", float(p["filter.emphasis"]) + 3.0 * c)
			if role == "lead":
				_put(p, r, "drive", _or0(p, "drive") + 0.3 * c)
			if role in ["keys", "lead", "texture"] and p.get("filter.resonance") != null:
				_put(p, r, "filter.resonance", float(p["filter.resonance"]) + 2.5 * c)
		if wd != 0.0:
			if role == "keys":
				_put(p, r, "chorus.mix", _or0(p, "chorus.mix") + 0.4 * wd)
			if role in ["keys", "bass"] and p.get("osc.detune") != null:
				_put(p, r, "osc.detune", float(p["osc.detune"]) * (1.0 + 0.8 * wd))
		var opts: Array = SWAPS.get(role, ["own"])
		_apply_swap(t, p, opts[clampi(int(pr.get("swap", 0)), 0, opts.size() - 1)])
	var pad: Dictionary = parts.get("pad", {})
	var pad_swap: String = SWAPS.pad[clampi(int(pad.get("swap", 0)), 0, SWAPS.pad.size() - 1)]
	if pad_swap == "synth":
		out.erase("pad")
	elif pad_swap.begins_with("sample:"):
		var pd: Dictionary = out.get("pad", {}) if typeof(out.get("pad")) == TYPE_DICTIONARY else {}
		pd["sample"] = pad_swap.substr(7)
		out["pad"] = pd
	if not pad.is_empty() and float(pad.get("level", 1.0)) != 1.0:
		out["padLevel"] = _r3(clampf(float(pad.level), 0.0, LEVEL_MAX))
	return out


static func _or0(p: Dictionary, k: String) -> float:
	return float(p[k]) if p.get(k) != null else 0.0


static func _put(p: Dictionary, r: Dictionary, k: String, v: float) -> void:
	if r.has(k):
		v = clampf(v, r[k][0], r[k][1])
	p[k] = _r3(v)


static func _apply_swap(t: Dictionary, p: Dictionary, sw: String) -> void:
	if sw == "" or sw == "own":
		return
	if sw == "synth":
		t.erase("sample")
	elif sw.begins_with("wave:"):
		p["osc.wave"] = sw.substr(5)
		t.erase("sample")
	elif sw.begins_with("model:"):
		p["model"] = sw.substr(6)
		t.erase("sample")
	elif sw.begins_with("sample:"):
		t["sample"] = sw.substr(7)


## Drums: sparser keeps the main hits; busier adds quiet off-beat hats and lifts velocities.
static func _drum_energy(pat: Variant, e: float) -> Variant:
	if typeof(pat) != TYPE_DICTIONARY:
		return pat
	var out := {}
	for voice in pat:
		var steps: Array = pat[voice]
		var row := []
		for i in steps.size():
			var v := float(steps[i]) if steps[i] != null else 0.0
			if e < 0.0:
				if v == 0.0:
					row.append(0.0)
					continue
				var keep: bool = (voice == "kick" and i % 4 == 0) or v >= 0.85 or BeaconMixer.hash01(i, String(voice).length(), 31) >= -e * 0.7
				row.append(v if keep else 0.0)
			elif v != 0.0:
				row.append(_r3(minf(1.0, v * (1.0 + 0.2 * e))))
			elif voice == "hat" and i % 2 == 1 and BeaconMixer.hash01(i, 7, 32) < e:
				row.append(_r3(0.18 + 0.12 * e))
			else:
				row.append(0.0)
		out[voice] = row
	return out


## Melodic parts: sparser drops notes off the beat (the bass keeps its downbeats); busier plays them harder.
static func _note_energy(bars: Variant, e: float, role: String) -> Variant:
	if typeof(bars) != TYPE_ARRAY:
		return bars
	var out := []
	for bi in bars.size():
		var bar = bars[bi]
		var row := []
		if typeof(bar) == TYPE_ARRAY:
			for i in bar.size():
				var ev = bar[i]
				if ev == null:
					row.append(null)
					continue
				if e < 0.0:
					var anchor: bool = i % 4 == 0 and (role == "bass" or i == 0)
					row.append(ev if anchor or BeaconMixer.hash01(bi, i, ROLE_SALT.get(role, 29)) >= -e * 0.6 else null)
				else:
					var ne: Dictionary = ev.duplicate()
					ne["v"] = _r3(minf(1.0, float(ev.get("v", 0.8)) * (1.0 + 0.15 * e)))
					row.append(ne)
		out.append(row)
	return out


## "Place my version": the song, remixed, named as a remix of the original.
static func bake(song: Dictionary, s: Dictionary) -> Dictionary:
	var out := remix_song(song, s)
	var title := String(song.get("title", "Song"))
	out["remixOf"] = String(song.get("title", ""))
	out["title"] = "%s (remix)" % title.substr(0, 52)
	return out


## Dice: random settings within tasteful ranges (parts' levels and sounds untouched).
static func dice(s: Dictionary) -> Dictionary:
	var n := normalize(s)
	var pick := func(lo: float, hi: float, step: float) -> float: return snappedf(randf_range(lo, hi), step)
	n.energy = pick.call(-0.6, 0.6, 0.05)
	n.brightness = pick.call(-0.6, 0.6, 0.05)
	n.space = pick.call(-0.5, 0.7, 0.05)
	n.mood = pick.call(-1.0, 1.0, 0.5)
	n.tempo = pick.call(-0.4, 0.4, 0.05)
	n.key = pick.call(-3.0, 3.0, 1.0)
	n.character = pick.call(-0.5, 0.5, 0.05)
	n.width = pick.call(-0.5, 0.6, 0.05)
	return n
