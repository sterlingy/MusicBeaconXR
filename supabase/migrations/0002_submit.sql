-- Beacon database, step 3: submitting and sharing.
-- docs/beacon-database-plan.md. Apply with: python tools/pg.py supabase/migrations/0002_submit.sql
--
-- Decisions (owner, 2026-11-26):
--   sign-in      email (a link or a 6-digit code from the same email)
--   moderation   a beacon hides itself after reports from 3 different people;
--                the owner reviews hidden ones (tools/moderate.py)
--   limits       per person per day: 5 grids, 20 songs, 20 planted songs, 5 maps, 20 reports
--   terms        shared songs are CC BY 4.0; a privacy notice is accepted before the first submit
--   privacy      submit times are stored rounded to the day; owners are never readable
--
-- The server re-checks everything a client could fake except presence
-- (location can't be proven): beacons must be in the lower 48 United States,
-- tiles are computed here, not trusted from the client.

begin;

-- ---------------------------------------------------------------- helpers

-- The lower 48 United States, the same coarse outline as web/src/drafts.js (lon, lat).
create or replace function public.in_lower_48(lat double precision, lon double precision)
returns boolean language plpgsql immutable as $$
declare
  xs double precision[] := array[-124.8,-123.0,-123.3,-95.15,-95.15,-94.8,-94.6,-93.0,-91.0,-89.5,-88.0,-84.6,-84.4,-83.5,-82.4,-83.1,-82.7,-79.0,-79.0,-76.3,-74.7,-71.5,-71.1,-70.3,-70.0,-69.2,-68.2,-67.8,-67.8,-67.4,-67.0,-69.0,-70.7,-70.8,-69.9,-69.9,-71.5,-71.9,-73.9,-74.0,-74.9,-75.1,-75.7,-75.5,-76.5,-78.0,-79.2,-80.8,-81.4,-80.6,-80.0,-80.1,-80.3,-81.2,-82.0,-81.9,-81.3,-82.8,-82.7,-83.7,-84.4,-85.4,-86.5,-88.0,-89.4,-89.2,-90.5,-92.0,-93.8,-94.8,-96.4,-97.2,-97.4,-97.2,-98.2,-99.1,-99.5,-100.3,-100.8,-101.4,-102.4,-103.0,-103.3,-104.5,-104.9,-106.5,-108.2,-108.2,-111.1,-114.8,-114.7,-117.1,-117.3,-118.4,-119.5,-120.6,-121.9,-122.5,-123.0,-123.8,-124.4,-124.2,-124.6,-123.9,-124.1,-124.7];
  ys double precision[] := array[48.4,48.3,49.0,49.0,49.38,49.3,48.7,48.6,48.2,48.0,48.3,46.7,46.5,46.0,43.0,42.3,41.7,42.8,43.3,44.2,45.0,45.0,45.3,45.9,46.7,47.45,47.35,47.07,45.7,45.2,44.8,43.8,43.0,42.2,42.0,41.3,41.2,41.0,40.5,39.6,38.9,38.3,37.0,35.2,34.6,33.8,33.1,32.0,30.7,28.4,26.7,25.3,24.9,24.5,24.45,24.75,25.8,27.8,29.0,29.9,29.9,29.7,30.4,30.2,30.1,29.1,29.0,29.5,29.7,29.3,28.3,27.6,26.0,25.9,26.1,26.5,27.5,28.3,29.3,29.8,29.8,29.0,29.0,29.6,30.6,31.8,31.8,31.33,31.33,32.5,32.72,32.53,33.2,33.7,34.4,34.5,36.3,37.5,38.0,39.8,40.4,42.0,42.8,46.2,47.0,48.0];
  n int := array_length(xs, 1);
  inside boolean := false;
  i int;
  j int := n;
begin
  for i in 1..n loop
    if ((ys[i] > lat) <> (ys[j] > lat)) and (lon < (xs[j] - xs[i]) * (lat - ys[i]) / (ys[j] - ys[i]) + xs[i]) then
      inside := not inside;
    end if;
    j := i;
  end loop;
  return inside;
end $$;

-- A lattice point id ("g<band>_<I>_<J>") as lat/lon, the same as drafts.js parsePoint.
create or replace function public.point_lat_lon(pt text, out lat double precision, out lon double precision)
language plpgsql immutable as $$
declare
  m text[] := regexp_match(pt, '^g(-?[0-9]+)_(-?[0-9]+)_(-?[0-9]+)$');
  mpd double precision := 6371.0088 * 1000 * pi() / 180;
begin
  if m is null then raise exception 'not a lattice point: %', pt; end if;
  lat := m[2]::double precision / mpd;
  lon := m[3]::double precision / (cos(radians(m[1]::double precision)) * mpd);
end $$;

create or replace function public.tile_of(lat double precision, lon double precision)
returns text language sql immutable as $$ select floor(lat)::int || '_' || floor(lon)::int $$;

-- The 1 degree tiles a grid's outline touches (as shared.js tilesForGrid; lower 48 only, so no date line).
create or replace function public.grid_tiles(center text, spacing_m int)
returns text[] language plpgsql immutable as $$
declare
  m text[] := regexp_match(center, '^g(-?[0-9]+)_(-?[0-9]+)_(-?[0-9]+)$');
  mpd double precision := 6371.0088 * 1000 * pi() / 180;
  h double precision := 10.5 * spacing_m;
  i0 double precision := m[2]::double precision;
  j0 double precision := m[3]::double precision;
  cb double precision := cos(radians(m[1]::double precision)) * mpd;
  out text[] := '{}';
  a int; b int;
begin
  for a in floor((i0 - h) / mpd)::int .. floor((i0 + h) / mpd)::int loop
    for b in floor((j0 - h) / cb)::int .. floor((j0 + h) / cb)::int loop
      out := out || (a || '_' || b);
    end loop;
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------- consent, limits

create table if not exists public.consents (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  terms text not null, -- which terms were accepted, e.g. "2026-11-26 CC BY 4.0"
  accepted_at timestamptz not null default now()
);
alter table public.consents enable row level security;
drop policy if exists "own consent" on public.consents;
create policy "own consent" on public.consents for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert on public.consents to authenticated;

-- One row per submission, never deletable by users, so limits can't be dodged by deleting.
create table if not exists public.submission_log (
  owner uuid not null references auth.users on delete cascade,
  kind text not null,
  day date not null default current_date
);
create index if not exists submission_log_owner_day on public.submission_log (owner, day);
alter table public.submission_log enable row level security; -- no policies: nobody reads or writes it through the API

create or replace function public.check_submission() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lim int := case tg_table_name when 'grids' then 5 when 'songs' then 20 when 'plants' then 20 when 'maps' then 5 when 'reports' then 20 else 0 end;
  who uuid := auth.uid();
  used int;
  p record;
  b jsonb;
begin
  if who is null then raise exception 'sign in to share beacons'; end if;
  if tg_table_name = 'reports' then
    new.reporter := who;
  else
    new.owner := who;
    if not exists (select 1 from consents where user_id = who) then raise exception 'accept the terms before sharing'; end if;
    new.created_at := date_trunc('day', now()); -- rounded to the day, for privacy
    new.status := 'live';
  end if;
  select count(*) into used from submission_log where owner = who and kind = tg_table_name and day = current_date;
  if used >= lim then raise exception 'daily limit reached: % % a day', lim, tg_table_name; end if;
  if tg_table_name = 'grids' then
    p := point_lat_lon(new.center);
    if not in_lower_48(p.lat, p.lon) then raise exception 'for now, beacons can only be shared in the lower 48 United States'; end if;
    new.tiles := grid_tiles(new.center, new.spacing_m);
  elsif tg_table_name = 'plants' then
    p := point_lat_lon(new.point);
    if not in_lower_48(p.lat, p.lon) then raise exception 'for now, beacons can only be shared in the lower 48 United States'; end if;
    new.tile := tile_of(p.lat, p.lon);
  elsif tg_table_name = 'maps' then
    new.tiles := '{}';
    for b in select * from jsonb_array_elements(new.beacons) loop
      if not in_lower_48((b->>'lat')::double precision, (b->>'lon')::double precision) then
        raise exception 'for now, map beacons can only be shared in the lower 48 United States';
      end if;
      new.tiles := array(select distinct unnest(new.tiles || tile_of((b->>'lat')::double precision, (b->>'lon')::double precision)));
    end loop;
  elsif tg_table_name = 'songs' then
    if length(new.body::text) > 65536 then raise exception 'a song can be at most 64 KB'; end if;
  end if;
  insert into submission_log (owner, kind) values (who, tg_table_name);
  return new;
end $$;

-- ---------------------------------------------------------------- shared maps

create table if not exists public.maps (
  id uuid primary key default gen_random_uuid(),
  owner uuid default auth.uid() references auth.users on delete cascade,
  name text not null check (length(name) between 1 and 60),
  exclusive boolean not null default false,
  -- [{id, lat, lon, range_m, seed? , song_id?}], at most 200
  beacons jsonb not null check (jsonb_typeof(beacons) = 'array' and jsonb_array_length(beacons) between 1 and 200),
  tiles text[] not null default '{}',
  created_at timestamptz not null default now(),
  status text not null default 'live' check (status in ('live', 'hidden'))
);
create index if not exists maps_tiles on public.maps using gin (tiles) where status = 'live';
alter table public.maps enable row level security;
drop policy if exists "live maps are public" on public.maps;
create policy "live maps are public" on public.maps for select to anon, authenticated using (status = 'live');

-- ---------------------------------------------------------------- writing: own rows only

do $$
declare t text;
begin
  foreach t in array array['songs', 'grids', 'plants', 'maps'] loop
    execute format('drop trigger if exists check_submission on public.%I', t);
    execute format('create trigger check_submission before insert on public.%I for each row execute function public.check_submission()', t);
    execute format('drop policy if exists "share your own" on public.%I', t);
    execute format('create policy "share your own" on public.%I for insert to authenticated with check (owner = auth.uid())', t);
    execute format('drop policy if exists "see your own" on public.%I', t);
    execute format('create policy "see your own" on public.%I for select to authenticated using (owner = auth.uid())', t);
    execute format('drop policy if exists "unshare your own" on public.%I', t);
    execute format('create policy "unshare your own" on public.%I for delete to authenticated using (owner = auth.uid())', t);
    execute format('grant delete on public.%I to authenticated', t);
  end loop;
end $$;

grant insert (body) on public.songs to authenticated;
grant insert (center, spacing_m, variant, variants, edited, tiles) on public.grids to authenticated;
grant insert (point, tile, range_m, song_id) on public.plants to authenticated;
grant insert (name, exclusive, beacons) on public.maps to authenticated;
grant select (id, name, exclusive, beacons, tiles, created_at, status) on public.maps to anon, authenticated;

-- ---------------------------------------------------------------- favorites

create table if not exists public.favorites (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  point text not null,  -- one favorite per spot per person
  beacon text not null, -- the shared beacon: a plant's or map beacon's id, or "<grid id>/<point>"
  created_at timestamptz not null default now(),
  primary key (user_id, point)
);
alter table public.favorites enable row level security;
drop policy if exists "own favorites" on public.favorites;
create policy "own favorites" on public.favorites for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.favorites to authenticated;

-- How many people favorited each beacon (no one's identity).
create or replace view public.favorite_counts as select beacon, count(*)::int as n from public.favorites group by beacon;
grant select on public.favorite_counts to anon, authenticated;

-- ---------------------------------------------------------------- reports and moderation

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null default auth.uid() references auth.users on delete cascade,
  target_kind text not null check (target_kind in ('grids', 'plants', 'maps', 'songs')),
  target_id uuid not null,
  reason text not null check (reason in ('offensive', 'spam', 'unsafe place', 'private place', 'other')),
  note text check (length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (reporter, target_kind, target_id)
);
alter table public.reports enable row level security;
drop policy if exists "report" on public.reports;
create policy "report" on public.reports for insert to authenticated with check (reporter = auth.uid());
drop policy if exists "see your reports" on public.reports;
create policy "see your reports" on public.reports for select to authenticated using (reporter = auth.uid());
grant insert (target_kind, target_id, reason, note) on public.reports to authenticated;
grant select (id, target_kind, target_id, reason, created_at) on public.reports to authenticated;
drop trigger if exists check_submission on public.reports;
create trigger check_submission before insert on public.reports for each row execute function public.check_submission();

-- After reports from 3 different people, the beacon hides until the owner reviews it.
create or replace function public.hide_reported() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(distinct reporter) from reports where target_kind = new.target_kind and target_id = new.target_id) >= 3 then
    execute format('update public.%I set status = ''hidden'' where id = $1', new.target_kind) using new.target_id;
  end if;
  return new;
end $$;
drop trigger if exists hide_reported on public.reports;
create trigger hide_reported after insert on public.reports for each row execute function public.hide_reported();

-- ---------------------------------------------------------------- deleting your data

-- Deletes the signed-in person's account and everything they shared, favorited and reported.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Helpers are for the server's own checks.
revoke all on function public.check_submission() from public, anon, authenticated;
revoke all on function public.hide_reported() from public, anon, authenticated;

commit;
