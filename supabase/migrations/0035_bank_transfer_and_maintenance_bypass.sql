-- Bank transfer as an alternative to Stripe Checkout. The renter declares
-- they have sent the money; an admin confirms it actually arrived, which is
-- what marks the booking paid. Lets the whole rental lifecycle be exercised
-- end-to-end without moving real money through Stripe.
alter table public.bookings
  add column if not exists payment_method text not null default 'stripe'
    check (payment_method in ('stripe', 'bank_transfer'));

alter table public.booking_extra_charges
  add column if not exists payment_method text not null default 'stripe'
    check (payment_method in ('stripe', 'bank_transfer'));

-- Lets a named account browse and book while the site is in maintenance
-- mode, without granting it admin rights or exposing the listings publicly.
alter table public.profiles
  add column if not exists maintenance_bypass boolean not null default false;

-- 'bank_transfer_declared' — a renter says they've paid by transfer and an
-- admin has to confirm it before the booking counts as paid.
alter table public.admin_notifications drop constraint if exists admin_notifications_type_check;
alter table public.admin_notifications add constraint admin_notifications_type_check
  check (type in (
    'new_registration', 'new_car_pending', 'new_identity_verification', 'new_referral',
    'commission_fallback', 'refund_failed', 'deposit_release_failed',
    'bank_transfer_declared'
  ));
