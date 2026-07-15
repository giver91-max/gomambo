-- Widen the personal-notification type set (0025 only had car_approved /
-- car_rejected) to cover the rest of the events a user needs to hear about
-- even if they never open the site: their booking request being accepted
-- or declined, a renter cancelling on them, and identity verification
-- outcomes — all previously silent (no email, no in-app row).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'car_approved',
    'car_rejected',
    'booking_accepted',
    'booking_declined',
    'booking_cancelled',
    'identity_verification_approved',
    'identity_verification_rejected'
  ));
