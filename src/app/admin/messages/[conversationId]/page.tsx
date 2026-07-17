import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackButton } from "@/components/back-button";
import { ChatThread } from "@/components/chat-thread";
import { deleteAdminChatMessage, markAdminChatReadByAdmin } from "../actions";
import { AdminReplyForm } from "./reply-form";

export default async function AdminConversationPage({
  params,
}: {
  params: { conversationId: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: conversation } = await supabase
    .from("admin_conversations")
    .select("id, user:profiles!admin_conversations_user_id_fkey(full_name)")
    .eq("id", params.conversationId)
    .single();

  if (!conversation) {
    notFound();
  }

  await markAdminChatReadByAdmin(params.conversationId);

  const { data: messages } = await supabase
    .from("admin_chat_messages")
    .select("id, sender_id, body, created_at")
    .eq("conversation_id", params.conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const userLabel =
    (conversation.user as unknown as { full_name: string } | null)?.full_name || "Użytkownik";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">{userLabel}</h1>

      <ChatThread
        messages={(messages ?? []).map((m) => ({
          id: m.id,
          senderId: m.sender_id,
          body: m.body,
          createdAt: m.created_at,
        }))}
        currentUserId={user!.id}
        onDelete={deleteAdminChatMessage.bind(null, params.conversationId)}
      />

      <AdminReplyForm conversationId={conversation.id} />
    </div>
  );
}
