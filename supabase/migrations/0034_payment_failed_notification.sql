-- BLIK — the dominant payment method in Poland — settles asynchronously:
-- Stripe sends checkout.session.completed while the payment is still
-- pending, then either async_payment_succeeded or async_payment_failed.
-- The failure case has to reach the renter, otherwise they wait for a
-- confirmation that never comes while the booking sits unpaid.
--
-- Same pattern as 0028/0032 — the CHECK is redefined with the full list.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'car_approved', 'car_rejected', 'booking_accepted', 'booking_declined',
    'booking_cancelled', 'identity_verification_approved', 'identity_verification_rejected',
    'booking_paid', 'deposit_captured',
    'booking_confirmed', 'extra_charge_requested', 'booking_extended',
    'payment_failed'
  ));
