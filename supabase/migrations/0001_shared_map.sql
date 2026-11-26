-- Beacon database, step 2: the shared map's read side.
-- docs/beacon-database-plan.md. Apply with: python tools/pg.py supabase/migrations/0001_shared_map.sql
--
-- Everyone (signed in or not) can read live grids, planted songs and songs.
-- Nobody can write through the API yet: submitting comes in step 3, with
-- sign-in, limits and moderation. The owner columns are never readable
-- through the API, so nobody can link one person's beacons into a trail of
-- where they've been.
--
-- Rows mirror the app's and website's "beacon-drafts" format:
--   grids:  a generated grid. Its 441 beacons aren't stored; the client
--           rebuilds them from center + spacing + seed variants, exactly as
--           for a draft. Edited songs are referenced by song id.
--   plants: one hand-made song on a 100 m lattice point, with a range.
--   songs:  full song JSON (beacon-song v2), loaded only when in range.
-- `tiles` / `tile` are the 1 degree tiles ("<floor lat>_<floor lon>") a row
-- touches, which is how clients fetch what's around them.

begin;

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  owner uuid default auth.uid() references auth.users on delete cascade,
  body jsonb not null check (jsonb_typeof(body) = 'object' and body->>'format' = 'beacon-song'),
  created_at timestamptz not null default now(),
  status text not null default 'live' check (status in ('live', 'hidden'))
);

create table if not exists public.grids (
  id uuid primary key default gen_random_uuid(),
  owner uuid default auth.uid() references auth.users on delete cascade,
  center text not null check (center ~ '^g-?[0-9]+_-?[0-9]+_-?[0-9]+$'),
  spacing_m integer not null check (spacing_m in (100, 200, 500, 1000, 2000, 5000)),
  variant integer not null default 0 check (variant >= 0),
  variants jsonb not null default '{}' check (jsonb_typeof(variants) = 'object'),
  edited jsonb not null default '{}' check (jsonb_typeof(edited) = 'object'), -- point id -> song id
  tiles text[] not null check (cardinality(tiles) between 1 and 16),
  created_at timestamptz not null default now(),
  status text not null default 'live' check (status in ('live', 'hidden'))
);

create table if not exists public.plants (
  id uuid primary key default gen_random_uuid(),
  owner uuid default auth.uid() references auth.users on delete cascade,
  point text not null check (point ~ '^g-?[0-9]+_-?[0-9]+_-?[0-9]+$'),
  tile text not null check (tile ~ '^-?[0-9]+_-?[0-9]+$'),
  range_m integer not null check (range_m between 100 and 10000),
  song_id uuid not null references public.songs on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'live' check (status in ('live', 'hidden'))
);

create index if not exists grids_tiles on public.grids using gin (tiles) where status = 'live';
create index if not exists plants_tile on public.plants (tile) where status = 'live';

alter table public.songs enable row level security;
alter table public.grids enable row level security;
alter table public.plants enable row level security;

drop policy if exists "live songs are public" on public.songs;
create policy "live songs are public" on public.songs for select to anon, authenticated using (status = 'live');
drop policy if exists "live grids are public" on public.grids;
create policy "live grids are public" on public.grids for select to anon, authenticated using (status = 'live');
drop policy if exists "live plants are public" on public.plants;
create policy "live plants are public" on public.plants for select to anon, authenticated using (status = 'live');

-- Column-level: everything but `owner` is readable; nothing is writable yet.
revoke all on public.songs, public.grids, public.plants from anon, authenticated;
grant select (id, body, created_at, status) on public.songs to anon, authenticated;
grant select (id, center, spacing_m, variant, variants, edited, tiles, created_at, status) on public.grids to anon, authenticated;
grant select (id, point, tile, range_m, song_id, created_at, status) on public.plants to anon, authenticated;

commit;
