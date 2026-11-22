class_name KeyboardView
extends Control
## On-screen piano (or drum pads for Pulsar). Click/drag to play; shows held
## notes from any source. Sends notes through the Midi autoload so the rest of
## the app treats them like any other input.

const DRUM_PADS := [
	[36, "Kick"], [38, "Snare"], [39, "Clap"], [42, "Closed Hat"],
	[46, "Open Hat"], [45, "Low Tom"], [50, "High Tom"], [49, "Cymbal"],
]

@export var first_note := 36
@export var octaves := 4
var accent := Color("2ec4b6")
var drum_mode := false:
	set(v):
		drum_mode = v
		queue_redraw()

var _mouse_note := -1
var _flash := {} # note -> time remaining (drum pads)


func _ready() -> void:
	custom_minimum_size = Vector2(0, 120)
	Midi.note_on.connect(_on_note_on)
	Midi.note_off.connect(queue_redraw.unbind(1))


func _on_note_on(note: int, _velocity: int) -> void:
	_flash[note] = 0.15
	queue_redraw()


func _process(delta: float) -> void:
	if _flash.is_empty():
		return
	for n in _flash.keys():
		_flash[n] -= delta
		if _flash[n] <= 0.0:
			_flash.erase(n)
	queue_redraw()


func _white_keys() -> Array:
	var out := []
	for n in range(first_note, first_note + octaves * 12 + 1):
		if not _is_black(n):
			out.append(n)
	return out


static func _is_black(n: int) -> bool:
	return [1, 3, 6, 8, 10].has(n % 12)


func note_at(pos: Vector2) -> int:
	if drum_mode:
		var w := size.x / DRUM_PADS.size()
		var i := int(pos.x / w)
		return DRUM_PADS[clampi(i, 0, DRUM_PADS.size() - 1)][0]
	var whites := _white_keys()
	var ww := size.x / whites.size()
	# Black keys first (they sit on top).
	if pos.y < size.y * 0.6:
		for i in whites.size():
			var n: int = whites[i]
			if _is_black(n + 1) and n + 1 < first_note + octaves * 12:
				var x := (i + 1) * ww - ww * 0.3
				if pos.x >= x and pos.x < x + ww * 0.6:
					return n + 1
	return whites[clampi(int(pos.x / ww), 0, whites.size() - 1)]


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_mouse_note = note_at(event.position)
			var vel := int(clampf(40.0 + 87.0 * (event.position.y / size.y), 1.0, 127.0))
			Midi.inject_note_on(_mouse_note, vel)
		elif _mouse_note >= 0:
			Midi.inject_note_off(_mouse_note)
			_mouse_note = -1
		accept_event()
	elif event is InputEventMouseMotion and _mouse_note >= 0 and not drum_mode:
		var n := note_at(event.position)
		if n != _mouse_note:
			Midi.inject_note_off(_mouse_note)
			_mouse_note = n
			Midi.inject_note_on(n, 100)


func _draw() -> void:
	var font := get_theme_default_font()
	if drum_mode:
		var w := size.x / DRUM_PADS.size()
		for i in DRUM_PADS.size():
			var n: int = DRUM_PADS[i][0]
			var lit: bool = Midi.held.has(n) or _flash.has(n)
			var r := Rect2(i * w + 4, 4, w - 8, size.y - 8)
			draw_rect(r, Color(accent, 0.85) if lit else Color(0.18, 0.19, 0.22))
			draw_rect(r, Color(accent, 0.5), false, 2.0)
			draw_string(font, r.position + Vector2(0, r.size.y * 0.5 + 6), DRUM_PADS[i][1], HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 14,
				Color.BLACK if lit else Color(1, 1, 1, 0.8))
		return
	var whites := _white_keys()
	var ww := size.x / whites.size()
	for i in whites.size():
		var n: int = whites[i]
		var r := Rect2(i * ww, 0, ww - 1, size.y)
		draw_rect(r, accent if Midi.held.has(n) else Color(0.92, 0.92, 0.9))
		if n % 12 == 0:
			draw_string(font, Vector2(r.position.x, size.y - 6), "C%d" % (n / 12 - 1), HORIZONTAL_ALIGNMENT_CENTER, ww, 10, Color(0, 0, 0, 0.6))
	for i in whites.size():
		var n: int = whites[i] + 1
		if _is_black(n) and n < first_note + octaves * 12:
			var x := (i + 1) * ww - ww * 0.3
			draw_rect(Rect2(x, 0, ww * 0.6, size.y * 0.6), accent.darkened(0.2) if Midi.held.has(n) else Color(0.08, 0.08, 0.1))
