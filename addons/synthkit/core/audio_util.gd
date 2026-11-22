class_name AudioUtil
extends RefCounted
## Helpers for offline audio tests and export: stats, pitch estimate, WAV writing.

static func stats(buf: PackedVector2Array) -> Dictionary:
	var peak := 0.0
	var sum := 0.0
	var bad := 0
	for f in buf:
		if is_nan(f.x) or is_nan(f.y) or is_inf(f.x) or is_inf(f.y):
			bad += 1
			continue
		peak = maxf(peak, maxf(absf(f.x), absf(f.y)))
		sum += f.x * f.x
	var rms := sqrt(sum / maxf(1.0, buf.size()))
	return {"peak": peak, "rms": rms, "bad": bad}


## Fundamental estimate by autocorrelation on the left channel (mono-ish signals).
static func pitch_hz(buf: PackedVector2Array, sr: float, from := 0, length := 8192, min_hz := 30.0, max_hz := 2000.0) -> float:
	var n := mini(length, buf.size() - from)
	var x := PackedFloat32Array()
	x.resize(n)
	for i in n:
		x[i] = buf[from + i].x
	var min_lag := int(sr / max_hz)
	var max_lag := mini(int(sr / min_hz), n / 2)
	var energy := 0.0
	for i in n - max_lag:
		energy += x[i] * x[i]
	if energy < 1e-9:
		return 0.0
	# Pick the first lag whose correlation is close to the best, which avoids octave errors.
	var corr := PackedFloat32Array()
	corr.resize(max_lag + 1)
	var best := 0.0
	for lag in range(min_lag, max_lag + 1):
		var s := 0.0
		for i in n - max_lag:
			s += x[i] * x[i + lag]
		corr[lag] = s
		best = maxf(best, s)
	for lag in range(min_lag + 1, max_lag):
		if corr[lag] >= 0.9 * best and corr[lag] >= corr[lag - 1] and corr[lag] >= corr[lag + 1]:
			return sr / float(lag)
	return 0.0


static func write_wav(path: String, buf: PackedVector2Array, sr: int) -> Error:
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var data := PackedByteArray()
	data.resize(buf.size() * 4)
	for i in buf.size():
		data.encode_s16(i * 4, int(clampf(buf[i].x, -1.0, 1.0) * 32767.0))
		data.encode_s16(i * 4 + 2, int(clampf(buf[i].y, -1.0, 1.0) * 32767.0))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.stereo = true
	wav.mix_rate = sr
	wav.data = data
	return wav.save_to_wav(path)
