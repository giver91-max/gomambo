-- Row-level security is row-level: every policy on bookings and profiles so
-- far answers "may this person touch this row", never "which columns". The
-- anon key ships inside the browser bundle, so anyone holding their own
-- session token can PATCH their own rows straight through PostgREST, past
-- every server action. This migration closes the columns that decide money,
-- dates and access.

-- ─────────────────────────────────────────────────────────────
-- BOOKINGS — payment state, prices and the rental period are set by the
-- server (service role) only.
-- ─────────────────────────────────────────────────────────────

-- Every legitimate booking is created by sendInquiry, which validates the
-- car, the dates, the overlap and the renter's verification, then writes
-- with the service role. Nothing else needs to insert one.
drop policy if exists "bookings_insert_renter" on public.bookings;

create or replace function public.enforce_booking_column_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null for the service role (server actions, Stripe
  -- webhook) — same convention as prevent_role_self_escalation in 0002.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  -- Money. Only the server may move any of this.
  new.payment_status := old.payment_status;
  new.payment_method := old.payment_method;
  new.total_price := old.total_price;
  new.platform_fee_amount := old.platform_fee_amount;
  new.deposit_amount := old.deposit_amount;
  new.deposit_status := old.deposit_status;
  new.stripe_checkout_session_id := old.stripe_checkout_session_id;
  new.stripe_deposit_payment_intent_id := old.stripe_deposit_payment_intent_id;

  -- The rental period and who it is between: extending the trip is a paid
  -- operation (booking_extensions + webhook), never a field edit.
  new.car_id := old.car_id;
  new.owner_id := old.owner_id;
  new.renter_id := old.renter_id;
  new.start_date := old.start_date;
  new.end_date := old.end_date;

  -- Status: the owner drives the booking (accept / decline / complete); the
  -- renter may only walk away from it.
  if new.status is distinct from old.status then
    if auth.uid() = old.owner_id then
      null;
    elsif auth.uid() = old.renter_id and new.status = 'cancelled' then
      null;
    else
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_booking_column_rules on public.bookings;
create trigger enforce_booking_column_rules
  before update on public.bookings
  for each row execute function public.enforce_booking_column_rules();

-- ─────────────────────────────────────────────────────────────
-- PROFILES — role was already pinned (0002); the columns added since then
-- decide site access and payouts and need the same treatment.
-- ─────────────────────────────────────────────────────────────
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  -- Grants the holder the catalogue while the site is in maintenance mode.
  new.maintenance_bypass := old.maintenance_bypass;
  -- Decides where Stripe sends the owner's payouts.
  new.stripe_connect_account_id := old.stripe_connect_account_id;
  new.stripe_connect_onboarded := old.stripe_connect_onboarded;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- IDENTITY VERIFICATIONS — the update trigger already forces 'pending' for
-- non-admins, but INSERT never ran it, so a fresh account could file itself
-- as approved and walk straight through the booking gate.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "identity_verifications_insert_own" on public.identity_verifications;
create policy "identity_verifications_insert_own"
  on public.identity_verifications for insert
  with check (user_id = auth.uid() and status = 'pending');

-- ─────────────────────────────────────────────────────────────
-- CARS — an approved listing is readable by everyone, and RLS cannot hide
-- a column, so the licence plate and the insurance document path were
-- being served to any anonymous REST client alongside the price. The plate
-- is personal data the product deliberately stickers out of listing photos
-- (src/lib/plate-cover.ts). Column privileges are the only lever here.
--
-- Every reader of these two columns now goes through the service role:
-- /admin/cars, the owner's own edit form, and the account-deletion sweep.
-- Public and dashboard queries name their columns explicitly instead of
-- using "*", which would otherwise fail for the whole row.
-- ─────────────────────────────────────────────────────────────
revoke select (registration_number, insurance_document_path)
  on public.cars from anon, authenticated;
