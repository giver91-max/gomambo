import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { BackButton } from "@/components/back-button";
import { markConversationRead } from "../actions";
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
    .select("id, owner_id, renter_id, cars(brand, model)")
    .eq("id", params.conversationId)
    .single();

  if (!conversation || (conversation.owner_id !== user.id && conversation.renter_id !== user.id)) {
    notFound();
  }

  await markConversationRead(params.conversationId);

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

      <div className="space-y-3 rounded-lg border p-4">
        {(messages ?? []).map((message) => {
          const isMine = message.sender_id === user.id;
          return (
            <div
              key={message.id}
              className={cn("flex", isMine ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                  isMine ? "bg-primary text-primary-foreground" : "bg-muted"
                )}
              >
                {message.body}
              </div>
            </div>
          );
        })}
      </div>

      <ReplyForm conversationId={conversation.id} />
    </div>
  );
}
