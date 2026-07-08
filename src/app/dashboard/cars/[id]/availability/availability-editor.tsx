"use client";

import { useState, useTransition } from "react";
import { MonthCalendar } from "@/components/month-calendar";
import { addAvailabilityRange, removeAvailabilityRange } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toISODate, eachDateInRange } from "@/lib/calendar";

export function AvailabilityEditor({
  carId,
  initialAvailable,
}: {
  carId: string;
  initialAvailable: string[];
}) {
  const [available, setAvailable] = useState(() => new Set(initialAvailable));
  const [isPending, startTransition] = useTransition();
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const todayIso = toISODate(new Date());

  function handleDayClick(iso: string) {
    if (pendingStart === null) {
      setPendingStart(iso);
      return;
    }

    const [from, to] = pendingStart <= iso ? [pendingStart, iso] : [iso, pendingStart];
    const dates = eachDateInRange(from, to);
    setAvailable((prev) => {
      const next = new Set(prev);
      dates.forEach((d) => next.add(d));
      return next;
    });
    startTransition(() => addAvailabilityRange(carId, from, to));
    setPendingStart(null);
  }

  function handleAddRange() {
    if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return;
    const dates = eachDateInRange(rangeStart, rangeEnd);
    setAvailable((prev) => {
      const next = new Set(prev);
      dates.forEach((iso) => next.add(iso));
      return next;
    });
    startTransition(() => addAvailabilityRange(carId, rangeStart, rangeEnd));
  }

  function handleRemoveRange() {
    if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return;
    const dates = new Set(eachDateInRange(rangeStart, rangeEnd));
    setAvailable((prev) => {
      const next = new Set(prev);
      dates.forEach((iso) => next.delete(iso));
      return next;
    });
    startTransition(() => removeAvailabilityRange(carId, rangeStart, rangeEnd));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {pendingStart
          ? "Kliknij dzień końcowy, aby oznaczyć cały zakres jako dostępny."
          : "Kliknij dzień początkowy i końcowy, aby oznaczyć cały zakres jako dostępny. Aby usunąć dostępność, użyj pól poniżej."}
        {pendingStart && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => setPendingStart(null)}
              className="text-primary hover:underline"
            >
              Anuluj wybór
            </button>
          </>
        )}
      </p>

      <div className="max-w-xs">
        <MonthCalendar
          highlightedDates={available}
          selectedRange={pendingStart ? { start: pendingStart, end: pendingStart } : undefined}
          onDayClick={handleDayClick}
          minDateIso={todayIso}
        />
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t pt-4">
        <div className="space-y-1.5">
          <Label htmlFor="rangeStart">Od</Label>
          <Input
            id="rangeStart"
            type="date"
            value={rangeStart}
            min={todayIso}
            onChange={(e) => setRangeStart(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rangeEnd">Do</Label>
          <Input
            id="rangeEnd"
            type="date"
            value={rangeEnd}
            min={rangeStart || todayIso}
            onChange={(e) => setRangeEnd(e.target.value)}
          />
        </div>
        <Button type="button" onClick={handleAddRange} disabled={isPending}>
          Oznacz jako dostępne
        </Button>
        <Button type="button" variant="outline" onClick={handleRemoveRange} disabled={isPending}>
          Oznacz jako niedostępne
        </Button>
      </div>
    </div>
  );
}
