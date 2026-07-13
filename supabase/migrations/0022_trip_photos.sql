-- Pickup/return photo documentation — owner and renter can each upload
-- photos of the car's condition at pickup and at return, viewable by both
-- sides of the booking, so damage disputes have something to point to
-- (there's no in-platform payment/insurance yet, so this is the cheapest
-- real protection we can ship right now).
create or replace function public.is_booking_participant(p_booking_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.bookings
    where id = p_booking_id
      and (owner_id = auth.uid() or renter_id = auth.uid())
  );
$$;

create table public.trip_photos (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id),
  stage text not null check (stage in ('pickup', 'return')),
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table public.trip_photos enable row level security;

create policy "trip_photos_select_participant_or_admin"
  on public.trip_photos for select
  using (public.is_booking_participant(booking_id) or public.is_admin());

create policy "trip_photos_insert_participant"
  on public.trip_photos for insert
  with check (uploader_id = auth.uid() and public.is_booking_participant(booking_id));

create policy "trip_photos_delete_own_or_admin"
  on public.trip_photos for delete
  using (uploader_id = auth.uid() or public.is_admin());

-- Private bucket, path convention: {booking_id}/{stage}/{uuid}.jpg
insert into storage.buckets (id, name, public)
values ('trip-photos', 'trip-photos', false)
on conflict (id) do nothing;

create policy "trip_photos_storage_select_participant_or_admin"
  on storage.objects for select
  using (
    bucket_id = 'trip-photos'
    and (
      public.is_booking_participant(((storage.foldername(name))[1])::uuid)
      or public.is_admin()
    )
  );

create policy "trip_photos_storage_insert_participant"
  on storage.objects for insert
  with check (
    bucket_id = 'trip-photos'
    and public.is_booking_participant(((storage.foldername(name))[1])::uuid)
  );

create policy "trip_photos_storage_delete_own_or_admin"
  on storage.objects for delete
  using (
    bucket_id = 'trip-photos'
    and (
      public.is_booking_participant(((storage.foldername(name))[1])::uuid)
      or public.is_admin()
    )
  );
