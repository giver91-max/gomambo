"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isConversationActive } from "@/lib/conversation-status";

export type MessageState = { error: string | null };

export async function sendMessage(
  conversationId: string,
  _prevState: MessageState,
  formData: FormData
): Promise<MessageState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const body = String(formData.get("body") ?? "").trim();
  if (!body) {
    return { error: "Napisz wiadomość." };
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("car_id, renter_id")
    .eq("id", conversationId)
    .single();

  if (!conversation) {
    return { error: "Nie znaleziono wątku." };
  }

  const active = await isConversationActive(supabase, conversation.car_id, conversation.renter_id);
  if (!active) {
    return { error: "Czat jest zamknięty — wypożyczenie zostało zakończone." };
  }

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body,
  });
  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/messages/${conversationId}`);
  revalidatePath("/dashboard/messages");
  return { error: null };
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .neq("sender_id", user.id)
    .is("read_at", null);

  revalidatePath("/dashboard/messages");
}
