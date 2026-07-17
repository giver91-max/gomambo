"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// reviews has no update/delete RLS policy at all (not even for the author),
// so this always goes through the service-role client. Soft-delete only —
// a review can be real evidence in a dispute, so it's hidden, not destroyed.
export async function deleteReview(reviewId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return { error: "Brak uprawnień." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("reviews")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", reviewId);
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/reviews");
  return { error: null };
}
