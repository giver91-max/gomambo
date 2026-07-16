-- Fuel return policy + mileage overage fee on cars (closes a common dispute
-- gap vs. competitors like SnappCar/Turo, which always state both up front).
alter table public.cars add column fuel_policy text
  check (fuel_policy in ('full_to_full', 'same_level', 'included'));
alter table public.cars add column mileage_overage_fee_per_km numeric(6, 2)
  check (mileage_overage_fee_per_km >= 0);

-- Structured odometer/fuel-level readings at pickup and return, alongside
-- the existing trip_photos, so damage/mileage disputes have a number to
-- point to instead of just photos.
alter table public.bookings add column pickup_odometer_km int check (pickup_odometer_km >= 0);
alter table public.bookings add column pickup_fuel_level text
  check (pickup_fuel_level in ('empty', 'quarter', 'half', 'three_quarters', 'full'));
alter table public.bookings add column return_odometer_km int check (return_odometer_km >= 0);
alter table public.bookings add column return_fuel_level text
  check (return_fuel_level in ('empty', 'quarter', 'half', 'three_quarters', 'full'));
