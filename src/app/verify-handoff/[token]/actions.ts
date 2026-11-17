"use server";

import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCodeEmail } from "@/lib/email";
import { checkDocumentLegibility, detectFace } from "@/lib/face-match";
import { assessIdentity, buildAutoReview, type IdentityAssessment } from "@/lib/identity-gates";
import { alertAdminsAboutVerification } from "@/lib/identity-alerts";
import {
  abandonedClaimCutoff,
  codeMatches,
  currentVerificationPaths,
  extendedHandoffExpiry,
  generateEmailCode,
  getHandoffByToken,
  hashEmailCode,
  isAbandonedClaim,
} from "@/lib/verification-handoff";
import type {
  FaceMatchResult,
  IdentityVerificationHandoff,
  IdentityVerificationStatus,
} from "@/types/database";
import { BIOMETRIC_CONSENT_VERSION } from "@/lib/terms";
import { rekognitionImageProblem, sniffImageFormat } from "@/lib/verification-image";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_CODE_SENDS = 5;
const MAX_CODE_ATTEMPTS = 5;

// Worded for both ways in: a QR code scanned from a computer, and the
// "Otwórz na tym telefonie" link on a phone, where there is no computer.
// Names the section, not a button: a freshly loaded profile labels it
// "Zweryfikuj przez telefon (QR)" on a computer and "Zrób zdjęcia aparatem
// krok po kroku" on a phone — „Wygeneruj nowy kod” shows only mid-session.
const NEW_CODE_HINT = "Utwórz nowy kod w profilu na GoMambo, w sekcji „Weryfikacja tożsamości”.";
const EXPIRED_MESSAGE = `Ta sesja wygasła. ${NEW_CODE_HINT}`;
// The same words as the server page for a closed session (page.tsx): the
// photos may well have been sent from the form, so nothing here says the
// verification still has to be finished.
const CANCELLED_MESSAGE =
  "Ta sesja została zamknięta — w profilu na GoMambo utworzono nowy kod albo wysłano zdjęcia z formularza. Status weryfikacji sprawdzisz w profilu.";
const ALREADY_VERIFIED_MESSAGE =
  "Twoja tożsamość została już zweryfikowana — te zdjęcia nie są potrzebne. Możesz zamknąć tę stronę.";
const TOO_MANY_CODES_MESSAGE =
  "Wysłaliśmy już wiele kodów w krótkim czasie. Spróbuj ponownie za godzinę albo dodaj zdjęcia z formularza w profilu.";

// Across ALL of a user's sessions: the per-session limits below reset with
// every new code, and each code is an e-mail through the same Resend account
// that delivers every other GoMambo mail (lib/email.ts).
const USER_CODE_SENDS_PER_HOUR = 10;

/** Why photos can no longer be sent to this session, in words the person can act on. */
function inactiveMessage(status: IdentityVerificationHandoff["status"]): string {
  if (status === "expired") return EXPIRED_MESSAGE;
  if (status === "cancelled") return CANCELLED_MESSAGE;
  if (status === "completed") return "Ta weryfikacja jest już zakończona.";
  return "Najpierw potwierdź kod z e-maila.";
}

/**
 * Codes e-mailed to a user in the last hour, over all of their sessions.
 * code_send_count is per session and counts every send, so the sum
 * over-counts a little for a session started over an hour ago — on the safe
 * side for a limit.
 */
async function codesSentLastHour(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<number> {
  const { data } = await admin
    .from("identity_verification_handoffs")
    .select("code_send_count")
    .eq("user_id", userId)
    .gte("code_last_sent_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  return (data ?? []).reduce((sum, row) => sum + row.code_send_count, 0);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

export async function getHandoffPublicState(token: string) {
  const handoff = await getHandoffByToken(token);
  if (!handoff) return null;
  return {
    status: handoff.status,
    maskedEmail: maskEmail(handoff.email),
    documentFrontUploadedAt: handoff.document_front_uploaded_at,
    documentBackUploadedAt: handoff.document_back_uploaded_at,
    selfieUploadedAt: handoff.selfie_uploaded_at,
  };
}

export async function sendHandoffCode(token: string): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const handoff = await getHandoffByToken(token);
  if (!handoff) return { error: "Link jest nieprawidłowy lub wygasł." };
  if (handoff.status === "expired" || handoff.status === "cancelled") {
    return { error: inactiveMessage(handoff.status) };
  }
  if (!["pending", "code_sent"].includes(handoff.status)) {
    return { error: `Ta sesja weryfikacji nie jest już aktywna. ${NEW_CODE_HINT}` };
  }
  if (handoff.code_send_count >= MAX_CODE_SENDS) {
    await admin.from("identity_verification_handoffs").update({ status: "expired" }).eq("id", handoff.id);
    return { error: `Zbyt wiele prób wysłania kodu. ${NEW_CODE_HINT}` };
  }
  if (handoff.code_last_sent_at && Date.now() - new Date(handoff.code_last_sent_at).getTime() < RESEND_COOLDOWN_MS) {
    return { error: "Poczekaj chwilę przed ponownym wysłaniem kodu." };
  }
  if ((await codesSentLastHour(admin, handoff.user_id)) >= USER_CODE_SENDS_PER_HOUR) {
    return { error: TOO_MANY_CODES_MESSAGE };
  }

  const code = generateEmailCode();
  const now = new Date();
  // The checks above read the row before writing it, so requests fired at
  // once would all pass them. This update claims the send: it only goes
  // through while the session still holds the count that was read, so of
  // several racing requests exactly one sends, and MAX_CODE_SENDS and the
  // cooldown hold. The status is re-checked as well — a session closed
  // meanwhile (a newer code, the profile form) must not come back to life
  // as 'code_sent'.
  const { data: claimed, error: updateError } = await admin
    .from("identity_verification_handoffs")
    .update({
      code_hash: hashEmailCode(code),
      code_expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
      code_attempts: 0,
      code_send_count: handoff.code_send_count + 1,
      code_last_sent_at: now.toISOString(),
      status: "code_sent",
    })
    .eq("id", handoff.id)
    .eq("code_send_count", handoff.code_send_count)
    .in("status", ["pending", "code_sent"])
    .select("id");

  if (updateError) {
    console.error("[verify-handoff] could not store the code", updateError);
    return { error: "Nie udało się wysłać kodu. Spróbuj ponownie." };
  }
  if (!claimed || claimed.length === 0) {
    const current = await getHandoffByToken(token);
    if (current && (current.status === "expired" || current.status === "cancelled")) {
      return { error: inactiveMessage(current.status) };
    }
    // Another request for this session sent a code a moment ago.
    return { error: "Poczekaj chwilę przed ponownym wysłaniem kodu." };
  }
  // The per-user limit once more, with this send counted: requests racing on
  // several of the user's sessions at once all passed the check above.
  // Whichever counts last sees every send claimed before it, so no more than
  // USER_CODE_SENDS_PER_HOUR codes go out. A code refused here was never
  // e-mailed, so nobody can use it.
  if ((await codesSentLastHour(admin, handoff.user_id)) > USER_CODE_SENDS_PER_HOUR) {
    return { error: TOO_MANY_CODES_MESSAGE };
  }

  const sent = await sendCodeEmail({
    to: handoff.email,
    subject: "Twój kod weryfikacyjny GoMambo",
    html: `
      <p>Twój kod weryfikacyjny do potwierdzenia tożsamości na GoMambo:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${code}</p>
      <p>Kod wygasa za 10 minut. Jeśli to nie Ty, zignoruj tę wiadomość.</p>
    `,
  });

  if (!sent) return { error: "Nie udało się wysłać kodu e-mail. Spróbuj ponownie." };
  return { error: null };
}

export async function claimHandoff(token: string, code: string): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const handoff = await getHandoffByToken(token);
  if (!handoff) return { error: "Link jest nieprawidłowy lub wygasł." };
  if (handoff.status === "claimed" || handoff.status === "photos_uploaded") return { error: null };
  if (handoff.status !== "code_sent") {
    return { error: "Najpierw wyślij kod na e-mail." };
  }
  if (!handoff.code_hash || !handoff.code_expires_at || new Date(handoff.code_expires_at) < new Date()) {
    return { error: "Kod wygasł. Wyślij nowy kod." };
  }
  if (handoff.code_attempts >= MAX_CODE_ATTEMPTS) {
    await admin.from("identity_verification_handoffs").update({ status: "expired" }).eq("id", handoff.id);
    return { error: `Zbyt wiele nieprawidłowych prób. ${NEW_CODE_HINT}` };
  }

  if (!codeMatches(code, handoff.code_hash)) {
    await admin
      .from("identity_verification_handoffs")
      .update({ code_attempts: handoff.code_attempts + 1 })
      .eq("id", handoff.id);
    return { error: "Nieprawidłowy kod." };
  }

  const { error } = await admin
    .from("identity_verification_handoffs")
    .update({
      status: "claimed",
      claimed_at: new Date().toISOString(),
      handoff_expires_at: extendedHandoffExpiry(handoff),
    })
    .eq("id", handoff.id);

  if (error) {
    console.error("[verify-handoff] could not claim the session", error);
    return { error: "Nie udało się potwierdzić kodu. Spróbuj ponownie." };
  }
  return { error: null };
}

type PhotoKind = "front" | "back" | "selfie";

export async function uploadHandoffPhoto(
  token: string,
  kind: PhotoKind,
  consentGiven: boolean,
  formData: FormData
): Promise<{ error: string | null }> {
  if (!consentGiven) {
    return { error: "Zgoda na przetworzenie wizerunku jest wymagana, żeby kontynuować." };
  }

  const admin = createAdminClient();
  const handoff = await getHandoffByToken(token);
  if (!handoff) return { error: "Link jest nieprawidłowy lub wygasł." };
  if (!["claimed", "photos_uploaded"].includes(handoff.status)) {
    return { error: inactiveMessage(handoff.status) };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Brak zdjęcia." };

  const buffer = Buffer.from(await file.arrayBuffer());
  // What Rekognition can take, checked on the bytes rather than the declared
  // type: the camera on this page always produces a JPEG well under the
  // limit, so anything else is a stale page or a hand-made request.
  const problem = rekognitionImageProblem(buffer);
  if (problem === "size") return { error: "Zdjęcie jest za duże (maks. 5 MB). Zrób je ponownie." };
  if (problem) return { error: "Nie możemy odczytać tego zdjęcia. Zrób je ponownie." };

  // Catch an obviously unusable shot (no face, or two people in frame)
  // right away instead of only discovering it once compareFaces() runs at
  // the very end of the flow. The back of a license has no photo on it, so
  // this only applies to the front (document photo) and the selfie.
  if (kind === "front" || kind === "selfie") {
    const detection = await detectFace(buffer, kind === "selfie" ? "selfie" : "document");
    if (!detection.ok) {
      return {
        error:
          detection.reason === "multiple_faces"
            ? "Na selfie widać więcej niż jedną osobę. Zrób zdjęcie ponownie — w kadrze powinna być tylko Twoja twarz."
            : detection.reason === "unreadable_image"
              ? "Nie możemy odczytać tego zdjęcia. Zrób je ponownie."
              : kind === "selfie"
                ? "Nie wykryto wyraźnej twarzy. Sprawdź oświetlenie i ostrość i spróbuj ponownie."
                : "Nie widać zdjęcia w dokumencie. Upewnij się, że fotografujesz przód prawa jazdy i że zdjęcie jest ostre.",
      };
    }
  }

  // Same idea for legibility — both sides of the document carry printed
  // text, the selfie doesn't, so this only applies to front/back.
  if (kind === "front" || kind === "back") {
    const legibility = await checkDocumentLegibility(buffer);
    if (!legibility.ok) {
      return {
        error:
          legibility.reason === "unreadable_image"
            ? "Nie możemy odczytać tego zdjęcia. Zrób je ponownie."
            : "Zdjęcie jest nieczytelne. Sprawdź oświetlenie i ostrość, upewnij się że cały dokument jest widoczny, i spróbuj ponownie.",
      };
    }
  }

  const path = `${handoff.user_id}/${crypto.randomUUID()}-${kind}.jpg`;

  const { error: uploadError } = await admin.storage
    .from("id-documents")
    .upload(path, buffer, {
      // The real type, for the admin preview — not whatever the form claimed.
      contentType: sniffImageFormat(buffer) === "png" ? "image/png" : "image/jpeg",
    });
  if (uploadError) {
    console.error("[verify-handoff] photo upload failed", uploadError);
    return { error: "Nie udało się zapisać zdjęcia. Spróbuj ponownie." };
  }

  const nowIso = new Date().toISOString();
  const previousPath =
    kind === "front"
      ? handoff.document_front_path
      : kind === "back"
        ? handoff.document_back_path
        : handoff.selfie_path;
  const update = {
    ...(kind === "front"
      ? { document_front_path: path, document_front_uploaded_at: nowIso }
      : kind === "back"
        ? { document_back_path: path, document_back_uploaded_at: nowIso }
        : { selfie_path: path, selfie_uploaded_at: nowIso }),
    // Each photo taken buys the session more time, so nobody actively
    // working through the steps is cut off half-way.
    handoff_expires_at: extendedHandoffExpiry(handoff),
  };

  const { data: updated, error: updateError } = await admin
    .from("identity_verification_handoffs")
    .update(update)
    .eq("id", handoff.id)
    .select("document_front_path, document_back_path, selfie_path")
    .single();

  if (updateError) {
    await admin.storage.from("id-documents").remove([path]);
    console.error("[verify-handoff] could not record the photo", updateError);
    return { error: "Nie udało się zapisać zdjęcia. Spróbuj ponownie." };
  }

  // A retake replaces the earlier shot of the same side; that file is now
  // referenced by nothing, so it goes — unless the saved verification still
  // uses it (it can, after "Spróbuj jeszcze raz").
  if (previousPath && previousPath !== path) {
    const inUse = await currentVerificationPaths(admin, handoff.user_id);
    if (!inUse.includes(previousPath)) {
      await admin.storage.from("id-documents").remove([previousPath]);
    }
  }

  if (updated?.document_front_path && updated?.document_back_path && updated?.selfie_path) {
    await admin
      .from("identity_verification_handoffs")
      .update({ status: "photos_uploaded" })
      .eq("id", handoff.id);
  }

  return { error: null };
}

// Called when the user chooses "try again" after an inconclusive automated
// match — resets just the selfie so uploadHandoffPhoto/finalizeHandoff can
// run again without redoing the (already-gated, already-uploaded) document
// photos.
export async function retrySelfieVerification(token: string): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const handoff = await getHandoffByToken(token);
  if (!handoff) return { error: "Link jest nieprawidłowy lub wygasł." };
  if (handoff.status !== "completed") {
    return { error: "Ta sesja weryfikacji nie jest jeszcze zakończona." };
  }

  // The retake starts a fresh deadline window too: a session that just
  // finished would otherwise expire under someone choosing to try again.
  const { error } = await admin
    .from("identity_verification_handoffs")
    .update({
      status: "photos_uploaded",
      selfie_path: null,
      selfie_uploaded_at: null,
      handoff_expires_at: extendedHandoffExpiry(handoff),
    })
    .eq("id", handoff.id);

  if (error) {
    console.error("[verify-handoff] could not reopen the session for a retake", error);
    return { error: "Nie udało się przygotować ponownego selfie. Spróbuj ponownie." };
  }
  return { error: null };
}

type FinalizeResult = {
  error: string | null;
  /** Retrying cannot help: the session is over and a new code is needed. */
  terminal?: boolean;
  result?: FaceMatchResult;
  approved?: boolean;
  status?: IdentityVerificationStatus;
};

const STILL_SAVING: FinalizeResult = {
  error:
    "Zapisujemy wynik weryfikacji — spróbuj ponownie za chwilę. Jeśli to się powtarza, odczekaj kilka minut i spróbuj jeszcze raz albo wygeneruj nowy kod w profilu na GoMambo.",
};

/**
 * What a finished session decided, read back from the saved verification.
 * "again" means a claim abandoned by a finalize that never finished was dealt
 * with, and the caller should read the session afresh and finalize it again.
 */
async function storedOutcome(
  admin: ReturnType<typeof createAdminClient>,
  handoff: IdentityVerificationHandoff,
  mayRecover: boolean
): Promise<FinalizeResult | "again"> {
  // Claimed by a finalize that is still saving (see the claim below): the
  // verification row does not hold this session's result yet, and reading it
  // now could report an older decision — a past rejection included.
  if (!handoff.result_identity_verification_id) {
    if (mayRecover && isAbandonedClaim(handoff)) return recoverAbandonedClaim(admin, handoff);
    return STILL_SAVING;
  }
  const { data: existing } = await admin
    .from("identity_verifications")
    .select("face_match_result, status")
    .eq("user_id", handoff.user_id)
    .maybeSingle();
  // Reload of a finished session: report what actually happened, so the
  // page doesn't promise a human review to someone already approved.
  return {
    error: null,
    result: existing?.face_match_result,
    approved: existing?.status === "approved",
    status: existing?.status,
  };
}

/**
 * A session finalizeHandoff claimed and never linked to a verification: the
 * link failed, the claim could not be released after a failed save, or the
 * function died in between (see isAbandonedClaim).
 */
async function recoverAbandonedClaim(
  admin: ReturnType<typeof createAdminClient>,
  handoff: IdentityVerificationHandoff
): Promise<FinalizeResult | "again"> {
  const { data: saved } = await admin
    .from("identity_verifications")
    .select("id, status, face_match_result, document_path, document_back_path, selfie_path, updated_at")
    .eq("user_id", handoff.user_id)
    .maybeSingle();

  // The save went through and only the link is missing. Every finalize runs
  // on a selfie file of its own (a retake clears the previous one), so a
  // verification pointing at this session's selfie was written by it. No
  // admin e-mail here: when only the link failed, that finalize went on to
  // send it, and a pending verification is in the admin queue either way.
  if (saved && handoff.selfie_path && saved.selfie_path === handoff.selfie_path) {
    const { error } = await admin
      .from("identity_verification_handoffs")
      .update({ result_identity_verification_id: saved.id })
      .eq("id", handoff.id)
      .eq("status", "completed")
      .is("result_identity_verification_id", null);
    if (error) console.error("[verify-handoff] could not link an abandoned claim to its verification", error);
    return {
      error: null,
      result: saved.face_match_result,
      approved: saved.status === "approved",
      status: saved.status,
    };
  }

  // The verification changed after this session was claimed: the profile
  // form sent newer photos, another phone session finished, or an admin
  // decided — while the claim was still too fresh for that newer step to
  // close it (retireUnfinishedHandoffs leaves claims under five minutes old
  // alone). Handed back, this session would finish over the newer result and
  // delete that result's photos as "old" ones, so it is closed the way retire
  // would have closed it. Both timestamps come from the database clock
  // (set_updated_at, 0019/0026), and an unlinked claim's updated_at is the
  // moment of the claim (isAbandonedClaim).
  if (saved && new Date(saved.updated_at).getTime() > new Date(handoff.updated_at).getTime()) {
    const { data: closed, error } = await admin
      .from("identity_verification_handoffs")
      .update({ status: "cancelled" })
      .eq("id", handoff.id)
      .eq("status", "completed")
      .is("result_identity_verification_id", null)
      .lt("updated_at", abandonedClaimCutoff())
      .select("id");
    if (error) {
      console.error("[verify-handoff] could not close a superseded claim", error);
      return { error: "Nie udało się zapisać weryfikacji. Spróbuj ponownie." };
    }
    // Changed meanwhile (closed by a newer code, say): the fresh read decides.
    if (!closed || closed.length === 0) return "again";

    // Its photos go, as retire's do — except any the verification uses.
    const photos = [handoff.document_front_path, handoff.document_back_path, handoff.selfie_path];
    const inUse = [saved.document_path, saved.document_back_path, saved.selfie_path];
    const discard = photos.filter((p): p is string => !!p && !inUse.includes(p));
    const { error: removeError } =
      discard.length > 0 ? await admin.storage.from("id-documents").remove(discard) : { error: null };
    if (removeError) {
      console.error("[verify-handoff] could not remove a superseded claim's photos", removeError);
    } else if (photos.some(Boolean)) {
      await admin
        .from("identity_verification_handoffs")
        .update({ document_front_path: null, document_back_path: null, selfie_path: null })
        .eq("id", handoff.id);
    }
    return {
      error: saved.status === "approved" ? ALREADY_VERIFIED_MESSAGE : CANCELLED_MESSAGE,
      terminal: true,
    };
  }

  // Nothing of this session was saved and nothing newer was: hand it back,
  // photos and all, so it is finalized again. Only a claim that is still
  // abandoned is undone — one closed by a newer code meanwhile
  // (retireUnfinishedHandoffs) stays closed.
  // The deadline moves on as after any other step, or a session that waited
  // out the claim would expire under the retry.
  const { error } = await admin
    .from("identity_verification_handoffs")
    .update({ status: "photos_uploaded", handoff_expires_at: extendedHandoffExpiry(handoff) })
    .eq("id", handoff.id)
    .eq("status", "completed")
    .is("result_identity_verification_id", null)
    .lt("updated_at", abandonedClaimCutoff());
  if (error) {
    console.error("[verify-handoff] could not release an abandoned claim", error);
    return { error: "Nie udało się zapisać weryfikacji. Spróbuj ponownie." };
  }
  return "again";
}

export async function finalizeHandoff(token: string): Promise<FinalizeResult> {
  return finalize(token, true);
}

async function finalize(token: string, mayRecover: boolean): Promise<FinalizeResult> {
  const admin = createAdminClient();
  const handoff = await getHandoffByToken(token);
  if (!handoff) return { error: "Link jest nieprawidłowy lub wygasł.", terminal: true };
  if (handoff.status === "completed") {
    const outcome = await storedOutcome(admin, handoff, mayRecover);
    // Once only: the session is read afresh, and whatever happened to it
    // meanwhile (closed, claimed again) decides the answer.
    return outcome === "again" ? finalize(token, false) : outcome;
  }
  if (handoff.status === "expired" || handoff.status === "cancelled") {
    return { error: inactiveMessage(handoff.status), terminal: true };
  }
  if (handoff.status !== "photos_uploaded") {
    return { error: "Prześlij wszystkie zdjęcia przed zakończeniem." };
  }
  if (!handoff.document_front_path || !handoff.selfie_path) {
    return { error: "Brakuje wymaganych zdjęć." };
  }

  const [{ data: frontBlob }, { data: selfieBlob }] = await Promise.all([
    admin.storage.from("id-documents").download(handoff.document_front_path),
    admin.storage.from("id-documents").download(handoff.selfie_path),
  ]);

  // Both photos must be readable before anything is claimed or saved, as on
  // the desktop route. Saving without them left a verification pointing the
  // admins at missing images, and deleted the current verification's photos
  // as "old" ones. Nothing is claimed yet, so a retry starts clean; should
  // the files be gone for good, a new code is the way on.
  if (!frontBlob || !selfieBlob) {
    return {
      error:
        "Nie udało się odczytać zdjęć z tej sesji. Spróbuj ponownie. Jeśli to się powtarza, utwórz nowy kod w profilu na GoMambo, w sekcji „Weryfikacja tożsamości”.",
    };
  }

  // One shared assessment for both ways in (phone QR and desktop upload), so
  // a gate tightened in one can't be silently missing from the other.
  const [frontBuffer, selfieBuffer] = await Promise.all([
    frontBlob.arrayBuffer().then((buf) => Buffer.from(buf)),
    selfieBlob.arrayBuffer().then((buf) => Buffer.from(buf)),
  ]);
  const assessment: IdentityAssessment = await assessIdentity(selfieBuffer, frontBuffer);
  const matchOutcome = assessment.match;

  // Claim the session before writing anything. The assessment above takes
  // seconds, and meanwhile "Nowy kod" or a submission from the profile form
  // may retire this session and delete its photos (retireUnfinishedHandoffs).
  // Saving after that would leave a verification — possibly approved — whose
  // images are gone, and delete the newer submission's files as "old" ones.
  // Only one of the two can win: retire never touches a 'completed' session,
  // and this update only succeeds on one still waiting to be finalized. The
  // result id is cleared until the row is saved: it is what tells the desktop
  // (verification-qr-panel) that the profile can be refreshed — after
  // "Spróbuj jeszcze raz" it still holds the previous attempt's id.
  const { data: claimed, error: claimError } = await admin
    .from("identity_verification_handoffs")
    .update({ status: "completed", result_identity_verification_id: null })
    .eq("id", handoff.id)
    .eq("status", "photos_uploaded")
    .select("id");
  if (claimError) {
    console.error("[verify-handoff] could not claim the session for finalizing", claimError);
    return { error: "Nie udało się zapisać weryfikacji. Spróbuj ponownie." };
  }
  if (!claimed || claimed.length === 0) {
    const current = await getHandoffByToken(token);
    if (!current) return { error: "Link jest nieprawidłowy lub wygasł.", terminal: true };
    // A second request for the same session (a retry after a dropped
    // connection) that lost to the first one. That claim is seconds old, so
    // nothing is recovered here.
    if (current.status === "completed") {
      const outcome = await storedOutcome(admin, current, false);
      return outcome === "again" ? STILL_SAVING : outcome;
    }
    if (current.status === "expired" || current.status === "cancelled") {
      return { error: inactiveMessage(current.status), terminal: true };
    }
    return { error: "Nie udało się zapisać weryfikacji. Spróbuj ponownie." };
  }
  // Undoes the claim when nothing was saved, so "Spróbuj ponownie" can run
  // again. Should this fail too, the claim is recovered once it goes stale
  // (recoverAbandonedClaim).
  const releaseClaim = async () => {
    const { error } = await admin
      .from("identity_verification_handoffs")
      .update({ status: "photos_uploaded" })
      .eq("id", handoff.id)
      .eq("status", "completed");
    if (error) console.error("[verify-handoff] could not release the claim", error);
  };

  const { data: existing } = await admin
    .from("identity_verifications")
    .select("id, status, rejection_reason, document_path, document_back_path, selfie_path, updated_at")
    .eq("user_id", handoff.user_id)
    .maybeSingle();

  // An approval that happened AFTER this session was opened (on the
  // computer, or by an admin) must not be overwritten by it: this result
  // would replace the approval and, with any gate failing, drop the account
  // back to pending. Opening a session on an account that was ALREADY
  // approved requires an explicit "Zmień dokument" on the profile
  // (createVerificationHandoff), so that one may proceed.
  if (
    existing?.status === "approved" &&
    new Date(existing.updated_at).getTime() > new Date(handoff.created_at).getTime()
  ) {
    await admin.from("identity_verification_handoffs").update({ status: "cancelled" }).eq("id", handoff.id);
    const inUse = [existing.document_path, existing.document_back_path, existing.selfie_path];
    const discard = [handoff.document_front_path, handoff.document_back_path, handoff.selfie_path].filter(
      (p): p is string => !!p && !inUse.includes(p)
    );
    if (discard.length > 0) await admin.storage.from("id-documents").remove(discard);
    return { error: ALREADY_VERIFIED_MESSAGE, terminal: true };
  }

  // 5. A human's REJECTION outranks every automatic gate.
  //
  // Resubmitting after a rejection is supported on purpose — the rejection
  // e-mail asks for exactly that. But the gates above cannot see WHY someone
  // was rejected (a photo of a screen, a borrowed document, a name that
  // didn't match), so without this the same document could be pushed through
  // the same flow again and silently overwrite the admin's decision, with no
  // limit on attempts. After a rejection a human always looks again.
  const previouslyRejected = existing?.status === "rejected";

  const autoApproved = assessment.passes && !previouslyRejected;

  const verificationRow = {
    document_path: handoff.document_front_path,
    document_back_path: handoff.document_back_path,
    selfie_path: handoff.selfie_path,
    face_match_score: matchOutcome.score,
    face_match_result: matchOutcome.result,
    verification_method: "phone_handoff" as const,
    biometric_consent_at: new Date().toISOString(),
    biometric_consent_version: BIOMETRIC_CONSENT_VERSION,
    status: autoApproved ? ("approved" as const) : ("pending" as const),
    rejection_reason: null,
    auto_review: buildAutoReview(assessment, previouslyRejected),
  };

  let verificationId: string;
  if (existing) {
    const { error } = await admin.from("identity_verifications").update(verificationRow).eq("id", existing.id);
    if (error) {
      console.error("[verify-handoff] could not save the verification", error);
      await releaseClaim();
      return { error: "Nie udało się zapisać weryfikacji. Spróbuj ponownie." };
    }
    verificationId = existing.id;

    const oldPaths = [existing.document_path, existing.document_back_path, existing.selfie_path].filter(
      (p): p is string => !!p && ![verificationRow.document_path, verificationRow.document_back_path, verificationRow.selfie_path].includes(p)
    );
    if (oldPaths.length > 0) {
      await admin.storage.from("id-documents").remove(oldPaths);
    }
  } else {
    const { data: inserted, error } = await admin
      .from("identity_verifications")
      .insert({ user_id: handoff.user_id, ...verificationRow })
      .select("id")
      .single();
    if (error || !inserted) {
      console.error("[verify-handoff] could not save the verification", error);
      await releaseClaim();
      return { error: "Nie udało się zapisać weryfikacji. Spróbuj ponownie." };
    }
    verificationId = inserted.id;
  }

  // The signal the desktop waits for before refreshing the profile — set as
  // soon as the row is saved, before the admin mails go out. Tried twice: an
  // unlinked session reads as "still saving" everywhere until the claim goes
  // stale. The verification itself is saved either way, so the phone hears
  // the result; a link that fails both times is made by the next retry or
  // reload once the claim is stale (recoverAbandonedClaim).
  const linkResult = async () =>
    (
      await admin
        .from("identity_verification_handoffs")
        .update({ result_identity_verification_id: verificationId })
        .eq("id", handoff.id)
    ).error;
  const resultError = (await linkResult()) && (await linkResult());
  if (resultError) {
    console.error("[verify-handoff] could not link the session to its verification", resultError);
  }

  // Every verification reaches the admins by e-mail; the ones that need a
  // decision also land in the panel queue. See lib/identity-alerts.ts.
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", handoff.user_id)
    .single();
  await alertAdminsAboutVerification(admin, {
    verificationId,
    fullName: profile?.full_name || "nieznany",
    email: handoff.email,
    route: "telefon",
    assessment,
    autoApproved,
    previouslyRejected,
    previousRejectionReason: existing?.rejection_reason,
  });

  return {
    error: null,
    result: matchOutcome.result,
    approved: autoApproved,
    status: autoApproved ? "approved" : "pending",
  };
}
