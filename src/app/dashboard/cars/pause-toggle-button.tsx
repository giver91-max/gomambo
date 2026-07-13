"use client";

import { useState, useTransition } from "react";
import { toggleCarPause } from "./[id]/edit/actions";
import { Button } from "@/components/ui/button";

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
      const result = await toggleCarPause(carId);
      if (result.error) setError(result.error);
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
