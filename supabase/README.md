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
| `0002_submit.sql` | Step 3: signed-in people share their own grids, songs, planted songs and maps after accepting the terms (`consents`). The server forces the owner, rounds the time to the day, recomputes tiles, checks the lower 48, and caps each person per day (5 grids, 20 songs, 20 planted songs, 5 maps, 20 reports; deleting doesn't give the allowance back). `favorites` with public `favorite_counts`; `reports` hide a beacon after 3 different people; `delete_my_account()` removes a person and everything they shared. |

**Checking the rules:** `python tools/pg.py supabase/tests/submit_check.sql` plays signed-in people against them inside a transaction that's rolled back (nothing stays), and ends with `submit_check: OK`.

**Moderation:** `python tools/moderate.py` lists hidden and reported beacons; `restore <kind> <id>` or `delete <kind> <id>` settles one.

`python tools/pg.py -c "select count(*) from public.grids"` runs a single statement.

## How clients read it

The website (`web/src/shared.js`) and the app (`scripts/beacon/shared_map.gd`) fetch the 3 × 3 one-degree tiles around the listener through the REST API with the publishable key:

- `grids?select=id,center,spacing_m,variant,variants,edited,created_at&status=eq.live&tiles=cs.{30_-98}`
- `plants?select=id,point,range_m,song_id,created_at&status=eq.live&tile=eq.30_-98`
- `songs?select=body&status=eq.live&id=eq.<id>`, only when a beacon using it is near

Tiles are cached on the device (IndexedDB on the website, `user://shared/` in the app) and refreshed after an hour; offline, the cache plays.

## Sign-in settings (in the Supabase dashboard)

Sign-in is by email: a link (website) or the 6-digit code from the same email (website and app). Three settings only the project owner can change:

1. **Authentication > Emails > Magic Link template:** add the code, e.g. `<p>Or enter this code: {{ .Token }}</p>`, so the app (which can't open links) can sign in.
2. **Authentication > URL Configuration:** add the website's addresses to **Redirect URLs** (e.g. `http://127.0.0.1:8765/**`, `http://localhost:8765/**` and the published site), so the link comes back to the page.
3. **Authentication > Emails > SMTP:** Supabase's built-in mailer only sends a few emails an hour and, on the free plan, only to the project's team members. Set up your own SMTP before inviting others.
