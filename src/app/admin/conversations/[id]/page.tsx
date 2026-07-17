import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { BackButton } from "@/components/back-button";
import { ChatThread } from "@/components/chat-thread";
import { deleteConversationMessage } from "../actions";

export default async function AdminConversationPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: conversation } = await admin
    .from("conversations")
    .select(
      `id, cars(brand, model),
       owner:profiles!conversations_owner_id_fkey(full_name),
       renter:profiles!conversations_renter_id_fkey(full_name)`
    )
    .eq("id", params.id)
    .single();

  if (!conversation) {
    notFound();
  }

  const typedConversation = conversation as unknown as {
    id: string;
    cars: { brand: string; model: string } | null;
    owner: { full_name: string } | null;
    renter: { full_name: string } | null;
  };

  const { data: messages } = await admin
    .from("messages")
    .select("id, sender_id, body, created_at")
    .eq("conversation_id", params.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const owner = typedConversation.owner;
  const renter = typedConversation.renter;
  const car = typedConversation.cars;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      <div>
        <h1 className="text-2xl font-bold">
          {owner?.full_name ?? "?"} ↔ {renter?.full_name ?? "?"}
        </h1>
        {car && <p className="text-sm text-muted-foreground">{car.brand} {car.model}</p>}
      </div>

      <ChatThread
        messages={(messages ?? []).map((m) => ({
          id: m.id,
          senderId: m.sender_id,
          body: m.body,
          createdAt: m.created_at,
        }))}
        currentUserId=""
        onDelete={deleteConversationMessage.bind(null, params.id)}
      />
    </div>
  );
}
