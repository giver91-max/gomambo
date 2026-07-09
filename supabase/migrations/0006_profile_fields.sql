-- Profile fields: avatar + notification preferences (phone already exists).
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists notify_email boolean not null default true;
alter table public.profiles add column if not exists notify_sms boolean not null default false;

-- Storage bucket for profile photos, mirroring car-images policies.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars_storage_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_storage_owner_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_storage_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
