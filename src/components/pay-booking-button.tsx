"use client";

import { useState, useTransition } from "react";
import { createBookingCheckoutSession } from "@/app/dashboard/rentals/payment-actions";
import { Button } from "@/components/ui/button";

export function PayBookingButton({ bookingId }: { bookingId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await createBookingCheckoutSession(bookingId);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-1">
      <Button type="button" size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? "Przekierowywanie…" : "Zapłać i potwierdź rezerwację"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
