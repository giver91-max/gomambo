"use client";

import { useState, useTransition } from "react";
import { payExtraCharge } from "@/app/dashboard/rentals/payment-actions";
import { Button } from "@/components/ui/button";

export function PayExtraChargeButton({
  extraChargeId,
  amountPln,
  reason,
}: {
  extraChargeId: string;
  amountPln: number;
  reason: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await payExtraCharge(extraChargeId);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-1 rounded-md border border-destructive/40 p-3">
      <p className="text-sm">
        Właściciel prosi o dopłatę <strong>{amountPln.toFixed(2)} zł</strong> — {reason}
      </p>
      <Button type="button" size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? "Przekierowywanie…" : "Zapłać dopłatę"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
