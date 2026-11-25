class_name ParamMap
extends RefCounted
## Translates song parameters (the browser instruments' ids and units) into
## SynthKit engine parameters. Anything without a counterpart is skipped; the
## part's base preset supplies the rest of the sound.

const UNDERTOW_WAVE := {"triangle": 0, "sawtooth": 2, "square": 4}
const OSC_WAVE := {"sawtooth": 0, "square": 1, "triangle": 3, "sine": 4}
## Prism's Analog engine waves (a.wave / b.wave): Saw 0, Square 1, Pulse 2, Triangle 3, Sine 4.
const PRISM_WAVE := {"sawtooth": 0, "square": 1, "triangle": 3, "sine": 4}
const PRISM_ANALOG := 1
const PRISM_WAVETABLE := 2
const DRIFT_MODEL := {"string": 0, "marimba": 1, "vibes": 2, "kalimba": 3, "bell": 4, "glass": 5}
## Prism parts: the songs' cutoffs and resonances were written for the browser's
## simpler synths. Prism's presets add a filter envelope and key tracking on top,
## so the raw values made them shrill. Instead, a song moves the preset's own
## cutoff (its "home") by half the song's distance from a typical song, within
## a range, and its resonance is scaled down. Typical = the song packs' median.
const PRISM_FILTER := {
	"keys": {"home": 2200.0, "typical": 2100.0, "down": 1.5, "up": 0.5, "res": 0.35, "res_max": 3.0},
	"lead": {"home": 1500.0, "typical": 2500.0, "down": 1.5, "up": 0.4, "res": 0.3, "res_max": 3.0},
}


static func to_synth(role: String, p: Dictionary) -> Dictionary:
	var o := {}
	match role:
		"drums":
			if p.has("kick.tune"): o["kick.tune"] = clampf(12.0 * log(float(p["kick.tune"]) / 50.0) / log(2.0), -12, 12)
			if p.has("kick.decay"): o["kick.decay"] = clampf(float(p["kick.decay"]) * 10.0, 0, 10)
			if p.has("snare.tone"): o["snare.tune"] = clampf(12.0 * log(float(p["snare.tone"]) / 200.0) / log(2.0), -12, 12)
			if p.has("snare.decay"): o["snare.decay"] = clampf(float(p["snare.decay"]) * 25.0, 0, 10)
			o["snare.tone"] = 3.0 # its noise centred near 3.6 kHz, like the browser's, not 5 kHz and up
			if p.has("hat.decay"):
				o["chat.decay"] = clampf(float(p["hat.decay"]) * 50.0, 0, 10)
				o["ohat.decay"] = clampf(float(p["hat.decay"]) * 60.0, 0, 10)
			if p.has("hat.tone"):
				# Pulsar's hats ring at 9-13 kHz and sit louder than the browser's,
				# which made them sizzle: keep them low in that range, and quieter.
				o["chat.tone"] = clampf((float(p["hat.tone"]) - 6000.0) / 2000.0, 0, 5)
				o["ohat.tone"] = o["chat.tone"]
				o["chat.level"] = 3.5
				o["ohat.level"] = 3.2
			if p.has("master.drive"): o["master.drive"] = clampf(float(p["master.drive"]) * 10.0, 0, 10)
		"bass":
			if p.has("osc.wave"):
				var w: int = UNDERTOW_WAVE.get(p["osc.wave"], 2)
				o["osc1.wave"] = w
				o["osc2.wave"] = w
			if p.has("osc.detune"): o["osc2.freq"] = clampf(float(p["osc.detune"]) / 100.0, -7, 7)
			if p.has("sub.level"):
				o["mix.osc3_on"] = 1.0
				o["osc3.range"] = 1 # 32', an octave under osc 1 and 2
				o["mix.osc3"] = clampf(float(p["sub.level"]) * 10.0, 0, 10)
			if p.has("filter.cutoff"): o["filter.cutoff"] = clampf(float(p["filter.cutoff"]), 20, 18000)
			# Emphasis 10 is close to self-oscillation on Undertow; the songs' values
			# (up to 12) were for the browser's gentler filter.
			if p.has("filter.emphasis"): o["filter.emphasis"] = clampf(float(p["filter.emphasis"]) * 0.5, 0, 5)
			if p.has("fenv.amount"):
				# The browser sweeps from the cutoff up to cutoff + amount (Hz).
				# Undertow's contour is in octaves (10 = 5 octaves): match the browser.
				var cut := clampf(float(p.get("filter.cutoff", 500.0)), 40, 16000)
				var octaves := log(minf(16000.0, cut + float(p["fenv.amount"])) / cut) / log(2.0)
				o["filter.contour"] = clampf(octaves * 2.0, 0, 10)
			if p.has("fenv.decay"): o["fenv.decay"] = clampf(float(p["fenv.decay"]), 0.004, 10)
			if p.has("glide"): o["ctrl.glide"] = clampf(float(p["glide"]), 0, 5)
		"lead":
			# Prism: the base preset makes the sound; the song sets its tone, motion and space.
			_prism_filter("lead", p, o)
			# The song's own oscillators: many leads are soft sines and triangles.
			if p.has("osc.wave"):
				o["a.type"] = PRISM_ANALOG
				o["a.wave"] = PRISM_WAVE.get(p["osc.wave"], 0)
			if p.has("osc2.wave"):
				o["b.type"] = PRISM_ANALOG
				o["b.wave"] = PRISM_WAVE.get(p["osc2.wave"], 1)
			if p.has("osc2.semis"):
				# At most an octave above: +19 and +24 whistle over a bright lead.
				var semis := int(round(float(p["osc2.semis"])))
				while semis > 12:
					semis -= 12
				o["b.coarse"] = clampi(semis, -24, 12)
			# The second oscillator (often an octave up) stays under the first.
			if p.has("osc2.level"): o["b.level"] = clampf(float(p["osc2.level"]) * 10.0, 0, 4)
			if p.has("vibrato.depth"): o["lfo1.vibrato"] = clampf(float(p["vibrato.depth"]), 0, 100)
			if p.has("vibrato.rate"): o["lfo1.rate"] = clampf(float(p["vibrato.rate"]), 0.1, 12)
			if p.has("portamento"): o["voice.glide"] = clampf(float(p["portamento"]), 0, 2)
			if p.has("delay.send"): o["send.echo"] = clampf(float(p["delay.send"]) * 10.0, 0, 10)
			if p.has("reverb.send"): o["send.space"] = clampf(float(p["reverb.send"]) * 10.0, 0, 10)
			if p.has("aenv.release"): o["env1.release"] = clampf(float(p["aenv.release"]), 0.005, 15)

		"keys":
			_prism_filter("keys", p, o)
			# Soft songs (sine, triangle) get the Analog engine with their wave;
			# the rest keep the preset's wavetable.
			if p.has("osc.wave"):
				var soft: bool = p["osc.wave"] in ["sine", "triangle"]
				o["a.type"] = PRISM_ANALOG if soft else PRISM_WAVETABLE
				o["a.wave"] = PRISM_WAVE.get(p["osc.wave"], 0)
			if p.has("osc2.wave"): o["b.wave"] = PRISM_WAVE.get(p["osc2.wave"], 1)
			if p.has("osc2.octave"): o["b.coarse"] = clampi(int(p["osc2.octave"]) * 12, -24, 24)
			if p.has("osc.detune"): o["b.fine"] = clampf(float(p["osc.detune"]), -50, 50)
			if p.has("aenv.attack"): o["env1.attack"] = clampf(float(p["aenv.attack"]), 0.001, 10)
			if p.has("aenv.release"): o["env1.release"] = clampf(float(p["aenv.release"]), 0.005, 15)
			if p.has("chorus.mix"): o["fx1.amount"] = clampf(float(p["chorus.mix"]) * 10.0, 0, 10)
			if p.has("reverb.send"): o["send.space"] = clampf(float(p["reverb.send"]) * 10.0, 0, 10)
			if p.has("delay.send"): o["send.echo"] = clampf(float(p["delay.send"]) * 10.0, 0, 10)

		"pluck":
			if p.has("model"): o["model.type"] = DRIFT_MODEL.get(p["model"], 0)
			# The brightest strings ("Banjo Bright") get only most of the way there.
			if p.has("brightness"): o["model.brightness"] = clampf(float(p["brightness"]) * 7.0, 0, 6.5)
			if p.has("decay"): o["model.decay"] = clampf(float(p["decay"]), 0.05, 20)
			if p.has("reverb.send"): o["reverb.mix"] = clampf(float(p["reverb.send"]) * 10.0, 0, 10)
		"texture":
			pass # Tangle is a patch: the base preset makes the sound, the blend sets its level.
	return o


static func _prism_filter(role: String, p: Dictionary, o: Dictionary) -> void:
	var f: Dictionary = PRISM_FILTER[role]
	if p.has("filter.cutoff"):
		var octaves := 0.5 * log(maxf(float(p["filter.cutoff"]), 30.0) / f.typical) / log(2.0)
		o["f1.cutoff"] = f.home * pow(2.0, clampf(octaves, -f.down, f.up))
	if p.has("filter.resonance"):
		o["f1.resonance"] = clampf(float(p["filter.resonance"]) * f.res, 0.0, f.res_max)
