extends Control
## The Synths screen: SynthKit's studio, to try and shape the instruments.
## "‹ Map" (or Android's back gesture) returns to the field.
## Dev: `-- --shot=<path> [--instrument=Name]` saves a screenshot and quits.

var studio: SynthStudio
var _shot := ""
var _frames := 45


func _ready() -> void:
	var bg := ColorRect.new()
	bg.color = Color(0.07, 0.075, 0.09)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 12)
	add_child(margin)
	studio = SynthStudio.new()
	margin.add_child(studio)
	var back := Button.new()
	back.text = "‹ Map"
	back.focus_mode = Control.FOCUS_NONE
	back.custom_minimum_size = Vector2(0, 40)
	back.anchor_left = 1.0
	back.anchor_right = 1.0
	back.offset_left = -110
	back.offset_right = -12
	back.offset_top = 10
	back.pressed.connect(_back_to_field)
	add_child(back)
	get_tree().quit_on_go_back = false
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			_shot = a.trim_prefix("--shot=")
		elif a.begins_with("--instrument="):
			studio.rig.set_instrument(a.trim_prefix("--instrument="))


func _process(_delta: float) -> void:
	if _shot == "":
		return
	_frames -= 1
	if _frames <= 0:
		DirAccess.make_dir_recursive_absolute(_shot.get_base_dir())
		get_viewport().get_texture().get_image().save_png(_shot)
		print("screenshot: ", _shot)
		get_tree().quit()


func _back_to_field() -> void:
	get_tree().quit_on_go_back = true
	get_tree().change_scene_to_file(FieldPrefs.scene_for(FieldPrefs.field()))


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST:
		_back_to_field()
