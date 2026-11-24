class_name ScaleLock
extends RefCounted
## Keeps notes in a key and scale, or lets every pitch through when switched off.
## Part of MusicInputKit (no SynthKit dependency).
##
## Pitches are MIDI note numbers as floats, so continuous objects (the orb, the
## ribbon) can play between the keys when the lock is off.

signal changed

const SCALES := {
	"major": [0, 2, 4, 5, 7, 9, 11],
	"minor": [0, 2, 3, 5, 7, 8, 10],
	"dorian": [0, 2, 3, 5, 7, 9, 10],
	"mixolydian": [0, 2, 4, 5, 7, 9, 10],
	"phrygian": [0, 1, 3, 5, 7, 8, 10],
	"harmonic minor": [0, 2, 3, 5, 7, 8, 11],
	"major pentatonic": [0, 2, 4, 7, 9],
	"minor pentatonic": [0, 3, 5, 7, 10],
	"blues": [0, 3, 5, 6, 7, 10],
	"chromatic": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}
const NAMES := ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

## On: notes snap to the scale. Off: anything goes (and bars, strings and
## blocks lay out chromatically).
var enabled := true:
	set(v):
		if v != enabled:
			enabled = v
			changed.emit()
## Key root, 0 = C ... 11 = B.
var root := 0:
	set(v):
		root = posmod(v, 12)
		changed.emit()
var scale := "major":
	set(v):
		if SCALES.has(v):
			scale = v
			changed.emit()


func intervals() -> Array:
	return SCALES[scale] if enabled else SCALES["chromatic"]


func in_scale(note: int) -> bool:
	return intervals().has(posmod(note - root, 12))


## The nearest allowed pitch (ties go down). With the lock off, `pitch` comes back as is.
func quantize(pitch: float) -> float:
	if not enabled:
		return pitch
	var base := floori(pitch)
	var best := float(base)
	var best_d := INF
	for k in range(-6, 7):
		var n := base + k
		if in_scale(n):
			var d := absf(pitch - n)
			if d < best_d - 1e-6:
				best_d = d
				best = n
	return best


## The `i`-th step above `base` (negative goes down): scale degrees with the lock
## on, semitones with it off. `base` itself is snapped into the scale first.
func step(base: int, i: int) -> int:
	var iv := intervals()
	var n := int(quantize(base)) if enabled else base
	if not enabled:
		return base + i
	var deg := iv.find(posmod(n - root, 12))
	var octave := floori(float(n - root) / 12.0)
	var d := deg + i
	octave += floori(float(d) / iv.size())
	d = posmod(d, iv.size())
	return root + octave * 12 + int(iv[d])


## A three-note chord on step `i` above `base`: stacked thirds of the scale with
## the lock on, a major triad on the chromatic step with it off. `extra` adds a 7th.
func chord(base: int, i: int, extra := false) -> Array:
	if not enabled or intervals().size() < 7:
		var r := step(base, i) if enabled else base + i
		var out := [r, r + 4, r + 7]
		if extra:
			out.append(r + 10)
		return out
	var notes := [step(base, i), step(base, i + 2), step(base, i + 4)]
	if extra:
		notes.append(step(base, i + 6))
	return notes


## Roman-numeral-ish label for chord step `i` (lock on), or the root name (lock off).
func chord_name(base: int, i: int) -> String:
	var c := chord(base, i)
	var q := ""
	if c[1] - c[0] == 3:
		q = "m" if c[2] - c[0] == 7 else "dim"
	elif c[2] - c[0] == 8:
		q = "+"
	return note_name(c[0], false) + q


static func note_name(note: int, octave := true) -> String:
	var s: String = NAMES[posmod(note, 12)]
	return s + str(floori(note / 12.0) - 1) if octave else s


func describe() -> String:
	return "%s %s" % [NAMES[root], scale] if enabled else "free (all 12 notes)"
