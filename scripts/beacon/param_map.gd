class_name ParamMap
extends RefCounted
## Translates song parameters (the browser instruments' ids and units) into
## SynthKit engine parameters. Anything without a counterpart is skipped; the
## part's base preset supplies the rest of the sound.

const UNDERTOW_WAVE := {"triangle": 0, "sawtooth": 2, "square": 4}
const OSC_WAVE := {"sawtooth": 0, "square": 1, "triangle": 3, "sine": 4}
const DRIFT_MODEL := {"string": 0, "marimba": 1, "vibes": 2, "kalimba": 3, "bell": 4, "glass": 5}


static func to_synth(role: String, p: Dictionary) -> Dictionary:
	var o := {}
	match role:
		"drums":
			if p.has("kick.tune"): o["kick.tune"] = clampf(12.0 * log(float(p["kick.tune"]) / 50.0) / log(2.0), -12, 12)
			if p.has("kick.decay"): o["kick.decay"] = clampf(float(p["kick.decay"]) * 10.0, 0, 10)
			if p.has("snare.tone"): o["snare.tune"] = clampf(12.0 * log(float(p["snare.tone"]) / 200.0) / log(2.0), -12, 12)
			if p.has("snare.decay"): o["snare.decay"] = clampf(float(p["snare.decay"]) * 25.0, 0, 10)
			if p.has("hat.decay"):
				o["chat.decay"] = clampf(float(p["hat.decay"]) * 50.0, 0, 10)
				o["ohat.decay"] = clampf(float(p["hat.decay"]) * 60.0, 0, 10)
			if p.has("hat.tone"):
				o["chat.tone"] = clampf((float(p["hat.tone"]) - 4000.0) / 800.0, 0, 10)
				o["ohat.tone"] = o["chat.tone"]
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
			if p.has("filter.emphasis"): o["filter.emphasis"] = clampf(float(p["filter.emphasis"]), 0, 10)
			if p.has("fenv.amount"): o["filter.contour"] = clampf(float(p["fenv.amount"]) / 300.0, 0, 10)
			if p.has("fenv.decay"): o["fenv.decay"] = clampf(float(p["fenv.decay"]), 0.004, 10)
			if p.has("glide"): o["ctrl.glide"] = clampf(float(p["glide"]), 0, 5)
		"lead":
			# Prism: the base preset makes the sound; the song sets its tone, motion and space.
			if p.has("filter.cutoff"): o["f1.cutoff"] = clampf(float(p["filter.cutoff"]), 30, 18000)
			if p.has("filter.resonance"): o["f1.resonance"] = clampf(float(p["filter.resonance"]), 0, 10)
			if p.has("vibrato.depth"): o["lfo1.vibrato"] = clampf(float(p["vibrato.depth"]), 0, 100)
			if p.has("vibrato.rate"): o["lfo1.rate"] = clampf(float(p["vibrato.rate"]), 0.1, 12)
			if p.has("portamento"): o["voice.glide"] = clampf(float(p["portamento"]), 0, 2)
			if p.has("delay.send"): o["send.echo"] = clampf(float(p["delay.send"]) * 10.0, 0, 10)
			if p.has("reverb.send"): o["send.space"] = clampf(float(p["reverb.send"]) * 10.0, 0, 10)
			if p.has("aenv.release"): o["env1.release"] = clampf(float(p["aenv.release"]), 0.005, 15)

		"keys":
			if p.has("filter.cutoff"): o["f1.cutoff"] = clampf(float(p["filter.cutoff"]), 30, 18000)
			if p.has("filter.resonance"): o["f1.resonance"] = clampf(float(p["filter.resonance"]), 0, 10)
			if p.has("osc.detune"): o["b.fine"] = clampf(float(p["osc.detune"]), -50, 50)
			if p.has("aenv.attack"): o["env1.attack"] = clampf(float(p["aenv.attack"]), 0.001, 10)
			if p.has("aenv.release"): o["env1.release"] = clampf(float(p["aenv.release"]), 0.005, 15)
			if p.has("chorus.mix"): o["fx1.amount"] = clampf(float(p["chorus.mix"]) * 10.0, 0, 10)
			if p.has("reverb.send"): o["send.space"] = clampf(float(p["reverb.send"]) * 10.0, 0, 10)
			if p.has("delay.send"): o["send.echo"] = clampf(float(p["delay.send"]) * 10.0, 0, 10)

		"pluck":
			if p.has("model"): o["model.type"] = DRIFT_MODEL.get(p["model"], 0)
			if p.has("brightness"): o["model.brightness"] = clampf(float(p["brightness"]) * 10.0, 0, 10)
			if p.has("decay"): o["model.decay"] = clampf(float(p["decay"]), 0.05, 20)
			if p.has("reverb.send"): o["reverb.mix"] = clampf(float(p["reverb.send"]) * 10.0, 0, 10)
		"texture":
			pass # Tangle is a patch: the base preset makes the sound, the blend sets its level.
	return o
