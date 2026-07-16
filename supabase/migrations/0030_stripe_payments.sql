-- Stripe Connect payments: rental fee (captured immediately, split via
-- Connect transfer + platform application fee) and an optional per-car
-- security deposit (separate manual-capture PaymentIntent, since BLIK —
-- the dominant PL payment method — doesn't support delayed capture, so it
-- can't share an object with the deposit hold). See src/lib/stripe.ts.

alter table public.profiles add column stripe_connect_account_id text;
alter table public.profiles add column stripe_connect_onboarded boolean not null default false;

alter table public.cars add column security_deposit_amount numeric(10, 2)
  check (security_deposit_amount >= 0);

alter table public.bookings add column total_price numeric(10, 2);
alter table public.bookings add column platform_fee_amount numeric(10, 2);
alter table public.bookings add column stripe_checkout_session_id text;
alter table public.bookings add column payment_status text not null default 'unpaid'
  check (payment_status in ('unpaid', 'paid', 'refunded', 'partially_refunded', 'failed'));
alter table public.bookings add column deposit_amount numeric(10, 2);
alter table public.bookings add column stripe_deposit_payment_intent_id text;
alter table public.bookings add column deposit_status text not null default 'not_required'
  check (deposit_status in ('not_required', 'held', 'captured', 'released', 'failed'));

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'car_approved',
    'car_rejected',
    'booking_accepted',
    'booking_declined',
    'booking_cancelled',
    'identity_verification_approved',
    'identity_verification_rejected',
    'booking_paid',
    'deposit_captured'
  ));
