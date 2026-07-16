"use client";

import { useState, useTransition } from "react";
import { createStripeConnectOnboardingLink } from "@/app/dashboard/profile/stripe-connect-actions";
import { Button } from "@/components/ui/button";

export function StripeConnectManager({ onboarded }: { onboarded: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await createStripeConnectOnboardingLink();
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  if (onboarded) {
    return (
      <p className="text-sm text-muted-foreground">
        ✅ Konto do wypłat jest skonfigurowane. Możesz przyjmować płatności za wynajem.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Żeby otrzymywać płatności za wynajem bezpośrednio na swoje konto, skonfiguruj
        wypłaty przez Stripe. Zajmuje kilka minut.
      </p>
      <Button type="button" onClick={handleClick} disabled={isPending}>
        {isPending ? "Przekierowywanie…" : "Skonfiguruj konto do wypłat"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
