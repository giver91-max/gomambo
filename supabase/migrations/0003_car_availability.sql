-- ─────────────────────────────────────────────────────────────
-- CAR_AVAILABILITY — dni, w które właściciel oznaczył auto jako dostępne.
-- Jeden wiersz = jeden dostępny dzień (brak wiersza = dzień niedostępny).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.car_availability (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  unique (car_id, date)
);

alter table public.car_availability enable row level security;

create policy "car_availability_select_public_or_owner"
  on public.car_availability for select
  using (
    exists (
      select 1 from public.cars
      where cars.id = car_availability.car_id
        and (cars.owner_id = auth.uid() or public.is_admin() or cars.status = 'approved')
    )
  );

create policy "car_availability_insert_owner"
  on public.car_availability for insert
  with check (
    exists (
      select 1 from public.cars
      where cars.id = car_availability.car_id and cars.owner_id = auth.uid()
    )
  );

create policy "car_availability_delete_owner"
  on public.car_availability for delete
  using (
    exists (
      select 1 from public.cars
      where cars.id = car_availability.car_id and cars.owner_id = auth.uid()
    )
  );
