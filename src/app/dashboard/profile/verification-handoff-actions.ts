"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateHandoffToken,
  newHandoffExpiry,
  retireUnfinishedHandoffs,
} from "@/lib/verification-handoff";
import { SITE_URL } from "@/lib/site";

// "Nowy kod" closes the old session and opens a fresh one with fresh
// per-session send limits (verify-handoff actions), so without a cap here a
// script could turn it into an unlimited stream of code e-mails through the
// Resend account every other GoMambo mail depends on. Far above what anyone
// verifying needs.
const HANDOFFS_PER_HOUR = 10;
const TOO_MANY_HANDOFFS_MESSAGE =
  "Utworzono już wiele kodów w krótkim czasie. Spróbuj ponownie za godzinę albo dodaj zdjęcia z formularza powyżej.";

export async function createVerificationHandoff(
  options: { replaceApproved?: boolean } = {}
): Promise<{ id: string; token: string; url: string; expiresAt: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!user.email) return { error: "Twoje konto nie ma przypisanego adresu e-mail." };

  const admin = createAdminClient();

  // An approved account sending new photos is re-verified from scratch: if
  // the automat cannot confirm them, the status drops to pending and "Dodaj
  // auto" is blocked until a human looks. Most approvals so far were made by
  // a human over failed automatic gates, so that drop is the likely outcome
  // — it must be something the person chose (the profile asks first and sends
  // replaceApproved), never a side effect of opening a QR code.
  const { data: verification } = await admin
    .from("identity_verifications")
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (verification?.status === "approved" && !options.replaceApproved) {
    return {
      error:
        "Twoja tożsamość jest już zweryfikowana. Jeśli chcesz wymienić dokument, użyj przycisku „Zmień dokument”.",
    };
  }

  const recentHandoffs = async () =>
    (
      await admin
        .from("identity_verification_handoffs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    ).count ?? 0;
  if ((await recentHandoffs()) >= HANDOFFS_PER_HOUR) {
    return { error: TOO_MANY_HANDOFFS_MESSAGE };
  }

  // Keep exactly one live handoff per user so the desktop's realtime
  // subscription (scoped to a single handoff id) is never ambiguous — and
  // delete what unfinished sessions collected, since a new code starts over.
  await retireUnfinishedHandoffs(admin, user.id, []);

  const token = generateHandoffToken();
  const { data: handoff, error } = await admin
    .from("identity_verification_handoffs")
    .insert({ user_id: user.id, token, email: user.email, handoff_expires_at: newHandoffExpiry() })
    .select("id, token, handoff_expires_at")
    .single();

  if (error || !handoff) {
    console.error("[verification-handoff] could not create a session", error);
    return { error: "Nie udało się utworzyć sesji weryfikacji. Spróbuj ponownie." };
  }

  // Counted again with this session in: requests fired at once all passed the
  // check above before any of them inserted. Whichever counts last sees every
  // row inserted before it, so no more than HANDOFFS_PER_HOUR survive; a
  // session refused here never reached anyone, so it simply goes.
  if ((await recentHandoffs()) > HANDOFFS_PER_HOUR) {
    await admin.from("identity_verification_handoffs").delete().eq("id", handoff.id);
    return { error: TOO_MANY_HANDOFFS_MESSAGE };
  }

  return {
    id: handoff.id,
    token: handoff.token,
    url: `${SITE_URL}/verify-handoff/${handoff.token}`,
    expiresAt: handoff.handoff_expires_at,
  };
}

/**
 * "Anuluj wymianę" on the profile of an approved account.
 *
 * A phone session opened to replace an approved document stays live on the
 * server for up to three hours, and finalizeHandoff lets it overwrite the
 * approval (the approval predates the session — that is what "Zmień dokument"
 * asked for). Hiding the QR panel on the computer tells the server nothing,
 * so a selfie taken on the phone afterwards would still replace the
 * verification, and any failed gate would drop the account to pending despite
 * the cancel. This closes the session and deletes what it collected.
 *
 * Only for an approved account: on any other a live session is the way to get
 * verified, not a leftover of a cancelled replacement.
 */
export async function cancelDocumentReplacement(): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: verification } = await admin
    .from("identity_verifications")
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (verification?.status === "approved") {
    await retireUnfinishedHandoffs(admin, user.id, []);
  }
  return { error: null };
}
