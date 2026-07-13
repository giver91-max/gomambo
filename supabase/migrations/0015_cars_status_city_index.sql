-- The /auta listing filters on status (+ optional city) with no supporting
-- index, forcing a full table scan as cars grows.
create index if not exists idx_cars_status_city on public.cars(status, city);
