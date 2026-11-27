class_name BuildInfo
extends RefCounted
## Shown at the bottom of the Fields panel, so it's clear which build is installed.
## Updated before each APK export.

const BUILD := "2026-11-27 09:42"


## Phones and tablets: Android or iOS (not touchscreen laptops). Dev: --phone lays out as a phone.
static func is_phone() -> bool:
	return OS.get_name() in ["Android", "iOS"] or OS.has_feature("mobile") or "--phone" in OS.get_cmdline_user_args()
