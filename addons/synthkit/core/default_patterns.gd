class_name DefaultPatterns
extends RefCounted
## Starter patterns so pressing Play does something musical on each instrument.


static func for_instrument(type: String) -> Dictionary:
	var pat := []
	for i in 16:
		pat.append({"notes": {}, "gate": 0.5, "accent": false, "slide": false})
	match type:
		"Pulsar":
			for i in 16:
				if i % 4 == 0:
					pat[i].notes["36"] = 0.95
				if i == 4 or i == 12:
					pat[i].notes["38"] = 0.9
				if i % 2 == 0:
					pat[i].notes["42"] = 0.6 if i % 4 else 0.8
			pat[14].notes["46"] = 0.7
			pat[10].notes["36"] = 0.7
		"Undertow":
			var line := [36, -1, 36, 48, -1, 36, 39, -1, 36, -1, 36, 46, 43, -1, 41, 39]
			for i in 16:
				if line[i] >= 0:
					pat[i].notes[str(line[i])] = 0.85
					pat[i].accent = i % 4 == 0
			pat[11].slide = true
	return {"steps": 16, "division": 0.25, "swing": 0.0, "enabled": true, "pattern": pat}
