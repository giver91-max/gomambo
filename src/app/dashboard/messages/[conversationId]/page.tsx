import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackButton } from "@/components/back-button";
import { ChatThread } from "@/components/chat-thread";
import { markConversationRead } from "../actions";
import { isConversationActive } from "@/lib/conversation-status";
import { ReplyForm } from "./reply-form";

export default async function ConversationPage({
  params,
}: {
  params: { conversationId: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, car_id, owner_id, renter_id, cars(brand, model)")
    .eq("id", params.conversationId)
    .single();

  if (!conversation || (conversation.owner_id !== user.id && conversation.renter_id !== user.id)) {
    notFound();
  }

  await markConversationRead(params.conversationId);

  const active = await isConversationActive(supabase, conversation.car_id, conversation.renter_id);

  const { data: messages } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at")
    .eq("conversation_id", params.conversationId)
    .order("created_at", { ascending: true });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">
        {conversation.cars?.brand} {conversation.cars?.model}
      </h1>

      <ChatThread
        messages={(messages ?? []).map((m) => ({
          id: m.id,
          senderId: m.sender_id,
          body: m.body,
          createdAt: m.created_at,
        }))}
        currentUserId={user.id}
      />

      {active ? (
        <ReplyForm conversationId={conversation.id} />
      ) : (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          Czat jest zamknięty — wypożyczenie zostało zakończone.
        </p>
      )}
    </div>
  );
}
