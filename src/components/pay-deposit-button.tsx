"use client";

import { useState, useTransition } from "react";
import { payDeposit } from "@/app/dashboard/rentals/payment-actions";
import { Button } from "@/components/ui/button";
import { formatZl } from "@/lib/deposit";

export function PayDepositButton({ bookingId, totalPln }: { bookingId: string; totalPln: number }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pay() {
    setError(null);
    startTransition(async () => {
      const result = await payDeposit(bookingId);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-1">
      <Button type="button" size="sm" onClick={pay} disabled={isPending}>
        {isPending ? "Chwileczkę…" : `Wpłać kaucję ${formatZl(totalPln)}`}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
