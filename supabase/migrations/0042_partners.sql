-- ─────────────────────────────────────────────────────────────
-- PARTNER — a professional rental company, as a first-class entity.
--
-- Until now the only party that could list a car was a natural person:
-- profiles.id IS auth.users.id, and cars.owner_id points at it. A rental
-- company had to pretend to be a person, with a personal name, a personal
-- phone and a personal driving-licence verification — which is why a company
-- literally could not add a car (createCar demands an approved driving
-- licence of the lister).
--
-- cars.owner_id deliberately STAYS the acting person: bookings.owner_id,
-- conversations.owner_id and the Stripe Connect payout account all hang off
-- it, and re-pointing them is a settlements-stage change. partner_id marks
-- the car as operated by a company and is what the customer is shown.
-- ─────────────────────────────────────────────────────────────

-- Public half. A customer must be able to see WHO is renting them the car
-- (art. 12a ustawy o prawach konsumenta: a platform has to say whether the
-- other side is a trader), so an active partner's presentation data is
-- world-readable. Everything that identifies the company legally or lets
-- someone contact it off-platform lives in partner_private.
create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  trade_name text not null check (char_length(trim(trade_name)) > 0),
  city text,
  description text,
  logo_path text,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'active', 'suspended', 'terminated')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_partners_status on public.partners(status);

-- Private half: RLS protects rows, not columns, and this codebase has
-- already been bitten three times by putting private data on a row someone
-- else may read (cars.registration_number, damage_reports.admin_note,
-- booking_verifications.escalation_reason). NIP, address and contact details
-- are exactly what a competitor or a circumventing customer would want.
create table if not exists public.partner_private (
  partner_id uuid primary key references public.partners(id) on delete cascade,
  legal_name text,
  nip text,
  regon text,
  krs text,
  address_street text,
  address_postal_code text,
  address_city text,
  contact_email text,
  contact_phone text,
  -- Where this partner's payouts will go once settlements move off the
  -- individual member's personal Connect account. Not used yet — Stage 6.
  stripe_connect_account_id text,
  stripe_connect_onboarded boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Which accounts act for the company. One partner, many people — a fleet
-- manager and an office assistant should not share a login.
create table if not exists public.partner_members (
  partner_id uuid not null references public.partners(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'manager' check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  primary key (partner_id, profile_id)
);

create index if not exists idx_partner_members_profile on public.partner_members(profile_id);

create table if not exists public.partner_documents (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  kind text not null check (kind in ('krs', 'ceidg', 'nip_confirmation', 'insurance', 'other')),
  storage_path text not null,
  original_name text,
  valid_until date,
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_partner_documents_partner on public.partner_documents(partner_id);

-- Helper mirroring is_booking_participant: security definer so the policies
-- below can consult partner_members without recursing through its own RLS.
create or replace function public.is_partner_member(p_partner_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.partner_members
    where partner_id = p_partner_id and profile_id = auth.uid()
  );
$$;

alter table public.partners enable row level security;
alter table public.partner_private enable row level security;
alter table public.partner_members enable row level security;
alter table public.partner_documents enable row level security;

drop policy if exists "partners_select_public_or_member" on public.partners;
create policy "partners_select_public_or_member"
  on public.partners for select
  using (status = 'active' or public.is_partner_member(id) or public.is_admin());

drop policy if exists "partners_update_member_or_admin" on public.partners;
create policy "partners_update_member_or_admin"
  on public.partners for update
  using (public.is_partner_member(id) or public.is_admin());

-- Creating the company itself goes through a server action, which also
-- writes the first partner_members row. A bare INSERT policy would let
-- someone create a partner they are not a member of.

drop policy if exists "partner_private_select_member_or_admin" on public.partner_private;
create policy "partner_private_select_member_or_admin"
  on public.partner_private for select
  using (public.is_partner_member(partner_id) or public.is_admin());

drop policy if exists "partner_private_update_member_or_admin" on public.partner_private;
create policy "partner_private_update_member_or_admin"
  on public.partner_private for update
  using (public.is_partner_member(partner_id) or public.is_admin());

drop policy if exists "partner_members_select_member_or_admin" on public.partner_members;
create policy "partner_members_select_member_or_admin"
  on public.partner_members for select
  using (public.is_partner_member(partner_id) or public.is_admin());

drop policy if exists "partner_documents_select_member_or_admin" on public.partner_documents;
create policy "partner_documents_select_member_or_admin"
  on public.partner_documents for select
  using (public.is_partner_member(partner_id) or public.is_admin());

drop policy if exists "partner_documents_insert_member" on public.partner_documents;
create policy "partner_documents_insert_member"
  on public.partner_documents for insert
  with check (public.is_partner_member(partner_id) and verified_at is null);

-- A member must not be able to mark their own company verified, or flip it
-- to 'active'. Same convention as prevent_role_self_escalation: auth.uid()
-- is null for the service role, which is how the server actions write.
create or replace function public.enforce_partner_column_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  -- Only GoMambo decides whether a company is verified and live.
  new.status := old.status;
  new.rejection_reason := old.rejection_reason;
  return new;
end;
$$;

drop trigger if exists enforce_partner_column_rules on public.partners;
create trigger enforce_partner_column_rules
  before update on public.partners
  for each row execute function public.enforce_partner_column_rules();

drop trigger if exists on_partners_updated on public.partners;
create trigger on_partners_updated
  before update on public.partners
  for each row execute function public.set_updated_at();

drop trigger if exists on_partner_private_updated on public.partner_private;
create trigger on_partner_private_updated
  before update on public.partner_private
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- CARS — which company operates this car, and whether it auto-confirms.
-- ─────────────────────────────────────────────────────────────
alter table public.cars
  add column if not exists partner_id uuid references public.partners(id) on delete restrict;

-- Rafał's decision: a Partner confirms each booking rather than having it
-- auto-confirm. Default TRUE so existing peer-to-peer listings keep the
-- instant book they have today — a new feature must never switch off an
-- existing one. Partner cars are created with false.
alter table public.cars
  add column if not exists instant_book boolean not null default true;

create index if not exists idx_cars_partner on public.cars(partner_id);

-- public.cars already has enforce_car_update_rules (0001, fixed in 0004,
-- extended in 0017 for approved<->paused, guard restored in 0023). It pins
-- status, rejection_reason and owner_id for an authenticated non-admin.
-- partner_id has to join that set, or an owner could attach their car to
-- somebody else's company — or detach it from their own to escape the
-- partner rules — with one PATCH through PostgREST.
--
-- Same function, one line added. A SECOND trigger would race the first and
-- the pinning order would be undefined.
create or replace function public.enforce_car_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if not (old.status in ('approved', 'paused') and new.status in ('approved', 'paused')) then
      new.status := old.status;
    end if;
    new.rejection_reason := old.rejection_reason;
    new.owner_id := old.owner_id;
    new.partner_id := old.partner_id;
  end if;

  -- An invariant, not an authorization rule, so it holds for the service
  -- role too: a Partner car always waits for the company to confirm. The
  -- listing tells the customer "zapłacisz dopiero po potwierdzeniu", and
  -- instant_book is otherwise an ordinary unpinned column that
  -- cars_update_own_or_admin lets the owner PATCH straight through PostgREST.
  if new.partner_id is not null then
    new.instant_book := false;
  end if;

  -- A car may not be PUBLISHED while the company behind it is not active.
  --
  -- Deliberately outside the auth.uid() branch, so it binds the owner, the
  -- admin and the service role alike: this is an invariant about what the
  -- catalogue may contain, not a permission. Enforcing it here rather than in
  -- each query is the whole point — the listing, the city dropdown, the
  -- homepage, /wynajmij-auto, the sitemap and sendInquiry all filter on
  -- cars.status alone, and adding a partner join to five places would leave
  -- the sixth wrong. Nothing else needs to know.
  if new.partner_id is not null and new.status = 'approved' then
    if not exists (
      select 1 from public.partners p
      where p.id = new.partner_id and p.status = 'active'
    ) then
      new.status := 'paused';
      -- Marked, not just paused: reactivation restores exactly the cars that
      -- were taken down for this reason, and nothing else.
      new.rejection_reason := 'Wstrzymane: wypożyczalnia nie jest aktywna w GoMambo.';
    end if;
  end if;

  return new;
end;
$$;

-- The UPDATE trigger above cannot protect the INSERT path, and
-- cars_insert_own (0001) only checks owner_id and status. Without this, any
-- signed-in account could POST a car carrying the partner_id of a verified
-- company — those ids are world-readable by design — and the listing would
-- present a private individual's car as that company's fleet, complete with
-- "to ta firma odpowiada za stan techniczny pojazdu".
create or replace function public.enforce_car_insert_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.partner_id is not null then
    -- Rejected outright rather than silently nulled: a car whose company
    -- quietly vanished would be a confusing listing, and the only way to
    -- reach this is a hand-made request.
    if auth.uid() is not null
       and not public.is_admin()
       and not public.is_partner_member(new.partner_id) then
      raise exception 'Nie należysz do tej wypożyczalni.';
    end if;
    new.instant_book := false;
  end if;

  -- A car may not be PUBLISHED while the company behind it is not active.
  --
  -- Deliberately outside the auth.uid() branch, so it binds the owner, the
  -- admin and the service role alike: this is an invariant about what the
  -- catalogue may contain, not a permission. Enforcing it here rather than in
  -- each query is the whole point — the listing, the city dropdown, the
  -- homepage, /wynajmij-auto, the sitemap and sendInquiry all filter on
  -- cars.status alone, and adding a partner join to five places would leave
  -- the sixth wrong. Nothing else needs to know.
  if new.partner_id is not null and new.status = 'approved' then
    if not exists (
      select 1 from public.partners p
      where p.id = new.partner_id and p.status = 'active'
    ) then
      new.status := 'paused';
      -- Marked, not just paused: reactivation restores exactly the cars that
      -- were taken down for this reason, and nothing else.
      new.rejection_reason := 'Wstrzymane: wypożyczalnia nie jest aktywna w GoMambo.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_car_insert_rules on public.cars;
create trigger enforce_car_insert_rules
  before insert on public.cars
  for each row execute function public.enforce_car_insert_rules();

alter table public.admin_notifications drop constraint if exists admin_notifications_type_check;
alter table public.admin_notifications add constraint admin_notifications_type_check
  check (type in (
    'new_registration', 'new_car_pending', 'new_identity_verification', 'new_referral',
    'commission_fallback', 'refund_failed', 'deposit_release_failed',
    'bank_transfer_declared', 'damage_reported', 'booking_verification_escalated',
    'new_partner_pending'
  ));

-- ─────────────────────────────────────────────────────────────
-- Private bucket for company registration documents. Keyed on the PARTNER
-- id, not the uploader's id, because a company has several members and the
-- documents belong to the company — so the policies consult
-- is_partner_member rather than comparing against auth.uid() the way the
-- id-documents bucket does.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('partner-documents', 'partner-documents', false)
on conflict (id) do nothing;

drop policy if exists "partner_documents_member_or_admin_select" on storage.objects;
create policy "partner_documents_member_or_admin_select"
  on storage.objects for select
  using (
    bucket_id = 'partner-documents'
    and (
      exists (
        select 1 from public.partner_members pm
        where pm.profile_id = auth.uid()
          and pm.partner_id::text = (storage.foldername(name))[1]
      )
      or public.is_admin()
    )
  );

drop policy if exists "partner_documents_member_insert" on storage.objects;
create policy "partner_documents_member_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'partner-documents'
    and exists (
      select 1 from public.partner_members pm
      where pm.profile_id = auth.uid()
        and pm.partner_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "partner_documents_member_or_admin_delete" on storage.objects;
create policy "partner_documents_member_or_admin_delete"
  on storage.objects for delete
  using (
    bucket_id = 'partner-documents'
    and (
      exists (
        select 1 from public.partner_members pm
        where pm.profile_id = auth.uid()
          and pm.partner_id::text = (storage.foldername(name))[1]
      )
      or public.is_admin()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- The catalogue rule, enforced from the other side.
--
-- The triggers on public.cars above check the partner's status on every
-- write to a CAR. But the state they forbid — an 'approved' car belonging to
-- a company that is not active — can be created with no write to cars at
-- all: by suspending the company. Leaving that to application code means the
-- rule holds only as long as two separate statements always both succeed,
-- which is the scattered enforcement this was meant to replace. One UPDATE
-- run by hand in the SQL editor would break it silently.
--
-- AFTER UPDATE, so it sees the committed new status, and in the same
-- transaction as the status change itself.
-- ─────────────────────────────────────────────────────────────
create or replace function public.sync_partner_fleet_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'active' then
    -- Back exactly the cars WE took down, not the ones the Partner paused
    -- for their own reasons.
    update public.cars
    set status = 'approved', rejection_reason = null
    where partner_id = new.id
      and status = 'paused'
      and rejection_reason = 'Wstrzymane: wypożyczalnia nie jest aktywna w GoMambo.';
  else
    update public.cars
    set status = 'paused',
        rejection_reason = 'Wstrzymane: wypożyczalnia nie jest aktywna w GoMambo.'
    where partner_id = new.id
      and status = 'approved';
  end if;

  return new;
end;
$$;

drop trigger if exists sync_partner_fleet_status on public.partners;
create trigger sync_partner_fleet_status
  after update on public.partners
  for each row execute function public.sync_partner_fleet_status();
