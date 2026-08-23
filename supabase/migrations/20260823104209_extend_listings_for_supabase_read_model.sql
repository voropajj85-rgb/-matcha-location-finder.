-- Supabase Phase 1: extend public.listings for Matcha Location Finder domain model.
-- Keeps legacy columns for migration safety while making Supabase the production listings source.

alter table public.listings
  add column if not exists external_id text,
  add column if not exists source_family text,
  add column if not exists source_name text,
  add column if not exists listing_type text,
  add column if not exists availability_status text,
  add column if not exists last_verified_at timestamptz,
  add column if not exists verification_method text,
  add column if not exists verification_override jsonb,
  add column if not exists unit_area numeric,
  add column if not exists project_total_area numeric,
  add column if not exists rent numeric,
  add column if not exists nebenkosten numeric,
  add column if not exists provision jsonb,
  add column if not exists abloese jsonb,
  add column if not exists kaution jsonb,
  add column if not exists gastro_suitability text,
  add column if not exists gastro_evidence text,
  add column if not exists verified_summary text,
  add column if not exists key_facts jsonb,
  add column if not exists unknowns jsonb,
  add column if not exists next_action text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

update public.listings
set
  external_id = coalesce(external_id, id::text),
  source_name = coalesce(source_name, source),
  source_family = coalesce(source_family, case
    when lower(coalesce(source, '')) like '%kleinanzeigen%' then 'portal'
    when lower(coalesce(source, '')) like '%immowelt%' then 'portal'
    when lower(coalesce(source, '')) like '%immoscout%' then 'portal'
    when lower(coalesce(source, '')) like '%stadt%' then 'municipal'
    when lower(coalesce(source, '')) like '%colliers%' then 'broker'
    when lower(coalesce(source, '')) like '%cbre%' then 'broker'
    else 'broker'
  end),
  listing_type = coalesce(listing_type, case when lower(coalesce(status, '')) = 'lead' then 'broker_lead' else 'direct_listing' end),
  availability_status = coalesce(availability_status, case when lower(coalesce(status, '')) = 'lead' then 'lead' else 'unknown' end),
  unit_area = coalesce(unit_area, area),
  rent = coalesce(rent, price),
  provision = coalesce(provision, jsonb_build_object('known', false, 'value', null, 'amount', null)),
  abloese = coalesce(abloese, jsonb_build_object('known', false, 'value', null, 'amount', null)),
  kaution = coalesce(kaution, jsonb_build_object('known', false, 'value', null, 'amount', null)),
  gastro_suitability = coalesce(gastro_suitability, 'unknown'),
  verified_summary = coalesce(verified_summary, notes),
  key_facts = coalesce(key_facts, '[]'::jsonb),
  unknowns = coalesce(unknowns, '[]'::jsonb)
where external_id is null or source_name is null or source_family is null or listing_type is null
   or availability_status is null or unit_area is null or rent is null or provision is null
   or abloese is null or kaution is null or gastro_suitability is null or verified_summary is null
   or key_facts is null or unknowns is null;

alter table public.listings
  alter column external_id set not null,
  alter column listing_type set default 'direct_listing',
  alter column availability_status set default 'unknown',
  alter column provision set default jsonb_build_object('known', false, 'value', null, 'amount', null),
  alter column abloese set default jsonb_build_object('known', false, 'value', null, 'amount', null),
  alter column kaution set default jsonb_build_object('known', false, 'value', null, 'amount', null),
  alter column gastro_suitability set default 'unknown',
  alter column key_facts set default '[]'::jsonb,
  alter column unknowns set default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_availability_status_check') then
    alter table public.listings add constraint listings_availability_status_check check (availability_status in ('active', 'dead', 'unknown', 'search_only', 'lead'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_listing_type_check') then
    alter table public.listings add constraint listings_listing_type_check check (listing_type in ('direct_listing', 'project_lead', 'broker_lead', 'municipal_lead', 'manual_lead'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listings_gastro_suitability_check') then
    alter table public.listings add constraint listings_gastro_suitability_check check (gastro_suitability in ('confirmed', 'possible', 'unknown', 'no'));
  end if;
end $$;

-- external_id is NOT NULL, so use a full unique index. This is required for
-- PostgREST/Supabase upsert with on_conflict=external_id.
create unique index if not exists listings_external_id_key on public.listings (external_id);
create index if not exists listings_availability_status_idx on public.listings (availability_status);
create index if not exists listings_listing_type_idx on public.listings (listing_type);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_listings_updated_at on public.listings;
create trigger set_listings_updated_at before update on public.listings for each row execute function public.set_updated_at();

alter table public.listings enable row level security;
revoke insert, update, delete, truncate, references, trigger on table public.listings from anon, authenticated;
grant select on table public.listings to anon, authenticated;

drop policy if exists "Public can read listings" on public.listings;
create policy "Public can read listings" on public.listings for select to anon using (true);
