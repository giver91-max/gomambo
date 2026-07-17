import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";

export default async function MessagesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: rawConversations }, { data: rawAdminConversation }] = await Promise.all([
    supabase
      .from("conversations")
      .select(
        `id, owner_id, renter_id, created_at,
         cars(brand, model),
         owner:profiles!conversations_owner_id_fkey(full_name),
         renter:profiles!conversations_renter_id_fkey(full_name),
         messages(id, body, sender_id, created_at, read_at, deleted_at)`
      )
      .or(`owner_id.eq.${user!.id},renter_id.eq.${user!.id}`),
    supabase
      .from("admin_conversations")
      .select("id, admin_chat_messages(id, body, sender_id, created_at, read_at, deleted_at)")
      .eq("user_id", user!.id)
      .maybeSingle(),
  ]);

  const adminConversation = rawAdminConversation as unknown as {
    id: string;
    admin_chat_messages: {
      id: string;
      body: string;
      sender_id: string;
      created_at: string;
      read_at: string | null;
      deleted_at: string | null;
    }[];
  } | null;
  const adminMessages = (adminConversation?.admin_chat_messages ?? []).filter((m) => !m.deleted_at);
  const adminSorted = adminMessages.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  const adminLastMessage = adminSorted[adminSorted.length - 1] ?? null;
  const adminUnreadCount = adminMessages.filter((m) => m.sender_id !== user!.id && !m.read_at).length;

  const conversations = (rawConversations ?? []) as unknown as {
    id: string;
    owner_id: string;
    renter_id: string;
    created_at: string;
    cars: { brand: string; model: string } | null;
    owner: { full_name: string } | null;
    renter: { full_name: string } | null;
    messages: {
      id: string;
      body: string;
      sender_id: string;
      created_at: string;
      read_at: string | null;
      deleted_at: string | null;
    }[];
  }[];

  const rows = conversations
    .map((c) => {
      const messages = (c.messages ?? []).filter((m) => !m.deleted_at);
      const sorted = messages.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
      const lastMessage = sorted[sorted.length - 1] ?? null;
      const unreadCount = messages.filter(
        (m) => m.sender_id !== user!.id && !m.read_at
      ).length;
      const isOwner = c.owner_id === user!.id;
      const otherName = isOwner ? c.renter?.full_name : c.owner?.full_name;

      return { conversation: c, lastMessage, unreadCount, otherName };
    })
    .sort((a, b) => {
      const aTime = a.lastMessage?.created_at ?? a.conversation.created_at;
      const bTime = b.lastMessage?.created_at ?? b.conversation.created_at;
      return bTime.localeCompare(aTime);
    });

  return (
    <div className="space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Wiadomości</h1>

      <div className="space-y-2">
        <Link href="/dashboard/messages/admin">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <p className={adminUnreadCount > 0 ? "font-semibold" : "font-medium"}>
                  Wiadomości od GoMambo
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {adminLastMessage ? adminLastMessage.body : "Napisz do nas, jeśli masz pytanie."}
                </p>
              </div>
              {adminUnreadCount > 0 && <Badge>{adminUnreadCount}</Badge>}
            </CardContent>
          </Card>
        </Link>

        {rows.map(({ conversation, lastMessage, unreadCount, otherName }) => (
          <Link key={conversation.id} href={`/dashboard/messages/${conversation.id}`}>
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className={unreadCount > 0 ? "font-semibold" : "font-medium"}>
                    {otherName || "Użytkownik"} ·{" "}
                    {conversation.cars?.brand} {conversation.cars?.model}
                  </p>
                  {lastMessage && (
                    <p className="truncate text-sm text-muted-foreground">{lastMessage.body}</p>
                  )}
                </div>
                {unreadCount > 0 && <Badge>{unreadCount}</Badge>}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
