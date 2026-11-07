"use client";

import { useState, useTransition } from "react";
import { createStripeConnectOnboardingLink } from "@/app/dashboard/profile/stripe-connect-actions";
import { Button } from "@/components/ui/button";
import type { StripeMode } from "@/lib/stripe";

export function StripeConnectManager({
  onboarded,
  mode,
  isAdmin,
}: {
  onboarded: boolean;
  mode: StripeMode;
  isAdmin: boolean;
}) {
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

  // Until the Stripe key is live, payout accounts would be sandbox accounts
  // (see stripeMode). Owners are told the truth instead of being sent into a
  // form whose result will be thrown away; admins keep the button to test.
  if (mode !== "live" && !isAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        Wypłaty uruchomimy razem z wynajmem aut — wtedy damy Ci znać mailem i skonfigurujesz je
        w kilka minut. Teraz nic nie musisz robić.
      </p>
    );
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
      {mode !== "live" && (
        <p className="text-sm font-medium text-yellow-600">
          Stripe działa w trybie testowym — konto utworzone teraz jest testowe (widzi to tylko admin).
        </p>
      )}
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
