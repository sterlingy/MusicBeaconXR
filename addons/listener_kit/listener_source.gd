class_name ListenerSource
extends Node
## Base class for things that move a ListenerInput. Add sources as children of
## the ListenerInput; earlier children win when two want to move at once.

var enabled := true
## True for sources that set the position outright (XR head tracking, GPS follow).
var drives_position := false


## The listener (the parent ListenerInput), or null.
func listener() -> ListenerInput:
	return get_parent() as ListenerInput


## A move direction (right, forward) for this frame, length 0..1. Zero = no opinion.
func move_intent(_li: ListenerInput, _delta: float) -> Vector2:
	return Vector2.ZERO


## For `drives_position` sources: the position to use this frame, or null to fall through.
func driven_position(_li: ListenerInput, _delta: float) -> Variant:
	return null
