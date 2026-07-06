"use client";

import { useState, useTransition } from "react";
import { MonthCalendar } from "@/components/month-calendar";
import { toggleAvailability, addAvailabilityRange, removeAvailabilityRange } from "./actions";
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
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const todayIso = toISODate(new Date());

  function handleDayClick(iso: string) {
    const willBeAvailable = !available.has(iso);
    setAvailable((prev) => {
      const next = new Set(prev);
      if (willBeAvailable) next.add(iso);
      else next.delete(iso);
      return next;
    });
    startTransition(() => toggleAvailability(carId, iso, willBeAvailable));
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
        Kliknij dzień, aby oznaczyć go jako dostępny lub niedostępny. Możesz też
        zaznaczyć cały zakres dat poniżej.
      </p>

      <div className="max-w-xs">
        <MonthCalendar highlightedDates={available} onDayClick={handleDayClick} minDateIso={todayIso} />
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
