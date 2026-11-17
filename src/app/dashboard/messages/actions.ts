"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { isConversationActive } from "@/lib/conversation-status";
import { getOrCreateAdminConversation } from "@/lib/admin-chat";
import { isSendingTooFast } from "@/lib/rate-limit";
import { sendNotificationEmail } from "@/lib/email";
import { notifyAdmins } from "@/lib/notify-admins";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";

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
    .select("car_id, owner_id, renter_id, cars(brand, model)")
    .eq("id", conversationId)
    .single();

  if (!conversation) {
    return { error: "Nie znaleziono wątku." };
  }

  const active = await isConversationActive(supabase, conversation.car_id, conversation.renter_id);
  if (!active) {
    return { error: "Czat jest zamknięty — wypożyczenie zostało zakończone." };
  }

  if (await isSendingTooFast(supabase, "messages", user.id)) {
    return { error: "Wysyłasz wiadomości zbyt szybko. Odczekaj chwilę." };
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

  // Chat's own unread-count badge already covers in-app awareness — the
  // gap this closes is the recipient finding out at all if they aren't
  // actively checking the site.
  //
  // The message is already saved, so nothing below may turn this into an
  // error: the sender would see "failed", send it again, and the other side
  // would get it twice.
  try {
    const recipientId = conversation.owner_id === user.id ? conversation.renter_id : conversation.owner_id;
    const admin = tryCreateAdminClient();
    if (!admin) return { error: null };
    const { data: recipientProfile } = await admin
      .from("profiles")
      .select("notify_email")
      .eq("id", recipientId)
      .single();
    if (recipientProfile?.notify_email !== false) {
      const { data: recipientAuth } = await admin.auth.admin.getUserById(recipientId);
      const recipientEmail = recipientAuth?.user?.email;
      if (recipientEmail) {
        const car = conversation.cars as unknown as { brand: string; model: string } | null;
        const carLabel = car ? `${car.brand} ${car.model}` : null;
        // Both the message and the car's name were typed by a user; the mail
        // comes from the GoMambo domain, where an injected link is trusted.
        await sendNotificationEmail({
          to: recipientEmail,
          subject: carLabel ? `Nowa wiadomość: ${carLabel}` : "Nowa wiadomość na GoMambo",
          html: `
            <p>Masz nową wiadomość na GoMambo${carLabel ? ` w sprawie ${escapeHtml(carLabel)}` : ""}:</p>
            <p>${escapeHtml(body).replace(/\r?\n/g, "<br>")}</p>
            <p><a href="${SITE_URL}/dashboard/messages/${conversationId}">Odpowiedz →</a></p>
            <p style="color:#888;font-size:12px">Odpowiedź na tego maila trafi do zespołu GoMambo, nie do rozmówcy.</p>
          `,
        });
      }
    }
  } catch (notifyError) {
    console.error("[messages] recipient notification failed", notifyError);
  }

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

export type AdminChatState = { error: string | null };

export async function sendMessageToAdmin(
  _prevState: AdminChatState,
  formData: FormData
): Promise<AdminChatState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const body = String(formData.get("body") ?? "").trim();
  if (!body) {
    return { error: "Napisz wiadomość." };
  }

  if (await isSendingTooFast(supabase, "admin_chat_messages", user.id)) {
    return { error: "Wysyłasz wiadomości zbyt szybko. Odczekaj chwilę." };
  }

  const conversationId = await getOrCreateAdminConversation(supabase, user.id);
  if (!conversationId) {
    return { error: "Nie udało się utworzyć wątku." };
  }

  // Checked BEFORE the insert: is an earlier message from this person still
  // unread by GoMambo? Then the admins were already mailed about this thread
  // and the new message is waiting right under that one. One mail per unread
  // streak — the chat allows 10 messages a minute, and every alert spends the
  // same Resend quota that delivers login codes.
  const { count: alreadyUnread } = await supabase
    .from("admin_chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("sender_id", user.id)
    .is("read_at", null)
    .is("deleted_at", null);

  const { error } = await supabase.from("admin_chat_messages").insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body,
  });
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/messages/admin");
  revalidatePath("/dashboard/messages");

  // Until now this only bumped an unread badge in /admin, so a message to
  // GoMambo waited until someone happened to open the panel. Saved already,
  // so a failure here is logged and never shown to the sender.
  if (!alreadyUnread) {
    try {
      const admin = tryCreateAdminClient();
      if (admin) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .maybeSingle();
        const name = profile?.full_name?.trim() || user.email || "Użytkownik";
        // No queue entry: the panel already counts unread chat messages, and
        // admin_notifications has no type for them.
        await notifyAdmins(admin, {
          link: `/admin/messages/${conversationId}`,
          email: {
            subject: `Nowa wiadomość od użytkownika: ${name}`,
            intro:
              "Ktoś napisał do GoMambo w wiadomościach na stronie. Kolejne wiadomości w tym wątku nie wyślą już maila, dopóki go nie otworzysz.",
            rows: [
              ["Od", name],
              ["E-mail", user.email],
              ["Wiadomość", body.length > 2000 ? `${body.slice(0, 2000)}…` : body],
            ],
            cta: "Odpowiedz",
          },
        });
      }
    } catch (notifyError) {
      console.error("[messages] admin notification failed", notifyError);
    }
  }

  return { error: null };
}

export async function markAdminChatReadByUser(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: conversation } = await supabase
    .from("admin_conversations")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!conversation) return;

  await supabase
    .from("admin_chat_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversation.id)
    .neq("sender_id", user.id)
    .is("read_at", null);

  revalidatePath("/dashboard/messages");
}
