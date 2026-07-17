"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// messages has no delete RLS at all (only select/insert/update, all
// participant-scoped) — soft-delete via the service-role client, same
// reasoning as reviews and admin_chat_messages.
export async function deleteConversationMessage(
  conversationId: string,
  messageId: string
): Promise<{ error: string | null }> {
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
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/admin/conversations/${conversationId}`);
  revalidatePath("/admin/conversations");
  return { error: null };
}
