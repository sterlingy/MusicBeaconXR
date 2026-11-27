-- Checks the step 3 rules (0002_submit.sql) as signed-in people would hit
-- them, inside one transaction that is ROLLED BACK: no account or row stays.
--   python tools/pg.py supabase/tests/submit_check.sql
-- Ends with "submit_check: OK"; any failed check raises an exception.

begin;

-- Three throwaway people (rolled back at the end).
insert into auth.users (id, aud, role, email, instance_id) values
  ('00000000-0000-4000-8000-00000000c001', 'authenticated', 'authenticated', 'check-a@example.invalid', '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-4000-8000-00000000c002', 'authenticated', 'authenticated', 'check-b@example.invalid', '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-4000-8000-00000000c003', 'authenticated', 'authenticated', 'check-c@example.invalid', '00000000-0000-0000-0000-000000000000');

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated, anon;

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(needle in sqlerrm) = 0 then raise exception 'expected "%", got "%"', needle, sqlerrm; end if;
    return;
  end;
  raise exception 'expected an error containing "%" from: %', needle, sql;
end $$;

do $$
declare
  a text := '00000000-0000-4000-8000-00000000c001';
  b text := '00000000-0000-4000-8000-00000000c002';
  c text := '00000000-0000-4000-8000-00000000c003';
  song jsonb := '{"format":"beacon-song","version":2,"title":"Check","tracks":{}}';
  sid uuid; gid uuid; pid uuid; n int; t timestamptz; tiles text[];
begin
  -- Not signed in: nothing can be written.
  perform set_config('role', 'anon', true);
  perform pg_temp.expect_error($q$insert into public.songs (body) values ('{"format":"beacon-song"}')$q$, 'permission denied');

  -- Signed in, before accepting the terms.
  perform pg_temp.as_user(a);
  perform pg_temp.expect_error(format('insert into public.songs (body) values (%L)', song), 'accept the terms');
  insert into public.consents (terms) values ('2026-11-26 CC BY 4.0');

  -- A song, a grid in Austin, a planted song.
  insert into public.songs (body) values (song) returning id, created_at into sid, t;
  if t <> date_trunc('day', now()) then raise exception 'created_at not rounded to the day: %', t; end if;
  insert into public.grids (center, spacing_m, tiles) values ('g30_3366000_-9412000', 5000, '{"0_0"}') returning id, grids.tiles into gid, tiles;
  if not ('30_-98' = any(tiles)) or '0_0' = any(tiles) then raise exception 'grid tiles not computed by the server: %', tiles; end if;
  insert into public.plants (point, tile, range_m, song_id) values ('g30_3366000_-9412000', '9_9', 500, sid) returning id into pid;
  if (select tile from public.plants where id = pid) <> '30_-98' then raise exception 'plant tile not computed by the server'; end if;
  insert into ids values ('grid', gid), ('plant', pid), ('song', sid);

  -- Anywhere (London) is fine now; and someone else's owner id.
  insert into public.grids (center, spacing_m, tiles) values ('g51_5727300_-8900', 1000, '{x}') returning grids.tiles into tiles;
  if not ('51_-1' = any(tiles) or '51_0' = any(tiles)) then raise exception 'London grid tiles wrong: %', tiles; end if;
  insert into public.maps (name, beacons) values ('Lakeside walk', '[{"id":"m1","lat":30.31,"lon":-97.76,"range_m":800}]');
  perform pg_temp.expect_error('select owner from public.grids', 'permission denied');

  -- The daily limit (5 grids).
  for n in 3..5 loop -- (Austin and London were 1 and 2)
    insert into public.grids (center, spacing_m, tiles) values (format('g30_%s_-9412000', 3366000 + n * 200000), 1000, '{}');
  end loop;
  perform pg_temp.expect_error($q$insert into public.grids (center, spacing_m, tiles) values ('g30_3466000_-9412000', 1000, '{}')$q$, 'daily limit');
  -- Deleting doesn't give the allowance back.
  delete from public.grids where center = 'g30_4366000_-9412000';
  perform pg_temp.expect_error($q$insert into public.grids (center, spacing_m, tiles) values ('g30_3466000_-9412000', 1000, '{}')$q$, 'daily limit');

  -- Someone else can read it, but not delete it.
  perform pg_temp.as_user(b);
  if (select count(*) from public.grids where id = gid) <> 1 then raise exception 'b cannot read a live grid'; end if;
  delete from public.grids where id = gid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'b deleted a grid of a'; end if;

  -- Favorites: counted without names.
  insert into public.favorites (point, beacon) values ('g30_3366000_-9412000', pid::text);
  perform set_config('role', 'anon', true);
  if (select fc.n from public.favorite_counts fc where fc.beacon = pid::text) <> 1 then raise exception 'favorite count'; end if;
  perform pg_temp.expect_error('select user_id from public.favorites', 'permission denied');

  -- Reports: hidden after 3 different people.
  perform pg_temp.as_user(b);
  insert into public.reports (target_kind, target_id, reason) values ('plants', pid, 'spam');
  perform pg_temp.expect_error(format('insert into public.reports (target_kind, target_id, reason) values (%L, %L, %L)', 'plants', pid, 'spam'), 'duplicate');
  perform pg_temp.as_user(c);
  insert into public.reports (target_kind, target_id, reason) values ('plants', pid, 'offensive');
  perform set_config('role', 'anon', true);
  if (select count(*) from public.plants where id = pid) <> 1 then raise exception 'hidden too early'; end if;
  perform pg_temp.as_user(a);
  insert into public.reports (target_kind, target_id, reason) values ('plants', pid, 'other');
  perform set_config('role', 'anon', true);
  if (select count(*) from public.plants where id = pid) <> 0 then raise exception 'not hidden after 3 reports'; end if;

  -- The owner can still unshare it, then delete the whole account.
  perform pg_temp.as_user(a);
  delete from public.plants where id = pid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'owner could not delete their hidden plant'; end if;
  perform public.delete_my_account();
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.grids where id = gid) or exists (select 1 from auth.users where id = a::uuid) then raise exception 'account deletion left data behind'; end if;
  raise notice 'submit_check: OK';
end $$;

rollback;
