"use client";

import { useState, useTransition } from "react";
import { resubmitRejectedCar } from "./actions";
import { Button } from "@/components/ui/button";

export function ResubmitCarButton({ carId }: { carId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await resubmitRejectedCar(carId);
      if (result.error) setError(result.error);
      else setDone(true);
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
