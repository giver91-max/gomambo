"use client";

import { useFormState } from "react-dom";
import { sendMessageToAdmin, type AdminChatState } from "../actions";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";

const initialState: AdminChatState = { error: null };

export function AdminChatReplyForm() {
  const [state, formAction] = useFormState(sendMessageToAdmin, initialState);

  return (
    <form action={formAction} className="space-y-2">
      <Textarea name="body" rows={3} required placeholder="Napisz wiadomość…" />
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <SubmitButton>Wyślij</SubmitButton>
    </form>
  );
}
