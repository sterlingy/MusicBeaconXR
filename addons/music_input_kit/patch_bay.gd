class_name PatchBay
extends RefCounted
## Connects the objects' moving parts (sources) to sound-shaping knobs (targets).
## Part of MusicInputKit (no SynthKit dependency).
##
## A source is a name an object sends values on, 0..1: "dial.turn", "orb.height",
## "flywheel.speed". A target is a part (an instrument role, like "keys") and a
## parameter id on it ("filter.cutoff"). The patch maps the source's 0..1 into
## lo..hi, which is a fraction of the knob's own range: the host that owns the
## synth turns that into real units. One source can feed several knobs.

signal changed

## {source, part, param, lo, hi}
var patches: Array[Dictionary] = []
## source -> label, filled in by the objects so a UI can list them.
var sources := {}


func register(source: String, label: String) -> void:
	sources[source] = label


## Replaces every patch from `source` with one to part/param. Empty param unpatches.
func set_patch(source: String, part: String, param: String, lo := 0.0, hi := 1.0) -> void:
	_drop(source)
	if param != "":
		patches.append({"source": source, "part": part, "param": param, "lo": lo, "hi": hi})
	changed.emit()


## Adds a patch alongside any the source already has.
func add_patch(source: String, part: String, param: String, lo := 0.0, hi := 1.0) -> void:
	patches.append({"source": source, "part": part, "param": param, "lo": lo, "hi": hi})
	changed.emit()


func remove(source: String) -> void:
	_drop(source)
	changed.emit()


func _drop(source: String) -> void:
	patches = patches.filter(func(p): return p.source != source)


func targets_of(source: String) -> Array[Dictionary]:
	return patches.filter(func(p): return p.source == source)


## [{part, param, value}] for a source moved to `v` (0..1).
func route(source: String, v: float) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for p in patches:
		if p.source == source:
			out.append({"part": p.part, "param": p.param, "value": clampf(lerpf(p.lo, p.hi, clampf(v, 0.0, 1.0)), 0.0, 1.0)})
	return out


## Moves `source` to the next of `options` ([[part, param], ...]); wraps to unpatched.
func cycle(source: String, options: Array) -> Dictionary:
	var cur := targets_of(source)
	var i := -1
	if not cur.is_empty():
		for k in options.size():
			if options[k][0] == cur[0].part and options[k][1] == cur[0].param:
				i = k
	i += 1
	if i >= options.size():
		set_patch(source, "", "")
		return {}
	set_patch(source, options[i][0], options[i][1])
	return targets_of(source)[0]


func to_array() -> Array:
	return patches.duplicate(true)


func from_array(a: Array) -> void:
	patches.clear()
	for p in a:
		if p is Dictionary and p.has("source") and p.has("param"):
			patches.append({"source": p.source, "part": p.get("part", ""), "param": p.param, "lo": float(p.get("lo", 0.0)), "hi": float(p.get("hi", 1.0))})
	changed.emit()
