alter table public.listings
  add column if not exists rent_type text,
  add column if not exists rent_per_sqm numeric;
