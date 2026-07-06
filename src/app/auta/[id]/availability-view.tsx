"use client";

import { useState } from "react";
import { MonthCalendar } from "@/components/month-calendar";
import { toISODate } from "@/lib/calendar";

export type SelectedRange = { start: string; end: string | null };

export function AvailabilityView({
  availableDates,
  onRangeChange,
}: {
  availableDates: string[];
  onRangeChange?: (range: SelectedRange) => void;
}) {
  const available = new Set(availableDates);
  const [range, setRange] = useState<SelectedRange>({ start: "", end: null });

  function handleDayClick(iso: string) {
    setRange((prev) => {
      const next: SelectedRange =
        !prev.start || (prev.start && prev.end)
          ? { start: iso, end: null }
          : iso < prev.start
            ? { start: iso, end: null }
            : { start: prev.start, end: iso };
      onRangeChange?.(next);
      return next;
    });
  }

  const todayIso = toISODate(new Date());

  if (availableDates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Właściciel nie oznaczył jeszcze żadnych dostępnych terminów. Napisz
        wiadomość poniżej, aby zapytać o dostępność.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <MonthCalendar
        highlightedDates={available}
        selectedRange={range}
        onDayClick={handleDayClick}
        minDateIso={todayIso}
        restrictToHighlighted
      />
      <p className="text-xs text-muted-foreground">
        Zielone dni są dostępne. Kliknij dzień początkowy i końcowy, aby zaznaczyć
        termin — zostanie dołączony do zapytania.
      </p>
    </div>
  );
}
