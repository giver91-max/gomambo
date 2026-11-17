"use client";

import { useState, useTransition } from "react";
import { startAdminConversation } from "./actions";
import { ALL_USERS } from "./recipients";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function ComposeForm({
  users,
  allUsersCount,
}: {
  users: { id: string; full_name: string }[];
  // Everyone a broadcast would reach (every account but the sender's).
  allUsersCount: number;
}) {
  // No recipient until one is picked. The empty value used to BE "Wszyscy
  // użytkownicy", so a note meant for one person went to every account.
  const [recipientId, setRecipientId] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!recipientId) {
      setError("Wybierz odbiorcę.");
      return;
    }
    if (
      recipientId === ALL_USERS &&
      !confirm(
        `Wysłać tę wiadomość do wszystkich (${allUsersCount} kont)? Każde konto dostanie ją w czacie i e-mailem. Tego nie da się cofnąć.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const result = await startAdminConversation(recipientId, body);
        if (result.error) {
          setError(result.error);
        } else {
          setBody("");
          // In the chat either way; the warning says how many e-mails failed.
          setNotice(result.warning ?? "Wiadomość wysłana.");
        }
      } catch {
        // The answer was lost, not necessarily the message: a blind retry of
        // a broadcast could put it into every conversation a second time.
        setError(
          "Nie dostaliśmy odpowiedzi — wiadomość mogła już wyjść. Sprawdź listę rozmów poniżej (odśwież stronę), zanim wyślesz ją ponownie."
        );
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="recipientId">Odbiorca</Label>
        <select
          id="recipientId"
          value={recipientId}
          onChange={(e) => setRecipientId(e.target.value)}
          required
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="" disabled>
            — wybierz odbiorcę —
          </option>
          <option value={ALL_USERS}>Wszyscy użytkownicy ({allUsersCount})</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name || u.id}
            </option>
          ))}
        </select>
        {recipientId === ALL_USERS && (
          <p className="text-xs text-muted-foreground">
            Przy wszystkich kontach wysyłka może potrwać kilka sekund — poczekaj na potwierdzenie.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="body">Wiadomość</Label>
        <Textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          required
          placeholder="Treść wiadomości…"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && !error && <p className="text-sm text-muted-foreground">{notice}</p>}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Chwileczkę…" : "Wyślij"}
      </Button>
    </form>
  );
}
