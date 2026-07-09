"use client";

import { useFormState } from "react-dom";
import { updateProfile, type ProfileState } from "./actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";
import type { Profile } from "@/types/database";

const initialState: ProfileState = { error: null };

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, formAction] = useFormState(updateProfile, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">Imię i nazwisko</Label>
        <Input id="fullName" name="fullName" required defaultValue={profile.full_name} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Telefon</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          placeholder="np. 500 100 200"
          defaultValue={profile.phone ?? ""}
        />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.success && !state.error && (
        <p className="text-sm text-muted-foreground">Zapisano zmiany.</p>
      )}

      <SubmitButton>Zapisz zmiany</SubmitButton>
    </form>
  );
}
