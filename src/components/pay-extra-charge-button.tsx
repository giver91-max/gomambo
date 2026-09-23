"use client";

import { useState, useTransition } from "react";
import {
  declareExtraChargeBankTransfer,
  payExtraCharge,
} from "@/app/dashboard/rentals/payment-actions";
import { Button } from "@/components/ui/button";

export function PayExtraChargeButton({
  extraChargeId,
  amountPln,
  reason,
  paymentMethod,
}: {
  extraChargeId: string;
  amountPln: number;
  reason: string;
  paymentMethod: "stripe" | "bank_transfer";
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
    <div className="space-y-2 rounded-md border border-destructive/40 p-3">
      <p className="text-sm">
        Właściciel prosi o dopłatę <strong>{amountPln.toFixed(2)} zł</strong> — {reason}
      </p>
      {paymentMethod === "bank_transfer" && (
        <p className="text-xs">
          Czekamy na Twój przelew · tytuł:{" "}
          <code className="font-mono">{extraChargeId.slice(0, 8)}</code>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => pay(() => payExtraCharge(extraChargeId))}
          disabled={isPending}
        >
          {isPending ? "Chwileczkę…" : "Zapłać kartą lub BLIK-iem"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => pay(() => declareExtraChargeBankTransfer(extraChargeId))}
          disabled={isPending}
        >
          Zapłacę przelewem
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
