-- Why the automatic approval did or did not let a verification through, kept
-- WITH the verification.
--
-- Until now the reasons ("w kadrze dokumentu jest więcej niż jedna osoba",
-- "nie potwierdzono ważności (pole 4b)", …) existed only inside the text of a
-- queue notification and an e-mail. The review card in /admin/verifications —
-- the screen where the decision is actually made — showed a score and told
-- the admin to go and find the reason in the notifications.
--
-- Shape (written by lib/identity-gates.ts buildAutoReview):
--   { "reasons": ["…", …],          -- failed gates; empty when it passed
--     "licenceExpiry": "02.05.2033", -- field 4b as read, or null
--     "licenceExpired": false,       -- or null when 4b was unreadable
--     "previouslyRejected": false }  -- a human rejection blocked the automat
alter table public.identity_verifications
  add column if not exists auto_review jsonb;

-- The reviewer decides on this, so the person being reviewed must not be able
-- to write it — otherwise an empty "reasons" list is one PATCH away. Pinned
-- with the other verdict columns (0044, 0046); a new image resets it, because
-- a verdict about the previous photo says nothing about the new one.
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
    new.auto_review := null;
  else
    new.face_match_result := old.face_match_result;
    new.face_match_score := old.face_match_score;
    new.verification_method := old.verification_method;
    new.auto_review := old.auto_review;
  end if;

  new.biometric_consent_at := old.biometric_consent_at;
  new.admin_alerted_at := old.admin_alerted_at;

  return new;
end;
$$;
