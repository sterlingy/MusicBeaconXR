class_name PlayHand
extends RefCounted
## One thing that touches the objects: a mouse, a finger, or a tracked hand or
## controller. Drivers (PlayPointer, PlayXRHands) keep these up to date and
## pass them to the objects, so an object never knows which device it is.

## "mouse", "touch", "xr"
var kind := "mouse"
var id := 0
## World position of the touching point: the ray hit for a pointer, the
## fingertip or controller tip in XR.
var position := Vector3.ZERO
## World velocity in m/s (XR), or an estimate from how fast the pointer moved.
var velocity := Vector3.ZERO
## Aim ray, for objects that react to where you point (pointer or controller).
var ray_origin := Vector3.ZERO
var ray_dir := Vector3.FORWARD
## Held down: mouse button, finger on glass, trigger or grip.
var pressed := false
## Grip in XR (grab and turn); the right mouse button / two fingers otherwise.
var grip := false
## 0..1: XR trigger squeeze, or 1.0 while a pointer is down.
var squeeze := 0.0
## Orientation of the hand (XR), for turning and tilting things you hold.
var basis := Basis.IDENTITY
## Set by the XR driver: func(strength: float) buzzes the controller.
var buzz := Callable()


func _init(k := "mouse", i := 0) -> void:
	kind = k
	id = i


func is_xr() -> bool:
	return kind == "xr"


## How hard a strike is, 0..1, from the hand's speed into `normal` (XR), or a
## default for pointers (which can't tell how hard you clicked).
func strike_strength(normal := Vector3.ZERO, full_speed := 2.0) -> float:
	if not is_xr():
		return clampf(0.7 + velocity.length() * 0.05, 0.4, 1.0)
	var s := velocity.length() if normal == Vector3.ZERO else maxf(0.0, -velocity.dot(normal))
	return clampf(s / full_speed, 0.08, 1.0)


## A short buzz on the controller (XR only; nothing on pointers).
func pulse(strength := 0.5) -> void:
	if buzz.is_valid():
		buzz.call(clampf(strength, 0.0, 1.0))
