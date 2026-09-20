-- Per-owner platform commission override — the "0% prowizji przez pierwsze
-- 6 miesięcy" promo for rental companies listing their fleets.
--
-- Its own table, not columns on profiles: migration 0009 lets a booking or
-- conversation counterparty SELECT the owner's whole profiles row, and the
-- platform's commercial terms with one owner are nobody else's business.
-- Keeping it off profiles also means owners never get UPDATE on these
-- values (their profiles UPDATE policy doesn't reach this table), so no
-- self-edit trigger is needed.
--
-- No row = platform default (15%, src/lib/commission.ts). commission_rate
-- is a fraction (0 = 0%), strictly < 1 because Stripe requires the
-- application fee to be less than the charge amount. commission_rate_until,
-- when set, lapses the override at that instant — evaluated at checkout
-- time, no cron needed.
create table if not exists public.owner_commission_overrides (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  commission_rate numeric(5, 4) not null
    check (commission_rate >= 0 and commission_rate < 1),
  commission_rate_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.owner_commission_overrides enable row level security;

-- Admins read through their session; every write goes through the
-- service-role client in the admin panel (bypasses RLS). No insert/update/
-- delete policy for anon/authenticated = denied.
drop policy if exists "commission_overrides_select_admin" on public.owner_commission_overrides;
create policy "commission_overrides_select_admin"
  on public.owner_commission_overrides for select
  using (public.is_admin());

drop trigger if exists on_owner_commission_override_updated on public.owner_commission_overrides;
create trigger on_owner_commission_override_updated
  before update on public.owner_commission_overrides
  for each row execute function public.set_updated_at();

-- Trip extensions were the one payment whose platform fee was stored
-- nowhere (bookings.platform_fee_amount only covers the initial payment).
-- With per-owner rates that makes reconciliation impossible, so record it.
alter table public.booking_extensions
  add column if not exists platform_fee_pln numeric(10, 2);

-- A paid extension is a second Stripe charge; cancelling a booking now
-- refunds it too (src/lib/cancellation.ts). Marking it here rather than
-- with a new status value keeps 0032's status CHECK intact and makes the
-- refund idempotent if a cancellation is ever retried.
alter table public.booking_extensions
  add column if not exists refunded_at timestamptz;

-- Three new admin notification types: src/lib/commission.ts raises
-- 'commission_fallback' when an owner's rate couldn't be read and the
-- default was billed; src/lib/cancellation.ts raises 'refund_failed' when
-- Stripe rejected a refund on an already-cancelled booking, and
-- 'deposit_release_failed' when a deposit hold couldn't be released (the
-- renter's money stays blocked until it's cancelled by hand). Same pattern
-- as 0019/0024 — the CHECK is redefined with the full list.
--
-- IMPORTANT: this migration must be applied BEFORE the matching code is
-- deployed. The app writes these three types, booking_extensions.
-- platform_fee_pln and refunded_at; against the old schema those writes
-- are rejected.
alter table public.admin_notifications drop constraint if exists admin_notifications_type_check;
alter table public.admin_notifications add constraint admin_notifications_type_check
  check (type in (
    'new_registration', 'new_car_pending', 'new_identity_verification', 'new_referral',
    'commission_fallback', 'refund_failed', 'deposit_release_failed'
  ));
