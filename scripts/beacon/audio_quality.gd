class_name AudioQuality
extends RefCounted
## How much sound this device can carry, and keeping it there while it plays.
##
## At start it picks the sample pack tier (full or phone) and a quality level
## from the device (desktop or mobile, memory, processor cores) and the user's
## setting (Auto, High, Light). While playing, update() watches the audio
## load (every synth's share of the audio deadline, summed): when it stays
## high (a busy blend, or a phone getting hot and slowing down) it steps the
## synths down a level before the sound can crackle, and steps back up when
## there is room again, never above the level the device started with.
## Samples already loaded stay; only voices and synth quality move.

## Quality levels, best first. Prism: voice.quality (0 light, 1 medium, 2 high)
## and its shared voice budget. Sampler: interpolation (0 linear, 1 cubic) and voices.
const LEVELS := [
	{"name": "High", "prism_quality": 2, "prism_budget": 24, "sampler_quality": 1, "sampler_voices": 32},
	{"name": "Medium", "prism_quality": 1, "prism_budget": 16, "sampler_quality": 1, "sampler_voices": 24},
	{"name": "Light", "prism_quality": 0, "prism_budget": 12, "sampler_quality": 0, "sampler_voices": 16},
	{"name": "Minimum", "prism_quality": 0, "prism_budget": 8, "sampler_quality": 0, "sampler_voices": 10},
]
const HIGH := 0
const MEDIUM := 1
const LIGHT := 2
const MINIMUM := 3
## The user's choice (FieldPrefs "audio_quality").
const MODES := ["auto", "high", "light"]
const MODE_NAMES := {"auto": "Auto", "high": "High", "light": "Light"}

## Audio load (fraction of the audio deadline) that counts as too much, and as plenty of room.
const LOAD_HIGH := 0.7
const LOAD_LOW := 0.35
const DOWN_AFTER := 2.0 # seconds of high load before stepping down
const UP_AFTER := 30.0 # seconds of low load before stepping back up
const COOLDOWN := 5.0 # seconds after a change before the next one

var mode := "auto"
var device := {}
var tier := "full" # sample pack: "full" or "phone"
var level := HIGH # current level (index into LEVELS)
var ceiling := HIGH # best level allowed (where it started)
var load := 0.0 # smoothed audio load
var changes := 0 # level changes made while playing (for the readout and tests)

var _high_t := 0.0
var _low_t := 0.0
var _cool := 0.0


func _init(p_mode := "", p_device := {}) -> void:
	mode = p_mode if p_mode in MODES else saved_mode()
	device = p_device if not p_device.is_empty() else this_device()
	var p := pick(device, mode)
	tier = p.tier
	level = p.level
	ceiling = p.level


## The user's setting, kept between launches.
static func saved_mode() -> String:
	var m := str(FieldPrefs.get_value("audio_quality", "auto"))
	return m if m in MODES else "auto"


static func save_mode(m: String) -> void:
	FieldPrefs.set_value("audio_quality", m if m in MODES else "auto")


## What this device is: mobile or not, memory (GB) and processor cores.
static func this_device() -> Dictionary:
	var bytes := float(OS.get_memory_info().get("physical", -1))
	if bytes <= 0.0:
		bytes = _proc_meminfo() # Android: Godot reports no physical memory there
	return {
		"mobile": OS.has_feature("mobile"),
		"ram_gb": maxf(bytes, 0.0) / 1073741824.0,
		"cores": OS.get_processor_count(),
	}


## Total memory in bytes from /proc/meminfo (Linux and Android), or 0.
static func _proc_meminfo() -> float:
	var f := FileAccess.open("/proc/meminfo", FileAccess.READ)
	if f == null:
		return 0.0
	while not f.eof_reached():
		var line := f.get_line()
		if line.begins_with("MemTotal:"):
			return float(line.trim_prefix("MemTotal:").strip_edges().split(" ")[0]) * 1024.0
	return 0.0


## The sample tier and starting level for a device and setting.
##   Desktops: the full pack, High.
##   Phones and Quest with 7+ GB and 8+ cores (recent flagships): the full pack,
##     High; if they heat up and slow down, update() steps them down.
##   Phones with 5+ GB and 6+ cores: the phone pack, Medium.
##   Smaller phones: the phone pack, Light (and Minimum when busy).
## High forces the full pack and High (still stepping down rather than crackle);
## Light forces the phone pack and Light.
static func pick(dev: Dictionary, m: String) -> Dictionary:
	if m == "high":
		return {"tier": "full", "level": HIGH}
	if m == "light":
		return {"tier": "phone", "level": LIGHT}
	if not dev.get("mobile", false):
		return {"tier": "full", "level": HIGH}
	var ram := float(dev.get("ram_gb", 0.0))
	var cores := int(dev.get("cores", 1))
	if ram >= 7.0 and cores >= 8:
		return {"tier": "full", "level": HIGH}
	if ram >= 5.0 and cores >= 6:
		return {"tier": "phone", "level": MEDIUM}
	return {"tier": "phone", "level": LIGHT}


func settings() -> Dictionary:
	return LEVELS[level]


func level_name() -> String:
	return LEVELS[level].name


## Feeds the audio load (summed over every synth); returns true when the level changed.
func update(p_load: float, delta: float) -> bool:
	load = lerpf(load, p_load, minf(1.0, delta * 2.0))
	_cool = maxf(0.0, _cool - delta)
	_high_t = _high_t + delta if load > LOAD_HIGH else 0.0
	_low_t = _low_t + delta if load < LOAD_LOW else 0.0
	if _cool > 0.0:
		return false
	if _high_t >= DOWN_AFTER and level < MINIMUM:
		return _step(1)
	if _low_t >= UP_AFTER and level > ceiling:
		return _step(-1)
	return false


func _step(d: int) -> bool:
	level += d
	changes += 1
	_high_t = 0.0
	_low_t = 0.0
	_cool = COOLDOWN
	return true


## One line for the readout: "Auto · Medium · audio 34% · full samples".
func describe() -> String:
	return "%s · %s · audio %d%% · %s samples" % [MODE_NAMES[mode], level_name(), roundi(load * 100.0), tier]


## What the device was judged on: "11.2 GB · 9 cores".
func device_text() -> String:
	return "%.1f GB · %d cores" % [float(device.get("ram_gb", 0.0)), int(device.get("cores", 0))]
