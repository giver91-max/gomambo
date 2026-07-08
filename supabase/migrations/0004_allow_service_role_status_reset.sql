-- Fix: enforce_car_update_rules blocked ALL non-admin status changes,
-- including our own service-role calls (auth.uid() is null for those,
-- which the trigger misread as "a non-admin trying to change status").
-- Only block the change when there IS an authenticated non-admin session —
-- this lets the app deliberately reset an approved car to 'pending' when
-- its owner edits it, while still preventing owners from setting status
-- themselves via a direct update.
create or replace function public.enforce_car_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.status := old.status;
    new.rejection_reason := old.rejection_reason;
    new.owner_id := old.owner_id;
  end if;
  return new;
end;
$$;
