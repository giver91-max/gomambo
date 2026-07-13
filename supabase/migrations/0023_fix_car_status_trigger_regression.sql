-- Migration 0017 (car pause) replaced enforce_car_update_rules() and
-- accidentally dropped the "auth.uid() is not null" guard that 0004 added.
-- Since then, ANY service-role status write (e.g. revertToPendingIfApproved
-- when an owner edits an approved car, or a script-driven admin approval)
-- gets silently reverted back to the old status, because is_admin() reads
-- auth.uid() which is null for service-role calls and so looks like "a
-- non-admin trying to change status". Restore the 0004 guard while keeping
-- 0017's owner approved<->paused carve-out.
create or replace function public.enforce_car_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if not (old.status in ('approved', 'paused') and new.status in ('approved', 'paused')) then
      new.status := old.status;
    end if;
    new.rejection_reason := old.rejection_reason;
    new.owner_id := old.owner_id;
  end if;
  return new;
end;
$$;
