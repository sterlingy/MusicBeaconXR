-- Grid spacing up to 10 km (the size cap in 0006 keeps grids within 50 km of their center).
alter table public.grids drop constraint if exists grids_spacing_m_check;
alter table public.grids add constraint grids_spacing_m_check check (spacing_m in (100, 200, 500, 1000, 2000, 5000, 10000));
