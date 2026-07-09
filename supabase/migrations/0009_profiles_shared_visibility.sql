-- Owners and renters who share a booking or conversation need to see each
-- other's name (e.g. in the messages inbox and booking list) — the existing
-- profiles_select_own_or_admin policy only allows seeing your own row.
-- RLS policies are OR'd together, so this purely extends visibility.
create policy "profiles_select_via_shared_booking_or_conversation"
  on public.profiles for select
  using (
    exists (
      select 1 from public.bookings
      where (bookings.owner_id = auth.uid() and bookings.renter_id = profiles.id)
         or (bookings.renter_id = auth.uid() and bookings.owner_id = profiles.id)
    )
    or exists (
      select 1 from public.conversations
      where (conversations.owner_id = auth.uid() and conversations.renter_id = profiles.id)
         or (conversations.renter_id = auth.uid() and conversations.owner_id = profiles.id)
    )
  );
