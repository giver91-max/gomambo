-- Two additive features on top of the Stripe booking flow:
-- 1) letting an owner request payment for damage beyond the held deposit
--    (a request the renter must pay themselves — see src/lib/stripe.ts,
--    BLIK can't support an off-session charge, so this can never be an
--    automatic card charge), and
-- 2) letting a renter pay to extend an already-accepted booking's dates.
-- Both are modeled as their own request/payment tables rather than more
-- nullable columns on bookings, since either could in principle happen
-- more than once per booking.

create table public.booking_extra_charges (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  amount_pln numeric(10, 2) not null check (amount_pln > 0),
  reason text not null,
  status text not null default 'requested' check (status in ('requested', 'paid', 'cancelled')),
  stripe_checkout_session_id text,
  created_at timestamptz not null default now()
);

alter table public.booking_extra_charges enable row level security;

create policy "booking_extra_charges_select_participant_or_admin"
  on public.booking_extra_charges for select
  using (public.is_booking_participant(booking_id) or public.is_admin());

create policy "booking_extra_charges_insert_owner"
  on public.booking_extra_charges for insert
  with check (
    exists (
      select 1 from public.bookings
      where id = booking_id and owner_id = auth.uid()
    )
  );

create table public.booking_extensions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  new_end_date date not null,
  additional_amount_pln numeric(10, 2) not null check (additional_amount_pln > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired')),
  stripe_checkout_session_id text,
  created_at timestamptz not null default now()
);

alter table public.booking_extensions enable row level security;

create policy "booking_extensions_select_participant_or_admin"
  on public.booking_extensions for select
  using (public.is_booking_participant(booking_id) or public.is_admin());

create policy "booking_extensions_insert_renter"
  on public.booking_extensions for insert
  with check (
    exists (
      select 1 from public.bookings
      where id = booking_id and renter_id = auth.uid()
    )
  );

-- Both new tables are only ever transitioned to 'paid'/'cancelled'/'expired'
-- via the Stripe webhook, which writes through the service-role admin
-- client (bypasses RLS entirely, same as every other webhook write) — so
-- no update policy is needed here for regular users.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'car_approved', 'car_rejected', 'booking_accepted', 'booking_declined',
    'booking_cancelled', 'identity_verification_approved', 'identity_verification_rejected',
    'booking_paid', 'deposit_captured',
    'booking_confirmed', 'extra_charge_requested', 'booking_extended'
  ));
