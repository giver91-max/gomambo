"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function resolveDamageReport(
  reportId: string,
  note: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  const admin = createAdminClient();
  const trimmed = note.trim();

  const { error } = await admin
    .from("damage_reports")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", reportId)
    .eq("status", "open");

  if (error) {
    return { error: error.message };
  }

  // Separate table so the people the note is about can't read it (0039).
  if (trimmed) {
    const { error: noteError } = await admin
      .from("damage_report_notes")
      .upsert({ report_id: reportId, note: trimmed });
    if (noteError) {
      return { error: noteError.message };
    }
  }

  revalidatePath("/admin/zgloszenia");
  return { error: null };
}
