class_name PopupFx
extends RefCounted
## How pop-out windows (Fields, Walks, My beacons, the Jump / Move card, the
## flight card) come and go: one open at a time, each popping open from its
## own corner with a little overshoot and fading in, shrinking and fading out
## on close, with a swoosh each way. Panels are frosted glass: the world shows
## through them, blurred.
##
## A window joins the "popup_windows" group and has close_popup(except); before
## it opens it calls PopupFx.claim(self) so the others close. Its fit code
## multiplies its scale by PopupFx.scale_of(panel) and the panel's alpha
## follows PopupFx.alpha_of(panel) (see animate()).

const OPEN_S := 0.28
const CLOSE_S := 0.16
const GROUP := "popup_windows"
const OPEN_SFX := "res://sfx/ui_open.ogg"
const CLOSE_SFX := "res://sfx/ui_close.ogg"
## UI sounds sit under the music.
const SFX_DB := -9.0

static var _player: AudioStreamPlayer
static var _streams := {}
static var _glass: Shader


## Closes every other pop-out window, then plays the opening swoosh.
static func claim(owner: Object) -> void:
	var node := owner as Node
	if node == null or not node.is_inside_tree():
		return
	node.get_tree().call_group(GROUP, "close_popup", owner)


## The swoosh for opening (true) or closing (false).
static func swoosh(tree: SceneTree, open: bool) -> void:
	if tree == null:
		return
	if _player == null or not is_instance_valid(_player):
		_player = AudioStreamPlayer.new()
		_player.name = "PopupSwoosh"
		_player.volume_db = SFX_DB
		_player.max_polyphony = 2
		tree.root.add_child.call_deferred(_player)
		await tree.process_frame
	var path := OPEN_SFX if open else CLOSE_SFX
	if not _streams.has(path):
		_streams[path] = load(path) if ResourceLoader.exists(path) else null
	if _streams[path] == null:
		return
	_player.stream = _streams[path]
	_player.play()


## Animates a window open or closed: its "fx" goes 0 -> 1 (with overshoot) or
## back to 0, and it hides when closed. Its fit code reads scale_of / alpha_of.
static func animate(panel: Control, open: bool, sound := true) -> void:
	if panel == null:
		return
	var was_open: bool = panel.get_meta("fx_open", panel.visible)
	panel.set_meta("fx_open", open)
	var old = panel.get_meta("fx_tween") if panel.has_meta("fx_tween") else null
	if old is Tween and old.is_valid():
		old.kill()
	if open:
		if not panel.visible:
			panel.set_meta("fx", 0.0)
		panel.visible = true
	if sound and open != was_open:
		swoosh(panel.get_tree(), open)
	if not panel.is_inside_tree():
		panel.set_meta("fx", 1.0 if open else 0.0)
		panel.visible = open
		return
	var tw := panel.create_tween()
	panel.set_meta("fx_tween", tw)
	var from: float = panel.get_meta("fx", 0.0 if open else 1.0)
	if open:
		tw.tween_method(func(v: float): panel.set_meta("fx", v), from, 1.0, OPEN_S).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	else:
		tw.tween_method(func(v: float): panel.set_meta("fx", v), from, 0.0, CLOSE_S).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		tw.tween_callback(func(): if not panel.get_meta("fx_open", false): panel.visible = false)


static func is_open(panel: Control) -> bool:
	return panel != null and bool(panel.get_meta("fx_open", panel.visible))


## The window's scale factor right now (0.86 closed, a touch over 1 mid-overshoot, 1 open).
static func scale_of(panel: Control) -> float:
	return lerpf(0.86, 1.0, float(panel.get_meta("fx", 1.0)))


## Its opacity right now.
static func alpha_of(panel: Control) -> float:
	return clampf(float(panel.get_meta("fx", 1.0)), 0.0, 1.0)


## Places and animates a window. `s` is its scale when open and `top_left`
## where its top-left corner goes then (screen); the pop animation scales it
## around `pivot` (its own corner, in its own unscaled size) inside that spot.
## Without `top_left` (anchored panels) it scales around the pivot where it is.
static func apply(panel: Control, s: float, pivot: Vector2, top_left := Vector2(INF, INF)) -> void:
	var f := scale_of(panel)
	var k := s * f
	panel.pivot_offset = pivot
	panel.scale = Vector2(k, k)
	panel.modulate.a = alpha_of(panel)
	if top_left.x != INF:
		# Visual top-left = position + pivot * (1 - scale); keep the open rect at
		# top_left and shrink it toward pivot (in screen space) while animating.
		panel.position = top_left + pivot * s * (1.0 - f) - pivot * (1.0 - k)


## Frosted glass: the panel's own background shows the world behind it,
## blurred and tinted with the panel colour (borders and corners kept).
static func glass(panel: Control, tint := 0.87) -> void:
	if _glass == null:
		_glass = Shader.new()
		_glass.code = """
shader_type canvas_item;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear;
uniform float tint = 0.8;
uniform float spread = 3.0;
void fragment() {
	vec2 px = SCREEN_PIXEL_SIZE * spread;
	vec3 acc = vec3(0.0);
	float w = 0.0;
	for (int x = -2; x <= 2; x++) {
		for (int y = -2; y <= 2; y++) {
			float k = 1.0 / (1.0 + float(x * x + y * y));
			acc += texture(screen_tex, SCREEN_UV + vec2(float(x), float(y)) * px).rgb * k;
			w += k;
		}
	}
	vec4 c = COLOR; // the style box: panel colour, border, rounded-corner alpha
	COLOR = vec4(mix(acc / w, c.rgb, tint), c.a);
}
"""
	var m := ShaderMaterial.new()
	m.shader = _glass
	m.set_shader_parameter("tint", tint)
	panel.material = m
