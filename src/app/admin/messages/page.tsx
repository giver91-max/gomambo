import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { ComposeForm } from "./compose-form";

export default async function AdminMessagesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: users }, { data: rawConversations }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").order("full_name", { ascending: true }),
    supabase
      .from("admin_conversations")
      .select(
        "id, user_id, created_at, user:profiles!admin_conversations_user_id_fkey(full_name), admin_chat_messages(id, body, sender_id, created_at, read_at, deleted_at)"
      ),
  ]);

  const conversations = (rawConversations ?? []) as unknown as {
    id: string;
    user_id: string;
    created_at: string;
    user: { full_name: string } | null;
    admin_chat_messages: {
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
      const messages = (c.admin_chat_messages ?? []).filter((m) => !m.deleted_at);
      const sorted = messages.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
      const lastMessage = sorted[sorted.length - 1] ?? null;
      const unreadCount = messages.filter((m) => m.sender_id !== user!.id && !m.read_at).length;
      return { conversation: c, lastMessage, unreadCount };
    })
    .sort((a, b) => {
      const aTime = a.lastMessage?.created_at ?? a.conversation.created_at;
      const bTime = b.lastMessage?.created_at ?? b.conversation.created_at;
      return bTime.localeCompare(aTime);
    });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Wiadomości do użytkowników</h1>

      <Card>
        <CardHeader>
          <CardTitle>Nowa wiadomość</CardTitle>
        </CardHeader>
        <CardContent>
          <ComposeForm users={users ?? []} />
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="font-semibold">Rozmowy</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Brak rozmów.</p>
        ) : (
          <div className="space-y-2">
            {rows.map(({ conversation, lastMessage, unreadCount }) => (
              <Link key={conversation.id} href={`/admin/messages/${conversation.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <p className={`flex items-center gap-2 ${unreadCount > 0 ? "font-semibold" : "font-medium"}`}>
                        {unreadCount > 0 && (
                          <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Nieprzeczytane" />
                        )}
                        {conversation.user?.full_name || "Użytkownik"}
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
        )}
      </div>
    </div>
  );
}
