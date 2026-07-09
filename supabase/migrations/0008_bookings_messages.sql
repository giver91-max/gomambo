-- ─────────────────────────────────────────────────────────────
-- BOOKINGS — a real rental request, replacing the old fire-and-forget
-- inquiry e-mail. Renter must be logged in to create one.
-- ─────────────────────────────────────────────────────────────
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  renter_id uuid not null references public.profiles(id),
  start_date date not null,
  end_date date not null,
  status text not null default 'requested'
    check (status in ('requested', 'accepted', 'declined', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bookings enable row level security;

create policy "bookings_select_participant"
  on public.bookings for select
  using (auth.uid() = owner_id or auth.uid() = renter_id);

create policy "bookings_insert_renter"
  on public.bookings for insert
  with check (auth.uid() = renter_id);

create policy "bookings_update_participant"
  on public.bookings for update
  using (auth.uid() = owner_id or auth.uid() = renter_id);

-- reuses public.set_updated_at() defined in 0001_init.sql
create trigger on_booking_updated
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- CONVERSATIONS + MESSAGES — one thread per (car, renter) pair.
-- ─────────────────────────────────────────────────────────────
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  renter_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (car_id, renter_id)
);

alter table public.conversations enable row level security;

create policy "conversations_select_participant"
  on public.conversations for select
  using (auth.uid() = owner_id or auth.uid() = renter_id);

create policy "conversations_insert_participant"
  on public.conversations for insert
  with check (auth.uid() = owner_id or auth.uid() = renter_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.messages enable row level security;

create policy "messages_select_participant"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations
      where conversations.id = messages.conversation_id
        and (conversations.owner_id = auth.uid() or conversations.renter_id = auth.uid())
    )
  );

create policy "messages_insert_participant"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations
      where conversations.id = messages.conversation_id
        and (conversations.owner_id = auth.uid() or conversations.renter_id = auth.uid())
    )
  );

create policy "messages_update_participant"
  on public.messages for update
  using (
    exists (
      select 1 from public.conversations
      where conversations.id = messages.conversation_id
        and (conversations.owner_id = auth.uid() or conversations.renter_id = auth.uid())
    )
  );
