-- Fix: prevent_role_self_escalation was blocking legitimate service-role
-- updates too (auth.uid() is null outside of an authenticated session,
-- which the trigger misread as "a non-admin trying to escalate").
-- Only block the change when there IS an authenticated session.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role <> old.role
     and auth.uid() is not null
     and not exists (
       select 1 from public.profiles where id = auth.uid() and role = 'admin'
     ) then
    new.role := old.role;
  end if;
  return new;
end;
$$;
