extends Node
## The app's first scene: opens the field the player used last (the local grid
## on the very first launch). See FieldPrefs.


func _ready() -> void:
	get_tree().change_scene_to_file.call_deferred(FieldPrefs.scene_for(FieldPrefs.field()))
