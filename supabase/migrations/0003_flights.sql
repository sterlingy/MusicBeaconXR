-- Following a flight: the listener rides along with a real aircraft.
-- Apply with: python tools/pg.py supabase/migrations/0003_flights.sql
--
-- Live positions come from adsb.lol (ODbL 1.0, https://adsb.lol), which
-- doesn't allow calls from web pages (no CORS), so the website asks this
-- function instead and the database fetches it. Answers are cached for 10
-- seconds per aircraft (everyone following the same flight shares one
-- request) and upstream calls are spaced at least 1.5 seconds apart overall,
-- because the free tier allows 500 requests a day per IP and the database is
-- one IP. With a free adsb.lol key (1,000 a day) or a feeder key (7,200 a
-- day), put it in private.settings:
--   insert into private.settings values ('adsb_key', '<key>')
--   on conflict (key) do update set value = excluded.value;
-- It never leaves the database.

begin;

create extension if not exists http with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.settings (key text primary key, value text not null);
create table if not exists private.flight_cache (
  q text primary key,      -- what was asked, normalized ("reg:N733YX", "callsign:UAL123", "hex:a1b2c3")
  body jsonb not null,     -- the answer we return
  fetched_at timestamptz not null default now()
);

-- One aircraft by tail number (registration), flight number (callsign) or
-- transponder hex code. Returns {found, reg, flight, type, hex, lat, lon,
-- alt_ft, gs_kt, track, seen_pos, at} or {found: false, reason}.
create or replace function public.flight_lookup(query text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  qn text := upper(regexp_replace(coalesce(query, ''), '[^A-Za-z0-9-]', '', 'g'));
  kinds text[];
  kind text;
  key text;
  cached private.flight_cache;
  res extensions.http_response;
  body jsonb;
  a jsonb;
  out jsonb;
  last timestamptz;
  have boolean;
begin
  if length(qn) < 2 or length(qn) > 10 then return jsonb_build_object('found', false, 'reason', 'Type a tail number (like N733YX) or a flight number (like UAL123).'); end if;
  -- Six hex digits may be a transponder code; three letters then digits is usually a flight number.
  kinds := case
    when qn ~ '^[0-9A-F]{6}$' and qn !~ '^N' then array['hex', 'reg']
    when qn ~ '^[A-Z]{3}[0-9]{1,4}[A-Z]?$' then array['callsign', 'reg']
    else array['reg', 'callsign'] end;
  foreach kind in array kinds loop
    select * into cached from private.flight_cache where flight_cache.q = kind || ':' || qn;
    have := found;
    if have and cached.fetched_at > now() - interval '10 seconds' then
      if (cached.body->>'found')::boolean then return cached.body; end if;
      continue;
    end if;
    -- Space upstream calls out (the free tier is per IP, and this is one IP).
    select max(fetched_at) into last from private.flight_cache;
    if last is not null and last > now() - interval '1.5 seconds' then
      if have then return cached.body; end if;
      if out is not null then return out; end if; -- the other kind of lookup already said "not found"
      return jsonb_build_object('found', false, 'reason', 'Busy: try again in a moment.', 'retry', true);
    end if;
    select value into key from private.settings where settings.key = 'adsb_key';
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '6000');
    select * into res from extensions.http((
      'GET',
      'https://api.adsb.lol/v2/' || kind || '/' || (case when kind = 'hex' then lower(qn) else qn end),
      case when key is null then array[extensions.http_header('User-Agent', 'MusicBeaconXR')] else array[extensions.http_header('User-Agent', 'MusicBeaconXR'), extensions.http_header('x-api-key', key)] end,
      null, null)::extensions.http_request);
    if res.status = 429 then return jsonb_build_object('found', false, 'reason', 'The flight data service is busy (daily limit). Try again later.', 'retry', true); end if;
    if res.status <> 200 then return jsonb_build_object('found', false, 'reason', 'The flight data service didn''t answer (' || res.status || ').', 'retry', true); end if;
    body := res.content::jsonb;
    a := (select x from jsonb_array_elements(coalesce(body->'ac', '[]')) x where x ? 'lat' order by (x->>'seen_pos')::float nulls last limit 1);
    if a is null then
      out := jsonb_build_object('found', false, 'reason', qn || ' isn''t sending its position right now (on the ground, out of coverage, or not found).');
    else
      out := jsonb_build_object('found', true, 'reg', a->>'r', 'flight', trim(a->>'flight'), 'type', a->>'t', 'hex', a->>'hex',
        'lat', (a->>'lat')::float, 'lon', (a->>'lon')::float,
        'alt_ft', case when a->>'alt_baro' = 'ground' then 0 else (a->>'alt_baro')::float end,
        'gs_kt', (a->>'gs')::float, 'track', (a->>'track')::float, 'seen_pos', coalesce((a->>'seen_pos')::float, 0),
        'at', (body->>'now')::float / 1000.0);
    end if;
    delete from private.flight_cache where fetched_at < now() - interval '1 hour'; -- keep it small
    insert into private.flight_cache (q, body, fetched_at) values (kind || ':' || qn, out, now())
      on conflict (q) do update set body = excluded.body, fetched_at = excluded.fetched_at;
    if (out->>'found')::boolean then return out; end if;
  end loop;
  return out;
end $$;

revoke all on function public.flight_lookup(text) from public;
grant execute on function public.flight_lookup(text) to anon, authenticated;

commit;
