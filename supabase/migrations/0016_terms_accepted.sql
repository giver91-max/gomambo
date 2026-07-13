-- Records when a user accepted the terms/privacy policy at signup, for
-- compliance — the checkbox itself was previously enforced client-side only.
-- Set via the same trigger that creates the profile row (rather than a
-- follow-up UPDATE from the app) because signUp() doesn't establish an
-- authenticated session until the user confirms their email, so an RLS-gated
-- UPDATE from the client right after signUp would silently affect 0 rows.
alter table public.profiles add column terms_accepted_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, terms_accepted_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    (new.raw_user_meta_data->>'terms_accepted_at')::timestamptz
  );
  return new;
end;
$$;
