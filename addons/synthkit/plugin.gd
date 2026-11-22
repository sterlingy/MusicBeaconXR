@tool
extends EditorPlugin
## Registers the two autoloads the instruments need: `Transport` (the shared
## musical clock) and `Midi` (MIDI, computer keyboard and on-screen input).

const AUTOLOADS := {
	"Transport": "res://addons/synthkit/core/transport.gd",
	"Midi": "res://addons/synthkit/core/midi_input.gd",
}


func _enable_plugin() -> void:
	for n in AUTOLOADS:
		if not ProjectSettings.has_setting("autoload/" + n):
			add_autoload_singleton(n, AUTOLOADS[n])


func _disable_plugin() -> void:
	for n in AUTOLOADS:
		if str(ProjectSettings.get_setting("autoload/" + n, "")).ends_with(AUTOLOADS[n]):
			remove_autoload_singleton(n)
