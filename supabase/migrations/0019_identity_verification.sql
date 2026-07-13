-- Manual identity/driver's license verification, mirroring the existing
-- car-approval pattern: user uploads a document, admin approves/rejects.
create table public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  document_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.identity_verifications enable row level security;

drop trigger if exists on_identity_verification_updated on public.identity_verifications;
create trigger on_identity_verification_updated
  before update on public.identity_verifications
  for each row execute function public.set_updated_at();

-- Resubmitting a document (by the user) always resets to pending for
-- re-review; only an admin's own update (approve/reject) can set the
-- status, mirroring enforce_car_update_rules for cars.
create or replace function public.enforce_identity_verification_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.status := 'pending';
    new.rejection_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists on_identity_verification_update_rules on public.identity_verifications;
create trigger on_identity_verification_update_rules
  before update on public.identity_verifications
  for each row execute function public.enforce_identity_verification_update_rules();

create policy "identity_verifications_select_own_or_admin"
  on public.identity_verifications for select
  using (user_id = auth.uid() or public.is_admin());

create policy "identity_verifications_insert_own"
  on public.identity_verifications for insert
  with check (user_id = auth.uid());

create policy "identity_verifications_update_own_or_admin"
  on public.identity_verifications for update
  using (user_id = auth.uid() or public.is_admin());

-- Private bucket (unlike car-images/avatars) — ID documents are sensitive.
insert into storage.buckets (id, name, public)
values ('id-documents', 'id-documents', false)
on conflict (id) do nothing;

create policy "id_documents_owner_or_admin_select"
  on storage.objects for select
  using (
    bucket_id = 'id-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

create policy "id_documents_owner_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "id_documents_owner_or_admin_delete"
  on storage.objects for delete
  using (
    bucket_id = 'id-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- Admin gets an in-app notification for new/resubmitted verifications too.
alter table public.admin_notifications drop constraint if exists admin_notifications_type_check;
alter table public.admin_notifications add constraint admin_notifications_type_check
  check (type in ('new_registration', 'new_car_pending', 'new_identity_verification'));
