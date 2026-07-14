"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateHandoffToken } from "@/lib/verification-handoff";
import { SITE_URL } from "@/lib/site";

export async function createVerificationHandoff(): Promise<
  { id: string; token: string; url: string } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!user.email) return { error: "Twoje konto nie ma przypisanego adresu e-mail." };

  const admin = createAdminClient();

  // Keep exactly one live handoff per user so the desktop's realtime
  // subscription (scoped to a single handoff id) is never ambiguous.
  await admin
    .from("identity_verification_handoffs")
    .update({ status: "cancelled" })
    .eq("user_id", user.id)
    .in("status", ["pending", "code_sent", "claimed", "photos_uploaded"]);

  const token = generateHandoffToken();
  const { data: handoff, error } = await admin
    .from("identity_verification_handoffs")
    .insert({ user_id: user.id, token, email: user.email })
    .select("id, token")
    .single();

  if (error || !handoff) {
    return { error: error?.message ?? "Nie udało się utworzyć sesji weryfikacji." };
  }

  return { id: handoff.id, token: handoff.token, url: `${SITE_URL}/verify-handoff/${handoff.token}` };
}
