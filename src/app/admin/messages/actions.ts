"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { getOrCreateAdminConversation } from "@/lib/admin-chat";

async function notifyByEmail(recipientIds: string[], body: string) {
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id")
    .in("id", recipientIds)
    .neq("notify_email", false);
  const eligibleIds = (profiles ?? []).map((p) => p.id);
  if (eligibleIds.length === 0) return;

  const emails: string[] = [];
  for (const id of eligibleIds) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) emails.push(data.user.email);
  }

  const subject = "Nowa wiadomość od GoMambo";
  const html = `
    <p>Masz nową wiadomość od zespołu GoMambo:</p>
    <p>${body.replace(/\n/g, "<br>")}</p>
    <p>Odpowiedz w skrzynce wiadomości na GoMambo.</p>
  `;

  await Promise.all(emails.map((to) => sendNotificationEmail({ to, subject, html })));
}

// Starts (or continues) one conversation with a specific user, or fans the
// same message out into every user's conversation when recipientId is null.
export async function startAdminConversation(
  recipientId: string | null,
  body: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return { error: "Napisz treść wiadomości." };
  }

  let recipientIds: string[];
  if (recipientId) {
    recipientIds = [recipientId];
  } else {
    const { data: profiles } = await supabase.from("profiles").select("id").neq("id", user.id);
    recipientIds = (profiles ?? []).map((p) => p.id);
  }

  if (recipientIds.length === 0) {
    return { error: "Brak odbiorców." };
  }

  for (const uid of recipientIds) {
    const conversationId = await getOrCreateAdminConversation(supabase, uid);
    if (!conversationId) {
      return { error: "Nie udało się utworzyć wątku." };
    }

    const { error: msgError } = await supabase.from("admin_chat_messages").insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: trimmedBody,
    });
    if (msgError) {
      return { error: msgError.message };
    }
  }

  revalidatePath("/admin/messages");
  await notifyByEmail(recipientIds, trimmedBody);
  return { error: null };
}

export async function sendAdminChatMessage(
  conversationId: string,
  body: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return { error: "Napisz wiadomość." };
  }

  const { data: conversation } = await supabase
    .from("admin_conversations")
    .select("user_id")
    .eq("id", conversationId)
    .single();
  if (!conversation) {
    return { error: "Nie znaleziono wątku." };
  }

  const { error } = await supabase.from("admin_chat_messages").insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: trimmedBody,
  });
  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/admin/messages/${conversationId}`);
  revalidatePath("/admin/messages");
  await notifyByEmail([conversation.user_id], trimmedBody);
  return { error: null };
}

export async function markAdminChatReadByAdmin(conversationId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("admin_chat_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .neq("sender_id", user.id)
    .is("read_at", null);

  revalidatePath("/admin/messages");
}

// admin_chat_messages has no delete RLS at all — soft-delete via the
// service-role client, same reasoning as reviews (see admin/reviews/actions.ts).
export async function deleteAdminChatMessage(
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
    .from("admin_chat_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/admin/messages/${conversationId}`);
  revalidatePath("/admin/messages");
  return { error: null };
}
