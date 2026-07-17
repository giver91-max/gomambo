"use client";

import { useFormState } from "react-dom";
import { updatePassword, type ProfileState } from "./actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";

const initialState: ProfileState = { error: null };

export function PasswordForm() {
  const [state, formAction] = useFormState(updatePassword, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="currentPassword">Obecne hasło</Label>
        <Input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="newPassword">Nowe hasło</Label>
        <Input id="newPassword" name="newPassword" type="password" required minLength={6} autoComplete="new-password" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Powtórz nowe hasło</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" required minLength={6} autoComplete="new-password" />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.success && !state.error && (
        <p className="text-sm text-muted-foreground">Hasło zostało zmienione.</p>
      )}

      <SubmitButton>Zmień hasło</SubmitButton>
    </form>
  );
}
