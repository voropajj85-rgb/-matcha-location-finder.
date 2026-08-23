alter table public.listings
  add column if not exists discovered_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists discovery_method text,
  add column if not exists canonical_url text,
  add column if not exists raw_source_data jsonb;

update public.listings
set
  discovered_at = coalesce(discovered_at, created_at, now()),
  last_seen_at = coalesce(last_seen_at, updated_at, created_at, now()),
  canonical_url = coalesce(canonical_url, source_url)
where discovered_at is null
  or last_seen_at is null
  or canonical_url is null;

create index if not exists listings_canonical_url_idx
  on public.listings (canonical_url)
  where canonical_url is not null;

create index if not exists listings_last_seen_at_idx
  on public.listings (last_seen_at desc);

alter table public.listings enable row level security;

revoke insert, update, delete, truncate, references, trigger
  on table public.listings
  from anon, authenticated;

grant select on table public.listings to anon, authenticated;
