import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";

// conversations_select_participant / messages_select_participant RLS is
// owner/renter-only, with no is_admin() bypass, so this reads through the
// service-role client — same reasoning as admin/bookings/page.tsx.
export default async function AdminConversationsPage() {
  const admin = createAdminClient();

  const { data: rawConversations } = await admin
    .from("conversations")
    .select(
      `id, created_at,
       cars(brand, model),
       owner:profiles!conversations_owner_id_fkey(full_name),
       renter:profiles!conversations_renter_id_fkey(full_name),
       messages(id, body, created_at, deleted_at)`
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const conversations = (rawConversations ?? []) as unknown as {
    id: string;
    created_at: string;
    cars: { brand: string; model: string } | null;
    owner: { full_name: string } | null;
    renter: { full_name: string } | null;
    messages: { id: string; body: string; created_at: string; deleted_at: string | null }[];
  }[];

  const rows = conversations
    .map((c) => {
      const messages = (c.messages ?? []).filter((m) => !m.deleted_at);
      const sorted = messages.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
      const lastMessage = sorted[sorted.length - 1] ?? null;
      return { conversation: c, lastMessage };
    })
    .sort((a, b) => {
      const aTime = a.lastMessage?.created_at ?? a.conversation.created_at;
      const bTime = b.lastMessage?.created_at ?? b.conversation.created_at;
      return bTime.localeCompare(aTime);
    });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Rozmowy właściciel ↔ najemca</h1>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Brak rozmów.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map(({ conversation, lastMessage }) => (
            <Link key={conversation.id} href={`/admin/conversations/${conversation.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <CardContent className="py-4">
                  <p className="font-medium">
                    {conversation.owner?.full_name ?? "?"} ↔ {conversation.renter?.full_name ?? "?"}
                    {conversation.cars && (
                      <span className="text-muted-foreground">
                        {" "}
                        — {conversation.cars.brand} {conversation.cars.model}
                      </span>
                    )}
                  </p>
                  {lastMessage && (
                    <p className="truncate text-sm text-muted-foreground">{lastMessage.body}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
