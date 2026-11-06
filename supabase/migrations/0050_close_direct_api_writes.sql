-- Three writes the app never makes from the browser, but the browser could.
-- All of them go through PostgREST with the public anon key plus the user's
-- own session, skipping every check the server actions do.

-- 1. A fake conversation exposed anyone's phone number and full name.
--
-- The old policy only required the caller to be ONE of the two sides. So a
-- fresh account (no verification needed) could insert a conversation with
-- any owner_id — public on every listing — as the other side, and the
-- profiles policy for "people you share a conversation with" then returned
-- that person's whole row: phone, full name. An owner could do the same to
-- any user id they knew, with themselves as owner_id.
--
-- The app only ever creates a thread from sendInquiry, as the renter, about
-- an approved car, after checking the renter's identity verification. The
-- policy now requires exactly that: the caller is the renter, the owner is
-- the car's real owner, the car is approved, and the caller is verified.
drop policy if exists "conversations_insert_participant" on public.conversations;
create policy "conversations_insert_verified_renter"
  on public.conversations for insert
  with check (
    renter_id = (select auth.uid())
    and renter_id <> owner_id
    and exists (
      select 1 from public.cars
      where cars.id = conversations.car_id
        and cars.owner_id = conversations.owner_id
        and cars.status = 'approved'
    )
    and exists (
      select 1 from public.identity_verifications iv
      where iv.user_id = (select auth.uid())
        and iv.status = 'approved'
    )
  );

-- 2. A user could forge their own identity-verification result.
--
-- identity_verifications_insert_own let a user insert their row with
-- face_match_result = 'match', face_match_score = 99.9 and a made-up
-- auto_review — status had to be 'pending', so it still went to a human, but
-- the review card then showed the automat vouching for it. Both routes that
-- create a verification (the desktop upload and the phone handoff) write with
-- the service role after running the checks themselves, so the browser needs
-- no INSERT at all. UPDATE goes the same way: only the service role and the
-- admin's approve/reject actions (which run as the admin) change a row.
drop policy if exists "identity_verifications_insert_own" on public.identity_verifications;
drop policy if exists "identity_verifications_update_own_or_admin" on public.identity_verifications;
create policy "identity_verifications_update_admin"
  on public.identity_verifications for update
  using (public.is_admin())
  with check (public.is_admin());
revoke insert on table public.identity_verifications from anon, authenticated;

-- 3. A forged "extension" refunded somebody else's booking.
--
-- booking_extensions_insert_renter let a renter insert an extension row for
-- their own booking carrying ANY stripe_checkout_session_id — including the
-- paid session of a different booking, which they can read on their own
-- bookings. Cancelling then treated that payment as a paid extension and
-- refunded it in full with reverse_transfer, while the other booking stayed
-- "paid" and the car was driven for free. booking_extra_charges had the same
-- shape on the owner side. The app inserts both with the service role
-- (payment-actions.ts, bookings/actions.ts), so the policies only ever served
-- an attacker. refundCheckoutSession also now refuses a session whose Stripe
-- metadata does not belong to the row it was read from.
drop policy if exists "booking_extensions_insert_renter" on public.booking_extensions;
drop policy if exists "booking_extra_charges_insert_owner" on public.booking_extra_charges;
revoke insert on table public.booking_extensions from anon, authenticated;
revoke insert on table public.booking_extra_charges from anon, authenticated;
