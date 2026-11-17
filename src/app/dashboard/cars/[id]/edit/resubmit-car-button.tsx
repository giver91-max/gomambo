"use client";

import { useState, useTransition } from "react";
import { resubmitRejectedCar } from "./actions";
import { Button } from "@/components/ui/button";

const CONNECTION_FAILED =
  "Nie udało się połączyć z GoMambo — sprawdź internet i spróbuj ponownie. Jeśli błąd się powtarza, odśwież stronę.";

export function ResubmitCarButton({ carId }: { carId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      // Caught here: a dropped connection would otherwise rethrow into
      // Next's bare "Application error" screen.
      try {
        const result = await resubmitRejectedCar(carId);
        if (!result || result.error) setError(result?.error ?? CONNECTION_FAILED);
        else setDone(true);
      } catch (err) {
        console.error("resubmit car", err);
        setError(CONNECTION_FAILED);
      }
    });
  }

  if (done) {
    return (
      <p className="text-sm font-medium">
        Wysłane — auto czeka na ponowną weryfikację. Damy znać mailem.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={handleClick} disabled={isPending}>
        {isPending ? "Wysyłanie…" : "Wyślij do ponownej weryfikacji"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
