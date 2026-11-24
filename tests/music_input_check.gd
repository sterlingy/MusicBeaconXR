extends Node3D
## Headless check of MusicInputKit (addons/music_input_kit): scale lock, patch
## bay, the hub, every object driven by simulated hands, and both drivers.
## No audio, no SynthKit.
## godot --headless --path . res://tests/music_input_check.tscn

var failures := 0
var kit: MusicInput
var ons := [] # [part, voice, note, vel]
var offs := []
var bends := [] # [part, voice, semis]
var knobs := [] # [part, param, value]


func check(ok: bool, msg: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: ", msg)


func _ready() -> void:
	_check_scale()
	_check_patches()
	kit = MusicInput.new()
	add_child(kit)
	kit.note_on.connect(func(p, v, n, vel): ons.append([p, v, n, vel]))
	kit.note_off.connect(func(p, v, n): offs.append([p, v, n]))
	kit.note_bend.connect(func(p, v, s): bends.append([p, v, s]))
	kit.control.connect(func(p, k, v): knobs.append([p, k, v]))
	_check_hub()
	_check_bars()
	_check_pads()
	_check_strings()
	_check_orb()
	_check_ribbon_blocks()
	_check_shapers()
	_check_music_box()
	_check_pointer()
	_check_xr()
	print("music_input_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)


func _reset() -> void:
	ons.clear()
	offs.clear()
	bends.clear()
	knobs.clear()


func hand_at(obj: Node3D, local: Vector3, kind := "mouse", id := 0) -> PlayHand:
	var h := PlayHand.new(kind, id)
	h.position = obj.global_transform * local
	h.pressed = true
	return h


func _check_scale() -> void:
	var s := ScaleLock.new()
	check(s.quantize(61.4) == 62.0 and s.quantize(61.0) == 60.0, "C major snaps 61.4 to D and C# down to C")
	var steps := []
	for i in 8:
		steps.append(s.step(60, i))
	check(steps == [60, 62, 64, 65, 67, 69, 71, 72], "major steps from middle C (got %s)" % [steps])
	check(s.step(60, -1) == 59, "a step down from C is B")
	check(s.chord(48, 0) == [48, 52, 55] and s.chord(48, 1) == [50, 53, 57], "chords on I and ii")
	check(s.chord_name(48, 1) == "Dm" and s.chord_name(48, 6) == "Bdim", "chord names (got %s, %s)" % [s.chord_name(48, 1), s.chord_name(48, 6)])
	s.root = 9
	s.scale = "minor pentatonic"
	check(s.step(60, 0) == 60 and s.step(60, 1) == 62 and s.step(60, 2) == 64, "A minor pentatonic from C: C D E")
	s.enabled = false
	check(s.quantize(61.37) == 61.37 and s.step(60, 3) == 63, "lock off: pitches pass, steps are semitones")
	check(s.chord(48, 1) == [49, 53, 56], "lock off: major chords a semitone apart")


func _check_patches() -> void:
	var pb := PatchBay.new()
	pb.set_patch("Dial.turn", "keys", "filter.cutoff", 0.2, 0.6)
	var r := pb.route("Dial.turn", 0.5)
	check(r.size() == 1 and absf(r[0].value - 0.4) < 1e-6 and r[0].param == "filter.cutoff", "a patch maps 0..1 into lo..hi")
	pb.add_patch("Dial.turn", "lead", "delay.mix")
	check(pb.route("Dial.turn", 1.0).size() == 2, "one source can feed two knobs")
	var opts := [["keys", "a"], ["keys", "b"]]
	pb.set_patch("X.x", "keys", "a")
	check(pb.cycle("X.x", opts).param == "b" and pb.cycle("X.x", opts).is_empty() and pb.cycle("X.x", opts).param == "a", "cycle walks the options, then unpatched")
	var saved := pb.to_array()
	var pb2 := PatchBay.new()
	pb2.from_array(saved)
	check(pb2.patches.size() == pb.patches.size(), "patches save and load")


func _check_hub() -> void:
	_reset()
	kit.scale.enabled = false
	var v := kit.start_note("lead", 60.5, 0.8)
	check(ons.size() == 1 and ons[0][2] == 61 or ons[0][2] == 60, "fractional pitch starts on the nearest note")
	check(bends.size() == 1 and absf(absf(bends[0][2]) - 0.5) < 1e-4, "and bends the rest of the way")
	kit.move_note(v, 64.25)
	check(absf(bends[-1][2] - (64.25 - ons[0][2])) < 1e-4, "moving bends from the start note")
	kit.move_note(v, 80.0)
	check(ons.size() == 2 and ons[1][2] == 80 and offs.size() == 1, "too far to bend: restarts on the new note")
	kit.end_note(v)
	check(offs.size() == 2 and not kit.is_sounding(v), "end_note releases it")
	kit.scale.enabled = true
	_reset()
	kit.start_note("lead", 60.8, 0.8)
	check(ons[0][2] == 60 and bends.is_empty(), "lock on: snapped, no bend")
	kit.end_all()
	kit.send_action("lock", false)
	check(not kit.scale.enabled, "the lock action turns the lock off")
	kit.send_action("lock")
	check(kit.scale.enabled, "and toggles it back")


func _check_bars() -> void:
	_reset()
	var bars := ChimeBars.new()
	bars.name = "Bars"
	add_child(bars)
	var w := bars.width / bars.count
	var h := hand_at(bars, Vector3(bars.box.position.x + w * 2.5, 0.05, 0.0))
	bars.hand_down(h)
	check(ons.size() == 1 and ons[0][0] == "mallet" and ons[0][2] == 64, "third bar plays E in C major (got %s)" % [ons])
	check(knobs.any(func(k): return k[1] == "model.position"), "hitting a bar sends where it was hit")
	h.position = bars.global_transform * Vector3(bars.box.position.x + w * 4.5, 0.05, 0.0)
	bars.hand_move(h)
	check(ons.size() == 2 and ons[1][2] == 67, "dragging to another bar plays it (glissando)")
	bars.hand_up(h)
	kit.scale.enabled = false
	_reset()
	bars.hand_down(hand_at(bars, Vector3(bars.box.position.x + w * 2.5, 0.05, 0.0)))
	check(ons[0][2] == 62, "lock off: the third bar is D (semitones)")
	check(bars.labels[2].text == "D", "bar labels follow the lock")
	kit.scale.enabled = true
	# A fast XR hit is louder than a slow one.
	var soft := PlayHand.new("xr", 5)
	soft.velocity = Vector3(0, -0.3, 0)
	var hard := PlayHand.new("xr", 6)
	hard.velocity = Vector3(0, -2.5, 0)
	check(soft.strike_strength(Vector3.UP) < 0.2 and hard.strike_strength(Vector3.UP) == 1.0, "XR strike strength follows hand speed into the surface")
	bars.free()


func _check_pads() -> void:
	_reset()
	var pads := DrumPads.new()
	add_child(pads)
	var c := pads._center(3)
	pads.hand_down(hand_at(pads, c + Vector3(0, 0.04, 0)))
	check(ons.size() == 1 and ons[0][2] == 42 and ons[0][0] == "drums", "the hat pad plays 42, not snapped to the scale (got %s)" % [ons])
	check(knobs.size() == 1 and knobs[0][1] == "chat.tone" and knobs[0][2] < 0.35, "a centre hit darkens that voice's tone")
	_reset()
	pads.hand_down(hand_at(pads, c + Vector3(pads.pad_size * 0.4, 0.04, 0), "mouse", 1))
	check(knobs[0][2] > 0.75, "a rim hit brightens it")
	pads.free()


func _check_strings() -> void:
	_reset()
	var s := LightStrings.new()
	add_child(s)
	var x := s.box.position.x + s.width * 0.5 / s.count
	var h := hand_at(s, Vector3(x, 0.2, 0), "xr", 7)
	s.hand_down(h)
	check(ons.size() == 1 and ons[0][2] == 60 and ons[0][0] == "harp", "touching the first string plucks C")
	h.position = s.global_transform * Vector3(x, 0.2, 0.04)
	s.hand_move(h)
	check(not bends.is_empty() and bends[-1][2] > 1.0, "pulling the string bends it up (got %s)" % [bends])
	h.position = s.global_transform * Vector3(x + s.width / s.count, 0.2, 0.0)
	s.hand_move(h)
	check(ons.size() == 2 and ons[1][2] == 62 and offs.size() >= 1, "sweeping to the next string strums it")
	s.hand_up(h)
	s.free()


func _check_orb() -> void:
	_reset()
	var orb := ThereminOrb.new()
	add_child(orb)
	var left := Vector3(orb.box.position.x + 0.001, 0.2, 0)
	var h := hand_at(orb, left)
	orb.hand_down(h)
	check(ons.size() == 1 and ons[0][2] == 48 and ons[0][0] == "lead", "orb's left edge is an octave below the base note")
	h.position = orb.global_transform * Vector3(orb.box.position.x + orb.size.x * 0.52, orb.box.end.y - 0.01, 0)
	orb.hand_move(h)
	var b: float = bends[-1][2]
	check(b == roundf(b), "lock on: the orb bends in whole steps (got %s)" % b)
	check(knobs.any(func(k): return k[1] == "filter.cutoff" and k[2] > 0.8), "raising the hand opens the filter")
	kit.scale.enabled = false
	h.position = orb.global_transform * Vector3(orb.box.position.x + orb.size.x * 0.513, 0.2, 0)
	orb.hand_move(h)
	check(absf(bends[-1][2] - roundf(bends[-1][2])) > 0.05, "lock off: the orb slides between notes")
	kit.scale.enabled = true
	orb.hand_up(h)
	check(offs.size() == ons.size() and offs.size() >= 1, "taking the hand out stops the note")
	orb.free()


func _check_ribbon_blocks() -> void:
	_reset()
	var r := PitchRibbon.new()
	add_child(r)
	var h := hand_at(r, Vector3(r.box.position.x + 0.001, 0.01, 0))
	r.hand_down(h)
	check(ons[0][2] == 36 and ons[0][0] == "bass", "ribbon's left end is two octaves down")
	h.position = r.global_transform * Vector3(r.box.end.x - 0.001, 0.01, 0)
	r.hand_move(h)
	check(ons.size() == 2 and ons[1][2] >= 59, "sliding the length of the ribbon climbs two octaves")
	r.hand_up(h)
	r.free()
	_reset()
	var bl := ChordBlocks.new()
	add_child(bl)
	var x := bl.box.position.x + bl.block * 0.5
	var p := hand_at(bl, Vector3(x + 4 * (bl.block + bl.gap), bl.block * 0.5, 0))
	bl.hand_down(p)
	check(ons.size() == 3 and ons.map(func(o): return o[2]) == [55, 59, 62], "the V block holds a G chord (got %s)" % [ons])
	p.position = bl.global_transform * Vector3(x + 4 * (bl.block + bl.gap), bl.block * 0.5 + 0.12, 0)
	bl.hand_move(p)
	check(knobs.any(func(k): return k[1] == "filter.cutoff"), "lifting the block opens the sound")
	bl.hand_up(p)
	check(offs.size() == 3, "letting go releases the chord")
	var xr := hand_at(bl, Vector3(x, bl.block + 0.2, 0), "xr", 9)
	_reset()
	bl.hand_down(xr)
	check(ons.is_empty(), "XR: a hand above the blocks doesn't play yet")
	xr.position = bl.global_transform * Vector3(x, bl.block * 0.6, 0)
	bl.hand_move(xr)
	check(ons.size() == 3, "XR: reaching the block plays its chord")
	bl.hand_up(xr)
	bl.free()


func _check_shapers() -> void:
	_reset()
	var d := TwistDial.new()
	d.name = "Dial"
	add_child(d)
	check(knobs.size() == 1 and knobs[0][1] == "filter.cutoff", "a dial sends its value when it starts")
	var h := hand_at(d, Vector3(0, 0.05, -d.radius))
	d.hand_down(h)
	# Drag a quarter turn clockwise seen from above: from -z (12 o'clock) to +x (3 o'clock).
	for i in range(1, 10):
		var a := -i * PI / 18.0
		h.position = d.global_transform * Vector3(-sin(a) * d.radius, 0.05, -cos(a) * d.radius)
		d.hand_move(h)
	check(absf(d.value - (0.5 + 1.0 / 3.0)) < 0.02, "a quarter turn clockwise moves the dial up a third (got %s)" % d.value)
	d.hand_up(h)
	var x := PlayHand.new("xr", 11)
	x.grip = true
	d.hand_down(x)
	x.basis = Basis(Vector3.FORWARD, deg_to_rad(27.0)) # clockwise wrist twist (seen from behind)
	d.hand_move(x)
	check(d.value > 0.9, "XR: gripping and twisting the wrist turns it (got %s)" % d.value)
	d.hand_up(x)
	d.wheel(null, -2)
	check(d.value < 0.9, "the mouse wheel turns it")
	d.free()

	var f := SlideFader.new()
	f.spring_back = true
	f.default_param = "@bend"
	add_child(f)
	var fh := hand_at(f, Vector3(0, 0.03, -f.length / 2))
	f.hand_down(fh)
	check(f.value > 0.95, "pushing a lever all the way")
	f.hand_up(fh)
	for i in 60:
		f._process(1.0 / 60.0)
	check(absf(f.value - 0.5) < 0.01, "a spring lever returns to rest (at %s)" % f.value)
	f.free()

	var xy := XYPad.new()
	add_child(xy)
	xy.hand_down(hand_at(xy, Vector3(xy.size / 2 - 0.001, 0.02, -xy.size / 2 + 0.001)))
	check(xy.x > 0.98 and xy.y > 0.98, "far right corner of the pad is x=1 y=1")
	xy.free()

	var fw := Flywheel.new()
	fw.name = "Wheel"
	add_child(fw)
	_reset()
	fw.spin(3.0)
	fw._process(0.01)
	var s0 := kit.last_value("Wheel.speed")
	for i in 120:
		fw._process(1.0 / 30.0)
	var s1 := kit.last_value("Wheel.speed")
	check(s0 > 0.95 and s1 < s0 and s1 > 0.0, "a flick spins it, then it slows (%.2f -> %.2f)" % [s0, s1])
	check(knobs.any(func(k): return k[1] == "perf.tremolo"), "its speed drives the tremolo")
	fw.free()

	var tc := TiltCube.new()
	add_child(tc)
	var th := PlayHand.new("xr", 12)
	th.grip = true
	tc.hand_down(th)
	th.basis = Basis(Vector3.RIGHT, deg_to_rad(-20.0))
	tc.hand_move(th)
	check(tc.pitch > 0.3, "XR: tipping the hand forward tips the cube (pitch %s)" % tc.pitch)
	tc.hand_up(th)
	tc.free()

	var sw := ScaleSwitch.new()
	add_child(sw)
	var b := sw.box
	sw.hand_down(hand_at(sw, Vector3(b.position.x + b.size.x / 6.0, 0.02, 0)))
	check(not kit.scale.enabled and sw.labels[0].text.contains("OFF"), "the LOCK button turns the lock off")
	sw.hand_down(hand_at(sw, Vector3(b.position.x + b.size.x / 6.0, 0.02, 0), "mouse", 1))
	sw.hand_down(hand_at(sw, Vector3(0, 0.02, 0), "mouse", 2))
	check(kit.scale.enabled and kit.scale.root == 1, "KEY moves the key up")
	sw.hand_down(hand_at(sw, Vector3(b.end.x - 0.01, 0.02, 0), "mouse", 3))
	check(kit.scale.scale == "minor", "SCALE steps to the next scale")
	kit.scale.root = 0
	kit.scale.scale = "major"
	sw.free()


func _check_music_box() -> void:
	_reset()
	var mb := MusicBoxWheel.new()
	add_child(mb)
	mb.toggle_peg(Vector2i(0, 12)) # three quarters round: reaches the comb after a quarter turn
	mb.toggle_peg(Vector2i(2, 0)) # at the comb now: plays when it comes round again
	mb._advance(TAU * 0.5)
	check(ons.size() == 1 and ons[0][2] == 60, "a half turn plays the peg that passed the comb (got %s)" % [ons])
	mb._advance(TAU * 0.5)
	check(ons.size() == 2 and ons[1][2] == 64, "a full turn plays the third ring's peg too (got %s)" % [ons])
	var tap := hand_at(mb, Vector3(0, 0.02, mb._ring_radius(1)))
	mb.hand_down(tap)
	mb.hand_up(tap)
	check(mb.pegs.size() == 3, "tapping the disc places a peg")
	mb.free()


func _check_pointer() -> void:
	_reset()
	var bars := ChimeBars.new()
	bars.name = "PBars"
	add_child(bars)
	var cam := Camera3D.new()
	add_child(cam)
	cam.look_at_from_position(Vector3(0, 0.6, 0.0001), Vector3.ZERO)
	var ptr := PlayPointer.new()
	ptr.camera = cam
	add_child(ptr)
	var center := get_viewport().get_visible_rect().size / 2
	check(ptr.down("m", center), "the pointer hits the bars under the camera")
	check(ons.size() == 1, "and plays one")
	var far := cam.unproject_position(bars.global_transform * Vector3(bars.box.end.x - 0.01, 0.05, 0))
	ptr.move("m", far)
	check(ons.size() == 2 and ons[1][2] == 72, "dragging to the last bar plays the octave (got %s)" % [ons])
	ptr.up("m")
	check(not ptr.down("m", Vector2(2, 2)), "pressing empty space misses")
	cam.free()
	ptr.free()
	bars.free()


func _check_xr() -> void:
	_reset()
	var pads := DrumPads.new()
	add_child(pads)
	var origin := XROrigin3D.new()
	add_child(origin)
	var c := XRController3D.new()
	origin.add_child(c)
	var hands := PlayXRHands.new()
	hands.enabled = false
	hands.add_controller(c)
	add_child(hands)
	var above := pads._center(0) + Vector3(0, 0.25, 0)
	c.global_position = above - hands.tip_offset
	hands.tick(0.016)
	c.global_position = pads._center(0) + Vector3(0, 0.05, 0) - hands.tip_offset
	hands.tick(0.05) # 0.2 m in 50 ms: a firm hit
	check(ons.size() == 1 and ons[0][2] == 36 and ons[0][3] > 0.6, "XR: bringing the hand down onto the kick pad hits it hard (got %s)" % [ons])
	hands.tick(0.016)
	check(ons.size() == 1, "XR: resting on the pad doesn't retrigger")
	c.global_position = above - hands.tip_offset
	hands.tick(0.016)
	check(hands.holding(c) == null, "XR: lifting off lets go")
	# Out of reach: point and pull the trigger.
	c.global_transform = Transform3D(Basis(Vector3.RIGHT, deg_to_rad(-90)), pads._center(5) + Vector3(0, 1.0, 0))
	c.set_meta("fake_trigger", 1.0)
	hands.tick(0.016)
	check(ons.size() == 2 and ons[1][2] == 50, "XR: trigger on a pointed-at pad plays it from a distance (got %s)" % [ons])
	c.set_meta("fake_trigger", 0.0)
	hands.tick(0.016)
	check(hands.holding(c) == null, "XR: releasing the trigger lets go")
	pads.free()
	origin.free()
	hands.free()
