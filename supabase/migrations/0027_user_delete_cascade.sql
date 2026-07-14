-- Admin "delete user account" needs every FK pointing at profiles to
-- cascade — otherwise deleting a profile with any booking, message, or
-- review errors out with a foreign-key violation the moment the user has
-- done anything on the platform. Per product decision, deletion cascades
-- fully, including data visible to the other side of a booking/review
-- (e.g. deleting an owner also removes reviews the renter received from
-- them) — there is no anonymize-and-keep-shared-history option here.
--
-- Constraint names are looked up dynamically instead of hardcoded, since
-- Postgres's auto-generated names aren't independently verifiable from
-- outside a direct SQL connection.
do $$
declare
  fk record;
begin
  for fk in
    select tc.table_name, kcu.column_name, tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and ccu.table_name = 'profiles'
      and (tc.table_name, kcu.column_name) in (
        ('bookings', 'owner_id'), ('bookings', 'renter_id'),
        ('conversations', 'owner_id'), ('conversations', 'renter_id'),
        ('messages', 'sender_id'),
        ('admin_chat_messages', 'sender_id'),
        ('reviews', 'reviewer_id'), ('reviews', 'reviewee_id'),
        ('trip_photos', 'uploader_id')
      )
  loop
    execute format('alter table public.%I drop constraint %I', fk.table_name, fk.constraint_name);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.profiles(id) on delete cascade',
      fk.table_name, fk.constraint_name, fk.column_name
    );
  end loop;
end $$;
