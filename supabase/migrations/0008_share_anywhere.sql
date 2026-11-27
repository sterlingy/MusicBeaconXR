-- Sharing anywhere: the lower-48 limit on shared grids, planted songs and maps
-- is lifted (beacons could already be made anywhere on the device). Tiles wrap
-- at the date line, and a grid may touch up to 64 tiles (near the poles a
-- degree of longitude is short).

alter table public.grids drop constraint if exists grids_tiles_check;
alter table public.grids add constraint grids_tiles_check check (cardinality(tiles) between 1 and 64);

-- As 0006, with longitudes wrapped into -180..179 (as shared.js tilesForGrid).
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
      out := out || (a || '_' || (((b + 180) % 360 + 360) % 360 - 180)); -- longitudes wrap at the date line
    end loop;
  end loop;
  return out;
end $$;

-- As 0006, without the lower-48 checks.
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
    new.tiles := grid_tiles(new.center, new.spacing_m, new.half);
  elsif tg_table_name = 'plants' then
    p := point_lat_lon(new.point);
    new.tile := tile_of(p.lat, p.lon);
  elsif tg_table_name = 'maps' then
    new.tiles := '{}';
    for b in select * from jsonb_array_elements(new.beacons) loop
      new.tiles := array(select distinct unnest(new.tiles || tile_of((b->>'lat')::double precision, (b->>'lon')::double precision)));
    end loop;
  elsif tg_table_name = 'songs' then
    if length(new.body::text) > 65536 then raise exception 'a song can be at most 64 KB'; end if;
  end if;
  insert into submission_log (owner, kind) values (who, tg_table_name);
  return new;
end $$;
