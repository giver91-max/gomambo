"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAdminConversation } from "@/lib/admin-chat";

export async function startConversationWithUser(userId: string) {
  const supabase = await createClient();
  const conversationId = await getOrCreateAdminConversation(supabase, userId);
  if (!conversationId) {
    throw new Error("Nie udało się utworzyć wątku.");
  }
  redirect(`/admin/messages/${conversationId}`);
}
