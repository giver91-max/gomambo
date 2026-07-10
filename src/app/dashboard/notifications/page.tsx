import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { markAdminMessagesRead } from "./actions";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: rawMessages } = await supabase
    .from("admin_messages")
    .select(
      "id, body, created_at, recipient_id, sender:profiles!admin_messages_sender_id_fkey(full_name)"
    )
    .or(`recipient_id.eq.${user!.id},recipient_id.is.null`)
    .order("created_at", { ascending: false });

  const messages = (rawMessages ?? []) as unknown as {
    id: string;
    body: string;
    created_at: string;
    recipient_id: string | null;
    sender: { full_name: string } | null;
  }[];

  const { data: reads } = await supabase
    .from("admin_message_reads")
    .select("message_id")
    .eq("user_id", user!.id);
  const readIds = new Set((reads ?? []).map((r) => r.message_id));

  const unreadIds = messages.filter((m) => !readIds.has(m.id)).map((m) => m.id);
  await markAdminMessagesRead(unreadIds);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Powiadomienia</h1>

      {messages.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nie masz jeszcze żadnych powiadomień od GoMambo.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {messages.map((message) => (
            <Card key={message.id} className={readIds.has(message.id) ? "" : "border-primary/40"}>
              <CardContent className="space-y-1 py-4">
                <p className="text-sm font-medium">
                  {message.recipient_id ? "Wiadomość od GoMambo" : "Ogłoszenie dla wszystkich"}
                </p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{message.body}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(message.created_at).toLocaleString("pl-PL")}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
