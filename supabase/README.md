# Supabase: the shared beacon map

The server side of the beacon database ([docs/beacon-database-plan.md](../docs/beacon-database-plan.md)): project `musicbeacon-dev` (us-east-2, free tier).

- **Public settings** (address and publishable key) are in `web/src/config.js` and `scripts/beacon/shared_map.gd`. They're public by design; the per-row security rules below decide what anyone can do.
- **Private credentials** (database address and password, secret key) live only in `.env.supabase` at the repo root, which git ignores. Never commit or print them.
- **`prod-ca-2021.crt`**: Supabase's root certificate. Database connections verify against it.

## Migrations

Applied in order with the repo's own small client (plain Python, no drivers; TLS always verified):

```bash
python tools/pg.py supabase/migrations/0001_shared_map.sql
```

| File | What it does |
|---|---|
| `0001_shared_map.sql` | Step 2, the read side: `songs`, `grids` and `plants`, readable by anyone when live, never writable through the API, and with the `owner` column never readable (so nobody can link one person's beacons into a trail). |

`python tools/pg.py -c "select count(*) from public.grids"` runs a single statement.

## How clients read it

The website (`web/src/shared.js`) and the app (`scripts/beacon/shared_map.gd`) fetch the 3 × 3 one-degree tiles around the listener through the REST API with the publishable key:

- `grids?select=id,center,spacing_m,variant,variants,edited,created_at&status=eq.live&tiles=cs.{30_-98}`
- `plants?select=id,point,range_m,song_id,created_at&status=eq.live&tile=eq.30_-98`
- `songs?select=body&status=eq.live&id=eq.<id>`, only when a beacon using it is near

Tiles are cached on the device (IndexedDB on the website, `user://shared/` in the app) and refreshed after an hour; offline, the cache plays.
