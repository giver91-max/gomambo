import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, IdentityVerificationStatus } from "@/types/database";

// Single source of truth for "is this account allowed to list or book a
// car" — both the desktop upload path and the phone-handoff path write into
// this same table, so checking status here covers either route.
export async function getVerificationStatus(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<{ status: IdentityVerificationStatus | null; rejectionReason: string | null }> {
  const { data } = await supabase
    .from("identity_verifications")
    .select("status, rejection_reason")
    .eq("user_id", userId)
    .maybeSingle();

  return { status: data?.status ?? null, rejectionReason: data?.rejection_reason ?? null };
}
