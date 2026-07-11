"use client";

import { useState, useTransition } from "react";
import { startAdminConversation } from "./actions";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function ComposeForm({ users }: { users: { id: string; full_name: string }[] }) {
  const [recipientId, setRecipientId] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await startAdminConversation(recipientId || null, body);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setBody("");
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
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Wszyscy użytkownicy</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name || u.id}
            </option>
          ))}
        </select>
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
      {success && !error && <p className="text-sm text-muted-foreground">Wiadomość wysłana.</p>}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Chwileczkę…" : "Wyślij"}
      </Button>
    </form>
  );
}
