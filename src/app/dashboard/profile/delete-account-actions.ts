"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeUserDataAndDeleteAccount } from "@/lib/delete-account";

// Self-service equivalent of admin/users/actions.ts's deleteUserAccount —
// same cleanup, but the caller deletes themselves (no admin-role check, no
// "can't delete own account" guard, since that guard exists specifically to
// stop an admin from doing this by accident on the admin panel).
export async function deleteOwnAccount(): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { error } = await purgeUserDataAndDeleteAccount(admin, user.id);
  if (error) {
    return { error };
  }

  // Best-effort — the auth user row is already gone at this point, so the
  // sign-out call itself may error; that shouldn't block the redirect.
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  }
  redirect("/");
}
