"use client";

import { useState, useTransition } from "react";
import { updateBookingStatus } from "./actions";
import { Button } from "@/components/ui/button";

export function BookingActions({ bookingId }: { bookingId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleUpdate(status: "accepted" | "declined") {
    setError(null);
    startTransition(async () => {
      const result = await updateBookingStatus(bookingId, status);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Button size="sm" disabled={isPending} onClick={() => handleUpdate("accepted")}>
          Zaakceptuj
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => handleUpdate("declined")}
        >
          Odrzuć
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
