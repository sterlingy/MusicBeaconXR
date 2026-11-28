class_name KitSounds
extends RefCounted
## SynthKit-native song sounds (web/src/kitsounds.js, line for line): the
## factory presets a song's parts choose from, and how a song's small "tune"
## offsets move the loaded preset. Songs store
## track.kit = {preset, tune: {bright, space, grit, width}} (and song.pad.kit);
## BeaconPlayer loads that SynthKit preset and applies kit_params() on top.
## Songs without a kit (planted or shared before kits) play the part's base
## preset through ParamMap as before. tests/kit_sound_check.gd keeps this
## identical to the website (tests/fixtures/kit_sounds.json).

const KIT_INSTRUMENT := {"drums": "Pulsar", "bass": "Undertow", "keys": "Prism", "lead": "Prism", "pluck": "Driftwood", "texture": "Tangle", "pad": "Prism"}
## [preset name, energy it suits]: a song picks one whose energy is within 0.3 of its own.
const KIT_SOUNDS := {
	"drums": [["Classic Eight", 0.5], ["Tight Funk", 0.6], ["Boom Bap", 0.5], ["Deep House", 0.65], ["Trap Thunder", 0.8], ["Lo-Fi Dust", 0.3], ["Hand Toms", 0.35]],
	"bass": [["Deep Current", 0.5], ["Riptide Pluck", 0.6], ["Sub Floor", 0.35], ["Acid Tide", 0.8], ["Hollow Reed", 0.4], ["Wobble Deep", 0.7]],
	"keys": [["Prism Keys", 0.5], ["Glass EP", 0.4], ["Drawbar Drift", 0.7]],
	"lead": [["Comet Tail", 0.6], ["Talking Lead", 0.5]],
	"pluck": [["Nylon Pluck", 0.5], ["Steel Harp", 0.6], ["Muted Pluck", 0.55], ["Marimba", 0.45], ["Vibes", 0.35], ["Kalimba", 0.4], ["Temple Bell", 0.2], ["Glass Drops", 0.3]],
	"texture": [["Drone Garden", 0.25], ["Basic Voice", 0.5], ["FM Bell", 0.4]],
	"pad": [["Aurora Pad", 0.4], ["Glass Choir", 0.3], ["Dust Halo", 0.3]],
}
const KIT_PARTS := ["drums", "bass", "keys", "lead", "pluck", "texture", "pad"]
const TUNES := ["bright", "space", "grit", "width"]
const TUNE_MAX := 0.4
## Level trims (dB) to each part's base preset's loudness (web/tools/kit_levels.mjs writes both copies).
const KIT_TRIM := {
	"Tight Funk": 4.8,
	"Boom Bap": -4.3,
	"Deep House": -2.2,
	"Trap Thunder": -7.3,
	"Lo-Fi Dust": -2.7,
	"Hand Toms": 4.0,
	"Riptide Pluck": 8.5,
	"Sub Floor": 0.6,
	"Acid Tide": 4.3,
	"Hollow Reed": -2.4,
	"Wobble Deep": 1.9,
	"Glass EP": 1.5,
	"Drawbar Drift": 1.2,
	"Talking Lead": -3.1,
	"Steel Harp": -6.8,
	"Muted Pluck": 8.1,
	"Marimba": -17.9,
	"Vibes": -19.1,
	"Kalimba": -18.7,
	"Temple Bell": -21.2,
	"Glass Drops": -27.9,
	"Basic Voice": -3.6,
	"FM Bell": -5.2,
	"Glass Choir": -7.6,
	"Dust Halo": -6.7,
}
## The parameters kit_params reads from the loaded preset.
const KIT_READS := {
	"Prism": ["f1.cutoff", "f1.resonance", "send.space", "send.echo", "fx1.amount"],
	"Undertow": ["filter.cutoff", "filter.emphasis"],
	"Pulsar": ["chat.tone", "ohat.tone", "master.drive"],
	"Driftwood": ["model.brightness", "reverb.mix"],
	"Tangle": [],
}


static func trim(preset: String) -> float:
	return float(KIT_TRIM.get(preset, 0.0))


static func _r4(v: float) -> float:
	return floorf(v * 10000.0 + 0.5) / 10000.0


## Octaves to move a cutoff: up to half an octave brighter, a whole octave darker.
static func _oct(t: float) -> float:
	return t * 0.5 if t > 0.0 else t


## The SynthKit settings a tune puts on a preset. `base` holds the loaded
## preset's values (synth.get_param after loading); `bright` multiplies the
## cutoffs (a section's brightness: 1 in the app).
static func kit_params(instrument: String, base: Dictionary, tune: Dictionary, bright := 1.0) -> Dictionary:
	var t := func(k: String) -> float: return clampf(float(tune.get(k, 0.0)) if tune.get(k) != null else 0.0, -1.0, 1.0)
	var b := func(id: String) -> float: return float(base.get(id, 0.0))
	var out := {}
	var add := func(id: String, v: float, lo: float, hi: float) -> void: out[id] = _r4(clampf(v, lo, hi))
	match instrument:
		"Prism":
			# Brighter stops at 3 kHz (or the preset's own cutoff, if higher): Prism's filter envelope opens it further.
			add.call("f1.cutoff", b.call("f1.cutoff") * pow(2.0, _oct(t.call("bright"))) * bright, 60.0, maxf(3000.0, b.call("f1.cutoff")))
			add.call("f1.resonance", b.call("f1.resonance") + t.call("grit") * 1.5, 0.0, maxf(3.0, b.call("f1.resonance")))
			add.call("send.space", b.call("send.space") + t.call("space") * 2.0, 0.0, 9.0)
			if b.call("send.echo") > 0.0:
				add.call("send.echo", b.call("send.echo") + t.call("space") * 1.5, 0.0, 8.0)
			add.call("fx1.amount", b.call("fx1.amount") + t.call("width") * 2.0, 0.0, 10.0)
		"Undertow":
			add.call("filter.cutoff", b.call("filter.cutoff") * pow(2.0, _oct(t.call("bright"))) * bright, 40.0, 6000.0)
			add.call("filter.emphasis", b.call("filter.emphasis") + t.call("grit") * 2.0, 0.0, maxf(8.0, b.call("filter.emphasis")))
		"Pulsar":
			add.call("chat.tone", b.call("chat.tone") + t.call("bright") * 1.5, 0.0, 9.0)
			add.call("ohat.tone", b.call("ohat.tone") + t.call("bright") * 1.5, 0.0, 9.0)
			add.call("master.drive", b.call("master.drive") + t.call("grit") * 2.0, 0.0, maxf(6.0, b.call("master.drive")))
		"Driftwood":
			add.call("model.brightness", (b.call("model.brightness") + t.call("bright") * 1.5) * sqrt(bright), 0.0, 9.0)
			add.call("reverb.mix", b.call("reverb.mix") + t.call("space") * 2.0, 0.0, 9.0)
	return out


## Chooses a SynthKit sound for each part (as kitsounds.js chooseKits), from
## the generator `g` seeded with seed + "|kit", so the notes don't change.
static func choose_kits(g: SongGen, song: Dictionary) -> void:
	var e := float(song.get("energy", 0.5))
	for role in KIT_PARTS:
		var fits := []
		for s in KIT_SOUNDS[role]:
			if absf(float(s[1]) - e) <= 0.3:
				fits.append(s)
		var preset: String = g.pick(fits if not fits.is_empty() else KIT_SOUNDS[role])[0]
		var tune := {}
		for k in TUNES:
			tune[k] = SongGen.rnd(g.rng_range(-TUNE_MAX, TUNE_MAX), 2)
		var kit := {"preset": preset, "tune": tune}
		if role == "drums" and song.get("family", "") == "ambient":
			tune.bright = minf(tune.bright, -0.3)
		if role == "pad":
			var pad: Dictionary = song.get("pad", {}) if typeof(song.get("pad")) == TYPE_DICTIONARY else {}
			pad["kit"] = kit
			song["pad"] = pad
		elif song.tracks.has(role):
			song.tracks[role]["kit"] = kit


## True when `preset` is one of the part's SynthKit sounds.
static func has_sound(role: String, preset: String) -> bool:
	for s in KIT_SOUNDS.get(role, []):
		if s[0] == preset:
			return true
	return false
