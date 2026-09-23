-- The machine's verdict on an identity document was writable by the person
-- being verified.
--
-- RLS lets a user UPDATE their own identity_verifications row (policy
-- "identity_verifications_update_own_or_admin", 0019), and the trigger pinned
-- exactly two columns: status and rejection_reason. face_match_result,
-- face_match_score and verification_method were left open. The anon key ships
-- inside the browser bundle, so anyone holding their own session token can
-- PATCH their own row straight through PostgREST, past every server action —
-- the same threat model 0036 spelled out for cars.
--
-- The consequence was not a direct self-approval (status is still forced to
-- 'pending'), but something quieter and arguably worse: the human reviewing
-- the document decides while looking at "Automat: zgodne 99%" that the
-- applicant wrote themselves. The hint is only worth anything if it can only
-- come from us.
--
-- Rule: the document images are the user's to set. The verdict on them is not.
-- Changing an image also RESETS the verdict rather than keeping a stale one,
-- because a score computed against a previous photo says nothing about the new
-- one and would be read as if it did.
create or replace function public.enforce_identity_verification_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No auth.uid() means our own server code (service role), which has already
  -- done the authorising. Same convention as enforce_booking_column_rules.
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

  -- Consent is a record of something that happened; a user must not be able
  -- to backdate it, invent it, or erase it.
  new.biometric_consent_at := old.biometric_consent_at;

  return new;
end;
$$;
