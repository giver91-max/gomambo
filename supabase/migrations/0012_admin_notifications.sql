-- System-generated notifications for admins (new registrations, new cars
-- pending review), shown in-app in addition to the existing email alerts.
create table public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('new_registration', 'new_car_pending')),
  body text not null,
  link text,
  created_at timestamptz not null default now()
);
alter table public.admin_notifications enable row level security;

create policy "admin_notifications_select_admin" on public.admin_notifications for select
  using (public.is_admin());
create policy "admin_notifications_insert_admin" on public.admin_notifications for insert
  with check (public.is_admin());

create table public.admin_notification_reads (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.admin_notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (notification_id, user_id)
);
alter table public.admin_notification_reads enable row level security;

create policy "admin_notification_reads_select_own" on public.admin_notification_reads for select
  using (user_id = auth.uid() or public.is_admin());
create policy "admin_notification_reads_insert_own" on public.admin_notification_reads for insert
  with check (user_id = auth.uid());
