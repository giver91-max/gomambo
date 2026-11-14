-- The security deposit becomes a real payment instead of a card hold.
--
-- Until now the deposit was a manual-capture authorisation on the renter's
-- card, placed right after the rental payment. That could not work: BLIK —
-- most Polish renters' way to pay — cannot be authorised and captured later,
-- so a car with a deposit could only be paid by card, and a card hold on a
-- destination charge lasts about seven days, so it lapsed on any longer trip.
--
-- Rafał's decisions, which this table encodes:
--  - the deposit is charged (card or BLIK) on GoMambo's own Stripe balance,
--    two days before pickup together with the pre-rental selfie, and the
--    pickup details are only sent once it is paid;
--  - the renter also pays a non-refundable fee for handling the deposit,
--    shown before booking and pinned on the booking when it is made;
--  - after the car comes back the owner has three days to confirm it or to
--    keep part of it; silence returns it in full;
--  - a kept amount waits three more days for the renter's objection before
--    it is transferred to the owner; an objection goes to GoMambo.
--
-- The old columns (bookings.deposit_status, stripe_deposit_payment_intent_id)
-- stay for now: the code no longer reads them, and a later cleanup migration
-- drops them once this one is live. The trigger below still pins them, so it
-- keeps working until then.

-- ─────────────────────────────────────────────────────────────
-- BOOKINGS — the fee is pinned at booking time, like the price (0036).
-- ─────────────────────────────────────────────────────────────
alter table public.bookings
  add column if not exists deposit_fee_amount numeric
    check (deposit_fee_amount is null or deposit_fee_amount >= 0);

comment on column public.bookings.deposit_status is
  'Unused since 0052 (the manual-capture deposit is gone; see booking_deposits). Dropped by a later cleanup migration.';
comment on column public.bookings.stripe_deposit_payment_intent_id is
  'Unused since 0052 (the manual-capture deposit is gone; see booking_deposits). Dropped by a later cleanup migration.';

-- ─────────────────────────────────────────────────────────────
-- BOOKING_DEPOSITS — one row per booking, created when the deposit is
-- requested. Every transition is a conditional UPDATE … RETURNING made by
-- the server before it calls Stripe (claim, then act), so the status column
-- is what serialises a webhook, the daily job and a click racing each other.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.booking_deposits (
  -- Cascade, with the guard trigger below: deleting a booking (an account or
  -- a car being deleted) is refused while the row still holds money, and
  -- allowed once it is settled or was never paid. A plain RESTRICT would
  -- block deleting an account for ever over a deposit returned long ago.
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  amount numeric(10, 2) not null check (amount > 0),
  fee_amount numeric(10, 2) not null default 0 check (fee_amount >= 0),
  status text not null default 'requested'
    check (status in (
      'requested', 'processing', 'paid', 'in_review',
      'retention_pending', 'retention_objected',
      'transferring', 'transfer_failed',
      'settled', 'voided', 'disputed'
    )),

  requested_at timestamptz not null default now(),
  -- End of the day before pickup (00:00 Polish time on the start date).
  due_at timestamptz,
  -- Idempotency for the daily job's T-1 reminder and pickup-day alarm.
  reminded_at timestamptz,
  overdue_notified_at timestamptz,

  stripe_checkout_session_id text,
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  payment_method_type text,
  -- What Stripe actually took: the deposit plus the fee.
  paid_amount numeric(10, 2),
  paid_at timestamptz,

  review_started_at timestamptz,
  review_deadline timestamptz,

  decision text check (decision in (
    'vehicle_ok', 'auto', 'retained', 'cancelled', 'late_payment', 'admin'
  )),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  -- Whether the fee comes back with the deposit when the booking is called
  -- off: true when the owner or GoMambo cancelled, false when the renter did
  -- (Rafał's rule). Written by the server BEFORE it marks the booking
  -- cancelled, so a deposit payment landing in the middle of a cancellation,
  -- and the daily job finishing one that died halfway, both know which rule
  -- applies. Null: the booking was never cancelled through the app.
  cancel_fee_refund boolean,

  -- The owner's claim on the deposit. The reason is shown to the renter on
  -- purpose (it is what they may object to), so it can live on this row.
  retained_amount numeric(10, 2) check (retained_amount is null or (retained_amount > 0 and retained_amount <= amount)),
  retention_reason text,
  retained_at timestamptz,
  objection_deadline timestamptz,
  objected_at timestamptz,
  objection_comment text,

  -- The leg that moves a kept amount to the owner's Connect account.
  transfer_amount numeric(10, 2) check (transfer_amount is null or (transfer_amount >= 0 and transfer_amount <= amount)),
  stripe_transfer_id text,
  transfer_attempts integer not null default 0,
  transfer_claimed_at timestamptz,
  transferred_at timestamptz,
  transfer_failure_reason text,
  stripe_transfer_reversal_id text,
  transfer_reversed_at timestamptz,

  -- The leg that returns money to the renter. refund_amount is the running
  -- total GoMambo has decided to send back; the server compares it with
  -- Stripe's own list of refunds before creating another, so a retry can
  -- never send the same złoty twice.
  refund_amount numeric(10, 2) not null default 0 check (refund_amount >= 0),
  refund_status text check (refund_status in ('pending', 'succeeded', 'failed')),
  stripe_refund_id text,
  refund_attempts integer not null default 0,
  refund_requested_at timestamptz,
  refunded_at timestamptz,
  refund_failure_reason text,
  -- A short lease held by the one server call sending a refund right now:
  -- it compares refund_amount with Stripe's list, sends the gap and records
  -- the result, so two calls can never send the same gap twice. Runs out on
  -- its own if that call dies.
  refund_lock_until timestamptz,

  stripe_dispute_id text,
  disputed_at timestamptz,
  -- Stripe lets a platform hold funds for 90 days; the daily job warns once.
  hold_alerted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_booking_deposits_status on public.booking_deposits(status);
create index if not exists idx_booking_deposits_review_deadline
  on public.booking_deposits(review_deadline) where status = 'in_review';
create index if not exists idx_booking_deposits_objection_deadline
  on public.booking_deposits(objection_deadline) where status = 'retention_pending';
create index if not exists idx_booking_deposits_refund_status
  on public.booking_deposits(refund_status) where refund_status in ('pending', 'failed');

drop trigger if exists on_booking_deposit_updated on public.booking_deposits;
create trigger on_booking_deposit_updated
  before update on public.booking_deposits
  for each row execute function public.set_updated_at();

-- Money GoMambo still holds must not disappear with a booking. Fires on the
-- cascade from bookings too, so deleting the account or the car is refused
-- (and the whole delete rolled back) until the deposit is settled.
create or replace function public.prevent_open_deposit_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in (
       'processing', 'paid', 'in_review', 'retention_pending', 'retention_objected',
       'transferring', 'transfer_failed', 'disputed'
     )
     or old.refund_status in ('pending', 'failed') then
    raise exception 'Kaucja do rezerwacji % nie jest jeszcze rozliczona (status %).', old.booking_id, old.status
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_open_deposit_delete on public.booking_deposits;
create trigger prevent_open_deposit_delete
  before delete on public.booking_deposits
  for each row execute function public.prevent_open_deposit_delete();

-- Same reasoning as 0049: nothing needs to call trigger functions through the
-- API, and a trigger firing does not check EXECUTE.
revoke execute on function public.prevent_open_deposit_delete() from public, anon, authenticated;

alter table public.booking_deposits enable row level security;

-- Both sides of the booking read it (the renter pays and may object, the
-- owner decides), an admin reads everything.
drop policy if exists "booking_deposits_select_participant_or_admin" on public.booking_deposits;
create policy "booking_deposits_select_participant_or_admin"
  on public.booking_deposits for select
  using (public.is_booking_participant(booking_id) or public.is_admin());

-- No insert, update or delete policy: every move is made by the service role
-- after a server action has checked who is acting (the pattern of 0041).
-- Revoked as well, so a policy added by mistake later still opens nothing.
revoke insert, update, delete on table public.booking_deposits from anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- enforce_booking_column_rules — the live definition (0036 + 0040), plus:
--  - deposit_fee_amount is pinned with the other money columns;
--  - PAY-1: a renter can no longer cancel from the start date on. After
--    pickup a cancellation is a dispute about a car someone is holding, and
--    only GoMambo may decide it. Polish calendar day, like the app.
--  - the owner may only make the moves the app's own owner action makes
--    (updateBookingStatus): requested → accepted / declined, accepted →
--    completed. Until now the owner could set any status straight through
--    the API — "cancelled" after pickup (which only GoMambo may do), with
--    no refund of the rental and the deposit's fee wrongly kept, or a
--    status that hides a finished trip from the deposit's review window.
--    Every other change of status by an owner goes through the server
--    (ownerCancelBooking, ownerCancelForUnpaidDeposit), which runs as the
--    service role and is not affected.
-- ─────────────────────────────────────────────────────────────
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
  new.deposit_fee_amount := old.deposit_fee_amount;
  new.deposit_status := old.deposit_status;
  new.stripe_checkout_session_id := old.stripe_checkout_session_id;
  new.stripe_deposit_payment_intent_id := old.stripe_deposit_payment_intent_id;
  -- The daily job's idempotency key for the pickup mail (0040).
  new.pickup_instructions_sent_at := old.pickup_instructions_sent_at;

  -- The rental period and who it is between: extending the trip is a paid
  -- operation (booking_extensions + webhook), never a field edit.
  new.car_id := old.car_id;
  new.owner_id := old.owner_id;
  new.renter_id := old.renter_id;
  new.start_date := old.start_date;
  new.end_date := old.end_date;

  -- Status: the owner drives the booking (accept / decline / complete) and
  -- nothing more; the renter may only walk away from it, and only before
  -- the start date.
  if new.status is distinct from old.status then
    if auth.uid() = old.owner_id
       and ((old.status = 'requested' and new.status in ('accepted', 'declined'))
            or (old.status = 'accepted' and new.status = 'completed')) then
      null;
    elsif auth.uid() = old.renter_id
          and new.status = 'cancelled'
          and old.start_date > (now() at time zone 'Europe/Warsaw')::date then
      null;
    else
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_booking_column_rules() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- Notification types. The old ones stay: rows written before this
-- migration still carry them (deposit_release_failed, deposit_captured).
-- ─────────────────────────────────────────────────────────────
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
    'deposit_overdue', 'deposit_objection'
  ));

alter table public.admin_notifications drop constraint if exists admin_notifications_type_check;
alter table public.admin_notifications add constraint admin_notifications_type_check
  check (type in (
    'new_registration', 'new_car_pending', 'new_identity_verification', 'new_referral',
    'commission_fallback', 'refund_failed', 'deposit_release_failed',
    'bank_transfer_declared', 'damage_reported', 'booking_verification_escalated',
    'new_partner_pending',
    'deposit_refund_failed', 'deposit_transfer_failed', 'deposit_overdue',
    'deposit_objection', 'payment_disputed'
  ));
