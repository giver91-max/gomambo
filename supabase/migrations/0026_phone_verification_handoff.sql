-- Sixt-style phone handoff for identity verification: user scans a QR code
-- shown on one device, continues on their phone (email code -> front/back
-- license photos -> selfie), and gets an automated face-match result via
-- AWS Rekognition. The existing single-device upload flow (identity-
-- verification-manager.tsx) stays fully intact as an alternative.

-- 1. Extend identity_verifications for the automated path. document_path
-- keeps meaning "front/primary document image" for both flows.
alter table public.identity_verifications add column document_back_path text;
alter table public.identity_verifications add column face_match_score numeric(5, 2);
alter table public.identity_verifications add column face_match_result text not null default 'not_run'
  check (face_match_result in ('not_run', 'match', 'no_match', 'error'));
alter table public.identity_verifications add column verification_method text not null default 'manual'
  check (verification_method in ('manual', 'phone_handoff'));
alter table public.identity_verifications add column biometric_consent_at timestamptz;

-- 2. Fix enforce_identity_verification_update_rules the same way 0023 fixed
-- enforce_car_update_rules: is_admin() reads auth.uid(), which is NULL for
-- a service-role client, so an automated approve from the handoff finalize
-- step (service-role, no auth.uid()) would otherwise be silently reverted
-- back to 'pending' by this trigger. Only lock the row down when there IS
-- an authenticated non-admin user acting on it.
create or replace function public.enforce_identity_verification_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.status := 'pending';
    new.rejection_reason := null;
  end if;
  return new;
end;
$$;

-- 3. QR handoff session table. The phone side never gets a real Supabase
-- Auth session, so RLS stays locked down (service-role mediates every
-- read/write, token/code checked in application code) except for one
-- narrow select-own policy needed so the desktop's realtime subscription
-- (which connects as `authenticated`, not `service_role`) can receive
-- postgres_changes events at all.
create table public.identity_verification_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  email text not null,
  code_hash text,
  code_expires_at timestamptz,
  code_attempts int not null default 0,
  code_send_count int not null default 0,
  code_last_sent_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'code_sent', 'claimed', 'photos_uploaded', 'completed', 'expired', 'cancelled')),
  claimed_at timestamptz,
  handoff_expires_at timestamptz not null default (now() + interval '15 minutes'),
  document_front_path text,
  document_back_path text,
  selfie_path text,
  document_front_uploaded_at timestamptz,
  document_back_uploaded_at timestamptz,
  selfie_uploaded_at timestamptz,
  result_identity_verification_id uuid references public.identity_verifications(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index identity_verification_handoffs_user_id_idx on public.identity_verification_handoffs (user_id);

drop trigger if exists on_identity_verification_handoff_updated on public.identity_verification_handoffs;
create trigger on_identity_verification_handoff_updated
  before update on public.identity_verification_handoffs
  for each row execute function public.set_updated_at();

alter table public.identity_verification_handoffs enable row level security;

create policy "identity_verification_handoffs_select_own"
  on public.identity_verification_handoffs for select
  using (user_id = auth.uid());

-- No insert/update/delete policy: only the service-role client (server
-- actions) writes to this table, bypassing RLS entirely, same pattern as
-- notifyOwner() in admin/cars/actions.ts.

alter publication supabase_realtime add table public.identity_verification_handoffs;
