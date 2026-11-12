-- Three things the platform promised or relied on without recording them.

-- 1. When a car's OC policy and technical inspection run out, and that the
--    owner may rent it out at all.
--
-- A policy was uploaded once and never looked at again: a year later the car
-- would still be listed with an expired OC — a car nobody may legally drive,
-- and a UFG penalty for whoever does. The same for the przegląd. And nothing
-- asked whether the lister may rent the car out for money; many cars are
-- leased or co-owned, and leasing contracts usually forbid sub-letting
-- without the lessor's consent. The daily job reminds the owner before each
-- date and pauses the listing when one passes (api/cron/daily).
alter table public.car_private
  add column if not exists insurance_valid_until date,
  add column if not exists inspection_valid_until date,
  add column if not exists rental_right_confirmed_at timestamptz,
  -- The day the daily job last reminded the owner, so a re-run the same day
  -- does not mail them twice.
  add column if not exists documents_reminded_on date;

-- The dates are what the expired-documents invariant below trusts, so a
-- session may not rewrite them: car_private_update_owner_or_admin (0037)
-- lets an owner PATCH their own row, and an owner could otherwise blank an
-- expired date, or push it to 2099, and resume the listing. The app writes
-- them with the service role (dashboard/cars/[id]/edit/actions.ts); a new
-- car's INSERT is unaffected — it is reviewed before it goes live.
-- insurance_document_path stays writable: attachCarImages sets it with the
-- owner's session, and a new file sends the car back to review anyway.
create or replace function public.enforce_car_private_update_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.insurance_valid_until := old.insurance_valid_until;
    new.inspection_valid_until := old.inspection_valid_until;
    new.rental_right_confirmed_at := old.rental_right_confirmed_at;
  end if;
  return new;
end;
$function$;
revoke execute on function public.enforce_car_private_update_rules() from public, anon, authenticated;
drop trigger if exists on_car_private_update_rules on public.car_private;
create trigger on_car_private_update_rules
  before update on public.car_private
  for each row execute function public.enforce_car_private_update_rules();

-- 2. WHICH terms a user accepted, not only when.
--
-- terms_accepted_at alone cannot show what someone agreed to, and the
-- Regulamin is about to be rewritten; the version lets the app ask everyone
-- to accept the new text (middleware -> /akceptacja-regulaminu). Existing
-- acceptances are dated against the two texts there have been: "5 lipca
-- 2026", replaced by "16 lipca 2026" (which added the identity-verification
-- and biometric section) when commit 506b28f went live at 10:30 UTC.
alter table public.profiles add column if not exists terms_version text;
update public.profiles
  set terms_version = case
    when terms_accepted_at < '2026-07-16 10:30:00+00' then '2026-07-05'
    else '2026-07-16'
  end
  where terms_accepted_at is not null and terms_version is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ref_raw text := new.raw_user_meta_data->>'referred_by';
  referrer uuid;
begin
  insert into public.profiles (id, full_name, terms_accepted_at, terms_version)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    (new.raw_user_meta_data->>'terms_accepted_at')::timestamptz,
    nullif(new.raw_user_meta_data->>'terms_version', '')
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
$function$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- An acceptance is evidence, so a user may not write it for themselves
-- through the API: the acceptance page records it with the service role.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  caller_is_admin boolean;
begin
  if auth.uid() is null then
    return new;
  end if;
  caller_is_admin := exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
  if caller_is_admin then
    return new;
  end if;
  new.role := old.role;
  new.maintenance_bypass := old.maintenance_bypass;
  new.stripe_connect_account_id := old.stripe_connect_account_id;
  new.stripe_connect_onboarded := old.stripe_connect_onboarded;
  new.terms_accepted_at := old.terms_accepted_at;
  new.terms_version := old.terms_version;
  return new;
end;
$function$;
revoke execute on function public.prevent_role_self_escalation() from public, anon, authenticated;

-- 3. WHICH biometric-consent wording a verification was given under.
--
-- The consent text is being rewritten to say what a valid consent has to:
-- that it is biometric data, who compares it, that it can approve the account
-- on its own, and how to withdraw. biometric_consent_at said when, never what.
-- Only the service role writes identity_verifications (0050).
alter table public.identity_verifications
  add column if not exists biometric_consent_version text;

-- The owner is told about an expiring or expired OC / inspection as its own
-- kind of notification, not as a "car rejected" one.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'car_approved', 'car_rejected', 'booking_accepted', 'booking_declined',
    'booking_cancelled', 'identity_verification_approved',
    'identity_verification_rejected', 'booking_paid', 'deposit_captured',
    'booking_confirmed', 'extra_charge_requested', 'booking_extended',
    'payment_failed', 'damage_reported', 'booking_verification_requested',
    'booking_verification_approved', 'booking_verification_pending_owner',
    'car_documents'
  ]));

-- A car whose OC policy or technical inspection has run out may not be
-- PUBLISHED. Like the partner invariant above it (0042), this binds the
-- owner, the admin and the service role alike: the daily job pauses such a
-- car when the date passes, and without this an owner could resume it the
-- next minute — through the app or straight through PostgREST (the dates
-- themselves are pinned by enforce_car_private_update_rules). A missing
-- date (cars listed before 0051) is not treated as expired; the owner is
-- asked for it on their next edit.
create or replace function public.enforce_car_update_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and not public.is_admin() then
    if not (old.status in ('approved', 'paused') and new.status in ('approved', 'paused')) then
      new.status := old.status;
    end if;
    -- Paused by GoMambo for an expired document: only an edit (back to
    -- review) and an admin's approval bring it back, never the owner's own
    -- "resume".
    if old.status = 'paused' and new.status = 'approved'
       and old.rejection_reason like 'Wstrzymane: wygasła polisa OC%' then
      new.status := old.status;
    end if;
    new.rejection_reason := old.rejection_reason;
    new.owner_id := old.owner_id;
    new.partner_id := old.partner_id;
  end if;

  -- An invariant, not an authorization rule, so it holds for the service
  -- role too: a Partner car always waits for the company to confirm. The
  -- listing tells the customer "zapłacisz dopiero po potwierdzeniu", and
  -- instant_book is otherwise an ordinary unpinned column that
  -- cars_update_own_or_admin lets the owner PATCH straight through PostgREST.
  if new.partner_id is not null then
    new.instant_book := false;
  end if;

  -- A car may not be PUBLISHED while the company behind it is not active.
  --
  -- Deliberately outside the auth.uid() branch, so it binds the owner, the
  -- admin and the service role alike: this is an invariant about what the
  -- catalogue may contain, not a permission. Enforcing it here rather than in
  -- each query is the whole point — the listing, the city dropdown, the
  -- homepage, /wynajmij-auto, the sitemap and sendInquiry all filter on
  -- cars.status alone, and adding a partner join to five places would leave
  -- the sixth wrong. Nothing else needs to know.
  if new.partner_id is not null and new.status = 'approved' then
    if not exists (
      select 1 from public.partners p
      where p.id = new.partner_id and p.status = 'active'
    ) then
      new.status := 'paused';
      -- Marked, not just paused: reactivation restores exactly the cars that
      -- were taken down for this reason, and nothing else.
      new.rejection_reason := 'Wstrzymane: wypożyczalnia nie jest aktywna w GoMambo.';
    end if;
  end if;

  if new.status = 'approved' and exists (
    select 1 from public.car_private cp
    where cp.car_id = new.id
      and (cp.insurance_valid_until < current_date or cp.inspection_valid_until < current_date)
  ) then
    new.status := 'paused';
    new.rejection_reason := 'Wstrzymane: wygasła polisa OC lub badanie techniczne — dodaj aktualny dokument w edycji auta.';
  end if;

  return new;
end;
$function$;
revoke execute on function public.enforce_car_update_rules() from public, anon, authenticated;
