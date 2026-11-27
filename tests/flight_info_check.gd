extends SceneTree
## The flight info card's words (FlightFollow.summary), from fixed data: route,
## progress, estimated times, altitude and speed in three units, the aircraft,
## and a schedule route the plane isn't flying marked unconfirmed. Plus the
## random-flight filter and hub order (daytime first). Offline.
##   godot --headless --path . -s res://tests/flight_info_check.gd
## With `-- --live` it also picks a real random flight and prints its card.

var failures := 0


func check(ok: bool, what: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: " + what)


func _init() -> void:
	var f := {"flight": "KAL251", "reg": "HL7782", "type": "B77W", "hex": "71be11", "lat": 33.0, "lon": -78.0, "alt_ft": 37000.0,
		"gs_kt": 480.0, "track": 30.0, "vrate": 0.0, "mach": 0.84, "oat": -52.0, "squawk": "2242"}
	var d := {"route": {"callsign_iata": "KE251", "airline": {"name": "Korean Air"},
		"origin": {"municipality": "Miami", "iata_code": "MIA", "latitude": 25.7932, "longitude": -80.2906},
		"destination": {"municipality": "New York", "iata_code": "JFK", "latitude": 40.6398, "longitude": -73.7789}},
		"aircraft": {"manufacturer": "Boeing", "type": "777 300ER", "registered_owner": "Korean Air", "registered_owner_country_name": "South Korea"}}
	var s := FlightFollow.summary(f, d, 1_800_000_000.0, 0.0)
	var text := "\n".join(s.lines)
	print(s.title, "\n", text)
	check(s.title == "✈ KE251 · Korean Air", "title: " + s.title)
	check(s.lines[0] == "Miami (MIA) → New York (JFK)", "route line: " + s.lines[0])
	check(s.progress > 0.4 and s.progress < 0.6, "about halfway (%.2f)" % s.progress)
	check(text.contains("to go · lands about") and text.contains("(estimated)"), "estimated arrival")
	check(text.contains("37,000 ft (11,278 m)"), "altitude in feet and meters")
	check(text.contains("480 kt · 552 mph · 889 km/h · heading NNE · Mach 0.84"), "speed and heading")
	check(text.contains("Boeing 777 300ER · HL7782 · Korean Air · South Korea"), "the aircraft")
	check(text.contains("Outside -52 °C · Squawk 2242"), "extras")
	# The same callsign flying somewhere else entirely: the schedule's route is suspect.
	f.lat = 51.0
	f.lon = 10.0
	var s2 := FlightFollow.summary(f, d, 1_800_000_000.0)
	check(s2.lines[0].ends_with("(route unconfirmed)") and not s2.has("progress"), "a route the plane isn't flying is unconfirmed")
	check(s2.airline == "" and s2.code == "KAL251", "and its airline isn't named (%s, %s)" % [s2.airline, s2.code])
	f.lat = 33.0
	f.lon = -78.0
	f.track = 210.0 # flying away from New York
	check(not FlightFollow.summary(f, d, 1_800_000_000.0).get("plausible", true), "heading away from the destination: unconfirmed")
	f.track = 30.0
	check(FlightFollow.summary({"flight": "ABC1", "lat": 0, "lon": 0, "alt_ft": 0, "gs_kt": 0, "track": 0}, {}, 0.0).lines[0] == "Route not known for ABC1", "no route known")
	# Random flights: cruising only; daytime hubs first.
	check(FlightFollow.is_cruising({"lat": 1, "alt_baro": 35000, "gs": 450, "flight": "DAL1 ", "seen_pos": 2}), "a cruising airliner counts")
	check(not FlightFollow.is_cruising({"lat": 1, "alt_baro": "ground", "gs": 10, "flight": "DAL1"}), "on the ground doesn't")
	check(not FlightFollow.is_cruising({"lat": 1, "alt_baro": 3000, "gs": 150, "flight": "N123"}), "a low, slow plane doesn't")
	var order := FlightFollow.hub_order(1_800_000_000.0) # 08:00 UTC: daytime from Europe to Asia
	var first_lon := float(order[0][1])
	check(first_lon > -40.0, "at 08:00 UTC the first hub is in daylight (lon %.0f)" % first_lon)
	check(order.size() == FlightFollow.HUBS.size(), "every hub is in the order")
	# Tracked: a fresh report, no failed update; out of sight otherwise.
	var ff0 := FlightFollow.new()
	ff0.fix = {"found": true, "hex": "a1b2c3", "at": FlightFollow.now_s(), "seen_pos": 2.0}
	check(ff0.tracked(), "a fresh report: seen")
	ff0.lost = "no update"
	check(not ff0.tracked(), "a failed update: out of sight")
	ff0.lost = ""
	ff0.fix.at = FlightFollow.now_s() - 90.0
	check(not ff0.tracked(), "a report over a minute old: out of sight")
	ff0.free()
	if "--live" in OS.get_cmdline_user_args():
		var ff := FlightFollow.new()
		root.add_child(ff)
		await process_frame
		var why: String = await ff.start_random()
		print("random: ", why if why != "" else FlightFollow.describe(ff.fix))
		if why == "":
			var det := await ff.details(ff.fix)
			var card := FlightFollow.summary(ff.fix, det, FlightFollow.now_s(), Time.get_time_zone_from_system().bias * 60.0)
			print(card.title)
			for l in card.lines:
				print("  ", l)
	print("flight_info_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	quit(0 if failures == 0 else 1)
