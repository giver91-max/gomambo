"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

export async function acceptCurrentTerms(
  redirectTo: string,
  accepted: boolean
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!accepted) {
    return { error: "Zaznacz akceptację regulaminu i polityki prywatności." };
  }

  // Service role: the acceptance is evidence, so the profile trigger (0051)
  // does not let a session write these two columns for itself.
  const { error } = await createAdminClient()
    .from("profiles")
    .update({ terms_accepted_at: new Date().toISOString(), terms_version: CURRENT_TERMS_VERSION })
    .eq("id", user.id);
  if (error) return { error: error.message };

  redirect(safeRedirectPath(redirectTo));
}
