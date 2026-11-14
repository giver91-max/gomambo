"use client";

import { useState, useTransition } from "react";
import {
  createBookingCheckoutSession,
  declareBankTransfer,
} from "@/app/dashboard/rentals/payment-actions";
import { Button } from "@/components/ui/button";
import { DEPOSIT_REQUEST_LEAD_DAYS, formatZl } from "@/lib/deposit";

export function PayBookingButton({
  bookingId,
  depositAmount,
  depositFee,
}: {
  bookingId: string;
  // Only to tell the renter what comes later: the deposit is never part of
  // this payment, so both ways of paying the rental stay open.
  depositAmount: number;
  depositFee: number;
}) {
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => pay(() => declareBankTransfer(bookingId))}
          disabled={isPending}
        >
          Zapłacę przelewem
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Przy przelewie rezerwacja zostanie potwierdzona dopiero, gdy zaksięgujemy wpłatę.
      </p>
      {depositAmount > 0 && (
        <p className="text-xs text-muted-foreground">
          Kaucję {formatZl(depositAmount)} (+{formatZl(depositFee)} opłaty za jej obsługę) wpłacisz
          osobno, kartą lub BLIK-iem, {DEPOSIT_REQUEST_LEAD_DAYS} dni przed odbiorem.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
