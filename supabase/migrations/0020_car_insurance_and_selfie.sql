-- Mandatory OC (third-party liability) insurance document per car, and an
-- optional live selfie capture alongside the existing ID document for
-- identity verification. Both reviewed manually by admin — no automated
-- face-matching (that would require processing biometric data and a paid
-- third-party vendor).
alter table public.cars add column registration_number text;
alter table public.cars add column insurance_document_path text;

-- Private bucket (same pattern as id-documents) — insurance documents
-- contain personal/financial details.
insert into storage.buckets (id, name, public)
values ('car-insurance', 'car-insurance', false)
on conflict (id) do nothing;

create policy "car_insurance_owner_or_admin_select"
  on storage.objects for select
  using (
    bucket_id = 'car-insurance'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

create policy "car_insurance_owner_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'car-insurance'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "car_insurance_owner_or_admin_delete"
  on storage.objects for delete
  using (
    bucket_id = 'car-insurance'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

alter table public.identity_verifications add column selfie_path text;
