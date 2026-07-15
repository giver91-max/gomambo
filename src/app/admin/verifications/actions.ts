"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notify-user";

export async function approveVerification(verificationId: string) {
  const supabase = await createClient();
  const { data: verification, error } = await supabase
    .from("identity_verifications")
    .update({ status: "approved", rejection_reason: null })
    .eq("id", verificationId)
    .select("user_id")
    .single();

  if (error) throw new Error(error.message);

  await notifyUser({
    userId: verification.user_id,
    type: "identity_verification_approved",
    subject: "Twoja tożsamość została zweryfikowana",
    body: "Twój dokument i selfie zostały zweryfikowane. Możesz teraz w pełni korzystać z GoMambo.",
    emailHtml: `
      <p>Dobra wiadomość — Twoja tożsamość została zweryfikowana na GoMambo.</p>
      <p><a href="https://www.gomambo.pl/dashboard">Przejdź do panelu →</a></p>
    `,
  });

  revalidatePath("/admin/verifications");
}

export async function rejectVerification(verificationId: string, reason: string) {
  const supabase = await createClient();
  const rejectionReason = reason || "Brak podanego powodu.";
  const { data: verification, error } = await supabase
    .from("identity_verifications")
    .update({ status: "rejected", rejection_reason: rejectionReason })
    .eq("id", verificationId)
    .select("user_id")
    .single();

  if (error) throw new Error(error.message);

  await notifyUser({
    userId: verification.user_id,
    type: "identity_verification_rejected",
    subject: "Weryfikacja tożsamości wymaga poprawek",
    body: `Twoje zgłoszenie weryfikacji tożsamości zostało odrzucone. Powód: ${rejectionReason}`,
    emailHtml: `
      <p>Twoje zgłoszenie weryfikacji tożsamości na GoMambo nie zostało zaakceptowane.</p>
      <ul>
        <li><strong>Powód:</strong> ${rejectionReason}</li>
      </ul>
      <p>Prześlij dokument i selfie ponownie w panelu.</p>
      <p><a href="https://www.gomambo.pl/dashboard/profile">Przejdź do profilu →</a></p>
    `,
  });

  revalidatePath("/admin/verifications");
}
