-- Admin → user announcements/direct messages, separate from the
-- owner/renter booking chat. recipient_id null = broadcast to everyone.
create table public.admin_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id),
  recipient_id uuid references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.admin_messages enable row level security;

create policy "admin_messages_select"
  on public.admin_messages for select
  using (
    public.is_admin()
    or recipient_id = auth.uid()
    or recipient_id is null
  );

create policy "admin_messages_insert_admin"
  on public.admin_messages for insert
  with check (public.is_admin() and sender_id = auth.uid());

-- per-user read tracking, needed since a broadcast has many recipients
create table public.admin_message_reads (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.admin_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (message_id, user_id)
);

alter table public.admin_message_reads enable row level security;

create policy "admin_message_reads_select_own"
  on public.admin_message_reads for select
  using (user_id = auth.uid() or public.is_admin());

create policy "admin_message_reads_insert_own"
  on public.admin_message_reads for insert
  with check (user_id = auth.uid());
