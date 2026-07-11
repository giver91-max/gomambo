"use client";

import { useState, useTransition } from "react";
import { sendAdminChatMessage } from "../actions";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function AdminReplyForm({ conversationId }: { conversationId: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await sendAdminChatMessage(conversationId, body);
      if (result.error) {
        setError(result.error);
      } else {
        setBody("");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        required
        placeholder="Napisz wiadomość…"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Chwileczkę…" : "Wyślij"}
      </Button>
    </form>
  );
}
