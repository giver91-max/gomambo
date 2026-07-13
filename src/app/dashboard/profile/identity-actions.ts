"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function submitIdentityVerification(
  documentPath: string,
  selfiePath: string | null
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existing } = await supabase
    .from("identity_verifications")
    .select("id, document_path, selfie_path")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("identity_verifications")
      .update({ document_path: documentPath, selfie_path: selfiePath })
      .eq("id", existing.id);
    if (error) {
      return { error: error.message };
    }
    if (existing.document_path !== documentPath) {
      await supabase.storage.from("id-documents").remove([existing.document_path]);
    }
    if (existing.selfie_path && existing.selfie_path !== selfiePath) {
      await supabase.storage.from("id-documents").remove([existing.selfie_path]);
    }
  } else {
    const { error } = await supabase.from("identity_verifications").insert({
      user_id: user.id,
      document_path: documentPath,
      selfie_path: selfiePath,
    });
    if (error) {
      return { error: error.message };
    }
  }

  const fullName = String(user.user_metadata?.full_name ?? user.email ?? "nieznany");
  const admin = createAdminClient();
  await admin.from("admin_notifications").insert({
    type: "new_identity_verification",
    body: `Nowe zgłoszenie weryfikacji tożsamości: ${fullName}`,
    link: "/admin/verifications",
  });

  revalidatePath("/dashboard/profile");
  return { error: null };
}
