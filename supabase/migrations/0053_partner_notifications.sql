-- GoMambo's decisions about a rental company get notification types of their
-- own.
--
-- Until now decidePartner reused the car types: verifying a company wrote a
-- 'car_approved' row and every other decision a 'car_rejected' one, so the
-- company's members read "Auto zatwierdzone" over "you can add cars now" and
-- "Auto odrzucone" over "we need one more document" or "the partnership has
-- ended". Three types, because the company has to do three different things:
--  - partner_approved: the company is verified and can list cars;
--  - partner_changes_requested: GoMambo asks for a correction (the company
--    goes back to draft until it fixes the data or the documents);
--  - partner_status_changed: suspended, terminated, or back to review.
--
-- The application code tolerates this migration not being applied yet: the
-- in-app row is then rejected by the CHECK below and logged, and the e-mail
-- still goes out (lib/notify-user.ts). Rows written earlier keep their car_*
-- types; the notifications page labels those by their /dashboard/firma link.
--
-- The list is the full one from 0052 plus the three new types.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'car_approved', 'car_rejected', 'booking_accepted', 'booking_declined',
    'booking_cancelled', 'identity_verification_approved', 'identity_verification_rejected',
    'booking_paid', 'deposit_captured',
    'booking_confirmed', 'extra_charge_requested', 'booking_extended',
    'payment_failed', 'damage_reported',
    'booking_verification_requested', 'booking_verification_approved',
    'booking_verification_pending_owner',
    'car_documents',
    'deposit_requested', 'deposit_paid', 'deposit_review', 'deposit_refunded',
    'deposit_overdue', 'deposit_objection',
    'partner_approved', 'partner_changes_requested', 'partner_status_changed'
  ));
