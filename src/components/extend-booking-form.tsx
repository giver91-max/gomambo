"use client";

import { useState, useTransition } from "react";
import { requestBookingExtension } from "@/app/dashboard/rentals/payment-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ExtendBookingForm({
  bookingId,
  currentEndDate,
}: {
  bookingId: string;
  currentEndDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [newEndDate, setNewEndDate] = useState(currentEndDate);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await requestBookingExtension(bookingId, newEndDate);
      if (result?.error) setError(result.error);
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Przedłuż wynajem
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <label className="block text-xs text-muted-foreground" htmlFor={`extend-${bookingId}`}>
        Nowa data zakończenia
      </label>
      <Input
        id={`extend-${bookingId}`}
        type="date"
        min={currentEndDate}
        value={newEndDate}
        onChange={(e) => setNewEndDate(e.target.value)}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={isPending} onClick={handleSubmit}>
          {isPending ? "Przekierowywanie…" : "Przejdź do płatności"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setOpen(false)}>
          Anuluj
        </Button>
      </div>
    </div>
  );
}
