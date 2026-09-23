-- Phase 2 of 2 — run this only AFTER the code that reads and writes
-- public.car_private is deployed (0037 created that table and has been
-- mirroring the old columns into it ever since).
--
-- Dropping the columns is what actually closes the disclosure: while they
-- exist on public.cars, the table-level grant Supabase gives anon and
-- authenticated keeps serving them to anyone holding the anon key, which
-- ships inside the browser bundle.

-- Belt and braces for a write that somehow escaped the mirror. The direction
-- of the coalesce is the whole point: the EXISTING private value wins.
--
-- Once the new code is live it writes car_private and never touches the cars
-- columns again, so cars is frozen at its pre-deploy value while car_private
-- moves on. Preferring the cars value here would silently revert every plate
-- correction and every renewed insurance policy filed since the deploy — and
-- for insurance that is worse than a revert, because uploading a new policy
-- deletes the old file, so the reverted path would point at nothing.
-- The mirror fires inside the same transaction as each old-build write, so
-- car_private can never be the staler of the two for anything the old build
-- wrote. That makes "existing wins" safe in both directions.
insert into public.car_private (car_id, registration_number, insurance_document_path)
select id, registration_number, insurance_document_path
from public.cars
where registration_number is not null or insurance_document_path is not null
on conflict (car_id) do update set
  registration_number =
    coalesce(car_private.registration_number, excluded.registration_number),
  insurance_document_path =
    coalesce(car_private.insurance_document_path, excluded.insurance_document_path);

-- Refuse to drop while any car holds a value that has NO counterpart at all
-- in car_private — that would be the only copy. Note what this deliberately
-- does NOT flag: a car_private value that merely DIFFERS from cars is the
-- normal, expected state after the deploy (the owner edited the plate and
-- only car_private was updated), so treating that as an error would abort
-- every real migration.
do $$
declare
  stragglers int;
begin
  select count(*) into stragglers
  from public.cars c
  left join public.car_private p on p.car_id = c.id
  where (c.registration_number is not null and p.registration_number is null)
     or (c.insurance_document_path is not null and p.insurance_document_path is null);

  if stragglers > 0 then
    raise exception
      'car_private nie ma danych dla % aut — przerywam, zeby nie skasowac jedynej kopii', stragglers;
  end if;
end;
$$;

drop trigger if exists mirror_car_private_columns on public.cars;
drop function if exists public.mirror_car_private_columns();

alter table public.cars drop column if exists registration_number;
alter table public.cars drop column if exists insurance_document_path;

-- 0036's column-level revoke named these two columns; with the columns gone
-- it refers to nothing. Re-asserting the table grant is a no-op on a fresh
-- project and makes the intent explicit: everything left on public.cars is
-- public listing data.
grant select on public.cars to anon, authenticated;
