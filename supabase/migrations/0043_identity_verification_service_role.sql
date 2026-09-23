-- NOTE: this migration turned out to be a NO-OP and is kept only so the
-- applied-migration history stays contiguous.
--
-- It was written on the belief that enforce_identity_verification_update_rules()
-- forced status='pending' for the service role, which would have made the
-- restored automatic approval work on a first verification (an INSERT, which
-- this BEFORE UPDATE trigger never sees) and fail silently on a second one.
-- That was wrong: 0026 had ALREADY exempted the service role with
-- `if auth.uid() is not null and not public.is_admin()`. Only 0019's original
-- version had the problem, and 0026 replaced it.
--
-- What follows is therefore the same guard written the other way round, with
-- no behavioural change. The real hardening of this trigger is in 0044.
create or replace function public.enforce_identity_verification_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;  -- service role: our own server code, already authorised
  end if;

  if not public.is_admin() then
    new.status := 'pending';
    new.rejection_reason := null;
  end if;

  return new;
end;
$$;
