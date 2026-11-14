"use client";

import { useState, useTransition } from "react";
import { confirmVehicleOk } from "@/app/dashboard/bookings/actions";
import { Button } from "@/components/ui/button";
import { formatZl } from "@/lib/deposit";

export function ConfirmVehicleOkButton({
  bookingId,
  depositAmount,
}: {
  bookingId: string;
  depositAmount: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (
      !confirm(
        `Potwierdzasz, że auto jest w porządku? Kaucja ${formatZl(depositAmount)} od razu wróci do najemcy i nie będzie można jej już zatrzymać.`
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const result = await confirmVehicleOk(bookingId);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-1">
      <Button type="button" size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? "Chwileczkę…" : "Auto w porządku — zwróć kaucję"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
