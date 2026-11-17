"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notify-user";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";
import { VERIFICATION_PATH } from "@/lib/links";

// Both return the problem instead of throwing it: in production Next replaces
// a thrown server-action message with a generic English one, so the admin
// never learnt why a decision did not go through.
//
// Both only touch a verification that is still pending. A double tap, or a
// second admin deciding the same one, would otherwise flip a decision that
// was already mailed to the person and mail them again.

const SESSION_EXPIRED = "Sesja wygasła — zaloguj się ponownie i spróbuj jeszcze raz.";

// An expired session does not fail the update, RLS just matches no row, and
// that would read as "already decided".
async function sessionClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? supabase : null;
}

export async function approveVerification(
  verificationId: string
): Promise<{ error: string | null }> {
  const supabase = await sessionClient();
  if (!supabase) return { error: SESSION_EXPIRED };
  const { data: verification, error } = await supabase
    .from("identity_verifications")
    .update({ status: "approved", rejection_reason: null })
    .eq("id", verificationId)
    .eq("status", "pending")
    .select("user_id")
    .maybeSingle();

  if (error) return { error: `Nie udało się zapisać decyzji: ${error.message}` };
  if (!verification) {
    revalidatePath("/admin/verifications");
    return { error: "To zgłoszenie zostało już rozpatrzone albo usunięte — odśwież stronę." };
  }

  await notifyUser({
    userId: verification.user_id,
    type: "identity_verification_approved",
    subject: "Twoja tożsamość została zweryfikowana",
    body: "Twój dokument i selfie zostały zweryfikowane. Możesz teraz w pełni korzystać z GoMambo.",
    emailHtml: `
      <p>Dobra wiadomość — Twoja tożsamość została zweryfikowana na GoMambo.</p>
      <p><a href="${SITE_URL}/dashboard">Przejdź do panelu →</a></p>
    `,
  });

  revalidatePath("/admin/verifications");
  return { error: null };
}

export async function rejectVerification(
  verificationId: string,
  reason: string
): Promise<{ error: string | null }> {
  // The person has to know what to fix; "Brak podanego powodu." used to be
  // mailed when the field was left empty.
  const rejectionReason = reason.trim();
  if (!rejectionReason) {
    return { error: "Napisz powód — ta osoba musi wiedzieć, co poprawić." };
  }

  const supabase = await sessionClient();
  if (!supabase) return { error: SESSION_EXPIRED };
  const { data: verification, error } = await supabase
    .from("identity_verifications")
    // Clearing admin_alerted_at reopens the alert window (0046), so if this
    // person resubmits — the one case that must never pass quietly — the
    // admins hear about it straight away rather than after the cooldown.
    .update({ status: "rejected", rejection_reason: rejectionReason, admin_alerted_at: null })
    .eq("id", verificationId)
    .eq("status", "pending")
    .select("user_id")
    .maybeSingle();

  if (error) return { error: `Nie udało się zapisać decyzji: ${error.message}` };
  if (!verification) {
    revalidatePath("/admin/verifications");
    return { error: "To zgłoszenie zostało już rozpatrzone albo usunięte — odśwież stronę." };
  }

  await notifyUser({
    userId: verification.user_id,
    type: "identity_verification_rejected",
    subject: "Weryfikacja tożsamości wymaga poprawek",
    body: `Twoje zgłoszenie weryfikacji tożsamości zostało odrzucone. Powód: ${rejectionReason}`,
    // The reason is typed by the admin, but it is still free text going into
    // HTML: a "<" in it would swallow the rest of the sentence.
    emailHtml: `
      <p>Twoje zgłoszenie weryfikacji tożsamości na GoMambo nie zostało zaakceptowane.</p>
      <ul>
        <li><strong>Powód:</strong> ${escapeHtml(rejectionReason)}</li>
      </ul>
      <p>Prześlij dokument i selfie ponownie w panelu.</p>
      <p><a href="${SITE_URL}${VERIFICATION_PATH}">Przejdź do weryfikacji →</a></p>
    `,
    // Straight to the verification card, the last one on a long profile page.
    link: VERIFICATION_PATH,
  });

  revalidatePath("/admin/verifications");
  return { error: null };
}
