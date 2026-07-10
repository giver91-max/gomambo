"use client";

import { useState, useTransition } from "react";
import { setMaintenanceMode } from "./actions";
import { Button } from "@/components/ui/button";

export function MaintenanceModeToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const next = !enabled;
    setError(null);
    setEnabled(next);
    startTransition(async () => {
      try {
        await setMaintenanceMode(next);
      } catch (e) {
        setEnabled(!next);
        setError(e instanceof Error ? e.message : "Błąd");
      }
    });
  }

  return (
    <div
      className={
        enabled
          ? "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-yellow-600/30 bg-yellow-600/10 p-3"
          : "flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
      }
    >
      <div>
        <p className="font-medium">
          {enabled ? "Wszystkie auta są ukryte dla odwiedzających" : "Ogłoszenia są widoczne publicznie"}
        </p>
        <p className="text-sm text-muted-foreground">
          {enabled
            ? "Strona główna i /auta nie pokazują żadnych aut — przydatne na czas prac nad stroną."
            : "Ukryj wszystkie ogłoszenia jednym kliknięciem, np. na czas prac nad stroną."}
        </p>
        {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
      </div>
      <Button
        type="button"
        variant={enabled ? "destructive" : "outline"}
        size="sm"
        disabled={isPending}
        onClick={handleToggle}
      >
        {enabled ? "Pokaż auta z powrotem" : "Ukryj wszystkie auta"}
      </Button>
    </div>
  );
}
