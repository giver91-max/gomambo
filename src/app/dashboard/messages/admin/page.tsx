import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackButton } from "@/components/back-button";
import { ChatThread } from "@/components/chat-thread";
import { markAdminChatReadByUser } from "../actions";
import { AdminChatReplyForm } from "./reply-form";

export default async function AdminChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  await markAdminChatReadByUser();

  const { data: conversation } = await supabase
    .from("admin_conversations")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: messages } = conversation
    ? await supabase
        .from("admin_chat_messages")
        .select("id, sender_id, body, created_at")
        .eq("conversation_id", conversation.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
    : { data: [] };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Wiadomości od GoMambo</h1>

      {(messages ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Napisz do nas, jeśli masz pytanie — odpowiemy najszybciej jak to możliwe.
        </p>
      ) : (
        <ChatThread
          messages={(messages ?? []).map((m) => ({
            id: m.id,
            senderId: m.sender_id,
            body: m.body,
            createdAt: m.created_at,
          }))}
          currentUserId={user.id}
        />
      )}

      <AdminChatReplyForm />
    </div>
  );
}
