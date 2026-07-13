"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function approveVerification(verificationId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("identity_verifications")
    .update({ status: "approved", rejection_reason: null })
    .eq("id", verificationId);

  if (error) throw new Error(error.message);
  revalidatePath("/admin/verifications");
}

export async function rejectVerification(verificationId: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("identity_verifications")
    .update({ status: "rejected", rejection_reason: reason || "Brak podanego powodu." })
    .eq("id", verificationId);

  if (error) throw new Error(error.message);
  revalidatePath("/admin/verifications");
}
