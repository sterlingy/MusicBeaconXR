class_name GeoLocation
extends Node
## The device's location, for the local grid. On Android it asks for location
## permission, then listens to Android's LocationManager (GPS and network)
## through Godot's Java bridge: no extra plugin or custom Android build.
## Elsewhere (desktop, headset without GPS) `unavailable` says why, and the
## local grid stays on its saved place (or London, like the website).
##
##   var geo := GeoLocation.new()
##   add_child(geo)
##   geo.located.connect(func(lat, lon, accuracy_m): ...)
##   geo.unavailable.connect(func(reason): ...)
##   geo.start()

signal located(lat: float, lon: float, accuracy_m: float)
signal unavailable(reason: String)

const PERMISSION := "android.permission.ACCESS_FINE_LOCATION"
const MIN_TIME_MS := 2000
const MIN_DISTANCE_M := 3.0

var running := false
var _manager: JavaObject
var _proxy: JavaObject
var _listener: _Listener
var _waiting_permission := false


## Called by Android, on its own thread, through the Java proxy.
class _Listener:
	extends RefCounted
	var owner: GeoLocation

	func onLocationChanged(location) -> void:
		if location == null or owner == null:
			return
		var acc := 0.0
		if location.hasAccuracy():
			acc = location.getAccuracy()
		owner.call_deferred("_on_fix", location.getLatitude(), location.getLongitude(), acc)

	func onProviderEnabled(_provider) -> void:
		pass

	func onProviderDisabled(_provider) -> void:
		pass

	func onStatusChanged(_provider, _status, _extras) -> void:
		pass

	func onFlushComplete(_request_code) -> void:
		pass


func start() -> void:
	if running:
		return
	if OS.get_name() != "Android":
		unavailable.emit("This device has no location service the app can use.")
		return
	if not _has_permission():
		_waiting_permission = true
		if not get_tree().on_request_permissions_result.is_connected(_on_permission):
			get_tree().on_request_permissions_result.connect(_on_permission)
		OS.request_permission(PERMISSION)
		return
	_listen()


func stop() -> void:
	if _manager != null and _proxy != null:
		_manager.removeUpdates(_proxy)
	running = false


func _exit_tree() -> void:
	stop()


func _has_permission() -> bool:
	return PERMISSION in OS.get_granted_permissions()


func _on_permission(permission: String, granted: bool) -> void:
	if not _waiting_permission or permission != PERMISSION:
		return
	_waiting_permission = false
	if granted:
		_listen()
	else:
		unavailable.emit("Location permission was declined. Allow it in Android Settings › Apps › Music Beacon XR › Permissions.")


func _listen() -> void:
	var rt = Engine.get_singleton("AndroidRuntime") if Engine.has_singleton("AndroidRuntime") else null
	if rt == null:
		unavailable.emit("Android's runtime isn't reachable from this build.")
		return
	var context = rt.getApplicationContext()
	_manager = context.getSystemService("location") if context != null else null
	if _manager == null:
		unavailable.emit("Android's location service isn't available.")
		return
	_listener = _Listener.new()
	_listener.owner = self
	_proxy = JavaClassWrapper.create_proxy(_listener, PackedStringArray(["android.location.LocationListener"]))
	var looper = JavaClassWrapper.wrap("android.os.Looper").getMainLooper()
	var providers := []
	for p in ["gps", "network"]:
		if _manager.isProviderEnabled(p):
			providers.append(p)
	if providers.is_empty():
		unavailable.emit("Location is turned off. Turn it on in Android's quick settings.")
		return
	# A recent fix, if there is one, so the grid appears at once.
	var best = null
	for p in providers:
		var last = _manager.getLastKnownLocation(p)
		if last != null and (best == null or last.getTime() > best.getTime()):
			best = last
	if best != null:
		_on_fix(best.getLatitude(), best.getLongitude(), best.getAccuracy() if best.hasAccuracy() else 0.0)
	for p in providers:
		_manager.requestLocationUpdates(p, MIN_TIME_MS, MIN_DISTANCE_M, _proxy, looper)
	running = true


func _on_fix(lat: float, lon: float, accuracy_m: float) -> void:
	located.emit(lat, lon, accuracy_m)
