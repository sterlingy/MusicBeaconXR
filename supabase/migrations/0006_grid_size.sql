-- Grid size chosen apart from spacing (as the local grid does): `half` is the
-- number of beacons from a grid's center to its edge, so a grid is
-- (2 * half + 1) beacons a side. Older grids are 21 x 21 (half 10), the default.
-- A grid stays within 50 km of its center (100 km a side), so its tiles stay few.

alter table public.grids add column if not exists half integer not null default 10;
alter table public.grids drop constraint if exists grids_half_check;
alter table public.grids add constraint grids_half_check check (half between 1 and 25 and half * spacing_m <= 50000);

-- The 1 degree tiles a grid's outline touches, now for any size (the old
-- two-argument version goes first, so calls aren't ambiguous).
drop function if exists public.grid_tiles(text, int);
create or replace function public.grid_tiles(center text, spacing_m int, half int default 10)
returns text[] language plpgsql immutable as $$
declare
  m text[] := regexp_match(center, '^g(-?[0-9]+)_(-?[0-9]+)_(-?[0-9]+)$');
  mpd double precision := 6371.0088 * 1000 * pi() / 180;
  h double precision := (half + 0.5) * spacing_m;
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

-- Submissions compute a grid's tiles from its size (as 0002, one line changed).
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
    new.tiles := grid_tiles(new.center, new.spacing_m, new.half);
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

grant select (half) on public.grids to anon, authenticated;
grant insert (half) on public.grids to authenticated;
