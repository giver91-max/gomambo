"use client";

import { useState, useTransition } from "react";
import { toggleCarPause } from "./[id]/edit/actions";
import { Button } from "@/components/ui/button";

const CONNECTION_FAILED =
  "Nie udało się połączyć z GoMambo — sprawdź internet i spróbuj ponownie. Jeśli błąd się powtarza, odśwież stronę.";

export function PauseToggleButton({
  carId,
  status,
}: {
  carId: string;
  status: "approved" | "paused";
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      // Caught here: a dropped connection would otherwise rethrow into
      // Next's bare "Application error" screen.
      try {
        const result = await toggleCarPause(carId);
        if (!result || result.error) setError(result?.error ?? CONNECTION_FAILED);
      } catch (err) {
        console.error("pause toggle", err);
        setError(CONNECTION_FAILED);
      }
    });
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? "Chwileczkę…" : status === "approved" ? "Wstrzymaj ogłoszenie" : "Wznów ogłoszenie"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
