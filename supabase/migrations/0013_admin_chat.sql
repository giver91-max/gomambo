-- Replace the one-way admin_messages announcements with a real two-way
-- support chat: one thread per user, either side can send messages.
create table public.admin_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_conversations enable row level security;

create policy "admin_conversations_select" on public.admin_conversations for select
  using (user_id = auth.uid() or public.is_admin());
create policy "admin_conversations_insert" on public.admin_conversations for insert
  with check (user_id = auth.uid() or public.is_admin());

create table public.admin_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.admin_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.admin_chat_messages enable row level security;

create policy "admin_chat_messages_select" on public.admin_chat_messages for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.admin_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );
create policy "admin_chat_messages_insert" on public.admin_chat_messages for insert
  with check (
    sender_id = auth.uid()
    and (
      public.is_admin()
      or exists (
        select 1 from public.admin_conversations c
        where c.id = conversation_id and c.user_id = auth.uid()
      )
    )
  );
create policy "admin_chat_messages_update" on public.admin_chat_messages for update
  using (
    public.is_admin()
    or exists (
      select 1 from public.admin_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

-- Carry over existing direct (non-broadcast) messages and their read state
-- before dropping the old one-way tables.
insert into public.admin_conversations (user_id)
select distinct recipient_id from public.admin_messages where recipient_id is not null
on conflict (user_id) do nothing;

insert into public.admin_chat_messages (conversation_id, sender_id, body, created_at, read_at)
select c.id, m.sender_id, m.body, m.created_at,
  (select min(r.read_at) from public.admin_message_reads r where r.message_id = m.id)
from public.admin_messages m
join public.admin_conversations c on c.user_id = m.recipient_id
where m.recipient_id is not null;

drop table public.admin_message_reads;
drop table public.admin_messages;
