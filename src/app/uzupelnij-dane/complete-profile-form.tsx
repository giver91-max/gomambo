"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProfile, type ProfileState } from "@/app/dashboard/profile/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const initialState: ProfileState = { error: null };

export function CompleteProfileForm({
  fullName,
  phone,
  redirectTo,
}: {
  fullName: string;
  phone: string;
  redirectTo: string;
}) {
  const [state, setState] = useState<ProfileState>(initialState);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateProfile(initialState, formData);
      if (result.error) {
        setState(result);
      } else {
        router.push(redirectTo);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">Imię i nazwisko</Label>
        <Input id="fullName" name="fullName" required defaultValue={fullName} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Telefon</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          required
          placeholder="np. 500 100 200"
          defaultValue={phone}
        />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Zapisywanie…" : "Zapisz i kontynuuj"}
      </Button>
    </form>
  );
}
