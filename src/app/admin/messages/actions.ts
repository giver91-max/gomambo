"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmails } from "@/lib/email";
import { getOrCreateAdminConversation } from "@/lib/admin-chat";
import { getAuthEmailsByUserId } from "@/lib/admin-users";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";
import { ALL_USERS } from "./recipients";

/** Mails the message to everyone who has not turned e-mail off; says how many did not go out. */
async function notifyByEmail(
  recipientIds: string[],
  body: string
): Promise<{ attempted: number; failed: number }> {
  const supabase = await createClient();
  const admin = createAdminClient();

  // A broadcast filters in code, not with every recipient id in the query
  // string (see postToConversations).
  const optedIn = supabase.from("profiles").select("id").neq("notify_email", false);
  const { data: profiles } = await (recipientIds.length === 1
    ? optedIn.eq("id", recipientIds[0])
    : optedIn);
  const wanted = new Set(recipientIds);
  const eligibleIds = (profiles ?? []).map((p) => p.id).filter((id) => wanted.has(id));
  if (eligibleIds.length === 0) return { attempted: 0, failed: 0 };

  // One account: one lookup. A broadcast: the whole address list in a few
  // paged requests, not one round trip per account.
  const emails: string[] = [];
  if (eligibleIds.length === 1) {
    const { data } = await admin.auth.admin.getUserById(eligibleIds[0]);
    if (data?.user?.email) emails.push(data.user.email);
  } else {
    const emailById = await getAuthEmailsByUserId();
    for (const id of eligibleIds) {
      const email = emailById.get(id);
      if (email) emails.push(email);
    }
  }
  if (emails.length === 0) return { attempted: 0, failed: 0 };

  const subject = "Nowa wiadomość od GoMambo";
  // The body is escaped like every other value in our mails, and the mail
  // links to the conversation: it used to say "answer in the inbox" without
  // saying where that is, and an answer there lands in this same thread.
  const html = `
    <p>Masz nową wiadomość od zespołu GoMambo:</p>
    <p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>
    <p>Odpowiedz w skrzynce wiadomości na GoMambo — odpowiedź trafi prosto do tej rozmowy.</p>
    <p><a href="${SITE_URL}/dashboard/messages/admin">Odpowiedz w GoMambo →</a></p>
  `;

  // Batched (a hundred mails per request) and counted: firing them all at
  // once got most rejected by Resend's rate limit while the panel said
  // "Wiadomość wysłana", and one at a time outran the time limit. The admin
  // is told how many did not go out.
  const { failed } = await sendNotificationEmails({ to: emails, subject, html });
  return { attempted: emails.length, failed };
}

/**
 * Puts the message into every recipient's conversation, starting the ones
 * that do not exist yet. The messages go in as ONE insert, so a broadcast
 * lands in every conversation or in none: an error part-way — or the admin
 * retrying after one — can never leave some accounts with it twice. Returns
 * an error message, or null.
 */
async function postToConversations(
  supabase: SupabaseClient<Database>,
  senderId: string,
  recipientIds: string[],
  body: string
): Promise<string | null> {
  // For a broadcast every conversation is wanted anyway, and listing a few
  // hundred ids in the query string would be the longer request.
  const conversations = supabase.from("admin_conversations").select("id, user_id");
  const { data: existing, error: readError } = await (recipientIds.length === 1
    ? conversations.eq("user_id", recipientIds[0])
    : conversations);
  if (readError) {
    console.error("[admin-chat] could not read conversations", readError);
    return "Nie udało się utworzyć wątku.";
  }
  const conversationByUser = new Map((existing ?? []).map((c) => [c.user_id, c.id]));

  const missing = recipientIds.filter((id) => !conversationByUser.has(id));
  if (missing.length > 0) {
    const { data: created } = await supabase
      .from("admin_conversations")
      .insert(missing.map((user_id) => ({ user_id })))
      .select("id, user_id");
    if (created) {
      for (const c of created) conversationByUser.set(c.user_id, c.id);
    } else {
      // A conversation started meanwhile (user_id is unique) fails the whole
      // insert; one at a time, each finds or makes its own.
      for (const uid of missing) {
        const conversationId = await getOrCreateAdminConversation(supabase, uid);
        if (!conversationId) return "Nie udało się utworzyć wątku.";
        conversationByUser.set(uid, conversationId);
      }
    }
  }

  const { error } = await supabase.from("admin_chat_messages").insert(
    recipientIds.map((uid) => ({
      conversation_id: conversationByUser.get(uid)!,
      sender_id: senderId,
      body,
    }))
  );
  if (error) {
    console.error("[admin-chat] could not post the message", error);
    return "Nie udało się wysłać wiadomości. Spróbuj ponownie.";
  }
  return null;
}

/**
 * Whether the signed-in user is an admin. Every action in this file checks it
 * itself: RLS keeps a non-admin to their own thread, but the notification
 * e-mail would still go out — their own text "od zespołu GoMambo", with no
 * limit, through the Resend account every other mail depends on — and a
 * server action can be called from anywhere once its id is known.
 */
async function isAdmin(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single();
  return profile?.role === "admin";
}

function emailFailureNotice({ attempted, failed }: { attempted: number; failed: number }): string | null {
  if (failed === 0) return null;
  return attempted === 1
    ? "Wiadomość jest w czacie, ale e-mail z powiadomieniem nie wyszedł (limit wysyłki lub błąd poczty)."
    : `Wiadomość jest w czacie u wszystkich, ale ${failed} z ${attempted} e-maili z powiadomieniem nie wyszło (limit wysyłki lub błąd poczty).`;
}

// Starts (or continues) one conversation with a specific user, or — only when
// asked for explicitly with ALL_USERS — fans the same message out into every
// user's conversation.
export async function startAdminConversation(
  recipientId: string,
  body: string
): Promise<{ error: string | null; warning?: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Brak uprawnień." };
  }

  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return { error: "Napisz treść wiadomości." };
  }

  let recipientIds: string[];
  if (recipientId === ALL_USERS) {
    const { data: profiles } = await supabase.from("profiles").select("id").neq("id", user.id);
    recipientIds = (profiles ?? []).map((p) => p.id);
  } else if (recipientId) {
    recipientIds = [recipientId];
  } else {
    return { error: "Wybierz odbiorcę." };
  }

  if (recipientIds.length === 0) {
    return { error: "Brak odbiorców." };
  }

  const postError = await postToConversations(supabase, user.id, recipientIds, trimmedBody);
  if (postError) {
    return { error: postError };
  }

  revalidatePath("/admin/messages");
  const mailed = await notifyByEmail(recipientIds, trimmedBody);
  return { error: null, warning: emailFailureNotice(mailed) };
}

export async function sendAdminChatMessage(
  conversationId: string,
  body: string
): Promise<{ error: string | null; warning?: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Brak uprawnień." };
  }

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
  const mailed = await notifyByEmail([conversation.user_id], trimmedBody);
  return { error: null, warning: emailFailureNotice(mailed) };
}

export async function markAdminChatReadByAdmin(conversationId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdmin(supabase, user.id))) return;

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
  if (!(await isAdmin(supabase, user.id))) {
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
