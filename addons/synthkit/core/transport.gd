extends Node
## The shared musical clock. Autoloaded as `Transport`.
##
## Time is the process-wide monotonic clock (JamSynth.get_time()) plus
## `clock_offset`, which network clock sync sets in M4 so every client agrees
## on "now". A tempo map anchor (anchor_time, anchor_beat, bpm) turns time into
## beats. Each frame, everything due in the next `lookahead` seconds is handed
## to the registered clients (metronome, sequencers, loopers), which schedule
## sample-accurate events on their synths with frame_for(). Scheduling ahead
## adds no latency: events land in the synth's future at the exact frame.
##
## Tempo changes take effect on the next bar line, so all clients switch on
## the same beat.

signal state_changed(running: bool)
signal tempo_changed(bpm: float)
signal meter_changed(beats_per_bar: int)
signal quantize_changed
## Host side: start/stop/tempo/meter changed, so the session broadcasts get_state().
signal state_dirty
## Follower side: the player asked for a change only the host may make.
signal request(action: String, value: Variant)

const GRIDS := [
	["1/1", 4.0], ["1/2", 2.0], ["1/4", 1.0], ["1/8", 0.5], ["1/16", 0.25], ["1/32", 0.125],
	["1/4T", 2.0 / 3.0], ["1/8T", 1.0 / 3.0], ["1/16T", 1.0 / 6.0],
]

var bpm := 120.0
var beats_per_bar := 4
var running := false
var clock_offset := 0.0
var lookahead := 0.12
## True on session clients: the host owns tempo and start/stop, so changes
## become requests and the host's state arrives through apply_state().
var follower := false

var metronome_on := true
## This player's click level (the click is local, so it's per player).
var click_volume_db := 0.0:
	set(v):
		click_volume_db = clampf(v, -60.0, 6.0)
		if click_player:
			click_player.volume_db = click_volume_db
var count_in_bars := 1
var quantize_enabled := true # record-time quantize
var quantize_grid := 0.25 # beats
var live_quantize := false # delays live notes to the next grid point

var anchor_time := 0.0
var anchor_beat := 0.0
var click: JamSynth
var click_player: AudioStreamPlayer

var _clients: Array = [] # objects with schedule(from_beat, to_beat) and transport_stopped()
var _scheduled_until := 0.0
var _pending_bpm := 0.0
var _pending_beat := 0.0
var _taps: Array[float] = []


func _ready() -> void:
	click = JamSynth.new()
	click.instrument = "Metronome"
	click_player = AudioStreamPlayer.new()
	click_player.stream = click
	click_player.volume_db = click_volume_db
	add_child(click_player)
	click_player.play()
	lookahead = 0.1 + AudioServer.get_output_latency()


func now() -> float:
	return JamSynth.get_time() + clock_offset


func beat_at(t: float) -> float:
	if not running:
		return anchor_beat
	return anchor_beat + (t - anchor_time) * bpm / 60.0


func time_at(beat: float) -> float:
	return anchor_time + (beat - anchor_beat) * 60.0 / bpm


func current_beat() -> float:
	return beat_at(now())


func beat_length() -> float:
	return 60.0 / bpm


## Engine frame on `synth` at which `beat` should sound. Output latency is
## subtracted so the sound reaches the ear on the beat (matters between devices).
## Returns -1 (play now) if the synth isn't running in real time yet.
func frame_for(synth: JamSynth, beat: float) -> int:
	var t := time_at(beat) - clock_offset - AudioServer.get_output_latency()
	return synth.time_to_frame(t)


func register(client: Object) -> void:
	if not _clients.has(client):
		_clients.append(client)


func unregister(client: Object) -> void:
	_clients.erase(client)


## Starts after a short safety margin, with an optional count-in.
func start() -> void:
	if running:
		return
	if follower:
		request.emit("start", null)
		return
	var count_in := float(count_in_bars * beats_per_bar)
	anchor_time = now() + 0.1
	anchor_beat = -count_in
	_scheduled_until = anchor_beat
	_pending_bpm = 0.0
	running = true
	state_changed.emit(true)
	state_dirty.emit()


func stop() -> void:
	if not running:
		return
	if follower:
		request.emit("stop", null)
		return
	_halt()
	state_dirty.emit()


func _halt() -> void:
	running = false
	anchor_beat = 0.0
	for c in _clients:
		if c.has_method("transport_stopped"):
			c.transport_stopped()
	click.all_notes_off()
	state_changed.emit(false)


func toggle() -> void:
	if running:
		stop()
	else:
		start()


func set_tempo(new_bpm: float) -> void:
	new_bpm = clampf(new_bpm, 30.0, 300.0)
	if follower:
		request.emit("tempo", new_bpm)
		return
	if not running:
		bpm = new_bpm
		tempo_changed.emit(bpm)
		state_dirty.emit()
		return
	# Switch on the next bar line that hasn't been scheduled yet.
	var b := maxf(current_beat(), _scheduled_until)
	_pending_beat = ceilf(b / beats_per_bar) * beats_per_bar
	if _pending_beat <= _scheduled_until:
		_pending_beat += beats_per_bar
	_pending_bpm = new_bpm
	state_dirty.emit()


## Tap tempo: call on every tap. After two taps, returns the tempo from the
## average gap of the last few taps (and sets it, or asks the host to); 0 until then.
## A pause of more than 2 s starts over.
func tap(at := -1.0) -> float:
	var t := at if at >= 0.0 else JamSynth.get_time()
	if not _taps.is_empty() and t - _taps[-1] > 2.0:
		_taps.clear()
	_taps.append(t)
	if _taps.size() > 5:
		_taps.pop_front()
	if _taps.size() < 2:
		return 0.0
	var gap := (_taps[-1] - _taps[0]) / (_taps.size() - 1)
	var b := clampf(roundf(60.0 / gap), 30.0, 300.0)
	set_tempo(b)
	return b


func set_beats_per_bar(n: int) -> void:
	if follower:
		request.emit("meter", n)
		return
	beats_per_bar = clampi(n, 1, 16)
	meter_changed.emit(beats_per_bar)
	state_dirty.emit()


## The tempo map as the host shares it. Times are on the shared clock.
func get_state() -> Dictionary:
	return {"running": running, "anchor_time": anchor_time, "anchor_beat": anchor_beat, "bpm": bpm,
		"beats_per_bar": beats_per_bar, "pending_bpm": _pending_bpm, "pending_beat": _pending_beat}


## Follows the host's tempo map. Beats already past are not scheduled again.
func apply_state(s: Dictionary) -> void:
	var was_running := running
	var old_bpm := bpm
	if int(s.get("beats_per_bar", beats_per_bar)) != beats_per_bar:
		beats_per_bar = clampi(int(s.beats_per_bar), 1, 16)
		meter_changed.emit(beats_per_bar)
	if not bool(s.get("running", false)):
		bpm = float(s.get("bpm", bpm))
		if was_running:
			_halt()
		if bpm != old_bpm:
			tempo_changed.emit(bpm)
		return
	anchor_time = float(s.anchor_time)
	anchor_beat = float(s.anchor_beat)
	bpm = float(s.bpm)
	_pending_bpm = float(s.get("pending_bpm", 0.0))
	_pending_beat = float(s.get("pending_beat", 0.0))
	running = true
	if not was_running:
		_scheduled_until = maxf(anchor_beat, beat_at(now()))
		state_changed.emit(true)
	if bpm != old_bpm:
		tempo_changed.emit(bpm)


func set_quantize(enabled: bool, grid: float, live: bool) -> void:
	quantize_enabled = enabled
	quantize_grid = grid
	live_quantize = live
	quantize_changed.emit()


func quantize(beat: float) -> float:
	if not quantize_enabled or quantize_grid <= 0.0:
		return beat
	return roundf(beat / quantize_grid) * quantize_grid


func next_grid(beat: float) -> float:
	return ceilf(beat / quantize_grid - 1e-6) * quantize_grid


## Bar and beat for display (1-based), e.g. "3.2". Count-in shows as "-1.4".
func position_text() -> String:
	var b := current_beat()
	if b < 0.0:
		return "-%d.%d" % [int(ceilf(-b / beats_per_bar)), int(fposmod(b, beats_per_bar)) + 1]
	return "%d.%d" % [int(b / beats_per_bar) + 1, int(fposmod(b, beats_per_bar)) + 1]


func _process(_delta: float) -> void:
	if not running:
		return
	pump(now() + lookahead)


## Schedules everything up to time `until` (also called directly by tests).
func pump(until: float) -> void:
	var end := beat_at(until)
	while end > _scheduled_until:
		var seg_end := end
		if _pending_bpm > 0.0 and seg_end > _pending_beat:
			seg_end = _pending_beat
		_schedule(_scheduled_until, seg_end)
		_scheduled_until = seg_end
		if _pending_bpm > 0.0 and _scheduled_until >= _pending_beat:
			anchor_time = time_at(_pending_beat)
			anchor_beat = _pending_beat
			bpm = _pending_bpm
			_pending_bpm = 0.0
			tempo_changed.emit(bpm)
			end = beat_at(until)
		elif seg_end >= end:
			break


func _schedule(from_beat: float, to_beat: float) -> void:
	# Metronome (always during the count-in).
	var b := ceilf(from_beat - 1e-9)
	while b < to_beat:
		if metronome_on or b < 0.0:
			var accent := int(fposmod(b, beats_per_bar)) == 0
			click.note_on(1 if accent else 0, 1.0, frame_for(click, b))
		b += 1.0
	if to_beat <= 0.0:
		return
	var f := maxf(from_beat, 0.0)
	for c in _clients:
		c.schedule(f, to_beat)
