-- Mutual reviews between owner and renter after a completed booking.
-- car_id is denormalized from the booking (via trigger, not client input)
-- so the car detail page can query ratings without joining bookings.
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  car_id uuid not null references public.cars(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  reviewee_id uuid not null references public.profiles(id),
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (booking_id, reviewer_id)
);

alter table public.reviews enable row level security;

create or replace function public.set_review_car_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select car_id into new.car_id from public.bookings where id = new.booking_id;
  return new;
end;
$$;

create trigger on_review_set_car_id
  before insert on public.reviews
  for each row execute function public.set_review_car_id();

-- Ratings are public trust signals, same as any real car-sharing platform.
create policy "reviews_select_public" on public.reviews for select using (true);

create policy "reviews_insert_participant" on public.reviews for insert
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.id = booking_id
        and b.status = 'completed'
        and (
          (b.renter_id = auth.uid() and reviewee_id = b.owner_id)
          or (b.owner_id = auth.uid() and reviewee_id = b.renter_id)
        )
    )
  );

create index idx_reviews_car_id on public.reviews(car_id);
