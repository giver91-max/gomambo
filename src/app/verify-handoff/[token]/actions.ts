"use server";

import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCodeEmail } from "@/lib/email";
import { checkDocumentLegibility, detectFace } from "@/lib/face-match";
import {
  assessIdentity,
  describeAssessment,
  emptyAssessment,
  type IdentityAssessment,
} from "@/lib/identity-gates";
import {
  codeMatches,
  generateEmailCode,
  getHandoffByToken,
  hashEmailCode,
} from "@/lib/verification-handoff";
import type { FaceMatchResult } from "@/types/database";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_CODE_SENDS = 5;
const MAX_CODE_ATTEMPTS = 5;

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
  if (!["pending", "code_sent"].includes(handoff.status)) {
    return { error: "Ta sesja weryfikacji nie jest już aktywna. Wygeneruj nowy kod QR." };
  }
  if (handoff.code_send_count >= MAX_CODE_SENDS) {
    await admin.from("identity_verification_handoffs").update({ status: "expired" }).eq("id", handoff.id);
    return { error: "Zbyt wiele prób wysłania kodu. Zeskanuj kod QR ponownie." };
  }
  if (handoff.code_last_sent_at && Date.now() - new Date(handoff.code_last_sent_at).getTime() < RESEND_COOLDOWN_MS) {
    return { error: "Poczekaj chwilę przed ponownym wysłaniem kodu." };
  }

  const code = generateEmailCode();
  const now = new Date();
  const { error: updateError } = await admin
    .from("identity_verification_handoffs")
    .update({
      code_hash: hashEmailCode(code),
      code_expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
      code_attempts: 0,
      code_send_count: handoff.code_send_count + 1,
      code_last_sent_at: now.toISOString(),
      status: "code_sent",
    })
    .eq("id", handoff.id);

  if (updateError) return { error: updateError.message };

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
    return { error: "Zbyt wiele nieprawidłowych prób. Zeskanuj kod QR ponownie." };
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
    .update({ status: "claimed", claimed_at: new Date().toISOString() })
    .eq("id", handoff.id);

  return { error: error?.message ?? null };
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
    return { error: "Ta sesja weryfikacji nie jest już aktywna." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Brak zdjęcia." };
  if (!file.type.startsWith("image/")) return { error: "Plik musi być zdjęciem." };
  if (file.size > MAX_FILE_BYTES) return { error: "Plik przekracza 8 MB." };

  const buffer = Buffer.from(await file.arrayBuffer());

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
          "Zdjęcie jest nieczytelne. Sprawdź oświetlenie i ostrość, upewnij się że cały dokument jest widoczny, i spróbuj ponownie.",
      };
    }
  }

  const path = `${handoff.user_id}/${crypto.randomUUID()}-${kind}.jpg`;

  const { error: uploadError } = await admin.storage
    .from("id-documents")
    .upload(path, buffer, { contentType: file.type });
  if (uploadError) return { error: uploadError.message };

  const nowIso = new Date().toISOString();
  const update =
    kind === "front"
      ? { document_front_path: path, document_front_uploaded_at: nowIso }
      : kind === "back"
        ? { document_back_path: path, document_back_uploaded_at: nowIso }
        : { selfie_path: path, selfie_uploaded_at: nowIso };

  const { data: updated, error: updateError } = await admin
    .from("identity_verification_handoffs")
    .update(update)
    .eq("id", handoff.id)
    .select("document_front_path, document_back_path, selfie_path")
    .single();

  if (updateError) return { error: updateError.message };

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

  const { error } = await admin
    .from("identity_verification_handoffs")
    .update({ status: "photos_uploaded", selfie_path: null, selfie_uploaded_at: null })
    .eq("id", handoff.id);

  return { error: error?.message ?? null };
}

export async function finalizeHandoff(
  token: string
): Promise<{ error: string | null; result?: FaceMatchResult; approved?: boolean }> {
  const admin = createAdminClient();
  const handoff = await getHandoffByToken(token);
  if (!handoff) return { error: "Link jest nieprawidłowy lub wygasł." };
  if (handoff.status === "completed") {
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
    };
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

  // One shared assessment for both ways in (phone QR and desktop upload), so
  // a gate tightened in one can't be silently missing from the other.
  let assessment: IdentityAssessment = emptyAssessment();
  if (frontBlob && selfieBlob) {
    const [frontBuffer, selfieBuffer] = await Promise.all([
      frontBlob.arrayBuffer().then((buf) => Buffer.from(buf)),
      selfieBlob.arrayBuffer().then((buf) => Buffer.from(buf)),
    ]);
    assessment = await assessIdentity(selfieBuffer, frontBuffer);
  }
  const matchOutcome = assessment.match;

  const { data: existing } = await admin
    .from("identity_verifications")
    .select("id, status, rejection_reason, document_path, document_back_path, selfie_path")
    .eq("user_id", handoff.user_id)
    .maybeSingle();

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
    status: autoApproved ? ("approved" as const) : ("pending" as const),
    rejection_reason: null,
  };

  let verificationId: string;
  if (existing) {
    const { error } = await admin.from("identity_verifications").update(verificationRow).eq("id", existing.id);
    if (error) return { error: error.message };
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
    if (error || !inserted) return { error: error?.message ?? "Nie udało się zapisać weryfikacji." };
    verificationId = inserted.id;
  }

  // The queue is a to-do list, so only what still needs doing goes on it.
  // Auto-approved verifications stay visible in /admin/verifications with
  // their score, so they can still be spot-checked — they just don't ask
  // anyone to act.
  if (!autoApproved) {
    const { data: profile } = await admin.from("profiles").select("full_name").eq("id", handoff.user_id).single();
    const detail = describeAssessment(assessment);

    // A resubmission after a rejection is the case that must never pass
    // quietly, so it leads the message.
    const rejected = previouslyRejected
      ? `UWAGA: to konto było wcześniej ODRZUCONE${
          existing?.rejection_reason ? ` (powód: ${existing.rejection_reason})` : ""
        }. `
      : "";

    await admin.from("admin_notifications").insert({
      type: "new_identity_verification",
      body: `${rejected}Nowe zgłoszenie weryfikacji tożsamości (telefon): ${
        profile?.full_name ?? "nieznany"
      }.${detail}`,
      link: "/admin/verifications",
    });
  }

  await admin
    .from("identity_verification_handoffs")
    .update({ status: "completed", result_identity_verification_id: verificationId })
    .eq("id", handoff.id);

  return { error: null, result: matchOutcome.result, approved: autoApproved };
}
