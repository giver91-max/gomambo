-- Lets an owner temporarily hide an approved listing (e.g. going on
-- vacation) without deleting it or triggering a full re-review, which is
-- what editing an approved car already does.
alter table public.cars drop constraint if exists cars_status_check;
alter table public.cars add constraint cars_status_check
  check (status in ('pending', 'approved', 'rejected', 'paused'));

-- Owners still can't touch status in general (self-approval etc. stays
-- blocked) — the one carve-out is toggling their own car between
-- 'approved' and 'paused'.
create or replace function public.enforce_car_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if not (old.status in ('approved', 'paused') and new.status in ('approved', 'paused')) then
      new.status := old.status;
    end if;
    new.rejection_reason := old.rejection_reason;
    new.owner_id := old.owner_id;
  end if;
  return new;
end;
$$;
