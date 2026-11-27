-- A random flight in the air, anywhere in the world, for the website's
-- "Random" button. Apply with: python tools/pg.py supabase/migrations/0005_flight_random.sql
--
-- adsb.lol (ODbL 1.0) lists every aircraft within 250 nautical miles of a
-- point. This asks around one of 46 busy hubs on every continent, keeps the
-- planes cruising (18,000 ft and up, 250 kt and up, with a callsign), and
-- returns one at random, airliners first (categories A3-A5). Hubs where it's
-- daytime are tried first, so a quiet night here still finds a plane over the
-- other side of the world. Each hub's list is cached for 5 minutes and
-- upstream calls keep flight_lookup's 1.5-second spacing; one upstream call
-- per request at most (anonymous requests have 3 seconds), so a quiet hub
-- answers {found: false, retry: true} and the next request tries another.
-- The page then follows the plane by its transponder code (flight_lookup).
-- Same hubs and rules as scripts/beacon/flight_follow.gd for the app.

begin;

create or replace function public.flight_random()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  hubs float8[][] := array[
    [33.64, -84.43], [41.98, -87.9], [32.9, -97.04], [39.86, -104.67], [33.94, -118.4], [40.64, -73.78],
    [47.45, -122.31], [25.79, -80.29], [43.68, -79.63], [19.44, -99.07], [61.17, -150.0], [21.32, -157.92],
    [4.7, -74.15], [-12.02, -77.11], [-33.39, -70.79], [-34.82, -58.54], [-23.43, -46.47], [-22.81, -43.25],
    [51.47, -0.45], [50.03, 8.57], [52.31, 4.76], [49.01, 2.55], [40.47, -3.56], [41.8, 12.25], [41.26, 28.74],
    [55.97, 37.41], [30.12, 31.41], [6.58, 3.32], [-1.32, 36.93], [-26.14, 28.24], [25.25, 55.36], [25.27, 51.61],
    [28.56, 77.1], [19.09, 72.87], [13.69, 100.75], [2.75, 101.71], [1.36, 103.99], [-6.13, 106.66], [22.31, 113.91],
    [31.14, 121.81], [40.08, 116.6], [37.46, 126.44], [35.55, 139.78], [-33.94, 151.18], [-37.67, 144.84], [-37.0, 174.79]];
  utc_h float8 := extract(epoch from now()) / 3600.0;
  i int;
  qk text;
  cached private.flight_cache;
  last timestamptz;
  key text;
  res extensions.http_response;
  body jsonb;
  pool jsonb;
  pick jsonb;
begin
  -- Hubs in daytime first (local solar hour 7-22), shuffled; then the rest.
  for i in
    select h from generate_subscripts(hubs, 1) h
    order by (mod((utc_h + hubs[h][2] / 15.0)::numeric + 48, 24) between 7 and 22) desc, random()
  loop
    qk := 'point:' || i;
    select * into cached from private.flight_cache where flight_cache.q = qk;
    if found and cached.fetched_at > now() - interval '5 minutes' then
      if jsonb_array_length(cached.body) > 0 then
        pick := cached.body -> floor(random() * jsonb_array_length(cached.body))::int;
        return pick || jsonb_build_object('found', true);
      end if;
      continue; -- quiet a moment ago: try another hub
    end if;
    -- One upstream call per request, spaced like flight_lookup's.
    select max(fetched_at) into last from private.flight_cache;
    if last is not null and last > now() - interval '1.5 seconds' then
      return jsonb_build_object('found', false, 'reason', 'Busy: try again in a moment.', 'retry', true);
    end if;
    select value into key from private.settings where settings.key = 'adsb_key';
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '2500');
    perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '1500');
    begin
      select * into res from extensions.http((
        'GET', 'https://api.adsb.lol/v2/point/' || hubs[i][1] || '/' || hubs[i][2] || '/250',
        case when key is null then array[extensions.http_header('User-Agent', 'MusicBeaconXR')] else array[extensions.http_header('User-Agent', 'MusicBeaconXR'), extensions.http_header('x-api-key', key)] end,
        null, null)::extensions.http_request);
    exception when others then
      return jsonb_build_object('found', false, 'reason', 'The flight data service didn''t answer in time. Try again in a moment.', 'retry', true);
    end;
    if res.status = 429 then return jsonb_build_object('found', false, 'reason', 'The flight data service is busy (daily limit). Try again later.', 'retry', false); end if;
    if res.status <> 200 then return jsonb_build_object('found', false, 'reason', 'The flight data service didn''t answer (' || res.status || ').', 'retry', true); end if;
    body := res.content::jsonb;
    -- Cruising planes, airliners first; at most 60 kept.
    select coalesce(jsonb_agg(f order by big desc, random()), '[]'::jsonb) into pool from (
      select jsonb_build_object('reg', x->>'r', 'flight', trim(x->>'flight'), 'type', x->>'t', 'hex', x->>'hex',
          'lat', (x->>'lat')::float, 'lon', (x->>'lon')::float, 'alt_ft', (x->>'alt_baro')::float,
          'gs_kt', (x->>'gs')::float, 'track', (x->>'track')::float, 'seen_pos', coalesce((x->>'seen_pos')::float, 0),
          'squawk', x->>'squawk', 'vrate', (x->>'baro_rate')::float, 'mach', (x->>'mach')::float, 'oat', (x->>'oat')::float,
          'category', x->>'category', 'at', (body->>'now')::float / 1000.0) as f,
        (x->>'category') in ('A3', 'A4', 'A5') as big
      from jsonb_array_elements(coalesce(body->'ac', '[]')) x
      where x ? 'lat' and jsonb_typeof(x->'alt_baro') = 'number' and (x->>'alt_baro')::float >= 18000
        and coalesce((x->>'gs')::float, 0) >= 250 and length(trim(coalesce(x->>'flight', ''))) >= 3
        and coalesce((x->>'seen_pos')::float, 99) < 30
      limit 60) c;
    -- Airliners only, when there are any.
    if exists (select 1 from jsonb_array_elements(pool) p where p->>'category' in ('A3', 'A4', 'A5')) then
      select jsonb_agg(p) into pool from jsonb_array_elements(pool) p where p->>'category' in ('A3', 'A4', 'A5');
    end if;
    insert into private.flight_cache (q, body, fetched_at) values (qk, pool, now())
      on conflict (q) do update set body = excluded.body, fetched_at = excluded.fetched_at;
    if jsonb_array_length(pool) > 0 then
      return (pool -> floor(random() * jsonb_array_length(pool))::int) || jsonb_build_object('found', true);
    end if;
    return jsonb_build_object('found', false, 'reason', 'Quiet skies there: trying elsewhere.', 'retry', true);
  end loop;
  return jsonb_build_object('found', false, 'reason', 'No flights found right now. Try again in a moment.', 'retry', false);
end $$;

revoke all on function public.flight_random() from public;
grant execute on function public.flight_random() to anon, authenticated;

commit;
