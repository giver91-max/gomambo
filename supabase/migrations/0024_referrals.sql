-- Referral tracking: whoever signs up via someone's referral link
-- (/register?ref=<user_id>) gets recorded as referred by that user. No
-- automatic reward is granted yet (no payment/credit system) — this just
-- gives each user a link + counter, and notifies admin so a reward can be
-- honoured manually.
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_id uuid not null references public.profiles(id) on delete cascade unique,
  created_at timestamptz not null default now()
);

alter table public.referrals enable row level security;

create policy "referrals_select_own_or_admin"
  on public.referrals for select
  using (referrer_id = auth.uid() or public.is_admin());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_raw text := new.raw_user_meta_data->>'referred_by';
  referrer uuid;
begin
  insert into public.profiles (id, full_name, terms_accepted_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    (new.raw_user_meta_data->>'terms_accepted_at')::timestamptz
  );

  if ref_raw is not null and ref_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    referrer := ref_raw::uuid;
    if referrer <> new.id and exists (select 1 from public.profiles where id = referrer) then
      insert into public.referrals (referrer_id, referred_id)
      values (referrer, new.id)
      on conflict (referred_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

alter table public.admin_notifications drop constraint if exists admin_notifications_type_check;
alter table public.admin_notifications add constraint admin_notifications_type_check
  check (type in ('new_registration', 'new_car_pending', 'new_identity_verification', 'new_referral'));
