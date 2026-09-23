"use client";

import { useState, useTransition } from "react";
import { resolveBookingVerification } from "./actions";
import { adminCancelBooking } from "@/app/admin/bookings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResolveVerificationButton({
  bookingId,
  overdue,
}: {
  bookingId: string;
  /** Past the 24h deadline — cancellation is on the table. */
  overdue: boolean;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(decision: "approve" | "keep_blocked") {
    setError(null);
    startTransition(async () => {
      const result = await resolveBookingVerification(bookingId, decision, note);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-2">
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Notatka do decyzji (opcjonalnie)"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={isPending} onClick={() => run("approve")}>
          {isPending ? "Chwileczkę…" : "Zatwierdzam — wydajcie auto"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => run("keep_blocked")}
        >
          Zostaw wstrzymane
        </Button>
        {overdue && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-destructive"
            disabled={isPending}
            onClick={() => {
              if (!confirm("Odwołać rezerwację i zwrócić wpłatę najemcy?")) return;
              setError(null);
              startTransition(async () => {
                const result = await adminCancelBooking(bookingId);
                if (result?.error) setError(result.error);
              });
            }}
          >
            Anuluj rezerwację ze zwrotem
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
