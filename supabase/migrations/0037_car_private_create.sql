-- The licence plate and the insurance document path sat on public.cars,
-- which every anonymous visitor may read (an approved listing is public by
-- design, and RLS filters rows, never columns). A column-level REVOKE cannot
-- fix that: Postgres checks the table-level grant first, and Supabase grants
-- the whole table to anon/authenticated at project creation.
--
-- Moving both fields to their own table makes the boundary structural: the
-- row is the unit RLS actually protects, so a column added to cars later is
-- public by default (the expected behaviour) and anything private goes here.
--
-- Phase 1 of 2. This migration only ADDS — the old columns stay, so the
-- currently deployed code keeps working. 0038 drops them once the new code
-- is live.
create table if not exists public.car_private (
  car_id uuid primary key references public.cars(id) on delete cascade,
  registration_number text,
  insurance_document_path text,
  updated_at timestamptz not null default now()
);

alter table public.car_private enable row level security;

drop policy if exists "car_private_select_owner_or_admin" on public.car_private;
create policy "car_private_select_owner_or_admin"
  on public.car_private for select
  using (
    exists (select 1 from public.cars c where c.id = car_id and c.owner_id = auth.uid())
    or public.is_admin()
  );

drop policy if exists "car_private_insert_owner_or_admin" on public.car_private;
create policy "car_private_insert_owner_or_admin"
  on public.car_private for insert
  with check (
    exists (select 1 from public.cars c where c.id = car_id and c.owner_id = auth.uid())
    or public.is_admin()
  );

drop policy if exists "car_private_update_owner_or_admin" on public.car_private;
create policy "car_private_update_owner_or_admin"
  on public.car_private for update
  using (
    exists (select 1 from public.cars c where c.id = car_id and c.owner_id = auth.uid())
    or public.is_admin()
  );

drop trigger if exists on_car_private_updated on public.car_private;
create trigger on_car_private_updated
  before update on public.car_private
  for each row execute function public.set_updated_at();

-- The deploy cannot land at the same instant as this migration: the new code
-- needs car_private to exist, and the old code still writes the plate to
-- public.cars. Everything written in that window would otherwise be dropped
-- by 0038 — a car added in those minutes would lose its plate and its
-- insurance file, and an edited plate would silently keep its old value.
--
-- So instead of a one-shot copy, the old columns are MIRRORED for as long as
-- they exist. This fires for writes from the old build and does nothing once
-- the new build stops touching those columns; 0038 removes it.
create or replace function public.mirror_car_private_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.registration_number is not null or new.insurance_document_path is not null then
    insert into public.car_private (car_id, registration_number, insurance_document_path)
    values (new.id, new.registration_number, new.insurance_document_path)
    on conflict (car_id) do update set
      registration_number =
        coalesce(excluded.registration_number, car_private.registration_number),
      insurance_document_path =
        coalesce(excluded.insurance_document_path, car_private.insurance_document_path),
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists mirror_car_private_columns on public.cars;
create trigger mirror_car_private_columns
  after insert or update of registration_number, insurance_document_path on public.cars
  for each row execute function public.mirror_car_private_columns();

-- Initial sync. Runs in the same transaction as the trigger above, so there
-- is no instant in which a write could slip past both.
insert into public.car_private (car_id, registration_number, insurance_document_path)
select id, registration_number, insurance_document_path
from public.cars
where registration_number is not null or insurance_document_path is not null
on conflict (car_id) do update set
  registration_number =
    coalesce(car_private.registration_number, excluded.registration_number),
  insurance_document_path =
    coalesce(car_private.insurance_document_path, excluded.insurance_document_path);
