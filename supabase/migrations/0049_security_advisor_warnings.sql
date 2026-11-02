-- Supabase Security Advisor: 28 warnings, which come down to four things.

-- 1. Public buckets allowed LISTING every file.
--
-- avatars and car-images are public buckets, so their files are served by
-- public URL (getPublicUrl) without any RLS check — that is how the site shows
-- them. The broad "bucket_id = …" SELECT policies were not needed for that;
-- what they added was the ability to list the whole bucket through the API.
-- Paths start with the owner's user id, so that listing enumerated every
-- user id on the platform, and exposed the photos of rejected and pending
-- cars that never appear on the site.
--
-- SELECT is still needed by an owner for their own files — Storage looks the
-- object up before deleting it — so the policies are narrowed, not dropped:
-- the same scope as the existing INSERT/DELETE policies.
drop policy if exists "avatars_storage_public_read" on storage.objects;
create policy "avatars_storage_owner_read"
  on storage.objects for select
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "car_images_storage_public_read" on storage.objects;
create policy "car_images_storage_owner_or_admin_read"
  on storage.objects for select
  using (
    bucket_id = 'car-images'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin())
  );

-- 2. Trigger functions were executable through the API.
--
-- They are SECURITY DEFINER and, like every function, executable by PUBLIC by
-- default, so PostgREST exposes them at /rest/v1/rpc/<name>. Postgres refuses
-- to run a trigger function outside a trigger, so this was not exploitable —
-- but nothing needs to call them directly, and a trigger firing does not check
-- EXECUTE, so revoking it changes nothing for the triggers themselves.
revoke execute on function public.enforce_booking_column_rules() from public, anon, authenticated;
revoke execute on function public.enforce_car_insert_rules() from public, anon, authenticated;
revoke execute on function public.enforce_car_update_rules() from public, anon, authenticated;
revoke execute on function public.enforce_identity_verification_update_rules() from public, anon, authenticated;
revoke execute on function public.enforce_partner_column_rules() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.prevent_role_self_escalation() from public, anon, authenticated;
revoke execute on function public.set_review_car_id() from public, anon, authenticated;
revoke execute on function public.sync_partner_fleet_status() from public, anon, authenticated;

-- 3. set_updated_at had no fixed search_path. It only sets new.updated_at,
-- but pinning it removes any chance of a shadowing object being picked up.
alter function public.set_updated_at() set search_path = public;

-- 4. Deliberately LEFT executable: is_admin(), is_booking_participant() and
-- is_partner_member(). They are called inside 64 RLS policies, which run with
-- the privileges of the querying role — revoking EXECUTE from anon or
-- authenticated would break every one of those tables. Each answers a
-- question about the CALLER only (auth.uid()), so calling one through the
-- API reveals nothing the caller doesn't already know about themselves.
comment on function public.is_admin() is
  'RLS helper; must stay executable by anon/authenticated (used in policies). Reveals only whether the caller is an admin.';
comment on function public.is_booking_participant(uuid) is
  'RLS helper; must stay executable by anon/authenticated (used in policies). Reveals only whether the caller takes part in the given booking.';
comment on function public.is_partner_member(uuid) is
  'RLS helper; must stay executable by anon/authenticated (used in policies). Reveals only whether the caller belongs to the given partner.';
