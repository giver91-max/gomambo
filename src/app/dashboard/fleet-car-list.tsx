"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PauseToggleButton } from "./cars/pause-toggle-button";
import { bulkDeleteCars, bulkSetCarStatus } from "./cars/[id]/edit/actions";
import { summarizeAvailableRanges } from "@/lib/availability-summary";
import type { CarStatus } from "@/types/database";

const AVAILABILITY_WINDOW_DAYS = 60;

const statusLabel: Record<CarStatus, string> = {
  pending: "Oczekuje na zatwierdzenie",
  approved: "Zatwierdzone",
  rejected: "Odrzucone",
  paused: "Wstrzymane",
};

const statusVariant: Record<CarStatus, "secondary" | "default" | "destructive"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  paused: "secondary",
};

type FleetCar = {
  id: string;
  brand: string;
  model: string;
  year: number;
  city: string;
  price_per_day: number;
  status: CarStatus;
  rejection_reason: string | null;
};

export function FleetCarList({
  cars,
  availabilityByCarId,
}: {
  cars: FleetCar[];
  availabilityByCarId: Record<string, string[]>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(carId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(carId)) next.delete(carId);
      else next.add(carId);
      return next;
    });
  }

  function reportFailures(label: string, failed: { carId: string; error: string }[]) {
    if (failed.length === 0) {
      setError(null);
      setSelected(new Set());
      return;
    }
    setError(`${label}: nie udało się dla ${failed.length} aut — ${failed[0].error}`);
  }

  function handleBulkStatus(nextStatus: "approved" | "paused") {
    setError(null);
    startTransition(async () => {
      const result = await bulkSetCarStatus(Array.from(selected), nextStatus);
      reportFailures(nextStatus === "paused" ? "Wstrzymanie" : "Wznowienie", result.failed);
    });
  }

  function handleBulkDelete() {
    if (!confirm(`Usunąć ${selected.size} zaznaczonych aut? Tej operacji nie można cofnąć.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await bulkDeleteCars(Array.from(selected));
      reportFailures("Usuwanie", result.failed);
    });
  }

  return (
    <div className="space-y-4">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
          <span className="text-sm font-medium">Zaznaczono: {selected.size}</span>
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => handleBulkStatus("paused")}>
            Wstrzymaj zaznaczone
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => handleBulkStatus("approved")}>
            Wznów zaznaczone
          </Button>
          <Button type="button" size="sm" variant="outline" className="text-destructive" disabled={isPending} onClick={handleBulkDelete}>
            Usuń zaznaczone
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setSelected(new Set())}>
            Odznacz wszystko
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {cars.map((car) => (
          <Card key={car.id} className={selected.has(car.id) ? "border-primary" : undefined}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={selected.has(car.id)}
                  onChange={() => toggle(car.id)}
                  aria-label={`Zaznacz ${car.brand} ${car.model}`}
                />
                <CardTitle className="text-base">
                  {car.brand} {car.model} ({car.year})
                </CardTitle>
              </div>
              <Badge variant={statusVariant[car.status]}>{statusLabel[car.status]}</Badge>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>{car.city}</p>
              <p>{Number(car.price_per_day).toFixed(2)} zł / dzień</p>
              {car.status === "rejected" && car.rejection_reason && (
                <p className="text-destructive">Powód odrzucenia: {car.rejection_reason}</p>
              )}
              {(car.status === "approved" || car.status === "paused") &&
                (() => {
                  const dates = availabilityByCarId[car.id] ?? [];
                  const { ranges, extraCount } = summarizeAvailableRanges(dates);
                  return ranges.length > 0 ? (
                    <p>
                      Dostępne: {ranges.join(", ")}
                      {extraCount > 0 ? ` +${extraCount} innych` : ""}
                    </p>
                  ) : (
                    <p className="text-amber-600 dark:text-amber-500">
                      Brak ustawionej dostępności w najbliższych {AVAILABILITY_WINDOW_DAYS} dniach
                    </p>
                  );
                })()}
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Link href={`/dashboard/cars/${car.id}/edit`} className="inline-block text-sm text-primary hover:underline">
                  Edytuj →
                </Link>
                <Link href={`/dashboard/cars/${car.id}/availability`} className="inline-block text-sm text-primary hover:underline">
                  {(availabilityByCarId[car.id]?.length ?? 0) > 0 ? "Zarządzaj dostępnością →" : "Ustaw dostępność →"}
                </Link>
                <Link href={`/dashboard/cars/new?duplicateFrom=${car.id}`} className="inline-block text-sm text-primary hover:underline">
                  Duplikuj to auto →
                </Link>
              </div>
              {(car.status === "approved" || car.status === "paused") && (
                <PauseToggleButton carId={car.id} status={car.status} />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
