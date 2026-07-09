"use client";

import { useFormState } from "react-dom";
import { sendMessage, type MessageState } from "../actions";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";

const initialState: MessageState = { error: null };

export function ReplyForm({ conversationId }: { conversationId: string }) {
  const sendWithId = sendMessage.bind(null, conversationId);
  const [state, formAction] = useFormState(sendWithId, initialState);

  return (
    <form action={formAction} className="space-y-2">
      <Textarea name="body" rows={3} required placeholder="Napisz wiadomość…" />
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <SubmitButton>Wyślij</SubmitButton>
    </form>
  );
}
