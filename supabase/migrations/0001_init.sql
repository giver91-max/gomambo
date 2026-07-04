-- GoMambo — Etap 1: schema + RLS
-- Wklej całość w Supabase Dashboard > SQL Editor > Run

-- ─────────────────────────────────────────────────────────────
-- 1. PROFILES
-- ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin')),
  full_name text not null default '',
  phone text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- auto-create profile row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- prevent a user from promoting themselves to admin via a client-side update
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role <> old.role and not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ) then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_role_change on public.profiles;
create trigger on_profile_role_change
  before update on public.profiles
  for each row execute function public.prevent_role_self_escalation();

-- helper used by RLS policies below (security definer avoids RLS recursion)
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "profiles_update_own_or_admin"
  on public.profiles for update
  using (id = auth.uid() or public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 2. CARS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.cars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  brand text not null,
  model text not null,
  year int not null check (year between 1990 and extract(year from now())::int + 1),
  price_per_day numeric(10, 2) not null check (price_per_day > 0),
  city text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cars enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists on_car_updated on public.cars;
create trigger on_car_updated
  before update on public.cars
  for each row execute function public.set_updated_at();

-- owners cannot change status/owner_id themselves — only admins can
create or replace function public.enforce_car_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.status := old.status;
    new.rejection_reason := old.rejection_reason;
    new.owner_id := old.owner_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_car_update_rules on public.cars;
create trigger on_car_update_rules
  before update on public.cars
  for each row execute function public.enforce_car_update_rules();

create policy "cars_select_own_or_admin_or_approved"
  on public.cars for select
  using (owner_id = auth.uid() or public.is_admin() or status = 'approved');

create policy "cars_insert_own"
  on public.cars for insert
  with check (owner_id = auth.uid() and status = 'pending');

create policy "cars_update_own_or_admin"
  on public.cars for update
  using (owner_id = auth.uid() or public.is_admin());

create policy "cars_delete_own_or_admin"
  on public.cars for delete
  using (owner_id = auth.uid() or public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 3. CAR_IMAGES
-- ─────────────────────────────────────────────────────────────
create table if not exists public.car_images (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  storage_path text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.car_images enable row level security;

create policy "car_images_select_via_car"
  on public.car_images for select
  using (
    exists (
      select 1 from public.cars
      where cars.id = car_images.car_id
        and (cars.owner_id = auth.uid() or public.is_admin() or cars.status = 'approved')
    )
  );

create policy "car_images_insert_via_own_car"
  on public.car_images for insert
  with check (
    exists (
      select 1 from public.cars
      where cars.id = car_images.car_id and cars.owner_id = auth.uid()
    )
  );

create policy "car_images_delete_via_own_car_or_admin"
  on public.car_images for delete
  using (
    exists (
      select 1 from public.cars
      where cars.id = car_images.car_id
        and (cars.owner_id = auth.uid() or public.is_admin())
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 4. STORAGE — bucket na zdjęcia aut
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('car-images', 'car-images', true)
on conflict (id) do nothing;

create policy "car_images_storage_public_read"
  on storage.objects for select
  using (bucket_id = 'car-images');

create policy "car_images_storage_owner_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'car-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "car_images_storage_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'car-images'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );
