class_name SampleBank
extends RefCounted
## The app's sample packs for SynthKit's Sampler (built by tools/build_samples.py):
## res://samples/full on desktop (every layer, stereo) and res://samples/phone
## on phones and Quest (lighter, mono). Programs load in the background: the
## files are read and decoded (JamSynth.decode_ogg, thread-safe) on a worker
## thread, and the finished zones are handed to a Sampler on the main thread.
##
##   var bank := SampleBank.new()
##   bank.load_into(sampler_synth, "strings", func(ok): ...)

const ROOT := "res://samples"

var tier := ""
var index := {} # id -> {id, name, role, zones, bytes, level}
var _jobs := {} # task id -> {id, synth, done, result}


func _init(p_tier := "") -> void:
	tier = p_tier if p_tier != "" else default_tier()
	if not FileAccess.file_exists(_dir() + "/index.json"):
		# Fall back to whichever pack this build carries.
		for t in ["phone", "full"]:
			if FileAccess.file_exists("%s/%s/index.json" % [ROOT, t]):
				tier = t
				break
	var text := FileAccess.get_file_as_string(_dir() + "/index.json")
	var parsed = JSON.parse_string(text) if text != "" else null
	if parsed is Dictionary:
		for p in parsed.get("programs", []):
			index[p.id] = p


## Phones and Quest get the light pack; desktops the full one.
static func default_tier() -> String:
	return "phone" if OS.has_feature("mobile") else "full"


func has(id: String) -> bool:
	return index.has(id)


func _dir() -> String:
	return "%s/%s" % [ROOT, tier]


## The program's description (program.json), or {} if it isn't in the pack.
func program(id: String) -> Dictionary:
	if not has(id):
		return {}
	var parsed = JSON.parse_string(FileAccess.get_file_as_string("%s/%s/program.json" % [_dir(), id]))
	return parsed if parsed is Dictionary else {}


## Reads and decodes a program's zones: [{pcm, channels, rate, zone}]. Any thread.
func decode(id: String) -> Dictionary:
	var prog := program(id)
	if prog.is_empty():
		return {}
	var zones := []
	for z in prog.zones:
		var bytes := FileAccess.get_file_as_bytes("%s/%s/%s" % [_dir(), id, z.file])
		var d := JamSynth.decode_ogg(bytes)
		if d.is_empty():
			continue
		zones.append({"pcm": d.pcm, "channels": d.channels, "rate": d.rate, "zone": z})
	return {"program": prog, "zones": zones}


## Loads a program into a Sampler synth now (main thread; blocks while decoding).
func load_now(synth: JamSynth, id: String) -> bool:
	return apply(synth, decode(id))


## Hands decoded zones to the synth and sets the program's Sampler settings.
func apply(synth: JamSynth, decoded: Dictionary) -> bool:
	if decoded.is_empty() or decoded.zones.is_empty() or not synth.sampler_begin():
		return false
	for z in decoded.zones:
		synth.sampler_add_pcm(z.pcm, z.channels, z.rate, z.zone)
	if not synth.sampler_commit():
		return false
	synth.reset_params()
	var params: Dictionary = decoded.program.get("params", {})
	for k in params:
		synth.set_param(k, float(params[k]))
	return true


## Loads a program in the background; calls done(ok) on the main thread from poll().
func load_async(synth: JamSynth, id: String, done: Callable) -> void:
	var job := {"id": id, "synth": synth, "done": done, "result": {}}
	var task := WorkerThreadPool.add_task(func(): job.result = decode(id), false, "SampleBank " + id)
	_jobs[task] = job


## Finishes background loads (call every frame).
func poll() -> void:
	for task in _jobs.keys():
		if not WorkerThreadPool.is_task_completed(task):
			continue
		WorkerThreadPool.wait_for_task_completion(task)
		var job: Dictionary = _jobs[task]
		_jobs.erase(task)
		var synth: JamSynth = job.synth
		var ok := is_instance_valid(synth) and apply(synth, job.result)
		job.done.call(ok)


func busy() -> bool:
	return not _jobs.is_empty()
