extends Control
## Temporary main scene: the SynthKit studio page, to try the instruments.
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
