import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { markAdminMessagesRead, markAdminNotificationsRead } from "./actions";

type FeedItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  link: string | null;
  read: boolean;
};

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: rawMessages }, { data: messageReads }, { data: rawSystem }, { data: systemReads }] =
    await Promise.all([
      supabase
        .from("admin_messages")
        .select(
          "id, body, created_at, recipient_id, sender:profiles!admin_messages_sender_id_fkey(full_name)"
        )
        .or(`recipient_id.eq.${user!.id},recipient_id.is.null`)
        .order("created_at", { ascending: false }),
      supabase.from("admin_message_reads").select("message_id").eq("user_id", user!.id),
      // Only returns rows for admins — RLS restricts admin_notifications to is_admin().
      supabase
        .from("admin_notifications")
        .select("id, type, body, link, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("admin_notification_reads").select("notification_id").eq("user_id", user!.id),
    ]);

  const messages = (rawMessages ?? []) as unknown as {
    id: string;
    body: string;
    created_at: string;
    recipient_id: string | null;
    sender: { full_name: string } | null;
  }[];
  const readMessageIds = new Set((messageReads ?? []).map((r) => r.message_id));

  const system = rawSystem ?? [];
  const readSystemIds = new Set((systemReads ?? []).map((r) => r.notification_id));

  const unreadMessageIds = messages.filter((m) => !readMessageIds.has(m.id)).map((m) => m.id);
  const unreadSystemIds = system.filter((n) => !readSystemIds.has(n.id)).map((n) => n.id);
  await Promise.all([
    markAdminMessagesRead(unreadMessageIds),
    markAdminNotificationsRead(unreadSystemIds),
  ]);

  const feed: FeedItem[] = [
    ...messages.map((message) => ({
      id: message.id,
      title: message.recipient_id ? "Wiadomość od GoMambo" : "Ogłoszenie dla wszystkich",
      body: message.body,
      createdAt: message.created_at,
      link: null,
      read: readMessageIds.has(message.id),
    })),
    ...system.map((notification) => ({
      id: notification.id,
      title:
        notification.type === "new_registration" ? "Nowa rejestracja" : "Nowe auto do weryfikacji",
      body: notification.body,
      createdAt: notification.created_at,
      link: notification.link,
      read: readSystemIds.has(notification.id),
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Powiadomienia</h1>

      {feed.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nie masz jeszcze żadnych powiadomień od GoMambo.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {feed.map((item) => (
            <Card key={item.id} className={item.read ? "" : "border-primary/40"}>
              <CardContent className="space-y-1 py-4">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString("pl-PL")}
                  </p>
                  {item.link && (
                    <Link href={item.link} className="text-xs text-primary hover:underline">
                      Zobacz →
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
