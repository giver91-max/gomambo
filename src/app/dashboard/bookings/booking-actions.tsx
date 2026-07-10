"use client";

import { useState, useTransition } from "react";
import { updateBookingStatus } from "./actions";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@/types/database";

export function BookingActions({
  bookingId,
  status,
}: {
  bookingId: string;
  status: BookingStatus;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleUpdate(nextStatus: "accepted" | "declined" | "completed") {
    setError(null);
    startTransition(async () => {
      const result = await updateBookingStatus(bookingId, nextStatus);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        {status === "requested" && (
          <>
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
          </>
        )}
        {status === "accepted" && (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => handleUpdate("completed")}
          >
            Zakończ wypożyczenie
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
