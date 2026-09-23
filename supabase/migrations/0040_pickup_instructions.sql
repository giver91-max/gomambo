-- Pickup instructions are sent once, ~24h before the trip starts, by the
-- daily cron (src/app/api/cron/daily). The timestamp is what makes that
-- idempotent: a retried or double-fired cron run must not mail the renter
-- twice, and the job has no other way to tell.
alter table public.bookings
  add column if not exists pickup_instructions_sent_at timestamptz;

-- This column is the cron's only idempotency key, and bookings_update_participant
-- (0008) still lets either party PATCH their own booking row through PostgREST
-- with the anon key from the browser bundle. 0036's trigger pins the columns
-- that existed then; a column added afterwards falls straight through it, so an
-- owner could stamp it themselves and suppress the renter's pickup mail — the
-- very mail that tells the renter to photograph the car before driving off.
--
-- Same function as 0036, plus this column. Any future server-owned column on
-- bookings has to be added here too.
create or replace function public.enforce_booking_column_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  new.payment_status := old.payment_status;
  new.payment_method := old.payment_method;
  new.total_price := old.total_price;
  new.platform_fee_amount := old.platform_fee_amount;
  new.deposit_amount := old.deposit_amount;
  new.deposit_status := old.deposit_status;
  new.stripe_checkout_session_id := old.stripe_checkout_session_id;
  new.stripe_deposit_payment_intent_id := old.stripe_deposit_payment_intent_id;
  new.pickup_instructions_sent_at := old.pickup_instructions_sent_at;

  new.car_id := old.car_id;
  new.owner_id := old.owner_id;
  new.renter_id := old.renter_id;
  new.start_date := old.start_date;
  new.end_date := old.end_date;

  if new.status is distinct from old.status then
    if auth.uid() = old.owner_id then
      null;
    elsif auth.uid() = old.renter_id and new.status = 'cancelled' then
      null;
    else
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;
