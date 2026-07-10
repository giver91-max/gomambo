import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { ComposeForm } from "./compose-form";

export default async function AdminMessagesPage() {
  const supabase = await createClient();

  const [{ data: users }, { data: rawSent }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").order("full_name", { ascending: true }),
    supabase
      .from("admin_messages")
      .select("id, body, created_at, recipient_id, recipient:profiles!admin_messages_recipient_id_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const sent = (rawSent ?? []) as unknown as {
    id: string;
    body: string;
    created_at: string;
    recipient_id: string | null;
    recipient: { full_name: string } | null;
  }[];

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
        <h2 className="font-semibold">Ostatnio wysłane</h2>
        {sent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Brak wysłanych wiadomości.</p>
        ) : (
          sent.map((message) => (
            <Card key={message.id}>
              <CardContent className="space-y-1 py-4">
                <p className="text-sm font-medium">
                  {message.recipient_id ? message.recipient?.full_name || "Użytkownik" : "Wszyscy użytkownicy"}
                </p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{message.body}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(message.created_at).toLocaleString("pl-PL")}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
