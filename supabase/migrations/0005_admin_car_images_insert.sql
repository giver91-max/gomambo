-- Allow admins to add photos to any car, not just their own — needed so
-- admin can use the same owner edit page to fix up any listing.
drop policy if exists "car_images_insert_via_own_car" on public.car_images;

create policy "car_images_insert_via_own_car_or_admin"
  on public.car_images for insert
  with check (
    exists (
      select 1 from public.cars
      where cars.id = car_images.car_id
        and (cars.owner_id = auth.uid() or public.is_admin())
    )
  );
