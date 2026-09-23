"use client";

import { useState, useTransition } from "react";
import {
  createBookingCheckoutSession,
  declareBankTransfer,
} from "@/app/dashboard/rentals/payment-actions";
import { Button } from "@/components/ui/button";

export function PayBookingButton({
  bookingId,
  depositAmount,
}: {
  bookingId: string;
  // A wire transfer leaves no card on file, so there is nothing to place the
  // security-deposit hold on — the renter would drive off with zero
  // collateral. Rafał's call: don't offer the transfer for such cars at all.
  depositAmount: number | null;
}) {
  const requiresCard = !!depositAmount && depositAmount > 0;
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pay(action: () => Promise<{ error: string | null } | undefined>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => pay(() => createBookingCheckoutSession(bookingId))}
          disabled={isPending}
        >
          {isPending ? "Chwileczkę…" : "Zapłać kartą lub BLIK-iem"}
        </Button>
        {!requiresCard && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => pay(() => declareBankTransfer(bookingId))}
            disabled={isPending}
          >
            Zapłacę przelewem
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {requiresCard
          ? `To auto ma kaucję ${Math.round(depositAmount!)} zł, którą blokujemy na karcie — dlatego ten wynajem opłacasz kartą lub BLIK-iem. Kaucja nie jest pobierana, tylko blokowana, i wraca po zakończeniu wynajmu.`
          : "Przy przelewie rezerwacja zostanie potwierdzona dopiero, gdy zaksięgujemy wpłatę."}
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
