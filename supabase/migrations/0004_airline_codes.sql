-- Following a flight: accept flight numbers as printed on tickets.
-- Apply with: python tools/pg.py supabase/migrations/0004_airline_codes.sql
--
-- Tickets use two-letter IATA airline codes (DL934); planes broadcast the
-- three-letter ICAO code (DAL934). flight_lookup now turns a two-letter code
-- it knows into the ICAO one and tries that callsign first. The same table is
-- in scripts/beacon/flight_follow.gd for the app.

begin;

create table if not exists private.airline_codes (iata text primary key, icao text not null);
insert into private.airline_codes (iata, icao) values
  -- United States and Canada
  ('AA','AAL'),('DL','DAL'),('UA','UAL'),('WN','SWA'),('B6','JBU'),('AS','ASA'),('NK','NKS'),('F9','FFT'),
  ('G4','AAY'),('HA','HAL'),('SY','SCX'),('MX','MXY'),('XP','VXP'),('QX','QXE'),('OO','SKW'),('YX','RPA'),
  ('9E','EDV'),('MQ','ENY'),('OH','JIA'),('PT','PDT'),('ZW','AWI'),('C5','UCA'),('G7','GJS'),('YV','ASH'),
  ('AC','ACA'),('WS','WJA'),('TS','TSC'),('PD','POE'),('F8','FLE'),('WG','SWG'),
  ('FX','FDX'),('5X','UPS'),('5Y','GTI'),('K4','CKS'),('3S','PAC'),
  -- Latin America
  ('AM','AMX'),('Y4','VOI'),('VB','VIV'),('CM','CMP'),('AV','AVA'),('LA','LAN'),('JJ','TAM'),('G3','GLO'),
  ('AD','AZU'),('AR','ARG'),('H2','SKU'),('B7','UIA'),
  -- Europe
  ('BA','BAW'),('VS','VIR'),('U2','EZY'),('FR','RYR'),('LH','DLH'),('AF','AFR'),('KL','KLM'),('IB','IBE'),
  ('VY','VLG'),('LX','SWR'),('OS','AUA'),('SN','BEL'),('SK','SAS'),('AY','FIN'),('DY','NOZ'),('D8','IBK'),
  ('EI','EIN'),('TP','TAP'),('AZ','ITY'),('LO','LOT'),('W6','WZZ'),('EW','EWG'),('DE','CFG'),('TK','THY'),
  ('PC','PGT'),('A3','AEE'),('FI','ICE'),('BT','BTI'),('OU','CTN'),('JU','ASL'),
  -- Middle East and Africa
  ('EK','UAE'),('QR','QTR'),('EY','ETD'),('SV','SVA'),('GF','GFA'),('WY','OMA'),('RJ','RJA'),('LY','ELY'),
  ('MS','MSR'),('ET','ETH'),('KQ','KQA'),('SA','SAA'),('AT','RAM'),('FZ','FDB'),
  -- Asia and Oceania
  ('SQ','SIA'),('CX','CPA'),('JL','JAL'),('NH','ANA'),('KE','KAL'),('OZ','AAR'),('CI','CAL'),('BR','EVA'),
  ('CA','CCA'),('MU','CES'),('CZ','CSN'),('HU','CHH'),('TG','THA'),('MH','MAS'),('GA','GIA'),('PR','PAL'),
  ('VN','HVN'),('AI','AIC'),('6E','IGO'),('UK','VTI'),('QF','QFA'),('VA','VOZ'),('NZ','ANZ'),('JQ','JST'),
  ('TR','TGW'),('AK','AXM'),('5J','CEB'),('MM','APJ'),('GK','JJP'),('HX','CRK'),('UO','HKE'),('7C','JJA')
on conflict (iata) do update set icao = excluded.icao;

-- flight_lookup: the 0003 function, plus "DL934" -> callsign "DAL934" first.
-- Upstream calls give up after 2.5 s: the API stops public requests after 3 s.
create or replace function public.flight_lookup(query text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  qn text := upper(regexp_replace(coalesce(query, ''), '[^A-Za-z0-9-]', '', 'g'));
  icao text;
  tries text[]; -- "kind:value" pairs, in order
  try text;
  kind text;
  val text;
  key text;
  cached private.flight_cache;
  res extensions.http_response;
  body jsonb;
  a jsonb;
  out jsonb;
  last timestamptz;
  have boolean;
  m text[];
begin
  if length(qn) < 2 or length(qn) > 10 then return jsonb_build_object('found', false, 'reason', 'Type a tail number (like N733YX) or a flight number (like DAL934 or DL934).'); end if;
  -- A ticket-style flight number: two-letter airline code + digits (DL934).
  m := regexp_match(qn, '^([A-Z0-9]{2})([0-9]{1,4}[A-Z]?)$');
  if m is not null then select ac.icao into icao from private.airline_codes ac where ac.iata = m[1]; end if;
  tries := case
    when icao is not null and ltrim(m[2], '0') <> m[2] then array['callsign:' || icao || ltrim(m[2], '0'), 'callsign:' || icao || m[2], 'reg:' || qn]
    when icao is not null then array['callsign:' || icao || m[2], 'reg:' || qn]
    when qn ~ '^[0-9A-F]{6}$' and qn !~ '^N' then array['hex:' || lower(qn), 'reg:' || qn]
    when qn ~ '^[A-Z]{3}[0-9]{1,4}[A-Z]?$' then array['callsign:' || qn, 'reg:' || qn]
    else array['reg:' || qn, 'callsign:' || qn] end;
  foreach try in array tries loop
    kind := split_part(try, ':', 1);
    val := substr(try, length(kind) + 2);
    select * into cached from private.flight_cache where flight_cache.q = try;
    have := found;
    if have and cached.fetched_at > now() - interval '10 seconds' then
      if (cached.body->>'found')::boolean then return cached.body; end if;
      out := cached.body;
      continue;
    end if;
    select max(fetched_at) into last from private.flight_cache;
    if last is not null and last > now() - interval '1.5 seconds' then
      if have then return cached.body; end if;
      if out is not null then return out; end if;
      return jsonb_build_object('found', false, 'reason', 'Busy: try again in a moment.', 'retry', true);
    end if;
    select value into key from private.settings where settings.key = 'adsb_key';
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '2500');
    perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '1500');
    begin
    select * into res from extensions.http((
      'GET', 'https://api.adsb.lol/v2/' || kind || '/' || val,
      case when key is null then array[extensions.http_header('User-Agent', 'MusicBeaconXR')] else array[extensions.http_header('User-Agent', 'MusicBeaconXR'), extensions.http_header('x-api-key', key)] end,
      null, null)::extensions.http_request);
    exception when others then
      return jsonb_build_object('found', false, 'reason', 'The flight data service didn''t answer in time. Try again in a moment.', 'retry', true);
    end;
    if res.status = 429 then return jsonb_build_object('found', false, 'reason', 'The flight data service is busy (daily limit). Try again later.', 'retry', true); end if;
    if res.status <> 200 then return jsonb_build_object('found', false, 'reason', 'The flight data service didn''t answer (' || res.status || ').', 'retry', true); end if;
    body := res.content::jsonb;
    a := (select x from jsonb_array_elements(coalesce(body->'ac', '[]')) x where x ? 'lat' order by (x->>'seen_pos')::float nulls last limit 1);
    if a is null then
      out := jsonb_build_object('found', false, 'reason', qn || case when icao is not null then ' (' || icao || ltrim(m[2], '0') || ')' else '' end
        || ' isn''t sending its position right now: it may be on the ground, out of coverage, or not flying today.');
    else
      out := jsonb_build_object('found', true, 'reg', a->>'r', 'flight', trim(a->>'flight'), 'type', a->>'t', 'hex', a->>'hex',
        'lat', (a->>'lat')::float, 'lon', (a->>'lon')::float,
        'alt_ft', case when a->>'alt_baro' = 'ground' then 0 else (a->>'alt_baro')::float end,
        'gs_kt', (a->>'gs')::float, 'track', (a->>'track')::float, 'seen_pos', coalesce((a->>'seen_pos')::float, 0),
        'at', (body->>'now')::float / 1000.0);
    end if;
    delete from private.flight_cache where fetched_at < now() - interval '1 hour';
    insert into private.flight_cache (q, body, fetched_at) values (try, out, now())
      on conflict (q) do update set body = excluded.body, fetched_at = excluded.fetched_at;
    if (out->>'found')::boolean then return out; end if;
  end loop;
  return out;
end $$;

revoke all on function public.flight_lookup(text) from public;
grant execute on function public.flight_lookup(text) to anon, authenticated;

commit;
