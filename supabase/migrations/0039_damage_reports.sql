-- Reporting a problem with a rental — damage, a dispute, anything either
-- side needs on the record. Until now the only channels were the owner
-- charging the renter (booking_extra_charges / deposit capture) and the
-- chat thread; neither leaves GoMambo a queue to work through, and a renter
-- had no way to raise anything at all.
--
-- Every report reaches BOTH the other party and GoMambo: the counterparty
-- gets a notification, and an admin_notifications row puts it on the
-- admin's queue.
create table if not exists public.damage_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  -- Which side filed it, so the admin can read the queue without joining.
  reporter_role text not null check (reporter_role in ('owner', 'renter')),
  description text not null check (char_length(trim(description)) > 0),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- The internal note lives in its own table, NOT as a column on the report.
-- Both participants may read the report row, and RLS protects rows, never
-- columns — an admin note saying which side we believe would be one
-- PostgREST call away from the person it is about, with the anon key that
-- ships in the browser bundle.
create table if not exists public.damage_report_notes (
  report_id uuid primary key references public.damage_reports(id) on delete cascade,
  note text not null,
  updated_at timestamptz not null default now()
);

alter table public.damage_report_notes enable row level security;

-- Admins only, and even they go through the service role in the app. No
-- policy for participants at all: absence of a policy is the strongest
-- statement available here.
drop policy if exists "damage_report_notes_admin_only" on public.damage_report_notes;
create policy "damage_report_notes_admin_only"
  on public.damage_report_notes for select
  using (public.is_admin());

create index if not exists idx_damage_reports_booking_id on public.damage_reports(booking_id);
create index if not exists idx_damage_reports_status on public.damage_reports(status);

alter table public.damage_reports enable row level security;

drop policy if exists "damage_reports_select_participant_or_admin" on public.damage_reports;
create policy "damage_reports_select_participant_or_admin"
  on public.damage_reports for select
  using (public.is_booking_participant(booking_id) or public.is_admin());

-- Inserts go through the server action (service role), which also writes the
-- notifications. No client-side insert path is needed, and leaving one open
-- would let a participant file a report as the other side.

-- 'damage_reported' on both channels: the counterparty's notification and
-- the admin queue.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'car_approved', 'car_rejected', 'booking_accepted', 'booking_declined',
    'booking_cancelled', 'identity_verification_approved', 'identity_verification_rejected',
    'booking_paid', 'deposit_captured',
    'booking_confirmed', 'extra_charge_requested', 'booking_extended',
    'payment_failed', 'damage_reported'
  ));

alter table public.admin_notifications drop constraint if exists admin_notifications_type_check;
alter table public.admin_notifications add constraint admin_notifications_type_check
  check (type in (
    'new_registration', 'new_car_pending', 'new_identity_verification', 'new_referral',
    'commission_fallback', 'refund_failed', 'deposit_release_failed',
    'bank_transfer_declared', 'damage_reported'
  ));
