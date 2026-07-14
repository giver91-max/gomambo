-- Personal, per-user notifications (distinct from admin_notifications,
-- which is a global feed only admins can see). Used first for telling an
-- owner their car was approved/rejected — /dashboard/notifications
-- previously only ever showed data to admins because it read
-- admin_notifications, which RLS restricts to is_admin().
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('car_approved', 'car_rejected')),
  body text not null,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_idx on public.notifications (user_id);

alter table public.notifications enable row level security;

create policy "notifications_select_own"
  on public.notifications for select
  using (user_id = auth.uid());

create policy "notifications_update_own"
  on public.notifications for update
  using (user_id = auth.uid());

-- The current inserter (car approve/reject) uses a service-role client,
-- which bypasses RLS entirely — this policy exists so a future
-- admin-authenticated (non-service-role) insert path also works.
create policy "notifications_insert_admin"
  on public.notifications for insert
  with check (public.is_admin());
