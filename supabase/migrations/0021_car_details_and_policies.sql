-- Richer car attributes (for filtering + trust on listing cards), delivery
-- option, monthly pricing, and a per-car cancellation policy.
alter table public.cars add column vehicle_type text
  check (vehicle_type in ('sedan', 'kombi', 'hatchback', 'suv', 'van', 'dostawczy', 'sportowe', 'kabriolet', 'elektryczne', 'inne'));
alter table public.cars add column fuel_type text
  check (fuel_type in ('benzyna', 'diesel', 'hybryda', 'elektryczny', 'lpg'));
alter table public.cars add column transmission text
  check (transmission in ('manualna', 'automatyczna'));
alter table public.cars add column seats int check (seats between 1 and 9);
alter table public.cars add column mileage_limit_km int check (mileage_limit_km > 0);
alter table public.cars add column price_per_month numeric(10, 2) check (price_per_month > 0);
alter table public.cars add column delivery_available boolean not null default false;
alter table public.cars add column delivery_info text;
alter table public.cars add column cancellation_policy text not null default 'moderate'
  check (cancellation_policy in ('flexible', 'moderate', 'strict'));

create index cars_vehicle_type_idx on public.cars (vehicle_type) where status = 'approved';
create index cars_fuel_type_idx on public.cars (fuel_type) where status = 'approved';
