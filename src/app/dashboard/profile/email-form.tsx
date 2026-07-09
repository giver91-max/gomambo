"use client";

import { useFormState } from "react-dom";
import { updateEmail, type ProfileState } from "./actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";

const initialState: ProfileState = { error: null };

export function EmailForm({ email }: { email: string }) {
  const [state, formAction] = useFormState(updateEmail, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Adres e-mail</Label>
        <Input id="email" name="email" type="email" required defaultValue={email} />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.success && !state.error && (
        <p className="text-sm text-muted-foreground">
          Wysłaliśmy link potwierdzający na nowy adres e-mail. Zmiana zacznie obowiązywać po
          kliknięciu w link.
        </p>
      )}

      <SubmitButton>Zmień e-mail</SubmitButton>
    </form>
  );
}
