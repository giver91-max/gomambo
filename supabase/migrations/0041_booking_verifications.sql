-- Re-verification before a rental starts. identity_verifications is ONE row
-- per user, approved once by an admin and then good forever — which does not
-- catch the risk that matters here: an account handed to someone else
-- between signing up and picking up a car. So this is per BOOKING.
--
-- The owner of the car approves it, not an admin. A rejection is an
-- accusation about someone's identity, so it does not cancel the booking on
-- its own — it goes to GoMambo to decide.
create table if not exists public.booking_verifications (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  status text not null default 'pending_renter'
    check (status in ('pending_renter', 'pending_owner', 'approved', 'escalated')),
  -- Fresh selfie in the existing private id-documents bucket.
  selfie_path text,
  face_match_result text check (face_match_result in ('match', 'no_match', 'error', 'not_run')),
  face_match_score numeric(5, 2),
  requested_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  -- Idempotency for the daily cron, same pattern as
  -- bookings.pickup_instructions_sent_at.
  escalated_at timestamptz,
  reminder_sent_at timestamptz
);

create index if not exists idx_booking_verifications_status
  on public.booking_verifications(status);

alter table public.booking_verifications enable row level security;

-- Both sides of the booking may read it: the renter needs to know what is
-- being asked of them, the owner has to act on it. Which is exactly why the
-- reason a case was escalated is NOT a column here — see below.
drop policy if exists "booking_verifications_select_participant_or_admin"
  on public.booking_verifications;
create policy "booking_verifications_select_participant_or_admin"
  on public.booking_verifications for select
  using (public.is_booking_participant(booking_id) or public.is_admin());

-- No insert/update policy at all: every transition runs through a server
-- action with the service role, after it has checked WHO is acting. Without
-- that, a renter could approve their own verification.

-- The owner's free-text objection ("na selfie jest inna osoba") and
-- GoMambo's own note are unverified accusations about the renter. Putting
-- them on the row above would hand them to the person they are about, since
-- RLS protects rows and not columns — the same mistake this codebase already
-- made with cars.registration_number and damage_reports.admin_note.
create table if not exists public.booking_verification_notes (
  booking_id uuid primary key references public.booking_verifications(booking_id) on delete cascade,
  reason text not null,
  updated_at timestamptz not null default now()
);

alter table public.booking_verification_notes enable row level security;

drop policy if exists "booking_verification_notes_admin_only"
  on public.booking_verification_notes;
create policy "booking_verification_notes_admin_only"
  on public.booking_verification_notes for select
  using (public.is_admin());

-- The renter's fresh selfie goes in the existing private id-documents
-- bucket, whose policies key on the path starting with the user's own id.
-- Nothing to add there.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'car_approved', 'car_rejected', 'booking_accepted', 'booking_declined',
    'booking_cancelled', 'identity_verification_approved', 'identity_verification_rejected',
    'booking_paid', 'deposit_captured',
    'booking_confirmed', 'extra_charge_requested', 'booking_extended',
    'payment_failed', 'damage_reported',
    'booking_verification_requested', 'booking_verification_approved',
    'booking_verification_pending_owner'
  ));

alter table public.admin_notifications drop constraint if exists admin_notifications_type_check;
alter table public.admin_notifications add constraint admin_notifications_type_check
  check (type in (
    'new_registration', 'new_car_pending', 'new_identity_verification', 'new_referral',
    'commission_fallback', 'refund_failed', 'deposit_release_failed',
    'bank_transfer_declared', 'damage_reported', 'booking_verification_escalated'
  ));
