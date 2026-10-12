-- Every identity verification now e-mails the admins. Without a limit, the
-- desktop route could be called in a loop and each call would send another
-- e-mail — with the user's own free-text name in the subject — through the
-- same Resend account that delivers login codes. One account could have used
-- up the day's sending quota and locked everyone else out of code sign-in.
--
-- admin_alerted_at records when the admins were last told about this
-- verification. The app claims it atomically before alerting and skips the
-- alert if one went out in the last 15 minutes (lib/identity-alerts.ts).
--
-- An admin REJECTION clears it (admin/verifications/actions.ts), so the one
-- case that must never be swallowed — someone resubmitting after being
-- rejected — always gets through.
alter table public.identity_verifications
  add column if not exists admin_alerted_at timestamptz;

-- The throttle is only worth anything if the person being throttled cannot
-- reset it. RLS lets a user UPDATE their own row through PostgREST (0019), so
-- the column is pinned here alongside the verdict columns 0044 already pins.
create or replace function public.enforce_identity_verification_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No auth.uid() means our own server code (service role).
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  -- An ordinary user: resubmitting always returns to the human queue.
  new.status := 'pending';
  new.rejection_reason := null;

  if new.document_path is distinct from old.document_path
     or new.document_back_path is distinct from old.document_back_path
     or new.selfie_path is distinct from old.selfie_path then
    new.face_match_result := 'not_run';
    new.face_match_score := null;
    new.verification_method := 'manual';
  else
    new.face_match_result := old.face_match_result;
    new.face_match_score := old.face_match_score;
    new.verification_method := old.verification_method;
  end if;

  new.biometric_consent_at := old.biometric_consent_at;
  new.admin_alerted_at := old.admin_alerted_at;

  return new;
end;
$$;
