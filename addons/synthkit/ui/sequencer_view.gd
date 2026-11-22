class_name SequencerView
extends VBoxContainer
## Step grid for an instrument's sequencer. Rows are drum voices (Pulsar) or
## two octaves of notes; columns are steps. Click/drag to paint notes; the last
## two rows toggle accent and slide. A playhead follows the transport.

var seq: StepSequencer
var accent := Color("2ec4b6")
var base_note := 48
var drum := false

var _grid: Control
var _steps_spin: SpinBox
var _div: OptionButton
var _swing: HSlider
var _gate: HSlider
var _rec: Button
var _on: Button
var _paint := -1 # -1 none, 0 erase, 1 draw
var _last_cell := Vector2i(-1, -1)

const LABEL_W := 70.0


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 8)
	add_child(bar)
	_on = _toggle("Pattern On", func(t):
		seq.enabled = t
		if not t:
			seq.transport_stopped())
	bar.add_child(_on)
	_rec = _toggle("● Record", func(t): seq.recording = t)
	bar.add_child(_rec)
	bar.add_child(_label("Steps"))
	_steps_spin = SpinBox.new()
	_steps_spin.min_value = 1
	_steps_spin.max_value = 64
	_steps_spin.value_changed.connect(func(v):
		seq.steps = int(v)
		_grid.queue_redraw())
	bar.add_child(_steps_spin)
	bar.add_child(_label("Step"))
	_div = OptionButton.new()
	for d in StepSequencer.DIVISIONS:
		_div.add_item(d[0])
	_div.item_selected.connect(func(i): seq.division = StepSequencer.DIVISIONS[i][1])
	bar.add_child(_div)
	bar.add_child(_label("Swing"))
	_swing = _slider(0.0, 0.5, func(v): seq.swing = v)
	bar.add_child(_swing)
	bar.add_child(_label("Gate"))
	_gate = _slider(0.05, 1.0, func(v):
		seq.gate = v
		for s in seq.pattern:
			if not s.notes.is_empty():
				s.gate = v)
	bar.add_child(_gate)
	var down := Button.new()
	down.text = "Oct −"
	down.pressed.connect(func():
		base_note = maxi(12, base_note - 12)
		_grid.queue_redraw())
	bar.add_child(down)
	var up := Button.new()
	up.text = "Oct +"
	up.pressed.connect(func():
		base_note = mini(96, base_note + 12)
		_grid.queue_redraw())
	bar.add_child(up)
	var clr := Button.new()
	clr.text = "Clear"
	clr.pressed.connect(func(): seq.clear())
	bar.add_child(clr)

	_grid = Control.new()
	_grid.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_grid.draw.connect(_draw_grid)
	_grid.gui_input.connect(_grid_input)
	_grid.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	add_child(_grid)


func bind(p_seq: StepSequencer, color: Color, is_drum: bool) -> void:
	if seq and seq.changed.is_connected(_grid.queue_redraw):
		seq.changed.disconnect(_grid.queue_redraw)
	seq = p_seq
	accent = color
	drum = is_drum
	base_note = 36 if seq.rig.instrument in ["Undertow"] else 48
	seq.changed.connect(_grid.queue_redraw)
	_on.set_pressed_no_signal(seq.enabled)
	_rec.set_pressed_no_signal(seq.recording)
	_steps_spin.set_value_no_signal(seq.steps)
	for i in StepSequencer.DIVISIONS.size():
		if is_equal_approx(StepSequencer.DIVISIONS[i][1], seq.division):
			_div.select(i)
	_swing.set_value_no_signal(seq.swing)
	_gate.set_value_no_signal(seq.gate)
	_grid.queue_redraw()


func _process(_d: float) -> void:
	if is_visible_in_tree() and Transport.running:
		_grid.queue_redraw()


func _rows() -> Array:
	# [note, label] top to bottom
	var out := []
	if drum:
		for p in KeyboardView.DRUM_PADS:
			out.append(p)
	else:
		var names := ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
		for n in range(base_note + 23, base_note - 1, -1):
			out.append([n, "%s%d" % [names[n % 12], n / 12 - 1]])
	return out


func _cell_size() -> Vector2:
	var rows := _rows().size() + 2
	return Vector2((_grid.size.x - LABEL_W) / maxf(1, seq.steps), _grid.size.y / rows)


func _cell_at(pos: Vector2) -> Vector2i:
	if seq == null or pos.x < LABEL_W:
		return Vector2i(-1, -1)
	var cs := _cell_size()
	return Vector2i(int((pos.x - LABEL_W) / cs.x), int(pos.y / cs.y))


func _grid_input(e: InputEvent) -> void:
	if seq == null:
		return
	if e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT:
		if e.pressed:
			var c := _cell_at(e.position)
			if c.x < 0 or c.x >= seq.steps:
				return
			_paint = 0 if _cell_on(c) else 1
			_last_cell = Vector2i(-1, -1)
			_apply(c)
		else:
			_paint = -1
	elif e is InputEventMouseMotion and _paint >= 0:
		var c := _cell_at(e.position)
		if c.x >= 0 and c.x < seq.steps:
			_apply(c)


func _cell_on(c: Vector2i) -> bool:
	var rows := _rows()
	var s: Dictionary = seq.pattern[c.x]
	if c.y < rows.size():
		return s.notes.has(rows[c.y][0])
	return s.accent if c.y == rows.size() else s.slide


func _apply(c: Vector2i) -> void:
	if c == _last_cell:
		return
	_last_cell = c
	var rows := _rows()
	var on := _paint == 1
	if c.y < rows.size():
		var note: int = rows[c.y][0]
		# Mono instruments: one note per step.
		if on and not drum and seq.rig.instrument in ["Undertow", "Comet", "Tangle"]:
			seq.pattern[c.x].notes.clear()
		seq.set_note(c.x, note, on)
		if on and not Transport.running:
			seq.rig.synth.note_on(note, 0.8)
			seq.rig.synth.note_off(note, seq.rig.synth.get_frame_position() + 6000)
	elif c.y == rows.size():
		seq.pattern[c.x].accent = on
		seq.changed.emit()
	elif c.y == rows.size() + 1:
		seq.pattern[c.x].slide = on
		seq.changed.emit()


func _draw_grid() -> void:
	if seq == null:
		return
	var font := get_theme_default_font()
	var rows := _rows()
	var cs := _cell_size()
	var play := seq.step_at(Transport.current_beat()) if Transport.running and seq.enabled else -1
	for r in rows.size() + 2:
		var y := r * cs.y
		var label: String
		if r < rows.size():
			label = rows[r][1]
		else:
			label = "Accent" if r == rows.size() else "Slide"
		var black: bool = r < rows.size() and not drum and KeyboardView._is_black(rows[r][0])
		_grid.draw_rect(Rect2(0, y, LABEL_W - 2, cs.y - 1), Color(0.16, 0.17, 0.2) if not black else Color(0.1, 0.1, 0.12))
		_grid.draw_string(font, Vector2(4, y + cs.y * 0.5 + 5), label, HORIZONTAL_ALIGNMENT_LEFT, LABEL_W - 6, 11, Color(1, 1, 1, 0.75))
		for i in seq.steps:
			var rect := Rect2(LABEL_W + i * cs.x + 1, y + 1, cs.x - 2, cs.y - 2)
			var beat_col := (i * seq.division) / 1.0
			var on_beat := is_equal_approx(fposmod(beat_col, 1.0), 0.0)
			var bg := Color(0.13, 0.14, 0.17) if not black else Color(0.1, 0.105, 0.125)
			if on_beat:
				bg = bg.lightened(0.06)
			if i == play:
				bg = bg.lightened(0.18)
			_grid.draw_rect(rect, bg)
			if _cell_on(Vector2i(i, r)):
				var col := accent if r < rows.size() else (Color("ffd166") if r == rows.size() else Color("4cc9f0"))
				if r < rows.size():
					col = col.lerp(Color.WHITE, 0.0 if not seq.pattern[i].accent else 0.25)
				_grid.draw_rect(rect.grow(-2), col)


func _toggle(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.toggle_mode = true
	b.text = text
	b.toggled.connect(cb)
	return b


func _label(text: String) -> Label:
	var l := Label.new()
	l.text = text
	return l


func _slider(lo: float, hi: float, cb: Callable) -> HSlider:
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = 0.01
	s.custom_minimum_size = Vector2(90, 20)
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	s.value_changed.connect(cb)
	return s
