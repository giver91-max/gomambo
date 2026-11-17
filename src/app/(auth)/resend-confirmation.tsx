"use client";

import { useState, useTransition } from "react";
import { resendConfirmation, type AuthActionState } from "./actions";
import { SUBMIT_FAILED_MESSAGE } from "./auth-errors";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { getRecaptchaToken } from "@/lib/recaptcha-client";

const initialState: AuthActionState = { error: null };

/**
 * "Wyślij link ponownie" for an address whose confirmation link never
 * arrived or has expired. With `email` (the login form already has it) it is
 * just the button; without (the "check your inbox" page does not keep the
 * address anywhere, least of all in the URL) it asks for the address first.
 */
export function ResendConfirmation({ email, next }: { email?: string; next: string }) {
  const [state, setState] = useState<AuthActionState>(initialState);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const address = String(formData.get("email") ?? "").trim();
    startTransition(async () => {
      try {
        const token = await getRecaptchaToken("resend_confirmation");
        formData.set("recaptchaToken", token ?? "");
        const result = await resendConfirmation(initialState, formData);
        setState(result);
        if (result.success) setSentTo(address);
      } catch {
        setState({ error: SUBMIT_FAILED_MESSAGE });
      }
    });
  }

  if (sentTo) {
    return (
      <p className="text-sm text-muted-foreground">
        {email ? (
          <>
            Wysłaliśmy nowy link aktywacyjny na <strong>{sentTo}</strong>.
          </>
        ) : (
          <>
            Jeśli <strong>{sentTo}</strong> czeka na potwierdzenie, wysłaliśmy na ten adres nowy
            link aktywacyjny.
          </>
        )}{" "}
        Kliknij go — najlepiej na tym samym urządzeniu — i sprawdź też folder ze spamem.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      {email ? (
        <input type="hidden" name="email" value={email} />
      ) : (
        <div className="space-y-2">
          <Label htmlFor="resend-email">Email</Label>
          <Input id="resend-email" name="email" type="email" required autoComplete="email" />
        </div>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button
        type="submit"
        variant={email ? "default" : "outline"}
        className="w-full"
        disabled={isPending}
      >
        {isPending ? "Wysyłanie…" : "Wyślij link ponownie"}
      </Button>
    </form>
  );
}
