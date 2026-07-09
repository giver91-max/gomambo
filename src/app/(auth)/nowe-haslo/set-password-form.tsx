"use client";

import { useState, useTransition } from "react";
import { updatePasswordAfterReset, type AuthActionState } from "../actions";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const initialState: AuthActionState = { error: null };

export function SetPasswordForm() {
  const [state, setState] = useState<AuthActionState>(initialState);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updatePasswordAfterReset(initialState, formData);
      // Redirects to /dashboard on success instead of returning a value —
      // only update state on failure, otherwise the page is navigating away.
      if (result) setState(result);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">Nowe hasło</Label>
        <PasswordInput
          id="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Chwileczkę…" : "Ustaw nowe hasło"}
      </Button>
    </form>
  );
}
