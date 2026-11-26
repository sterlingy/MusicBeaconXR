# Beacon database plan

People add beacons to the world: generated grids and songs they make, wherever they are, and everyone hears them as they travel. This file is the agreed design and the build order. Decisions were made with the project owner in November 2026; anything marked *open* still needs their call.

## What people can do

- **Where:** creating beacons happens on the **Globe** tab, **only where you physically are** (GPS), and for now **only in the lower 48 United States**. Listening works everywhere.
- **Generate a grid** at your location: a spacing from **0.1 to 5 km**, with the size capped to match (for example 100 km a side at 5 km spacing is 21 × 21 = 441 beacons). When you walk out of your grid, the app offers to **generate more**: the next grid along, on the same lattice and spacing.
- **Regenerate** all of a grid's songs, or one selected beacon's song.
- **Plant a song:** put a single beacon with a song you made at your location, with a **range** (500 m by default, 10 km at most).
- **My grids:** your own list of generated grids and custom maps. You can turn each on or off (several at once, merged into one pool, each in its own tint), open, rename, duplicate, delete, export, import, jump to it, submit or share.
- **Custom maps:** your own named map, with beacons placed freely at exact GPS spots and no lattice. Only the owner edits it, from anywhere. Shared maps are publicly listed. A map **blends** with everything else by default; its owner can make it **exclusive**, so only the map plays and you hear silence off its route. An exclusive map that's on overrides other layers.
- **Favorites:** favorite a song on a beacon. The song panel shows how many times a song has been favorited.
- **Several songs at one spot:** every song planted on the same 100 m point is kept, up to about 20. The listener chooses what plays: **random, favorite** (your own favorite), **owned, original** (first planted) or **latest**. "Random" rotates daily and is the same for everyone at the spot.

## How it sounds

- **Two layers, crossfaded.** The **global layer** (today's 10° globe beacons) always reaches. **User beacons** have a range and blend nearest-3 among themselves. Toward the edge of their range they fade out and the global layer fades in, so there are no jumps.
- **Range:** equal to the spacing for generated grids, or chosen by the person planting a single song.
- **Status line** in the song panel: which sources you're hearing and how much of each. For example "Global 100%", "User 70% · Global 30%", "Lakeside walk 60% · User 25% · Global 15%", or "Lakeside walk (exclusive) · outside".
- **No sound history for now.** Instrument and mix improvements apply to every song, like a remaster. Song length stays 2 to 5 minutes.

## Technical decisions

- **Lattice, option A:** every beacon snaps to a **100 m** lattice, built on the existing worldwide 1 m local-grid lattice. The column spacing uses the whole degree of latitude of the **beacon's own row**, so every point has exactly one id for everyone. There's a slight seam every 1° of latitude. 5 km grid points are also 100 m points.
- **What's stored:** a generated beacon stores just its **seed variant** ("song 3 of this beacon"), a few bytes. A hand-made song stores its **full song JSON**, about 15 KB.
- **Reading while traveling:** the world is split into **1° tiles**. As you move, the app fetches the tiles around you and caches them. Each tile has a light beacon index (positions, ranges, song references), and song bodies load only when a beacon is in range. Offline, or anything missing, falls back to the global layer.
- **Same code on both platforms.** The app (GDScript) and the website (JavaScript) share data formats and are kept identical by test fixtures, as the song generator (`scripts/beacon/song_gen.gd`) and the local grid already are.
- **Storage on the device:** IndexedDB on the website, a JSON file under `user://` in the app, in one format, so export and import work across platforms.
- **Server:** Supabase, project `musicbeacon-dev`, region us-east-2, free tier. The public address and publishable key ship in the app and website; per-row security rules protect the data. Private credentials live only in `.env.supabase` (git-ignored). Supabase's root certificate is `supabase/prod-ca-2021.crt`, and connections must verify it. The owner also has their own server, an option for self-hosting later.

## Build order

1. **Drafts on the device, no server.** Website first, then the app.
   - My grids; Generate (with the lower-48 and GPS check) and "generate more".
   - Regenerate; Plant (on the website from its song editor; in the app with generated songs until it has an editor).
   - Custom maps; the two-layer crossfade; play modes; favorites; the status line.
2. **Reading the shared map.** 1° tiles fetched and cached while traveling, in the app and the website.
3. **Submitting and sharing.** Supabase tables and per-row security rules; sign-in; submit grids and songs; share custom maps; favorite counts; moderation and limits; the server also checks the lower-48 rule.

## Open decisions (for step 3)

- **Sign-in:** Google (needs an app ID the owner creates in Google's developer console), email link, or anonymous device accounts.
- **Moderation:** who removes reported beacons, and limits per person per day.
- **Terms and privacy policy:** licensing of shared songs, the fact that planted beacons reveal places, and deleting your data.
- **Song editor in the app,** or plant hand-made songs from the website only at first.
- **Browsing** submitted beacons and public maps on a map or list.
- **Location checks** happen only on the phone and can be faked, so rely on limits, reports and moderation.
